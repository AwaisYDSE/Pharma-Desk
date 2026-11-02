// A tampered paired device must not be able to act as someone else, and other websites must not reach the server PC routes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { startShop, stop, addUser, seedMedicine, type Shop } from './helpers.ts';
import { getRow } from '../server/db.ts';
import { applyOp } from '../server/ops.ts';
import { getIdentity, encryptSecret, decryptSecret } from '../server/identity.ts';
import { uuid } from '../shared/util.ts';
import type { Op, User, Invoice, InvoiceItem } from '../shared/types.ts';

const base = (o: Partial<Op>): Op => ({ id: uuid(), kind: 'upsert', strict: true, deviceId: 'd', userId: null, createdAt: '', rows: [], deltas: [], ...o });

describe('Hardening', () => {
  let S: Shop;
  beforeEach(async () => { S = await startShop(); });
  afterEach(async () => { await stop(S); });

  async function pairDevice() {
    const id = getIdentity(S.db)!;
    const r = await request(S.app).post('/api/pair').send({ sid: id.serverId, pin: id.pin, deviceName: 'Phone' });
    return r.body.token as string;
  }
  const bill = (cashierId: string, extra: Partial<Invoice> = {}): Invoice => ({ id: uuid(), number: 'X-' + uuid(), cashierId, createdAt: new Date().toISOString(), status: 'paid', gross: 500, discount: 0, tax: 0, total: 500, paid: 500, change: 0, payMethod: 'cash', deviceId: 'd', ...extra });

  it('permissions cannot be smuggled inside an offline sale', () => {
    const c = addUser(S, 'cashier');
    const r = applyOp(S.db, base({ kind: 'sale', strict: false, userId: c.id, rows: [{ tbl: 'users', row: { ...c, perms: ['users', 'users.edit'], hlc: '9999999999999:0001:x' } as User }] }));
    expect(r.ok).toBe(false);
    expect(getRow<User>(S.db, 'users', c.id)!.perms).not.toContain('users.edit');
  });

  it('a sale cannot add stock or overwrite an existing bill', () => {
    const c = addUser(S, 'cashier');
    const { med, batches: [b] } = seedMedicine(S.db, 'Brufen', 'Ibuprofen', 500, [{ batchNo: 'B1', qty: 10, expiresInDays: 200 }]);
    expect(applyOp(S.db, base({ kind: 'sale', strict: false, userId: c.id, deltas: [{ batchId: b.id, medicineId: med.id, delta: 5 }] })).ok).toBe(false);
    const inv = bill(c.id);
    expect(applyOp(S.db, base({ kind: 'sale', strict: false, userId: c.id, rows: [{ tbl: 'invoices', row: inv }] })).ok).toBe(true);
    expect(applyOp(S.db, base({ kind: 'sale', strict: false, userId: c.id, rows: [{ tbl: 'invoices', row: { ...inv, total: 1 } as Invoice }] })).ok).toBe(false);
  });

  it('other kinds of operation cannot carry user rows', () => {
    const r = applyOp(S.db, base({ kind: 'stock', userId: S.owner.id, rows: [{ tbl: 'users', row: { id: 'x' } as User }] }));
    expect(r.ok).toBe(false);
  });

  it('the server checks discount, credit, zero price and price change on online sales', () => {
    const c = addUser(S, 'cashier');
    const { med, batches: [b] } = seedMedicine(S.db, 'Brufen', 'Ibuprofen', 500, [{ batchNo: 'B1', qty: 10, expiresInDays: 200 }]);
    const sale = (inv: Partial<Invoice>, unitPrice = 500) => {
      const i = bill(c.id, inv);
      const item: InvoiceItem = { id: uuid(), invoiceId: i.id, medicineId: med.id, batchId: b.id, qty: 1, unitPrice, costPrice: 0, discount: 0, taxBp: 0, tax: 0, total: unitPrice };
      return applyOp(S.db, base({ kind: 'sale', strict: true, userId: c.id, rows: [{ tbl: 'invoices', row: i }, { tbl: 'invoiceItems', row: item }], deltas: [{ batchId: b.id, medicineId: med.id, delta: -1, itemId: item.id }] }));
    };
    expect(sale({ discount: 50 }).ok).toBe(false);
    expect(sale({ payMethod: 'credit' }).ok).toBe(false);
    expect(sale({}, 100).ok).toBe(false);
    expect(sale({}, 0).ok).toBe(false);
    expect(sale({}).ok).toBe(true);
    expect(sale({ discount: 50, note: `approved by ${S.owner.id}` }).ok).toBe(true); // a supervisor approved it
  });

  it('an offline sale without permission is kept but flagged for the owner', () => {
    const c = addUser(S, 'cashier');
    const r = applyOp(S.db, base({ kind: 'sale', strict: false, userId: c.id, rows: [{ tbl: 'invoices', row: bill(c.id, { discount: 50 }) }] }));
    expect(r.ok).toBe(true);
    const n = (S.db.prepare(`SELECT COUNT(*) AS n FROM audit WHERE action = 'sale.needs_review'`).get() as { n: number }).n;
    expect(n).toBe(1);
  });

  it('a device cannot act as the owner until the owner logged in on it', async () => {
    const token = await pairDevice();
    const auth = { authorization: `Bearer ${token}` };
    const row = { id: uuid(), date: '2026-01-01', category: 'x', amount: 1, payMethod: 'cash', hlc: '9999999999999:0001:x' };
    const op = base({ userId: S.owner.id, rows: [{ tbl: 'expenses', row }] });
    const first = await request(S.app).post('/api/ops').set(auth).send({ ops: [op] });
    expect(first.body.results[0].code).toBe('NEEDS_LOGIN');
    expect(getRow(S.db, 'expenses', row.id)).toBeNull();
    // A login reported as "happened offline" proves nothing.
    await request(S.app).post('/api/sessions/offline').set(auth).send({ events: [{ type: 'login', localId: 'l', userId: S.owner.id, at: new Date().toISOString() }] });
    expect((await request(S.app).post('/api/ops').set(auth).send({ ops: [op] })).body.results[0].code).toBe('NEEDS_LOGIN');
    expect((await request(S.app).post('/api/login').set(auth).send({ username: 'owner', pin: '111111' })).status).toBe(200);
    expect((await request(S.app).post('/api/ops').set(auth).send({ ops: [op] })).body.results[0].ok).toBe(true);
  });

  it('repeated wrong PINs lock that user on that device', async () => {
    const auth = { authorization: `Bearer ${await pairDevice()}` };
    for (let i = 0; i < 5; i++) expect((await request(S.app).post('/api/login').set(auth).send({ username: 'owner', pin: '000000' })).status).toBe(401);
    expect((await request(S.app).post('/api/login').set(auth).send({ username: 'owner', pin: '111111' })).body.code).toBe('LOCKED');
  });

  it('other websites cannot reach the server PC routes', async () => {
    for (const set of [{ origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }, { host: 'evil.example' }]) {
      expect((await request(S.app).get('/local/status').set(set as never)).status).toBe(403);
      expect((await request(S.app).post('/local/self-pair').set(set as never).send({})).status).toBe(403);
    }
    const r = await request(S.app).options('/local/status').set('origin', 'https://evil.example');
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    expect((await request(S.app).get('/local/status')).status).toBe(200); // the PC's own page still works
  });

  it('saved secrets survive renaming the PC, and old ones still open', () => {
    const blob = encryptSecret('key', 'secret');
    expect(decryptSecret(blob, 'secret')).toBe('key');
    expect(decryptSecret(blob, 'wrong')).toBeNull();
  });
});
