// All modules linked: supplier → purchase → inventory → POS sale → customer credit
// → payment → bill void → stock back. Plus "item must exist before purchase".
import { describe, it, expect, afterEach } from 'vitest';
import { startShop, stop, addUser, newDevice, serverStock, type Shop } from './helpers.ts';
import { login } from '../client/core/auth.ts';
import { saveRecord, saveMedicine, savePurchase, receivePurchase, cancelPurchase, recordPayment, partyBalance, stockOf } from '../client/core/inventory.ts';
import { newCart, addToCart, checkout, voidInvoice } from '../client/core/pos.ts';
import { applyOp } from '../server/ops.ts';
import { allRows } from '../server/db.ts';
import { uuid, addDays, isoDate } from '../shared/util.ts';
import type { Supplier, Patient, Medicine, LedgerEntry } from '../shared/types.ts';

const shops: Shop[] = [];
afterEach(async () => { while (shops.length) await stop(shops.pop()!); });

async function ownerDevice() {
  const S = await startShop(); shops.push(S);
  const d = await newDevice(S);
  await login(d.ctx, 'owner', '111111', d.client);
  return { S, ...d };
}

describe('Modules are linked end to end', () => {
  it('supplier → purchase → receive → inventory → sale → customer udhaar → payment → void returns stock', async () => {
    const { S, ctx, client, sync } = await ownerDevice();
    const sup = await saveRecord<Supplier>(ctx, 'suppliers', { name: 'Muller & Phipps', phone: '021-1234567' });
    const med = await saveMedicine(ctx, { name: 'Risek', generic: 'Omeprazole', strength: '20mg', form: 'Capsule', salePrice: 3100 });
    const pt = await saveRecord<Patient>(ctx, 'patients', { name: 'Bilal', phone: '03001234567' });

    // Purchase → nothing in stock until received
    const po = await savePurchase(ctx, { supplierId: sup.id, date: isoDate(), status: 'ordered' }, [{ medicineId: med.id, qty: 40, freeQty: 2, costPrice: 2400, salePrice: 3200, batchNo: 'R-77', mfgDate: null, expiryDate: addDays(isoDate(), 400) }]);
    expect(await stockOf(ctx, med.id)).toBe(0);
    await receivePurchase(ctx, po.id);
    expect(await stockOf(ctx, med.id)).toBe(42);                         // Inventory
    expect(await partyBalance(ctx, 'supplier', sup.id)).toBe(40 * 2400); // Supplier account
    await expect(cancelPurchase(ctx, po.id)).rejects.toThrow(/already in stock/);

    // Sale on credit to the customer — price comes from the purchased batch
    const cart = newCart(true); cart.patientId = pt.id;
    await addToCart(ctx, cart, med, 10);
    expect(cart.lines[0].unitPrice).toBe(3200);
    const { invoice } = await checkout(ctx, cart, { method: 'credit', paid: 0 }, client);
    expect(await stockOf(ctx, med.id)).toBe(32);
    expect(await partyBalance(ctx, 'patient', pt.id)).toBe(invoice.total); // Customer udhaar
    await recordPayment(ctx, 'patient', pt.id, 10000, 'Cash');
    expect(await partyBalance(ctx, 'patient', pt.id)).toBe(invoice.total - 10000);

    // Return the bill → stock goes back to the same batch
    await voidInvoice(ctx, invoice.id, 'Customer returned');
    expect(await stockOf(ctx, med.id)).toBe(42);

    // Everything reached the shop server and matches
    await sync.syncNow();
    expect(serverStock(S.db, med.id)).toBe(42);
    expect(allRows<LedgerEntry>(S.db, 'ledger').length).toBe(3);
  });

  it('an item must exist in Inventory before it can be purchased (device and server both refuse)', async () => {
    const { S, ctx } = await ownerDevice();
    const sup = await saveRecord<Supplier>(ctx, 'suppliers', { name: 'Supplier A' });
    await expect(savePurchase(ctx, { supplierId: sup.id, date: isoDate(), status: 'ordered' }, [{ medicineId: 'does-not-exist', qty: 5, freeQty: 0, costPrice: 100, salePrice: null, batchNo: 'B1', mfgDate: null, expiryDate: addDays(isoDate(), 300) }]))
      .rejects.toThrow(/must exist in Inventory/);
    const r = applyOp(S.db, { id: uuid(), kind: 'upsert', strict: true, deviceId: 'd', userId: S.owner.id, createdAt: '', deltas: [],
      rows: [{ tbl: 'purchaseItems', row: { id: uuid(), purchaseId: 'p', medicineId: 'ghost', qty: 1, costPrice: 1, batchNo: 'x', expiryDate: '2099-01-01' } as never }] });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/created in Inventory/);
  });

  it('a purchase needs a real supplier, whole quantities and a batch + future expiry', async () => {
    const { ctx } = await ownerDevice();
    const med = await saveMedicine(ctx, { name: 'Flagyl', generic: 'Metronidazole', salePrice: 400 });
    const sup = await saveRecord<Supplier>(ctx, 'suppliers', { name: 'S' });
    const line = { medicineId: med.id, qty: 5, freeQty: 0, costPrice: 300, salePrice: null, batchNo: 'F1', mfgDate: null, expiryDate: addDays(isoDate(), 100) };
    await expect(savePurchase(ctx, { supplierId: 'nope', date: isoDate(), status: 'ordered' }, [line])).rejects.toThrow(/supplier/i);
    await expect(savePurchase(ctx, { supplierId: sup.id, date: isoDate(), status: 'ordered' }, [{ ...line, qty: 2.5 }])).rejects.toThrow(/whole number/);
    await expect(savePurchase(ctx, { supplierId: sup.id, date: isoDate(), status: 'ordered' }, [{ ...line, qty: -3 }])).rejects.toThrow(/whole number/);
    await expect(savePurchase(ctx, { supplierId: sup.id, date: isoDate(), status: 'ordered' }, [{ ...line, batchNo: ' ' }])).rejects.toThrow(/batch/);
  });

  it('deleted items cannot be sold or bought, but their history stays', async () => {
    const { ctx } = await ownerDevice();
    const med = await saveMedicine(ctx, { name: 'Old Syrup', generic: 'X', salePrice: 100 });
    const gone = await saveRecord<Medicine>(ctx, 'medicines', { ...med, deleted: true } as never);
    await expect(addToCart(ctx, newCart(), gone, 1)).rejects.toThrow(/deleted/);
    const sup = await saveRecord<Supplier>(ctx, 'suppliers', { name: 'S' });
    await expect(savePurchase(ctx, { supplierId: sup.id, date: isoDate(), status: 'ordered' }, [{ medicineId: med.id, qty: 1, freeQty: 0, costPrice: 1, salePrice: null, batchNo: 'b', mfgDate: null, expiryDate: addDays(isoDate(), 9) }])).rejects.toThrow(/Inventory/);
  });
});

describe('Granular permissions — each switch is enforced', () => {
  it('create, modify and delete are separate for items, customers and suppliers', async () => {
    const S = await startShop(); shops.push(S);
    const { saveUser } = await import('../server/supervision.ts');
    saveUser(S.db, S.owner, { username: 'clerk', name: 'Clerk', role: 'custom', perms: ['inventory', 'inventory.create', 'patients', 'patients.create', 'suppliers', 'suppliers.edit'], pin: '222222' });
    const d = await newDevice(S);
    await login(d.ctx, 'clerk', '222222', d.client);
    const med = await saveMedicine(d.ctx, { name: 'Brufen', generic: 'Ibuprofen', salePrice: 500 });   // create: allowed
    await expect(saveMedicine(d.ctx, { ...med, salePrice: 1 })).rejects.toThrow(/not allowed to modify/); // modify: not allowed
    await expect(saveRecord(d.ctx, 'medicines', { ...med, deleted: true } as never)).rejects.toThrow(/not allowed to delete/);
    const p = await saveRecord<Patient>(d.ctx, 'patients', { name: 'Ali' });
    await expect(saveRecord(d.ctx, 'patients', { ...p, phone: '0300' } as never)).rejects.toThrow(/modify/);
    await expect(saveRecord(d.ctx, 'suppliers', { name: 'New Sup' })).rejects.toThrow(/create/);
    await expect(recordPayment(d.ctx, 'patient', p.id, 100)).rejects.toThrow();
  });

  it('the server refuses the same actions even if a device is tampered with', async () => {
    const S = await startShop(); shops.push(S);
    const { saveUser } = await import('../server/supervision.ts');
    const u = saveUser(S.db, S.owner, { username: 'clerk', name: 'Clerk', role: 'custom', perms: ['inventory', 'inventory.create'], pin: '222222' });
    const med = { id: uuid(), name: 'X', generic: 'Y', salePrice: 1, hlc: '1' };
    const op = (rows: object[], kind = 'upsert') => applyOp(S.db, { id: uuid(), kind: kind as never, strict: true, deviceId: 'd', userId: u.id, createdAt: '', deltas: [], rows: rows as never });
    expect(op([{ tbl: 'medicines', row: med }]).ok).toBe(true);
    expect(op([{ tbl: 'medicines', row: { ...med, salePrice: 9, hlc: '2' } }]).code).toBe('FORBIDDEN');
    expect(op([{ tbl: 'medicines', row: { ...med, deleted: true, hlc: '3' } }]).code).toBe('FORBIDDEN');
    expect(op([{ tbl: 'patients', row: { id: uuid(), name: 'P' } }]).code).toBe('FORBIDDEN');
    expect(op([{ tbl: 'ledger', row: { id: uuid(), partyType: 'supplier', partyId: 's', date: isoDate(), debit: 5, credit: 0, ref: 'x' } }]).code).toBe('FORBIDDEN');
    expect(op([{ tbl: 'shop', row: { id: 'shop', name: 'Hacked' } }]).code).toBe('FORBIDDEN');
    expect(op([{ tbl: 'users', row: { ...u, perms: ['users'], hlc: '9' } }]).code).toBe('FORBIDDEN');
  });
});
