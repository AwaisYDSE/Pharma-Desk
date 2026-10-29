// Sync engine: device ⇄ shop server PC.
//  push: sends the outbox in order; the server applies each op once (idempotent).
//  pull: fetches every change since the last revision and stores it locally, so the
//        device always holds a full copy of the shop's data.
// Batch stock on a device = server stock + this device's not-yet-synced changes,
// so offline sales are visible immediately and never double-counted after sync.
// © Awais Amin
import type { Ctx, Pairing } from './db.ts';
import { getMeta, setMeta, emit } from './db.ts';
import type { Op, OpResult, PullResponse, Synced, SyncTable } from '../../shared/types.ts';
import { NetworkError, AppError, PIN_MISMATCH_MESSAGE } from '../../shared/util.ts';

/** Sends every pending change to the server, oldest first. Used by sync and before an online sale. */
export async function flushOutbox(ctx: Ctx, client: ServerClient): Promise<OpResult[]> {
  const all: OpResult[] = [];
  for (;;) {
    const ops = await ctx.db.outbox.where('status').equals('pending').limit(50).sortBy('seq');
    if (!ops.length) break;
    const { results } = await client.request<{ results: OpResult[] }>('POST', '/api/ops', { ops: ops.map(stripLocal) }, { session: false });
    await ctx.db.transaction('rw', [ctx.db.outbox, ctx.db.meta, ctx.db.batches, ctx.db.invoices], async () => {
      for (const r of results) {
        const op = ops.find(o => o.id === r.id);
        if (!op) continue;
        if (!r.ok) {
          // Undo this op's optimistic stock change locally; the server never applied it.
          for (const d of op.deltas) {
            const b = await ctx.db.batches.get(d.batchId);
            if (b) await ctx.db.batches.update(d.batchId, { qty: Number(b.qty || 0) - d.delta });
          }
          for (const row of op.rows) if (row.tbl === 'invoices') await ctx.db.invoices.update(row.row.id, { rejected: `${r.code}: ${r.message}` });
        }
        await ctx.db.outbox.update(op.seq!, r.ok
          ? { status: 'done', lastError: null }
          : { status: 'error', lastError: `${r.code}: ${r.message}`, attempts: (op.attempts || 0) + 1 });
      }
    });
    for (const r of results) {
      all.push(r);
      if (!r.ok) emit(ctx, 'op-rejected', r);
      if (r.conflicts?.length && r.ok) emit(ctx, 'stock-conflict', r);
      if (r.reallocations?.length) emit(ctx, 'fefo-reallocated', r);
    }
    if (results.length < ops.length) break;
  }
  return all;
}

export class ServerClient {
  ctx: Ctx;
  timeoutMs = 6000;
  constructor(ctx: Ctx) { this.ctx = ctx; }

  get pairing(): Pairing {
    if (!this.ctx.pairing) throw new AppError('NOT_PAIRED', 'This device is not paired with a shop server');
    return this.ctx.pairing;
  }

  /** Tries the last working address first, then the others (LAN → Tailscale → Cloudflare). */
  async request<T>(method: string, path: string, body?: unknown, { session = true } = {}): Promise<T> {
    const p = this.pairing;
    const preferred = await getMeta<string | null>(this.ctx.db, 'lastGoodUrl', null);
    const urls = [...new Set([preferred, ...p.urls].filter(Boolean) as string[])];
    let lastErr: unknown = new NetworkError();
    for (const base of urls) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.ctx.fetch(base.replace(/\/$/, '') + path, {
          method, signal: ctl.signal,
          headers: {
            'content-type': 'application/json', authorization: `Bearer ${p.token}`,
            ...(session && this.ctx.sessionId ? { 'x-session': this.ctx.sessionId } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e) { lastErr = new NetworkError(); continue; } finally { clearTimeout(t); }
      if (preferred !== base) await setMeta(this.ctx.db, 'lastGoodUrl', base);
      const data = await res.json().catch(() => ({})) as { code?: string; message?: string };
      if (res.status === 401 && (data.code === 'UNAUTHORIZED' || data.code === 'DEVICE_REMOVED')) {
        emit(this.ctx, 'unpaired', data.message || PIN_MISMATCH_MESSAGE);
        throw new AppError(data.code, data.message || PIN_MISMATCH_MESSAGE);
      }
      if (res.status === 401 && (data.code === 'SESSION_ENDED' || data.code === 'LOGIN_REQUIRED')) {
        emit(this.ctx, 'session-ended', data.message);
        throw new AppError(data.code, data.message || 'Session ended');
      }
      if (!res.ok) throw new AppError(data.code || 'ERROR', data.message || `Server error ${res.status}`);
      return data as T;
    }
    throw lastErr;
  }
}

/** Optimistic stock: re-apply this device's unsynced deltas on top of server values. */
async function pendingDeltas(ctx: Ctx): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  for (const op of await ctx.db.outbox.where('status').equals('pending').toArray()) {
    for (const d of op.deltas) m.set(d.batchId, (m.get(d.batchId) || 0) + d.delta);
  }
  return m;
}

/** Name used by the older modules (auth, inventory). */
export type HttpTransport = ServerClient;

export class SyncEngine {
  ctx: Ctx;
  client: ServerClient;
  running = false;
  timer: ReturnType<typeof setInterval> | null = null;
  constructor(ctx: Ctx, client?: ServerClient) { this.ctx = ctx; this.client = client || new ServerClient(ctx); }

  setOnline(v: boolean) {
    if (this.ctx.online !== v) { this.ctx.online = v; emit(this.ctx, 'online', v); }
  }

  /** Sends pending ops in order. Stops at the first network failure (order matters). */
  async push(): Promise<OpResult[]> {
    const all = await flushOutbox(this.ctx, this.client);
    // Keep the outbox small: drop delivered ops older than 7 days.
    const cutoff = new Date(Date.now() - 7 * 864e5).toISOString();
    await this.ctx.db.outbox.filter(o => o.status === 'done' && o.createdAt < cutoff).delete();
    return all;
  }

  /** Downloads all changes since the last pull into the local replica. */
  async pull(): Promise<number> {
    let since = await getMeta<number>(this.ctx.db, 'rev', 0);
    let total = 0;
    for (;;) {
      const r = await this.client.request<PullResponse>('GET', `/api/pull?since=${since}&limit=2000`, undefined, { session: false });
      if (r.changes.length) {
        const pend = await pendingDeltas(this.ctx);
        const pendingRows = new Set<string>();
        for (const op of await this.ctx.db.outbox.where('status').equals('pending').toArray()) for (const row of op.rows) pendingRows.add(`${row.tbl}:${row.row.id}`);
        const tables = [...new Set(r.changes.map(c => c.tbl))].map(t => this.ctx.db.tbl(t));
        await this.ctx.db.transaction('rw', [...tables, this.ctx.db.meta], async () => {
          for (const c of r.changes) {
            const t = this.ctx.db.tbl(c.tbl as SyncTable);
            let row = c.data as Synced & { qty?: number };
            if (pendingRows.has(`${c.tbl}:${c.id}`)) {
              const local = await t.get(c.id);
              if (local && (local.hlc || '') > (c.hlc || '')) row = { ...local, ...(c.tbl === 'batches' ? { qty: row.qty } : {}) } as typeof row;
            }
            if (c.tbl === 'batches') row = { ...row, qty: (row.qty || 0) + (pend.get(c.id) || 0) };
            await t.put(row);
            this.ctx.hlc.receive(c.hlc);
          }
          await setMeta(this.ctx.db, 'rev', r.rev);
        });
        total += r.changes.length;
      }
      since = r.rev;
      if (!r.more) break;
    }
    if (total) emit(this.ctx, 'data-changed', { pulled: total });
    await setMeta(this.ctx.db, 'lastSync', new Date().toISOString());
    return total;
  }

  /** Logins/logouts that happened while the server was off are reported afterwards. */
  async pushSessionEvents() {
    const evs = await this.ctx.db.sessionEvents.where('sent').equals(0).toArray();
    if (!evs.length) return;
    const r = await this.client.request<{ sessions: Record<string, string> }>('POST', '/api/sessions/offline', { events: evs }, { session: false });
    if (this.ctx.localSessionId && r.sessions[this.ctx.localSessionId] && !this.ctx.sessionId) this.ctx.sessionId = r.sessions[this.ctx.localSessionId];
    await this.ctx.db.sessionEvents.bulkUpdate(evs.map(e => ({ key: e.seq!, changes: { sent: 1 as const } })));
  }

  async syncNow(): Promise<{ pushed: number; pulled: number }> {
    if (this.running || !this.ctx.pairing) return { pushed: 0, pulled: 0 };
    this.running = true;
    try {
      await this.pushSessionEvents();
      const pushed = (await this.push()).length;
      const pulled = await this.pull();
      if (this.ctx.sessionId) await this.client.request('POST', '/api/heartbeat', {}).catch(() => {});
      this.setOnline(true);
      return { pushed, pulled };
    } catch (e) {
      if (e instanceof NetworkError) this.setOnline(false);
      throw e;
    } finally { this.running = false; }
  }

  start(intervalMs = 5000) {
    this.stop();
    const tick = () => this.syncNow().catch(() => {});
    tick();
    this.timer = setInterval(tick, intervalMs);
    if (typeof window !== 'undefined') window.addEventListener('online', tick);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

const stripLocal = (op: Op): Op => {
  const { seq, status, attempts, lastError, ...rest } = op;
  void seq; void status; void attempts; void lastError;
  return rest as Op;
};

/** Pair this device with a shop server (QR payload + PIN typed by the user). */
export async function pair(ctx: Ctx, qr: { sid: string; name: string; urls: string[] }, pin: string, deviceName: string, platform = '') {
  let lastErr: unknown = new NetworkError('Could not reach the shop server. Check Wi-Fi or internet.');
  for (const base of qr.urls) {
    let res: Response;
    try {
      res = await ctx.fetch(base.replace(/\/$/, '') + '/api/pair', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sid: qr.sid, pin, deviceName, platform }),
      });
    } catch { continue; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { lastErr = new AppError(data.code || 'PAIR_FAILED', data.message || PIN_MISMATCH_MESSAGE); break; }
    const pairing: Pairing = { serverId: data.serverId, serverName: data.serverName, token: data.token, deviceId: data.deviceId, beaconKey: data.beaconKey, urls: qr.urls };
    // A device belongs to exactly one shop. Pairing with a different shop wipes the old shop's data.
    if (ctx.pairing && ctx.pairing.serverId !== pairing.serverId) await ctx.db.delete().then(() => ctx.db.open());
    await setMeta(ctx.db, 'pairing', pairing);
    await setMeta(ctx.db, 'lastGoodUrl', base);
    ctx.pairing = pairing;
    ctx.deviceId = pairing.deviceId;
    return pairing;
  }
  throw lastErr;
}
