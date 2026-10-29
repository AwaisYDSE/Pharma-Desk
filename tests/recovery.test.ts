// Crash recovery: WAL + snapshots; a damaged database file is restored automatically.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, openWithRecovery, snapshot, putRow, getRow, tx } from '../server/db.ts';
import { ensureIdentity, getIdentity } from '../server/identity.ts';

describe('Database crash recovery', () => {
  it('a failed transaction rolls back completely', () => {
    const db = openDb(':memory:');
    expect(() => tx(db, () => { putRow(db, 'medicines', { id: 'm1', name: 'A' } as never, '1'); throw new Error('power cut mid-sale'); })).toThrow();
    expect(getRow(db, 'medicines', 'm1')).toBeNull();
  });

  it('restores the latest snapshot when the database file is corrupt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-'));
    const file = path.join(dir, 'pharmadesk.db'), backups = path.join(dir, 'backups');
    const db = openDb(file);
    ensureIdentity(db, 'Recovery Shop');
    putRow(db, 'medicines', { id: 'm1', name: 'Panadol' } as never, '1');
    snapshot(db, backups);
    const sid = getIdentity(db)!.serverId;
    db.close();
    for (const f of fs.readdirSync(dir)) if (f.startsWith('pharmadesk.db')) fs.writeFileSync(path.join(dir, f), Buffer.alloc(8192, 0x5a)); // garbage
    const logs: string[] = [];
    const { db: db2, restored } = openWithRecovery(file, backups, m => logs.push(m));
    expect(restored).toBeTruthy();
    expect(getIdentity(db2)!.serverId).toBe(sid);       // same shop, same pairings
    expect(getRow(db2, 'medicines', 'm1')).toMatchObject({ name: 'Panadol' });
    expect(logs.join(' ')).toMatch(/restored/);
    expect(fs.readdirSync(dir).some(f => f.includes('.corrupt-'))).toBe(true); // damaged copy kept
  });
});
