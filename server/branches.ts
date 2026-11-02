// Branches of one pharmacy chain, each with its own shop server PC, licence key and stock, working alone
// when the link is down. One branch is the head office and the others connect to it.
//   Shared by all:   medicines and suppliers; customers and their accounts if the owner chooses.
//   Kept per branch: stock, bills, purchases, expenses. The head office keeps a read-only copy for reports.
// © Awais Amin
import { getRow, allRows, putRow, tx, getSetting, setSetting, type DB } from './db.ts';
import { pullChanges, serverClock } from './ops.ts';
import { encryptSecret, decryptSecret, getIdentity } from './identity.ts';
import * as sup from './supervision.ts';
import { readBeacon } from '../client/core/beacon.ts';
import { summarize } from '../shared/accounting.ts';
import { AppError, uuid, isoDate } from '../shared/util.ts';
import type { Batch, Synced, SyncTable, User } from '../shared/types.ts';

export const HEAD = 'head';
const SHARED_ALWAYS: SyncTable[] = ['medicines', 'suppliers'];
const SHARED_CUSTOMERS: SyncTable[] = ['patients'];
const DOCS: SyncTable[] = ['invoices', 'invoiceItems', 'refunds', 'purchases', 'expenses', 'ledger', 'batches'];

export interface TransferLine { medicineId: string; name: string; batchNo: string; expiryDate: string; costPrice: number; salePrice?: number | null; qty: number }
export interface Transfer { id: string; from: string; to: string; fromName: string; toName: string; status: 'sent' | 'received'; lines: TransferLine[]; at: string; receivedAt?: string | null; by?: string | null }
export interface BranchStock { id: string; name: string; stock: Record<string, number> }
type Row = Synced & Record<string, unknown>;

export function openBranchTables(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS branches (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT, joined_at TEXT NOT NULL, last_sync TEXT);
    CREATE TABLE IF NOT EXISTS branch_data (branch_id TEXT NOT NULL, tbl TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (branch_id, tbl, id));
    CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, data TEXT NOT NULL, unsent INTEGER NOT NULL DEFAULT 0);`);
}

export const branchRole = (db: DB): 'none' | 'head' | 'branch' => (getSetting(db, 'branch_role') as 'head' | 'branch') || 'none';
export const shareCustomers = (db: DB) => getSetting(db, 'branch_share_customers') === '1';
export const myBranchId = (db: DB) => branchRole(db) === 'head' ? HEAD : getSetting(db, 'branch_id') || '';
const myName = (db: DB) => getIdentity(db)!.name;

/** Newer stamp wins. The same stamp changes nothing, so rows never bounce back and forth. */
function mergeShared(db: DB, tbl: SyncTable, row: Row, foreign = false) {
  const cur = getRow(db, tbl, row.id);
  if (cur && (cur.hlc || '') >= (row.hlc || '')) return false;
  putRow(db, tbl, foreign ? { ...row, foreign: true } as Synced : row, row.hlc || serverClock.tick());
  serverClock.receive(row.hlc);
  return true;
}

function saveTransfer(db: DB, t: Transfer, unsent: 0 | 1) {
  const cur = db.prepare(`SELECT data FROM transfers WHERE id = ?`).get(t.id) as { data: string } | undefined;
  // Received is final: an older "sent" copy can never undo it.
  if (cur && (JSON.parse(cur.data) as Transfer).status === 'received' && t.status !== 'received') return;
  db.prepare(`INSERT INTO transfers(id, data, unsent) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, unsent = excluded.unsent`).run(t.id, JSON.stringify(t), unsent);
}
export const allTransfers = (db: DB): Transfer[] => (db.prepare(`SELECT data FROM transfers`).all() as { data: string }[]).map(r => JSON.parse(r.data) as Transfer).sort((a, b) => b.at.localeCompare(a.at));

/* ---------- head office side ---------- */

export function makeHead(db: DB, share: boolean) {
  if (branchRole(db) === 'branch') throw new AppError('INVALID', 'This PC is connected to a head office');
  setSetting(db, 'branch_role', 'head');
  setSetting(db, 'branch_share_customers', share ? '1' : null);
}

export function joinAtHead(db: DB, deviceId: string, name: string, code: string) {
  if (branchRole(db) !== 'head') throw new AppError('NOT_HEAD', 'This PC has not been made the head office');
  db.prepare(`INSERT INTO branches(id, name, code, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, code = excluded.code`)
    .run(deviceId, String(name || 'Branch').slice(0, 80), String(code || '').slice(0, 12), new Date().toISOString());
  return { branchId: deviceId, headName: myName(db), share: shareCustomers(db) };
}

const branchList = (db: DB) => db.prepare(`SELECT id, name, code, joined_at, last_sync FROM branches ORDER BY name`).all() as { id: string; name: string; code: string; joined_at: string; last_sync: string | null }[];

/** Stock of one server's own batches, by medicine. */
const stockOf = (batches: Batch[]) => {
  const m: Record<string, number> = {};
  for (const b of batches) if (!b.deleted && !b.pending && b.qty > 0) m[b.medicineId] = (m[b.medicineId] || 0) + b.qty;
  return m;
};
const dataOf = <T,>(db: DB, branchId: string, tbl: SyncTable): T[] =>
  (db.prepare(`SELECT data FROM branch_data WHERE branch_id = ? AND tbl = ?`).all(branchId, tbl) as { data: string }[]).map(r => JSON.parse(r.data) as T);

function stockEverywhere(db: DB): BranchStock[] {
  return [{ id: HEAD, name: myName(db), stock: stockOf(allRows<Batch>(db, 'batches')) },
    ...branchList(db).map(b => ({ id: b.id, name: b.name, stock: stockOf(dataOf<Batch>(db, b.id, 'batches')) }))];
}

export interface SyncRequest { since: number; changes: { tbl: SyncTable; row: Row }[]; transfers: Transfer[]; name?: string }

export function syncAtHead(db: DB, deviceId: string, req: SyncRequest) {
  if (branchRole(db) !== 'head') throw new AppError('NOT_HEAD', 'This PC is not the head office');
  if (!db.prepare(`SELECT id FROM branches WHERE id = ?`).get(deviceId)) throw new AppError('NOT_JOINED', 'This branch is not connected to the head office');
  const share = shareCustomers(db);
  const shared = new Set<string>([...SHARED_ALWAYS, ...(share ? SHARED_CUSTOMERS : [])]);
  tx(db, () => {
    for (const c of req.changes || []) {
      if (!c?.row || typeof c.row.id !== 'string') continue;
      if (shared.has(c.tbl)) mergeShared(db, c.tbl, c.row);
      if (DOCS.includes(c.tbl)) {
        db.prepare(`INSERT INTO branch_data(branch_id, tbl, id, data) VALUES (?, ?, ?, ?) ON CONFLICT(branch_id, tbl, id) DO UPDATE SET data = excluded.data`).run(deviceId, c.tbl, c.row.id, JSON.stringify(c.row));
        if (share && c.tbl === 'ledger' && c.row.partyType === 'patient' && !c.row.foreign) mergeShared(db, 'ledger', { ...c.row, originBranch: deviceId }, true);
      }
    }
    for (const t of req.transfers || []) if (t?.id && (t.from === deviceId || t.to === deviceId)) saveTransfer(db, t, 0);
    db.prepare(`UPDATE branches SET last_sync = ? WHERE id = ?`).run(new Date().toISOString(), deviceId);
  });
  const page = pullChanges(db, Number(req.since || 0), 1000);
  const rows = page.changes.filter(c => shared.has(c.tbl) || (share && c.tbl === 'ledger' && (c.data as Row).partyType === 'patient' && (c.data as Row).originBranch !== deviceId))
    .map(c => ({ tbl: c.tbl, row: c.data as Row }));
  return {
    rows, rev: page.rev, more: page.more, share,
    transfers: allTransfers(db).filter(t => t.from === deviceId || t.to === deviceId),
    stock: stockEverywhere(db),
  };
}

/** Head office report: every branch and the total, for any dates. */
export function branchReport(db: DB, from: string, to: string) {
  const one = (id: string, name: string, lastSync: string | null, d: (t: SyncTable) => never[]) => {
    const s = summarize({ invoices: d('invoices'), invoiceItems: d('invoiceItems'), refunds: d('refunds'), purchases: d('purchases'), expenses: d('expenses'), ledger: d('ledger'), medicines: [] }, from, to, 'month');
    const stockValue = (d('batches') as Batch[]).filter(b => !b.deleted && !b.pending && b.qty > 0).reduce((n, b) => n + b.qty * (b.costPrice || 0), 0);
    return { id, name, lastSync, bills: s.totals.bills, netSales: s.totals.netSales, purchases: s.totals.purchases, expenses: s.totals.expenses, netProfit: s.totals.netProfit, cashIn: s.totals.cashIn, cashOut: s.totals.cashOut, stockValue };
  };
  const rows = [one(HEAD, myName(db), new Date().toISOString(), t => allRows(db, t) as never[]),
    ...branchList(db).map(b => one(b.id, b.name, b.last_sync, t => dataOf<never>(db, b.id, t)))];
  const keys = ['bills', 'netSales', 'purchases', 'expenses', 'netProfit', 'cashIn', 'cashOut', 'stockValue'] as const;
  const total = Object.fromEntries(keys.map(k => [k, rows.reduce((n, r) => n + r[k], 0)]));
  return { rows, total };
}

/* ---------- branch side ---------- */

interface HeadLink { sid: string; urls: string[]; token: string; beaconKey?: string; deviceId: string; name: string }
const link = (db: DB): HeadLink | null => {
  const raw = getSetting(db, 'branch_link');
  const plain = raw ? decryptSecret(raw, getIdentity(db)!.jwtSecret) : null;
  return plain ? JSON.parse(plain) as HeadLink : null;
};
const saveLink = (db: DB, l: HeadLink) => setSetting(db, 'branch_link', encryptSecret(JSON.stringify(l), getIdentity(db)!.jwtSecret));

async function callHead<T>(l: HeadLink, path: string, body: unknown, f: typeof fetch, token = l.token): Promise<T> {
  let last: Error = new AppError('NO_LINK', 'Could not reach the head office');
  for (const base of l.urls) {
    let res: Response;
    try {
      res = await f(base.replace(/\/$/, '') + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    } catch { continue; }
    const d = await res.json().catch(() => ({})) as { code?: string; message?: string };
    if (!res.ok) { last = new AppError(d.code || 'ERROR', d.message || `Head office error ${res.status}`); throw last; }
    return d as T;
  }
  throw last;
}

/** Connect this PC to the head office with the head office's code and Server PIN. */
export async function joinHead(db: DB, input: { code: string; pin: string; branchName?: string; branchCode?: string }, f: typeof fetch = fetch) {
  if (branchRole(db) === 'head') throw new AppError('INVALID', 'This PC is the head office');
  let qr: { sid: string; urls: string[]; name: string };
  try { qr = JSON.parse(Buffer.from(input.code.trim().replace(/^pharmadesk:/, ''), 'base64url').toString()); } catch { throw new AppError('INVALID', 'This is not a head office code'); }
  if (!qr?.sid || !Array.isArray(qr.urls)) throw new AppError('INVALID', 'This is not a head office code');
  const name = String(input.branchName || myName(db)).slice(0, 80);
  const probe: HeadLink = { sid: qr.sid, urls: qr.urls, token: '', deviceId: '', name: qr.name };
  const paired = await callHead<{ token: string; deviceId: string; beaconKey?: string; serverName: string }>(probe, '/api/pair', { sid: qr.sid, pin: input.pin, deviceName: `Branch: ${name}`, platform: 'branch' }, f);
  const l: HeadLink = { ...probe, token: paired.token, deviceId: paired.deviceId, beaconKey: paired.beaconKey, name: paired.serverName };
  const j = await callHead<{ branchId: string; headName: string; share: boolean }>(l, '/api/branch/join', { name, code: input.branchCode || '' }, f);
  saveLink(db, l);
  setSetting(db, 'branch_role', 'branch');
  setSetting(db, 'branch_id', j.branchId);
  setSetting(db, 'branch_share_customers', j.share ? '1' : null);
  setSetting(db, 'branch_sent_rev', '0');
  setSetting(db, 'branch_got_rev', '0');
  return { headName: j.headName };
}

export function leaveHead(db: DB) {
  for (const k of ['branch_role', 'branch_id', 'branch_link', 'branch_sent_rev', 'branch_got_rev', 'branch_stock', 'branch_last_sync', 'branch_share_customers']) setSetting(db, k, null);
}

let syncing = false;
/** One round with the head office: send what changed here, take what changed there. Safe to fail and repeat. */
export async function syncWithHead(db: DB, f: typeof fetch = fetch): Promise<boolean> {
  if (branchRole(db) !== 'branch' || syncing) return false;
  const l = link(db);
  if (!l) return false;
  syncing = true;
  try {
    let tries = 0;
    for (;;) {
      const sentRev = Number(getSetting(db, 'branch_sent_rev') || 0), gotRev = Number(getSetting(db, 'branch_got_rev') || 0);
      const share = shareCustomers(db);
      const wanted = new Set<string>([...SHARED_ALWAYS, ...(share ? SHARED_CUSTOMERS : []), ...DOCS]);
      const out = pullChanges(db, sentRev, 500);
      const changes = out.changes.filter(c => wanted.has(c.tbl) && !(c.tbl === 'ledger' && (c.data as Row).foreign)).map(c => ({ tbl: c.tbl, row: c.data as Row }));
      const unsent = (db.prepare(`SELECT data FROM transfers WHERE unsent = 1`).all() as { data: string }[]).map(r => JSON.parse(r.data) as Transfer);
      let res: { rows: { tbl: SyncTable; row: Row }[]; rev: number; more: boolean; share: boolean; transfers: Transfer[]; stock: BranchStock[] };
      try { res = await callHead(l, '/api/branch/sync', { since: gotRev, changes, transfers: unsent }, f); }
      catch (e) {
        if ((e as AppError).code !== 'NO_LINK' || tries++) throw e;
        // The head office address changes when its PC restarts: find the new one and try once more.
        const b = l.beaconKey ? await readBeacon({ serverId: l.sid, beaconKey: l.beaconKey } as never, f) : null;
        if (!b?.urls.length) throw e;
        l.urls = [...new Set([...b.urls, ...l.urls])]; saveLink(db, l);
        continue;
      }
      tx(db, () => {
        for (const r of res.rows) mergeShared(db, r.tbl, r.row, r.tbl === 'ledger');
        for (const t of unsent) db.prepare(`UPDATE transfers SET unsent = 0 WHERE id = ?`).run(t.id);
        for (const t of res.transfers) if (!unsent.some(u => u.id === t.id)) saveTransfer(db, t, 0);
        // The owner just switched on shared customers: go through everything once more so older ones are included.
        const fresh = res.share && !share;
        setSetting(db, 'branch_sent_rev', fresh ? '0' : String(out.rev));
        setSetting(db, 'branch_got_rev', fresh ? '0' : String(res.rev));
        setSetting(db, 'branch_stock', JSON.stringify(res.stock));
        setSetting(db, 'branch_share_customers', res.share ? '1' : null);
        setSetting(db, 'branch_last_sync', new Date().toISOString());
      });
      if (!out.more && !res.more) return true;
    }
  } finally { syncing = false; }
}

/* ---------- both sides ---------- */

export function branchStatus(db: DB) {
  const role = branchRole(db);
  return {
    role, me: myBranchId(db), share: shareCustomers(db), lastSync: getSetting(db, 'branch_last_sync'), headName: link(db)?.name || null,
    branches: role === 'head' ? branchList(db) : [],
  };
}

/** Stock at every branch. On a branch this is as fresh as its last round with the head office. */
export function stockAll(db: DB): BranchStock[] {
  const role = branchRole(db);
  if (role === 'head') return stockEverywhere(db);
  if (role !== 'branch') return [];
  const list = JSON.parse(getSetting(db, 'branch_stock') || '[]') as BranchStock[];
  const me = myBranchId(db);
  return list.map(b => b.id === me ? { ...b, stock: stockOf(allRows<Batch>(db, 'batches')) } : b);
}

/** Send stock to another branch. It leaves this branch's count now and arrives when the other branch receives it. */
export function sendTransfer(db: DB, actor: User, input: { to: string; toName?: string; lines: { batchId: string; qty: number }[] }): Transfer {
  const role = branchRole(db);
  if (role === 'none') throw new AppError('INVALID', 'Connect the branches first');
  const me = myBranchId(db);
  if (!input.to || input.to === me) throw new AppError('INVALID', 'Choose another branch');
  if (!Array.isArray(input.lines) || !input.lines.length) throw new AppError('INVALID', 'Add at least one item');
  const known = stockAll(db).find(b => b.id === input.to);
  if (!known) throw new AppError('INVALID', 'That branch is not connected');
  return tx(db, () => {
    const lines: TransferLine[] = [];
    for (const l of input.lines) {
      const b = getRow<Batch>(db, 'batches', String(l.batchId));
      if (!Number.isInteger(l.qty) || l.qty <= 0) throw new AppError('INVALID', 'Quantity must be a whole number above zero');
      if (!b || b.deleted || b.pending || b.qty < l.qty) throw new AppError('OUT_OF_STOCK', 'Not enough stock in that batch');
      if (b.expiryDate && b.expiryDate <= isoDate()) throw new AppError('INVALID', 'Expired stock cannot be sent');
      putRow(db, 'batches', { ...b, qty: b.qty - l.qty } as Batch, serverClock.tick());
      const m = getRow<Synced & { name?: string }>(db, 'medicines', b.medicineId);
      lines.push({ medicineId: b.medicineId, name: m?.name || '', batchNo: b.batchNo, expiryDate: b.expiryDate, costPrice: b.costPrice || 0, salePrice: b.salePrice ?? null, qty: l.qty });
    }
    const t: Transfer = { id: uuid(), from: me, to: input.to, fromName: myName(db), toName: known.name, status: 'sent', lines, at: new Date().toISOString(), by: actor.name };
    saveTransfer(db, t, role === 'branch' ? 1 : 0);
    sup.logEvent(db, 'branch.transfer_sent', { id: t.id, to: known.name, items: lines.length }, actor.id, actor.name);
    return t;
  });
}

/** Stock arrives only when someone at the receiving branch confirms it, and only once. */
export function receiveTransfer(db: DB, actor: User, id: string): Transfer {
  const row = db.prepare(`SELECT data FROM transfers WHERE id = ?`).get(id) as { data: string } | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Transfer not found');
  const t = JSON.parse(row.data) as Transfer;
  if (t.to !== myBranchId(db)) throw new AppError('FORBIDDEN', 'This transfer is for another branch');
  if (t.status === 'received') throw new AppError('DUPLICATE', 'This transfer was already received');
  return tx(db, () => {
    t.lines.forEach((l, i) => {
      if (!getRow(db, 'medicines', l.medicineId)) throw new AppError('NOT_IN_INVENTORY', 'Please wait for the medicine list to sync, then try again');
      const batch: Batch = { id: `${t.id}~${i}`, medicineId: l.medicineId, batchNo: l.batchNo, expiryDate: l.expiryDate, qty: l.qty, costPrice: l.costPrice, salePrice: l.salePrice ?? null, receivedAt: new Date().toISOString() };
      putRow(db, 'batches', batch, serverClock.tick());
    });
    const done: Transfer = { ...t, status: 'received', receivedAt: new Date().toISOString() };
    saveTransfer(db, done, branchRole(db) === 'branch' ? 1 : 0);
    sup.logEvent(db, 'branch.transfer_received', { id: t.id, from: t.fromName, items: t.lines.length }, actor.id, actor.name);
    return done;
  });
}
