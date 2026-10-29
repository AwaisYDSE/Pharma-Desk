// Built-in medicine list: offered only at first setup; editable/deletable with permission;
// can't be re-imported later. Plus own-photo and shop-profile permissions.
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { openDb, allRows } from '../server/db.ts';
import { createApp, setupShop } from '../server/app.ts';
import { builtinCatalog } from '../server/catalog.ts';
import { applyOp } from '../server/ops.ts';
import { startShop, stop, addUser, type Shop } from './helpers.ts';
import { uuid } from '../shared/util.ts';
import type { Medicine, Op } from '../shared/types.ts';

const shops: Shop[] = [];
afterEach(async () => { while (shops.length) await stop(shops.pop()!); });
const upsert = (userId: string, rows: { tbl: Op['rows'][number]['tbl']; row: object }[]): Op => ({ id: uuid(), kind: 'upsert', strict: true, deviceId: 'd', userId, createdAt: '', rows: rows as Op['rows'], deltas: [] });

describe('Built-in Pakistan medicine list', () => {
  it('has brand, formula, strength and a description for every entry, with unique ids', () => {
    const list = builtinCatalog();
    expect(list.length).toBeGreaterThan(120);
    expect(new Set(list.map(m => m.id)).size).toBe(list.length);
    for (const m of list) { expect(m.name && m.generic && m.form && m.description).toBeTruthy(); expect(m.source).toBe('catalog'); }
    expect(list.find(m => m.name === 'Panadol')).toMatchObject({ generic: 'Paracetamol', strength: '500mg' });
  });

  it('first setup with "use built-in list" loads it; choosing "own" loads nothing', async () => {
    const appDb = openDb(':memory:');
    const app = createApp(appDb);
    const r = await request(app).post('/local/setup-owner').send({ name: 'Awais', username: 'owner', pin: '123456', shopName: 'Al-Shifa', catalog: 'builtin', logo: 'data:image/png;base64,AAAA' });
    expect(r.status).toBe(200);
    expect(r.body.medicines).toBe(builtinCatalog().length);
    expect(allRows(appDb, 'shop')[0]).toMatchObject({ name: 'Al-Shifa', logo: 'data:image/png;base64,AAAA', catalogChoice: 'builtin' });

    const db2 = openDb(':memory:');
    const app2 = createApp(db2);
    const r2 = await request(app2).post('/local/setup-owner').send({ name: 'B', username: 'owner', pin: '123456', shopName: 'B', catalog: 'own' });
    expect(r2.body.medicines).toBe(0);
    expect(allRows(db2, 'medicines')).toHaveLength(0);
  });

  it('the list cannot be imported later — not by the owner, not by anyone', async () => {
    const S = await startShop(); shops.push(S);
    setupShop(S.db, 'Shop', 'own', S.owner);
    expect(() => setupShop(S.db, 'Shop', 'builtin', S.owner)).toThrow(/already set up/);
    const [panadol] = builtinCatalog();
    const r = applyOp(S.db, upsert(S.owner.id, [{ tbl: 'medicines', row: panadol }]));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/only be added when the shop is first set up/);
    const second = await request(S.app).post('/local/setup-owner').send({ name: 'x', username: 'x2', pin: '123456', catalog: 'builtin' });
    expect(second.status).toBe(409);
  });

  it('built-in medicines can be edited and deleted by users with permission, not by others', async () => {
    const S = await startShop(); shops.push(S);
    setupShop(S.db, 'Shop', 'builtin', S.owner);
    const med = allRows<Medicine>(S.db, 'medicines').find(m => m.name === 'Brufen')!;
    const cashier = addUser(S, 'sana');
    const keeper = addUser(S, 'hamza', 'storekeeper');
    expect(applyOp(S.db, upsert(cashier.id, [{ tbl: 'medicines', row: { ...med, description: 'x', hlc: '9' } }])).ok).toBe(false);
    expect(applyOp(S.db, upsert(keeper.id, [{ tbl: 'medicines', row: { ...med, salePrice: 500, description: 'Pain and swelling', hlc: '9' } }])).ok).toBe(true);
    // Store keeper may modify items but deleting is a separate switch that is OFF for him…
    expect(applyOp(S.db, upsert(keeper.id, [{ tbl: 'medicines', row: { ...med, deleted: true, hlc: '99' } }])).ok).toBe(false);
    // …the owner turns "Delete items" on for him, and now it works.
    const { saveUser } = await import('../server/supervision.ts');
    saveUser(S.db, S.owner, { id: keeper.id, username: keeper.username, name: keeper.name, role: 'custom', perms: [...keeper.perms, 'inventory.delete'] });
    expect(applyOp(S.db, upsert(keeper.id, [{ tbl: 'medicines', row: { ...med, deleted: true, hlc: '99' } }])).ok).toBe(true);
    expect(allRows<Medicine>(S.db, 'medicines').find(m => m.id === med.id)!.deleted).toBe(true);
  });
});

describe('Photos and shop logo', () => {
  it('anyone can change their own photo, but not their own role; only Settings users change the shop logo', async () => {
    const S = await startShop(); shops.push(S);
    const c = addUser(S, 'sana');
    expect(applyOp(S.db, upsert(c.id, [{ tbl: 'users', row: { ...c, photo: 'data:image/jpeg;base64,AA', hlc: '5' } }])).ok).toBe(true);
    expect(applyOp(S.db, upsert(c.id, [{ tbl: 'users', row: { ...c, perms: [...c.perms, 'users'], hlc: '6' } }])).ok).toBe(false);
    expect(applyOp(S.db, upsert(c.id, [{ tbl: 'shop', row: { id: 'shop', name: 'Hacked', hlc: '7' } }])).ok).toBe(false);
    expect(applyOp(S.db, upsert(S.owner.id, [{ tbl: 'shop', row: { id: 'shop', name: 'Al-Shifa', logo: 'data:image/png;base64,BB', hlc: '8' } }])).ok).toBe(true);
  });
});
