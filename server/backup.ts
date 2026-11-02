// Backup file the owner can take even while the plan is locked. It is encrypted with a key made from the
// owner's PIN, so the file alone shows nothing to a casual reader. It restores only into a new, empty shop.
// © Awais Amin
import crypto from 'node:crypto';
import { allRows, putRow, tx, type DB } from './db.ts';
import { serverClock } from './ops.ts';
import { AppError } from '../shared/util.ts';
import { SYNC_TABLES, type SyncTable, type Synced } from '../shared/types.ts';
import { pinMatches, userCount } from './supervision.ts';
import type { User } from '../shared/types.ts';

const MAGIC = 'PDBK1';
const keyOf = (pin: string, salt: Buffer) => crypto.scryptSync(pin, salt, 32);

export function makeBackup(db: DB, pin: string): string {
  const owner = allRows<User>(db, 'users').find(u => u.owner && !u.deleted);
  if (!owner || !pinMatches(owner, pin)) throw new AppError('BAD_LOGIN', 'Wrong owner PIN');
  const tables: Partial<Record<SyncTable, Synced[]>> = {};
  for (const t of SYNC_TABLES) tables[t] = allRows(db, t);
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyOf(pin, salt), iv);
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
