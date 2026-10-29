// Shop server database — SQLite in WAL mode (crash-safe: a power cut can lose
// at most the transaction in flight, never corrupt committed sales).
// © Awais Amin
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';
// Loaded via require so test tools that don't know the new node:sqlite module still work.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncT;
import fs from 'node:fs';
import path from 'node:path';
import { SYNC_TABLES, type SyncTable, type Synced } from '../shared/types.ts';
import { HLC } from '../shared/util.ts';

export type DB = DatabaseSync;

/** camelCase sync name → SQLite table. */
export const SQL_TABLE: Record<SyncTable, string> = {
  medicines: 'medicines', batches: 'batches', suppliers: 'suppliers', patients: 'patients',
  prescriptions: 'prescriptions', invoices: 'invoices', invoiceItems: 'invoice_items',
  purchases: 'purchases', purchaseItems: 'purchase_items', ledger: 'ledger', users: 'users', audit: 'audit', shop: 'shop',
};

/** Indexed columns pulled out of each record's JSON (generated columns). */
const INDEXED: Record<SyncTable, [string, string][]> = {
  medicines: [['name', '$.name'], ['generic', '$.generic'], ['barcode', '$.barcode']],
  batches: [['medicine_id', '$.medicineId'], ['expiry_date', '$.expiryDate'], ['batch_no', '$.batchNo']],
  suppliers: [['name', '$.name']],
  patients: [['name', '$.name'], ['phone', '$.phone']],
  prescriptions: [['patient_id', '$.patientId'], ['next_due', '$.nextDue']],
  invoices: [['number', '$.number'], ['created_at', '$.createdAt'], ['status', '$.status']],
  invoiceItems: [['invoice_id', '$.invoiceId'], ['medicine_id', '$.medicineId']],
  purchases: [['number', '$.number'], ['supplier_id', '$.supplierId']],
  purchaseItems: [['purchase_id', '$.purchaseId']],
  ledger: [['party_id', '$.partyId']],
  users: [['username', '$.username'], ['email', '$.email']],
  audit: [['at', '$.at'], ['action', '$.action']],
  shop: [],
};

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`);
  migrate(db);
  return db;
}

function migrate(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS server_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      server_id TEXT NOT NULL, name TEXT NOT NULL, pin TEXT NOT NULL,
      jwt_secret TEXT NOT NULL, beacon_key TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS paired_devices (
      id TEXT PRIMARY KEY, name TEXT, platform TEXT, jti TEXT NOT NULL,
      paired_at TEXT NOT NULL, last_seen TEXT, last_ip TEXT, revoked INTEGER NOT NULL DEFAULT 0,
      active_user TEXT, user_since TEXT
    );
    CREATE TABLE IF NOT EXISTS server_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS ai_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, feature TEXT NOT NULL, model TEXT,
      status TEXT NOT NULL, latency_ms INTEGER, fallback INTEGER NOT NULL DEFAULT 0, error TEXT, device_id TEXT
    );
    CREATE TABLE IF NOT EXISTS ops (
      id TEXT PRIMARY KEY, applied_at TEXT NOT NULL, device_id TEXT, user_id TEXT, kind TEXT, result TEXT NOT NULL
    );
  `);
  for (const t of SYNC_TABLES) {
    const name = SQL_TABLE[t];
    const gen = INDEXED[t].map(([col, p]) => `, ${col} TEXT GENERATED ALWAYS AS (json_extract(data, '${p}')) VIRTUAL`).join('');
    db.exec(`CREATE TABLE IF NOT EXISTS ${name} (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, hlc TEXT NOT NULL DEFAULT '', rev INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0${gen});
      CREATE INDEX IF NOT EXISTS ${name}_rev ON ${name}(rev);`);
    for (const [col] of INDEXED[t]) db.exec(`CREATE INDEX IF NOT EXISTS ${name}_${col} ON ${name}(${col});`);
  }
  db.prepare(`INSERT OR IGNORE INTO meta(key, value) VALUES ('rev', '0'), ('schema', '1')`).run();
}

export function nextRev(db: DB): number {
  const row = db.prepare(`UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev' RETURNING value`).get() as { value: string };
  return Number(row.value);
}

export function getRow<T extends Synced = Synced>(db: DB, tbl: SyncTable, id: string): T | null {
  const r = db.prepare(`SELECT data FROM ${SQL_TABLE[tbl]} WHERE id = ?`).get(id) as { data: string } | undefined;
  return r ? JSON.parse(r.data) as T : null;
}

export function allRows<T extends Synced = Synced>(db: DB, tbl: SyncTable, where = '', ...params: (string | number)[]): T[] {
  return (db.prepare(`SELECT data FROM ${SQL_TABLE[tbl]} ${where}`).all(...params) as { data: string }[]).map(r => JSON.parse(r.data) as T);
}

/** Write a row unconditionally (server-side changes), bumping its revision. */
export function putRow(db: DB, tbl: SyncTable, row: Synced, hlc: string) {
  const data = { ...row, hlc };
  db.prepare(`INSERT INTO ${SQL_TABLE[tbl]}(id, data, hlc, rev, deleted) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, hlc = excluded.hlc, rev = excluded.rev, deleted = excluded.deleted`)
    .run(row.id, JSON.stringify(data), hlc, nextRev(db), row.deleted ? 1 : 0);
  return data;
}

/**
 * Last-Write-Wins upsert from a device. A newer HLC stamp wins; an older one is
 * ignored. Batch quantities are never overwritten here — they only change
 * through stock deltas, so two devices can never erase each other's sales.
 */
export function upsertLWW(db: DB, tbl: SyncTable, row: Synced, clock: HLC): boolean {
  const cur = getRow(db, tbl, row.id);
  const incoming = row.hlc || '';
  clock.receive(incoming);
  if (cur && (cur.hlc || '') > incoming) return false;
  const next: Synced = { ...row };
  if (tbl === 'batches') (next as unknown as { qty: number }).qty = cur ? (cur as unknown as { qty: number }).qty : 0;
  putRow(db, tbl, next, incoming || clock.tick());
  return true;
}

export function getSetting(db: DB, key: string): string | null {
  const r = db.prepare(`SELECT value FROM server_settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return r ? r.value : null;
}
export function setSetting(db: DB, key: string, value: string | null) {
  if (value === null) db.prepare(`DELETE FROM server_settings WHERE key = ?`).run(key);
  else db.prepare(`INSERT INTO server_settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/* -------- crash recovery: integrity check on start + rolling snapshots -------- */

export function integrityOk(db: DB): boolean {
  try {
    const r = db.prepare('PRAGMA integrity_check').get() as Record<string, string>;
    return Object.values(r)[0] === 'ok';
  } catch { return false; }
}

export function snapshot(db: DB, dir: string, keep = 7): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `pharmadesk-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const all = fs.readdirSync(dir).filter(f => f.startsWith('pharmadesk-') && f.endsWith('.db')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(dir, old), { force: true });
  return file;
}

/**
 * Opens the database; if it is corrupt (e.g. disk failure), moves it aside and
 * restores the newest snapshot automatically. Devices then re-sync anything newer.
 */
export function openWithRecovery(file: string, backupDir: string, log: (m: string) => void = console.log): { db: DB; restored: string | null } {
  let db: DB | null = null;
  try {
    db = openDb(file);
    if (integrityOk(db)) return { db, restored: null };
    db.close();
  } catch (e) { log(`Database failed to open: ${(e as Error).message}`); }
  const snaps = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter(f => f.endsWith('.db')).sort() : [];
  const corrupt = `${file}.corrupt-${Date.now()}`;
  if (fs.existsSync(file)) fs.renameSync(file, corrupt);
  for (const ext of ['-wal', '-shm']) if (fs.existsSync(file + ext)) fs.renameSync(file + ext, corrupt + ext);
  const latest = snaps.at(-1);
  if (latest) {
    fs.copyFileSync(path.join(backupDir, latest), file);
    log(`Database was damaged — restored snapshot ${latest}. The damaged copy was kept as ${path.basename(corrupt)}.`);
  }
  return { db: openDb(file), restored: latest || null };
}
