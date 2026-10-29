// Concurrent FEFO overselling and strict "out of stock" locking.
import { describe, it, expect, afterEach } from 'vitest';
import { startShop, stop, seedMedicine, serverStock, serverBatchQty, addUser, newDevice, deviceStock, type Shop } from './helpers.ts';
import { applyOp, pullChanges } from '../server/ops.ts';
import { allRows } from '../server/db.ts';
import { newCart, addToCart, checkout } from '../client/core/pos.ts';
import { login } from '../client/core/auth.ts';
import { uuid } from '../shared/util.ts';
import type { Op, InvoiceItem, AuditEntry, Medicine } from '../shared/types.ts';

const shops: Shop[] = [];
afterEach(async () => { while (shops.length) await stop(shops.pop()!); });

function saleOp(userId: string, medicineId: string, batchId: string, qty: number, strict: boolean): Op {
  const invoiceId = uuid(), itemId = uuid();
  return {
    id: uuid(), kind: 'sale', strict, deviceId: 'dev', userId, createdAt: new Date().toISOString(),
    rows: [
      { tbl: 'invoices', row: { id: invoiceId, number: `INV-${invoiceId.slice(0, 6)}`, cashierId: userId, createdAt: new Date().toISOString(), status: 'paid', gross: qty * 100, discount: 0, tax: 0, total: qty * 100, paid: qty * 100, change: 0, payMethod: 'cash', deviceId: 'dev', hlc: '1' } as never },
      { tbl: 'invoiceItems', row: { id: itemId, invoiceId, medicineId, batchId, qty, unitPrice: 100, costPrice: 80, discount: 0, taxBp: 0, tax: 0, total: qty * 100 } as never },
    ],
    deltas: [{ batchId, medicineId, delta: -qty, itemId }],
  };
}

describe('Concurrent FEFO batch overselling', () => {
  it('two cashiers sell the last 3 of Batch #101 offline → second sale moves to Batch #102 with a warning', async () => {
    const S = await startShop(); shops.push(S);
    const c1 = addUser(S, 'cashier1'), c2 = addUser(S, 'cashier2');
    const { med, batches: [b101, b102] } = seedMedicine(S.db, 'Panadol 500mg', 'Paracetamol', 270, [
      { batchNo: '101', qty: 3, expiresInDays: 40 }, { batchNo: '102', qty: 10, expiresInDays: 300 },
    ]);
    const before = serverStock(S.db, med.id);
    // Both devices were offline and both picked Batch #101 (FEFO) for 3 units.
    const r1 = applyOp(S.db, saleOp(c1.id, med.id, b101.id, 3, false));
    const r2 = applyOp(S.db, saleOp(c2.id, med.id, b101.id, 3, false));
    expect(r1.ok && r2.ok).toBe(true);
    expect(r1.reallocations).toEqual([]);
    expect(r2.reallocations![0].to).toEqual([{ batchId: b102.id, qty: 3 }]);
    expect(serverBatchQty(S.db, b101.id)).toBe(0);
    expect(serverBatchQty(S.db, b102.id)).toBe(7);
    expect(serverStock(S.db, med.id)).toBe(before - 6); // zero drift
    const item = allRows<InvoiceItem>(S.db, 'invoiceItems').find(i => i.id === r2.reallocations![0].itemId)!;
    expect(item.batchId).toBe(b102.id);  // the invoice now shows the batch actually sold
    const log = allRows<AuditEntry>(S.db, 'audit').filter(a => a.action === 'fefo.reallocated');
    expect(log).toHaveLength(1);
  });

  it('when every batch is empty, an offline sale is kept and flagged; stock goes negative "pending intake"', async () => {
    const S = await startShop(); shops.push(S);
    const c = addUser(S, 'cashier');
    const { med, batches: [b] } = seedMedicine(S.db, 'Risek 20mg', 'Omeprazole', 3100, [{ batchNo: 'R1', qty: 2, expiresInDays: 200 }]);
    applyOp(S.db, saleOp(c.id, med.id, b.id, 2, false));
    const r = applyOp(S.db, saleOp(c.id, med.id, b.id, 2, false));
    expect(r.ok).toBe(true);
    expect(r.conflicts).toEqual([{ medicineId: med.id, shortBy: 2 }]);
    expect(serverStock(S.db, med.id)).toBe(-2);
    expect(allRows<AuditEntry>(S.db, 'audit').some(a => a.action === 'stock.conflict')).toBe(true);
  });

  it('2 simultaneous online sales for 1 remaining item → 1 succeeds, 1 fails "Out of stock"', async () => {
    const S = await startShop(); shops.push(S);
    addUser(S, 'c1'); addUser(S, 'c2');
    const { med } = seedMedicine(S.db, 'Augmentin 625mg', 'Amoxicillin + Clavulanate', 8000, [{ batchNo: 'A1', qty: 1, expiresInDays: 365 }]);
    const d1 = await newDevice(S, 'Counter 1'), d2 = await newDevice(S, 'Counter 2');
    await login(d1.ctx, 'c1', '222222', d1.client);
    await login(d2.ctx, 'c2', '222222', d2.client);
    const m1 = (await d1.ctx.db.medicines.get(med.id)) as Medicine, m2 = (await d2.ctx.db.medicines.get(med.id)) as Medicine;
    const cart1 = newCart(), cart2 = newCart();
    await addToCart(d1.ctx, cart1, m1, 1);
    await addToCart(d2.ctx, cart2, m2, 1); // both screens still show 1 in stock
    const results = await Promise.allSettled([
      checkout(d1.ctx, cart1, { method: 'cash', paid: 10000 }, d1.client),
      checkout(d2.ctx, cart2, { method: 'cash', paid: 10000 }, d2.client),
    ]);
    const ok = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason.code).toBe('OUT_OF_STOCK');
    expect(failed[0].reason.message).toMatch(/sold out/i);
    expect(serverStock(S.db, med.id)).toBe(0);
    // The losing device saved nothing.
    const loser = ok[0] === results[0] ? d2 : d1;
    expect(await loser.ctx.db.invoices.count()).toBe(0);
    await d1.sync.syncNow(); await d2.sync.syncNow();
    expect(await deviceStock(d1.ctx, med.id)).toBe(0);
    expect(await deviceStock(d2.ctx, med.id)).toBe(0);
  });

  it('a retried operation is applied only once (idempotent)', async () => {
    const S = await startShop(); shops.push(S);
    const c = addUser(S, 'cashier');
    const { med, batches: [b] } = seedMedicine(S.db, 'Brufen 400mg', 'Ibuprofen', 500, [{ batchNo: 'B1', qty: 10, expiresInDays: 200 }]);
    const op = saleOp(c.id, med.id, b.id, 4, false);
    applyOp(S.db, op); applyOp(S.db, op); applyOp(S.db, op);
    expect(serverStock(S.db, med.id)).toBe(6);
    expect(pullChanges(S.db, 0).changes.filter(ch => ch.tbl === 'invoices')).toHaveLength(1);
  });

  it('a cashier without permission cannot void, adjust stock or create users through sync', async () => {
    const S = await startShop(); shops.push(S);
    const c = addUser(S, 'cashier');
    const r = applyOp(S.db, { id: uuid(), kind: 'upsert', strict: true, deviceId: 'd', userId: c.id, createdAt: '', deltas: [],
      rows: [{ tbl: 'users', row: { id: uuid(), username: 'evil', name: 'x', role: 'admin', perms: [], active: true } as never }] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('FORBIDDEN');
    const r2 = applyOp(S.db, { id: uuid(), kind: 'upsert', strict: true, deviceId: 'd', userId: c.id, createdAt: '', deltas: [],
      rows: [{ tbl: 'users', row: { ...S.owner, active: false } as never }] });
    expect(r2.ok).toBe(false);
  });
});
