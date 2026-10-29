// Bad input, lost replies, broken data and attacks — the app must refuse safely.
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { startShop, stop, seedMedicine, serverStock, addUser, newDevice, type Shop } from './helpers.ts';
import { applyOp } from '../server/ops.ts';
import { login } from '../client/core/auth.ts';
import { newCart, addToCart, setQty, checkout, totals } from '../client/core/pos.ts';
import { receiptHtml } from '../client/core/print.ts';
import { DEFAULT_SETTINGS } from '../client/core/settings.ts';
import { lineTotals, invoiceTotals } from '../shared/money.ts';
import { getIdentity } from '../server/identity.ts';
import { uuid } from '../shared/util.ts';
import type { Op, Invoice, Medicine } from '../shared/types.ts';

const shops: Shop[] = [];
afterEach(async () => { while (shops.length) await stop(shops.pop()!); });

describe('Bad input at the counter', () => {
  it('quantity 0, negative, decimal or absurd is refused; removing a line works', async () => {
    const S = await startShop(); shops.push(S);
    const { med } = seedMedicine(S.db, 'Panadol', 'Paracetamol', 270, [{ batchNo: '1', qty: 500, expiresInDays: 300 }]);
    const d = await newDevice(S); await login(d.ctx, 'owner', '111111', d.client);
    const m = (await d.ctx.db.medicines.get(med.id)) as Medicine;
    const cart = newCart();
    for (const q of [0, -1, 1.5, 1e9, NaN]) await expect(addToCart(d.ctx, cart, m, q)).rejects.toThrow(/whole number/);
    await addToCart(d.ctx, cart, m, 2);
    setQty(cart, cart.lines[0].key, 0);
    expect(cart.lines).toHaveLength(0);
  });

  it('cannot pay less than the total, empty bills are refused, credit needs a customer', async () => {
    const S = await startShop(); shops.push(S);
    const { med } = seedMedicine(S.db, 'Panadol', 'Paracetamol', 270, [{ batchNo: '1', qty: 50, expiresInDays: 300 }]);
    const d = await newDevice(S); await login(d.ctx, 'owner', '111111', d.client);
    await expect(checkout(d.ctx, newCart(), { method: 'cash', paid: 0 }, d.client)).rejects.toThrow(/empty/);
    const cart = newCart(); await addToCart(d.ctx, cart, (await d.ctx.db.medicines.get(med.id))!, 10);
    await expect(checkout(d.ctx, cart, { method: 'cash', paid: totals(cart).total - 1 }, d.client)).rejects.toThrow(/less than the total/);
    await expect(checkout(d.ctx, cart, { method: 'credit', paid: 0 }, d.client)).rejects.toThrow(/customer/);
    expect(serverStock(S.db, med.id)).toBe(50); // nothing was taken
  });

  it('expired batches are never sold, even if they are the only stock', async () => {
    const S = await startShop(); shops.push(S);
    const { med } = seedMedicine(S.db, 'Old Tab', 'X', 100, [{ batchNo: 'E', qty: 20, expiresInDays: -1 }]);
    const d = await newDevice(S); await login(d.ctx, 'owner', '111111', d.client);
    await expect(addToCart(d.ctx, newCart(), (await d.ctx.db.medicines.get(med.id))!, 1)).rejects.toThrow(/out of stock/i);
  });

  it('money never drifts: paisa maths, discounts and GST add up exactly', () => {
    const t = invoiceTotals([{ unitPrice: 333, qty: 3, taxBp: 1700 }, { unitPrice: 1999, qty: 7 }, { unitPrice: 1, qty: 1 }], { billDiscount: 1001, inclusive: true });
    expect(t.lines.reduce((s, l) => s + l.total, 0)).toBe(t.total);
    expect(t.gross - t.discount).toBe(t.total);
    expect(lineTotals({ unitPrice: 10000, qty: 1, taxBp: 1700 }).total).toBe(11700);
  });
});

describe('Lost replies, bad data and attacks', () => {
  it('a sale whose reply was lost is retried and still applied exactly once', async () => {
    const S = await startShop(); shops.push(S);
    const c = addUser(S, 'cashier');
    const { med, batches: [b] } = seedMedicine(S.db, 'Brufen', 'Ibuprofen', 500, [{ batchNo: 'B1', qty: 10, expiresInDays: 200 }]);
    const inv: Invoice = { id: uuid(), number: 'INV-1', cashierId: c.id, createdAt: new Date().toISOString(), status: 'paid', gross: 500, discount: 0, tax: 0, total: 500, paid: 500, change: 0, payMethod: 'cash', deviceId: 'd' };
    const op: Op = { id: uuid(), kind: 'sale', strict: false, deviceId: 'd', userId: c.id, createdAt: '', rows: [{ tbl: 'invoices', row: inv }], deltas: [{ batchId: b.id, medicineId: med.id, delta: -1 }] };
    for (let i = 0; i < 5; i++) expect(applyOp(S.db, op).ok).toBe(true);
    expect(serverStock(S.db, med.id)).toBe(9);
  });

  it('malformed operations are rejected without touching stock', async () => {
    const S = await startShop(); shops.push(S);
    const { med, batches: [b] } = seedMedicine(S.db, 'X', 'Y', 100, [{ batchNo: '1', qty: 10, expiresInDays: 200 }]);
    const bad: unknown[] = [
      null, {}, { id: 'a', kind: 'upsert', rows: 'x', deltas: [] },
      { id: uuid(), kind: 'stock', strict: true, deviceId: 'd', userId: S.owner.id, rows: [], deltas: [{ batchId: b.id, medicineId: med.id, delta: 1.5 }] },
      { id: uuid(), kind: 'upsert', strict: true, deviceId: 'd', userId: S.owner.id, rows: [{ tbl: 'evil_table', row: { id: '1' } }], deltas: [] },
      { id: uuid(), kind: 'upsert', strict: true, deviceId: 'd', userId: 'nobody', rows: [{ tbl: 'medicines', row: { id: '1', name: 'x' } }], deltas: [] },
    ];
    for (const op of bad) expect(applyOp(S.db, op as Op).ok).toBe(false);
    expect(serverStock(S.db, med.id)).toBe(10);
  });

  it('names with HTML/script are printed as plain text on receipts (no script injection)', () => {
    const html = receiptHtml({
      invoice: { id: '1', number: '<b>1</b>', cashierId: 'c', createdAt: new Date().toISOString(), status: 'paid', gross: 100, discount: 0, tax: 0, total: 100, paid: 100, change: 0, payMethod: 'cash', deviceId: 'd' },
      items: [{ id: 'i', invoiceId: '1', medicineId: 'm', batchId: 'b', qty: 1, unitPrice: 100, costPrice: 0, discount: 0, taxBp: 0, tax: 0, total: 100, name: '<img src=x onerror=alert(1)>' }],
      settings: { ...DEFAULT_SETTINGS, storeName: '<script>alert(1)</script>' }, cashier: 'A', patient: null,
    });
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('huge request bodies and unknown routes are refused cleanly', async () => {
    const S = await startShop(); shops.push(S);
    const big = await request(S.app).post('/api/pair').set('content-type', 'application/json').send('{"x":"' + 'a'.repeat(13 * 1024 * 1024) + '"}');
    expect([400, 413]).toContain(big.status);
    expect((await request(S.app).get('/api/does-not-exist')).status).toBe(401); // nothing is visible without this shop's token
  });

  it('owner setup cannot be run twice, and never through a tunnel', async () => {
    const S = await startShop(); shops.push(S);
    const again = await request(S.app).post('/local/setup-owner').send({ name: 'x', username: 'x', pin: '123456', catalog: 'builtin' });
    expect(again.status).toBe(409);
    const tunnel = await request(S.app).post('/local/setup-owner').set('x-forwarded-for', '1.2.3.4').send({});
    expect(tunnel.status).toBe(403);
    expect(getIdentity(S.db)).toBeTruthy();
  });
});
