// Backup file the owner can take even while the plan is locked. It is encrypted with a key made from the
// owner's PIN, so the file alone shows nothing to a casual reader. It restores only into a new, empty shop.
// © Awais Amin
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { allRows, putRow, tx, getSetting, setSetting, type DB } from './db.ts';
import { getIdentity, encryptSecret, decryptSecret } from './identity.ts';
import { serverClock } from './ops.ts';
import { AppError } from '../shared/util.ts';
import { SYNC_TABLES, type SyncTable, type Synced } from '../shared/types.ts';
import { pinMatches, userCount } from './supervision.ts';
import type { User } from '../shared/types.ts';

const MAGIC = 'PDBK1';
const keyOf = (pin: string, salt: Buffer) => crypto.scryptSync(pin, salt, 32);

const checkOwner = (db: DB, pin: string) => {
  const owner = allRows<User>(db, 'users').find(u => u.owner && !u.deleted);
  if (!owner || !pinMatches(owner, pin)) throw new AppError('BAD_LOGIN', 'Wrong owner PIN');
};

export function makeBackup(db: DB, pin: string): string {
  checkOwner(db, pin);
  const salt = crypto.randomBytes(16);
  return seal(db, salt, keyOf(pin, salt));
}

function seal(db: DB, salt: Buffer, key: Buffer): string {
  const tables: Partial<Record<SyncTable, Synced[]>> = {};
  for (const t of SYNC_TABLES) tables[t] = allRows(db, t);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(JSON.stringify({ at: new Date().toISOString(), tables }), 'utf8'), c.final()]);
  return [MAGIC, salt, iv, c.getAuthTag(), enc].map(p => typeof p === 'string' ? p : p.toString('base64')).join('.');
}

export function restoreBackup(db: DB, file: string, pin: string): { rows: number } {
  if (userCount(db) > 0) throw new AppError('EXISTS', 'A backup can only be restored into a new, empty shop');
  const [magic, salt, iv, tag, enc] = String(file || '').trim().split('.');
  if (magic !== MAGIC || !enc) throw new AppError('INVALID', 'This is not a PharmaDesk backup file');
  let parsed: { tables: Partial<Record<SyncTable, Synced[]>> };
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', keyOf(pin, Buffer.from(salt, 'base64')), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    parsed = JSON.parse(Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8'));
  } catch { throw new AppError('BAD_LOGIN', 'Wrong owner PIN, or the backup file is damaged'); }
  let rows = 0;
  tx(db, () => {
    for (const t of SYNC_TABLES) for (const r of parsed.tables[t] || []) { putRow(db, t, r, serverClock.tick()); rows++; }
  });
  return { rows };
}

/* ---------- automatic copy to a USB drive or another folder ---------- */

/** The PIN is not kept: only a key made from it, itself encrypted. Files open with the PIN set at that time. */
export function setBackupFolder(db: DB, folder: string, pin: string) {
  if (!folder.trim()) { for (const k of ['backup_folder', 'backup_folder_key', 'backup_folder_error']) setSetting(db, k, null); return; }
  checkOwner(db, pin);
  const salt = crypto.randomBytes(16);
  const stored = JSON.stringify({ salt: salt.toString('base64'), key: keyOf(pin, salt).toString('base64') });
  setSetting(db, 'backup_folder_key', encryptSecret(stored, getIdentity(db)!.jwtSecret));
  setSetting(db, 'backup_folder', folder.trim());
  copyToFolder(db);
}

/** Runs after every automatic backup. A missing USB drive is reported, never a crash. Keeps the newest 7. */
export function copyToFolder(db: DB, keep = 7): boolean {
  const folder = getSetting(db, 'backup_folder');
  if (!folder) return false;
  try {
    const raw = decryptSecret(getSetting(db, 'backup_folder_key') || '', getIdentity(db)!.jwtSecret);
    if (!raw) throw new Error('Set the backup folder again');
    const k = JSON.parse(raw) as { salt: string; key: string };
    if (!fs.existsSync(folder)) throw new Error('Folder not found. Is the USB drive plugged in?');
    const name = `pharmadesk-${new Date().toISOString().replace(/[:.]/g, '-')}.pdbk`;
    fs.writeFileSync(path.join(folder, name), seal(db, Buffer.from(k.salt, 'base64'), Buffer.from(k.key, 'base64')));
    const all = fs.readdirSync(folder).filter(f => f.startsWith('pharmadesk-') && f.endsWith('.pdbk')).sort();
    for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(folder, old), { force: true });
    setSetting(db, 'backup_folder_ok', new Date().toISOString());
    setSetting(db, 'backup_folder_error', null);
    return true;
  } catch (e) { setSetting(db, 'backup_folder_error', (e as Error).message); return false; }
}

export const backupFolderStatus = (db: DB) => ({ folder: getSetting(db, 'backup_folder'), lastOk: getSetting(db, 'backup_folder_ok'), error: getSetting(db, 'backup_folder_error') });
