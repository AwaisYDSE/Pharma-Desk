// HTTP API of the shop server. Every route except /api/hello, /api/pair and the
// server-PC-only /local routes needs this shop's device token.
// © Awais Amin
import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import type { DB } from './db.ts';
import { getRow, allRows, putRow, tx, getSetting } from './db.ts';
import {
  ensureIdentity, getIdentity, pairDevice, requireDevice, PairLimiter, clientIp, isLocalRequest,
  rotatePin, resetPairings, renameServer, blockedToday, type DeviceClaims,
} from './identity.ts';
import { applyOp, pullChanges, serverClock } from './ops.ts';
import { builtinCatalog } from './catalog.ts';
import * as sup from './supervision.ts';
import * as ai from './ai.ts';
import { pairingPayload, pairingQr, type Endpoints } from './tunnel.ts';
import { can } from '../shared/permissions.ts';
import { licensingOn } from '../shared/vendor.ts';
import { licenseState, activateLicense, installId } from './license.ts';
import { pcCode, resetOwnerPin } from './owner-reset.ts';
import { setSupportAccess, supportOn, checkIn } from './vendor-link.ts';
import { VENDOR } from '../shared/vendor.ts';
import { AppError } from '../shared/util.ts';
import type { Op, User, Medicine, Batch, Invoice, InvoiceItem, Shop } from '../shared/types.ts';
import { isoDate, addDays, daysBetween } from '../shared/util.ts';

type Req = Request & { device?: DeviceClaims; user?: User; sessionId?: string };

/**
 * First-start only: save the shop profile and, if the owner chose it, load the
 * built-in Pakistan medicine list. There is no way to import the list later.
 */
export function setupShop(db: DB, name: string, choice: 'builtin' | 'own', owner: User, logo: string | null = null): number {
  if (getRow(db, 'shop', 'shop')) throw new AppError('EXISTS', 'The shop is already set up');
  let added = 0;
  tx(db, () => {
    putRow(db, 'shop', { id: 'shop', name, logo, catalogChoice: choice } as never, serverClock.tick());
    if (choice === 'builtin') for (const m of builtinCatalog()) { putRow(db, 'medicines', m, serverClock.tick()); added++; }
    sup.logEvent(db, 'shop.setup', { name, catalog: choice, medicines: added }, owner.id, owner.name);
  });
  return added;
}

export interface AppOptions { endpoints?: () => Endpoints; staticDir?: string; aiFetch?: typeof fetch; version?: string }

export function createApp(db: DB, opts: AppOptions = {}) {
  ensureIdentity(db);
  sup.openSessionTable(db);
  const app = express();
  const limiter = new PairLimiter();

  // Licensing lock, kept in memory and refreshed so each request check is instant.
  // Off entirely unless the vendor enabled it in shared/vendor.ts.
  const LOCK = { locked: false, needsKey: false };
  const refreshLock = async () => {
    try {
      const s = await licenseState(db); LOCK.locked = s.locked; LOCK.needsKey = s.needsKey;
      // Tell every device (through the synced shop record) whether billing is off, and why.
      const shop = getRow<Shop>(db, 'shop', 'shop');
      if (shop) {
        const want = s.locked && !s.needsKey ? { status: s.status, message: getSetting(db, 'vendor_message'), vendor: VENDOR.name } : null;
        if (JSON.stringify(shop.planLock || null) !== JSON.stringify(want)) putRow(db, 'shop', { ...shop, planLock: want } as Shop, serverClock.tick());
      }
    } catch { /* keep last */ }
  };
  /** Ask the vendor dashboard now (after activating, or when the owner taps "Check again"). */
  const checkInNow = async () => { await checkIn(db, { endpoints: opts.endpoints, version: opts.version }).catch(() => null); await refreshLock(); };
  if (licensingOn()) { void refreshLock(); setInterval(refreshLock, 60_000).unref?.(); }
  const requireUnlocked = () => { if (LOCK.locked) throw new AppError('LICENSE_LOCKED', 'This copy is not licensed or the plan has ended. Please renew with the vendor.'); };
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(express.json({ limit: '12mb' }));
  app.use((req, res, next) => {
    // Devices load the app from GitHub Pages / the installer and call this server.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, x-session');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const wrap = (fn: (req: Req, res: Response) => unknown) => async (req: Request, res: Response, next: NextFunction) => {
    try { const out = await fn(req as Req, res); if (out !== undefined && !res.headersSent) res.json(out); }
    catch (e) { next(e); }
  };

  /* ---------- public ---------- */
  app.get('/api/hello', (_req, res) => res.json({ app: 'pharmadesk', v: opts.version || '1.0.0' }));

  app.post('/api/pair', (req, res) => {
    if (LOCK.locked) return res.status(403).json({ code: 'LICENSE_LOCKED', message: 'This copy is not licensed or the plan has ended. Please renew with the vendor.' });
    const r = pairDevice(db, limiter, req.body || {}, clientIp(req));
    if (!r.ok) return res.status(r.status).json({ code: r.code, message: r.message });
    sup.logEvent(db, 'device.paired', { name: req.body?.deviceName, platform: req.body?.platform, ip: clientIp(req) });
    res.json(r.result);
  });

  /* ---------- server PC screen only (localhost, not through a tunnel) ---------- */
  const localOnly = (req: Request, res: Response, next: NextFunction) =>
    isLocalRequest(req) ? next() : res.status(403).json({ code: 'LOCAL_ONLY', message: 'Only available on the server PC itself' });

  app.get('/local/status', localOnly, wrap(async () => {
    const id = getIdentity(db)!;
    const endpoints = opts.endpoints?.() || { lan: [], tailscale: null, cloudflare: null };
    const qr = await pairingQr(pairingPayload(id.serverId, id.name, endpoints));
    return {
      serverId: id.serverId, name: id.name, pin: id.pin, endpoints, qrSvg: qr.svg, qrText: qr.text,
      needsOwner: sup.userCount(db) === 0, devices: listDevices(), blockedToday: blockedToday(db),
      license: await licenseState(db),
    };
  }));
  // Paste a licence key (server PC only). Stored only if it verifies.
  app.post('/local/activate', localOnly, wrap(async req => {
    const token = String(req.body?.token || '');
    const st = await activateLicense(db, token);
    await refreshLock();
    void checkInNow(); // show up in the vendor dashboard straight away
    return { status: st.state, license: await licenseState(db) };
  }));
  app.post('/local/setup-owner', localOnly, wrap(req => {
    if (licensingOn() && LOCK.needsKey) throw new AppError('LICENSE_REQUIRED', 'Enter your licence key before setting up the shop.');
    const { name, username, pin, email, shopName, catalog, logo, photo } = req.body || {};
    const img = (v: unknown, max = 400_000) => typeof v === 'string' && v.startsWith('data:image/') && v.length < max ? v : null;
    const owner = sup.createOwner(db, { name, username, pin, email, photo: img(photo) });
    if (shopName) renameServer(db, String(shopName).slice(0, 80));
    const added = setupShop(db, String(shopName || 'My Pharmacy').slice(0, 80), catalog === 'builtin' ? 'builtin' : 'own', owner, img(logo, 600_000));
    void checkInNow();
    return { ok: true, userId: owner.id, medicines: added };
  }));
  app.post('/local/checkin-now', localOnly, wrap(async () => { await checkInNow(); return { license: await licenseState(db) }; }));
  /** Forgot the owner PIN — only on the server PC itself. */
  app.get('/local/owner-reset', localOnly, wrap(() => ({ pcCode: pcCode(db), vendor: VENDOR.name, vendorReset: !!VENDOR.publicKey })));
  app.post('/local/owner-reset', localOnly, wrap(req => resetOwnerPin(db, { code: String(req.body?.code || ''), pin: String(req.body?.pin || '') })));
  /** The server PC is also a till: it pairs itself without typing the PIN. */
  app.post('/local/self-pair', localOnly, wrap(() => {
    const id = getIdentity(db)!;
    const r = pairDevice(db, limiter, { sid: id.serverId, pin: id.pin, deviceName: 'Server PC', platform: 'server' }, 'local');
    if (!r.ok) throw new AppError(r.code, r.message);
    return r.result;
  }));
  app.post('/local/pin/rotate', localOnly, wrap(() => ({ pin: rotatePin(db) })));
  app.post('/local/reset-pairings', localOnly, wrap(() => {
    resetPairings(db, (o, n) => ai.reencryptSecrets(db, o, n));
    sup.logEvent(db, 'device.reset_all', {});
    return { ok: true };
  }));

  /* ---------- paired devices ---------- */
  const device = requireDevice(db);
  app.use('/api', (req, res, next) => (req.path === '/hello' || req.path === '/pair') ? next() : device(req, res, next));

  /** Session = a user logged in on this device. Needed for owner tools and AI. */
  const session = (perm?: string) => (req: Request, res: Response, next: NextFunction) => {
    const r = req as Req;
    const sid = String(req.headers['x-session'] || '');
    const s = sid ? db.prepare(`SELECT user_id, device_id FROM sessions WHERE id = ?`).get(sid) as { user_id: string; device_id: string } | undefined : undefined;
    if (!s || s.device_id !== r.device?.did) return res.status(401).json({ code: 'LOGIN_REQUIRED', message: 'Please log in again' });
    const t = sup.touchSession(db, sid);
    if (!t.ok) return res.status(401).json({ code: 'SESSION_ENDED', message: t.reason });
    const u = getRow<User>(db, 'users', s.user_id)!;
    if (perm && !can(u, perm)) return res.status(403).json({ code: 'FORBIDDEN', message: 'You do not have permission for this' });
    r.user = u; r.sessionId = sid;
    next();
  };

  const deviceName = (req: Req) => (db.prepare(`SELECT name FROM paired_devices WHERE id = ?`).get(req.device!.did) as { name: string } | undefined)?.name || 'Device';

  app.post('/api/login', wrap(req => {
    const { username, pin } = req.body || {};
    const r = sup.login(db, String(username || ''), String(pin || ''), { id: req.device!.did, name: deviceName(req) });
    return { sessionId: r.sessionId, userId: r.user.id };
  }));
  app.post('/api/logout', wrap(req => { sup.logout(db, String(req.headers['x-session'] || ''), 'Logged out'); return { ok: true }; }));
  app.post('/api/heartbeat', session(), wrap(() => ({ ok: true, at: new Date().toISOString() })));

  /** Logins/logouts that happened on this device while the server was off. */
  app.post('/api/sessions/offline', wrap(req => {
    const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 500) : [];
    const map: Record<string, string> = {};
    for (const e of events) {
      const u = getRow<User>(db, 'users', String(e.userId));
      if (!u) continue;
      if (e.type === 'login') map[e.localId] = sup.startSession(db, u, { id: req.device!.did, name: deviceName(req) }, { at: e.at, offline: true }).sessionId;
      else if (e.type === 'logout' && (map[e.localId] || e.sessionId)) sup.logout(db, map[e.localId] || e.sessionId, e.reason || 'Logged out (offline)', e.at);
    }
    return { sessions: map };
  }));

  /* ---------- sync ---------- */
  app.post('/api/ops', wrap(req => {
    requireUnlocked(); // billing/stock changes stop when unlicensed or expired; reading still works
    const ops: Op[] = Array.isArray(req.body?.ops) ? req.body.ops.slice(0, 200) : [];
    return { results: ops.map(op => applyOp(db, { ...op, deviceId: req.device!.did })) };
  }));
  app.get('/api/pull', wrap(req => pullChanges(db, Number(req.query.since || 0), Math.min(5000, Number(req.query.limit || 2000)))));

  /* ---------- owner supervision ---------- */
  app.get('/api/supervision', session('users'), wrap(() => ({
    people: sup.workingNow(db), serverRuns: sup.serverRuns(db, 20), devices: listDevices(), blockedToday: blockedToday(db),
  })));
  app.get('/api/activity', session('users'), wrap(req => sup.activity(db, {
    userId: req.query.userId ? String(req.query.userId) : undefined, day: req.query.day ? String(req.query.day) : undefined,
  })));
  app.post('/api/users', session('users'), wrap(req => {
    const u = sup.saveUser(db, req.user!, req.body);
    return { id: u.id };
  }));
  app.delete('/api/users/:id', session('users'), wrap(req => { sup.deleteUser(db, req.user!, String(req.params.id)); return { ok: true }; }));
  app.post('/api/users/:id/logout', session('users.logout'), wrap(req => ({ closed: sup.forceLogout(db, req.user!, String(req.params.id)) })));
  app.post('/api/devices/:id/revoke', session('users.logout'), wrap(req => {
    db.prepare(`UPDATE paired_devices SET revoked = 1 WHERE id = ?`).run(String(req.params.id));
    db.prepare(`UPDATE sessions SET logout_at = ?, logout_reason = 'Device removed' WHERE device_id = ? AND logout_at IS NULL`).run(new Date().toISOString(), String(req.params.id));
    sup.logEvent(db, 'device.removed', { deviceId: req.params.id }, req.user!.id, req.user!.name);
    return { ok: true };
  }));
  app.post('/api/settings/ai', session('settings.ai'), wrap(async req => {
    if (typeof req.body?.key === 'string') ai.setGeminiKey(db, req.body.key || null);
    if (typeof req.body?.model === 'string') db.prepare(`INSERT INTO server_settings(key,value) VALUES ('gemini_model', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(req.body.model || ai.DEFAULT_MODEL);
    sup.logEvent(db, 'settings.ai', { keySet: ai.hasGeminiKey(db) }, req.user!.id, req.user!.name);
    return { hasKey: ai.hasGeminiKey(db), provider: ai.keyProvider(db), test: ai.hasGeminiKey(db) ? await ai.testKey(db, { fetch: opts.aiFetch }) : null };
  }));
  app.get('/api/settings/ai', session(), wrap(() => ({ hasKey: ai.hasGeminiKey(db), provider: ai.keyProvider(db) })));
  // Vendor support access: only the owner can switch it; it is shown on every device and logged.
  app.get('/api/settings/support', session(), wrap(() => ({ on: supportOn(db), available: !!VENDOR.vendorApi && licensingOn(), vendor: VENDOR.name })));
  app.post('/api/settings/support', session(), wrap(req => setSupportAccess(db, req.user!, !!req.body?.on)));

  /* ---------- AI ---------- */
  app.post('/api/ai/rx', session('ai'), wrap(req => ai.parsePrescription(db, req.body || {}, { fetch: opts.aiFetch }, req.device!.did)));
  app.post('/api/ai/interactions', session(), wrap(req => ai.checkInteractions(db, (req.body?.drugs || []).slice(0, 40), { fetch: opts.aiFetch }, req.device!.did)));
  app.get('/api/ai/insights', session('dashboard'), wrap(req => ai.dailyInsights(db, dailyStats(db), String(req.query.lang || 'en'), { fetch: opts.aiFetch })));

  /* ---------- the app itself (so the server PC and LAN phones can open it) ---------- */
  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir, { index: 'index.html', maxAge: '1h' }));
    app.get(/^\/(?!api|local).*/, (_req, res) => res.sendFile(path.join(opts.staticDir!, 'index.html')));
  }

  app.use((err: Error & { code?: string }, _req: Request, res: Response, _next: NextFunction) => {
    const httpStatus = (err as { status?: number; type?: string }).status;
    if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
      res.status(httpStatus).json({ code: httpStatus === 413 ? 'TOO_LARGE' : 'BAD_REQUEST', message: httpStatus === 413 ? 'Request is too large' : 'Bad request' });
      return;
    }
    const status = err instanceof AppError ? ({ FORBIDDEN: 403, NOT_FOUND: 404, BAD_LOGIN: 401, DISABLED: 403, LOCKED: 409, EXISTS: 409, DUPLICATE: 409 } as Record<string, number>)[err.code] || 400 : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ code: err.code || 'ERROR', message: status === 500 ? 'Server error' : err.message });
  });

  function listDevices() {
    return db.prepare(`SELECT id, name, platform, paired_at, last_seen, last_ip, revoked FROM paired_devices ORDER BY last_seen DESC`).all();
  }
  return app;
}

/** Numbers for the dashboard AI summary (and its offline fallback). */
export function dailyStats(db: DB, today = isoDate()): ai.DailyStats {
  const meds = new Map(allRows<Medicine>(db, 'medicines').map(m => [m.id, m]));
  const dayInv = (d: string) => allRows<Invoice>(db, 'invoices', `WHERE created_at >= ? AND created_at < ? AND status != 'void'`, `${d}T00:00:00`, `${addDays(d, 1)}T00:00:00`);
  const inv = dayInv(today);
  const ids = new Set(inv.map(i => i.id));
  const items = allRows<InvoiceItem>(db, 'invoiceItems').filter(i => ids.has(i.invoiceId));
  const revenue = inv.reduce((s, i) => s + i.total, 0);
  const profit = items.reduce((s, i) => s + (i.total - i.tax) - i.costPrice * i.qty, 0);
  const lastWeek = dayInv(addDays(today, -7)).reduce((s, i) => s + i.total, 0);
  const qtyBy = new Map<string, number>();
  for (const i of items) qtyBy.set(i.medicineId, (qtyBy.get(i.medicineId) || 0) + i.qty);
  const top = [...qtyBy].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, qty]) => ({ name: meds.get(id)?.name || '?', qty }));
  const batches = allRows<Batch>(db, 'batches', 'WHERE deleted = 0');
  const stock = new Map<string, number>();
  for (const b of batches) stock.set(b.medicineId, (stock.get(b.medicineId) || 0) + b.qty);
  // 14-day average sales per medicine → days of stock left
  const since = addDays(today, -14);
  const recentInv = new Set(allRows<Invoice>(db, 'invoices', `WHERE created_at >= ? AND status != 'void'`, `${since}T00:00:00`).map(i => i.id));
  const sold14 = new Map<string, number>();
  for (const i of allRows<InvoiceItem>(db, 'invoiceItems')) if (recentInv.has(i.invoiceId)) sold14.set(i.medicineId, (sold14.get(i.medicineId) || 0) + i.qty);
  const lowStock = [...meds.values()].filter(m => !m.deleted && (stock.get(m.id) || 0) <= (m.reorderLevel ?? 10))
    .map(m => { const q = stock.get(m.id) || 0, rate = (sold14.get(m.id) || 0) / 14; return { name: m.name, qty: q, daysLeft: rate ? Math.floor(q / rate) : null }; })
    .slice(0, 10);
  const expiring = batches.filter(b => !b.pending && b.qty > 0 && b.expiryDate && daysBetween(today, b.expiryDate) <= 30)
    .map(b => ({ name: meds.get(b.medicineId)?.name || '?', batchNo: b.batchNo, days: daysBetween(today, b.expiryDate) }));
  return {
    date: today, revenue, profit, invoices: inv.length,
    vsLastWeekPct: lastWeek ? Math.round(((revenue - lastWeek) / lastWeek) * 100) : null, top, lowStock, expiring,
  };
}
