// Medicines, batches, purchases, stock intake, adjustments, supplier/patient ledgers.
// © Awais Amin
import { uuid, isoDate, AppError, PermissionError } from '../../shared/util.ts';
import { pendingBatchId } from '../../shared/fefo.ts';
import { can, rowPerm } from '../../shared/permissions.ts';
import type { Medicine, Batch, Purchase, PurchaseItem, LedgerEntry, SyncTable, Synced, Delta, OpRow } from '../../shared/types.ts';
import { stamp, emit, nextNumber, type Ctx } from './db.ts';
import { makeOp, enqueue } from './outbox.ts';
import { logAuditRow } from './audit.ts';

export async function stockMap(ctx: Ctx): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  await ctx.db.batches.each(b => { if (!b.deleted) map.set(b.medicineId, (map.get(b.medicineId) || 0) + (b.qty || 0)); });
  return map;
}

export async function stockOf(ctx: Ctx, medicineId: string): Promise<number> {
  const list = await ctx.db.batches.where('medicineId').equals(medicineId).toArray();
  return list.filter(b => !b.deleted).reduce((s, b) => s + b.qty, 0);
}


/** Save a master record (medicine, supplier, patient, prescription) and queue it for sync. */
export async function saveRecord<T extends Synced>(ctx: Ctx, tbl: SyncTable, row: Partial<T> & Record<string, unknown>): Promise<T> {
  const db = ctx.db;
  // create / modify / delete are separate permissions (same rule as the server)
  const prev = row.id ? await db.tbl(tbl).get(row.id as string) : undefined;
  const perm = rowPerm(tbl, prev, row as { deleted?: boolean });
  if (perm && !can(ctx.user, perm)) throw new PermissionError(`You are not allowed to ${perm.endsWith('.create') ? 'create' : perm.endsWith('.delete') ? 'delete' : 'modify'} this`);
  const rec = { ...row, id: (row.id as string) || uuid(), hlc: stamp(ctx), updatedAt: new Date().toISOString() } as unknown as T;
  await db.transaction('rw', db.tbl(tbl), db.outbox, db.audit, async () => {
    const before = await db.tbl(tbl).get(rec.id);
    await db.tbl(tbl).put(rec);
    const a = await logAuditRow(ctx, `${tbl}.${row.deleted ? 'delete' : before ? 'update' : 'create'}`, {
      entity: tbl, entityId: rec.id, details: { name: (rec as unknown as { name?: string }).name },
    });
    await enqueue(ctx, makeOp(ctx, 'upsert', [{ tbl, row: rec }, { tbl: 'audit', row: a }]));
  });
  emit(ctx, 'data-changed', { tbl });
  return rec;
}

export const saveMedicine = (ctx: Ctx, m: Partial<Medicine> & { name: string }) =>
  saveRecord<Medicine>(ctx, 'medicines', { altBarcodes: [], gstBp: 0, reorderLevel: 10, reorderQty: 0, rxRequired: false, deleted: false, salePrice: 0, generic: '', source: 'own', ...m });

/** Remove a medicine from the list (its sales history is kept). Built-in ones can't be brought back later. */
export const deleteMedicine = (ctx: Ctx, m: Medicine) => saveRecord<Medicine>(ctx, 'medicines', { ...m, deleted: true } as never);

/** Edit batch details (expiry, prices). Quantity never changes here — use adjustStock. */
export async function saveBatchDetails(ctx: Ctx, batch: Partial<Batch> & { id: string }) {
  if (!can(ctx.user, 'inventory.edit')) throw new PermissionError();
  const db = ctx.db;
  const cur = await db.batches.get(batch.id);
  if (!cur) throw new AppError('NOT_FOUND', 'Batch not found');
  const rec: Batch = { ...cur, ...batch, qty: cur.qty, hlc: stamp(ctx) };
  await db.transaction('rw', db.batches, db.outbox, db.audit, async () => {
    await db.batches.put(rec);
    const a = await logAuditRow(ctx, 'batches.update', { entity: 'batches', entityId: rec.id, details: { batchNo: rec.batchNo } });
    await enqueue(ctx, makeOp(ctx, 'upsert', [{ tbl: 'batches', row: rec }, { tbl: 'audit', row: a }]));
  });
  emit(ctx, 'stock-changed');
  return rec;
}

/** Stock correction (damage, expired write-off, count difference). Delta-based so devices never overwrite each other. */
export async function adjustStock(ctx: Ctx, batchId: string, delta: number, reason: string) {
  if (!can(ctx.user, 'inventory.adjust')) throw new PermissionError();
  if (!reason?.trim()) throw new AppError('REASON_REQUIRED', 'Please write a reason for this adjustment');
  delta = Math.trunc(delta);
  if (!delta) return;
  const db = ctx.db;
  await db.transaction('rw', db.batches, db.outbox, db.audit, async () => {
    const b = await db.batches.get(batchId);
    if (!b) throw new AppError('NOT_FOUND', 'Batch not found');
    if (!b.pending && b.qty + delta < 0) throw new AppError('NEGATIVE', `Only ${b.qty} in this batch`);
    b.qty += delta;
    b.hlc = stamp(ctx);
    await db.batches.put(b);
    const a = await logAuditRow(ctx, 'stock.adjust', { entity: 'batches', entityId: batchId, details: { batchNo: b.batchNo, delta, reason, newQty: b.qty } });
    await enqueue(ctx, makeOp(ctx, 'stock', [{ tbl: 'audit', row: a }], [{ batchId, medicineId: b.medicineId, delta }]));
  });
  emit(ctx, 'stock-changed');
}

export async function savePurchase(ctx: Ctx, purchase: Partial<Purchase> & { supplierId: string }, items: Omit<PurchaseItem, 'id' | 'purchaseId'>[]): Promise<Purchase> {
  if (!can(ctx.user, purchase.id ? 'purchases.edit' : 'purchases.create')) throw new PermissionError();
  const db = ctx.db;
  let saved!: Purchase;
  await db.transaction('rw', [db.purchases, db.purchaseItems, db.medicines, db.suppliers, db.outbox, db.audit, db.meta], async () => {
    for (const i of items) {
      const m = await db.medicines.get(i.medicineId);
      if (!m || m.deleted) throw new AppError('NOT_IN_INVENTORY', 'Every item must exist in Inventory before it can be purchased');
      if (!Number.isInteger(i.qty) || i.qty <= 0) throw new AppError('INVALID_QTY', `${m.name}: quantity must be a whole number above 0`);
      if (!Number.isInteger(i.freeQty || 0) || (i.freeQty || 0) < 0) throw new AppError('INVALID_QTY', `${m.name}: free units must be 0 or more`);
      if (!(i.costPrice >= 0)) throw new AppError('INVALID_PRICE', `${m.name}: cost price is not valid`);
      if (!i.batchNo?.trim() || !i.expiryDate) throw new AppError('BATCH_REQUIRED', `${m.name}: batch number and expiry are required`);
    }
    if (!purchase.supplierId || !(await db.suppliers.get(purchase.supplierId))) throw new AppError('SUPPLIER_REQUIRED', 'Choose a supplier that exists in Suppliers');
    const old = purchase.id ? await db.purchases.get(purchase.id) : undefined;
    if (old?.status === 'received') throw new AppError('LOCKED', 'A received purchase cannot be edited');
    const p: Purchase = {
      status: 'draft', paid: 0, date: isoDate(), ...old, ...purchase,
      id: purchase.id || uuid(), number: old?.number || purchase.number || await nextNumber(ctx, 'PO'),
      total: items.reduce((s, i) => s + i.costPrice * i.qty, 0), hlc: stamp(ctx),
    } as Purchase;
    const oldItems = await db.purchaseItems.where('purchaseId').equals(p.id).toArray();
    const rows: PurchaseItem[] = items.map(i => ({ freeQty: 0, ...i, id: uuid(), purchaseId: p.id, hlc: stamp(ctx) }));
    await db.purchaseItems.bulkDelete(oldItems.map(o => o.id));
    await db.purchaseItems.bulkPut(rows);
    await db.purchases.put(p);
    const a = await logAuditRow(ctx, old ? 'purchase.update' : 'purchase.create', { entity: 'purchases', entityId: p.id, details: { number: p.number, lines: rows.length } });
    const opRows: OpRow[] = [{ tbl: 'purchases', row: p }, ...rows.map(row => ({ tbl: 'purchaseItems' as const, row })),
      ...oldItems.map(o => ({ tbl: 'purchaseItems' as const, row: { ...o, deleted: true, hlc: stamp(ctx) } })), { tbl: 'audit', row: a }];
    await enqueue(ctx, makeOp(ctx, 'upsert', opRows));
    saved = p;
  });
  emit(ctx, 'data-changed', { tbl: 'purchases' });
  return saved;
}

/**
 * Stock intake: one batch per line. Any medicine sold before it was entered
 * (negative "pending intake") is settled first so the shelf count is right.
 */
export async function receivePurchase(ctx: Ctx, purchaseId: string) {
  if (!can(ctx.user, 'purchases.receive')) throw new PermissionError();
  const db = ctx.db;
  const now = new Date().toISOString();
  let created: Batch[] = [];
  await db.transaction('rw', [db.purchases, db.purchaseItems, db.batches, db.ledger, db.outbox, db.audit], async () => {
    const p = await db.purchases.get(purchaseId);
    if (!p) throw new AppError('NOT_FOUND', 'Purchase not found');
    if (p.status === 'received') throw new AppError('DUPLICATE', 'This purchase was already received');
    const items = (await db.purchaseItems.where('purchaseId').equals(purchaseId).toArray()).filter(i => !i.deleted);
    if (!items.length) throw new AppError('EMPTY', 'Add at least one line');
    for (const it of items) if (!it.batchNo || !it.expiryDate) throw new AppError('BATCH_REQUIRED', 'Every line needs a batch number and expiry date');
    const deltas: Delta[] = [];
    created = [];
    for (const it of items) {
      let qty = it.qty + (it.freeQty || 0);
      const pend = await db.batches.get(pendingBatchId(it.medicineId));
      if (pend && pend.qty < 0) {
        const settle = Math.min(qty, -pend.qty);
        pend.qty += settle; pend.hlc = stamp(ctx);
        await db.batches.put(pend);
        deltas.push({ batchId: pend.id, medicineId: it.medicineId, delta: settle });
        qty -= settle;
      }
      const b: Batch = {
        id: uuid(), medicineId: it.medicineId, batchNo: it.batchNo, mfgDate: it.mfgDate || null, expiryDate: it.expiryDate,
        qty, costPrice: it.costPrice, salePrice: it.salePrice || null, supplierId: p.supplierId, purchaseId: p.id,
        receivedAt: now, pending: false, hlc: stamp(ctx),
      };
      await db.batches.put(b);
      created.push(b);
      deltas.push({ batchId: b.id, medicineId: b.medicineId, delta: qty, create: { ...b, qty: 0 } });
    }
    const rp: Purchase = { ...p, status: 'received', receivedAt: now, hlc: stamp(ctx) };
    await db.purchases.put(rp);
    const entry: LedgerEntry = { id: uuid(), partyType: 'supplier', partyId: p.supplierId, date: isoDate(), debit: 0, credit: p.total, ref: p.number, note: 'Purchase bill', hlc: stamp(ctx) };
    await db.ledger.put(entry);
    const a = await logAuditRow(ctx, 'purchase.receive', { entity: 'purchases', entityId: p.id, details: { number: p.number, lines: items.length, total: p.total } });
    await enqueue(ctx, makeOp(ctx, 'stock', [{ tbl: 'purchases', row: rp }, { tbl: 'ledger', row: entry }, { tbl: 'audit', row: a }], deltas));
  });
  emit(ctx, 'stock-changed');
  return created;
}

/** Quick "opening stock" entry without a purchase order (first-time setup). */
export async function addOpeningStock(ctx: Ctx, medicineId: string, b: { batchNo: string; expiryDate: string; qty: number; costPrice: number; salePrice?: number | null; mfgDate?: string | null }) {
  if (!can(ctx.user, 'inventory.add_stock')) throw new PermissionError();
  const db = ctx.db;
  const batch: Batch = { id: uuid(), medicineId, pending: false, receivedAt: new Date().toISOString(), supplierId: null, purchaseId: null, salePrice: null, mfgDate: null, ...b, hlc: stamp(ctx) };
  await db.transaction('rw', db.batches, db.outbox, db.audit, async () => {
    await db.batches.put(batch);
    const a = await logAuditRow(ctx, 'stock.opening', { entity: 'batches', entityId: batch.id, details: { batchNo: b.batchNo, qty: b.qty } });
    await enqueue(ctx, makeOp(ctx, 'stock', [{ tbl: 'audit', row: a }], [{ batchId: batch.id, medicineId, delta: b.qty, create: { ...batch, qty: 0 } }]));
  });
  emit(ctx, 'stock-changed');
  return batch;
}

export async function recordPayment(ctx: Ctx, partyType: 'supplier' | 'patient', partyId: string, amount: number, note = '') {
  if (!can(ctx.user, partyType === 'supplier' ? 'suppliers.payment' : 'patients.payment')) throw new PermissionError();
  const db = ctx.db;
  const entry: LedgerEntry = {
    id: uuid(), partyType, partyId, date: isoDate(), ref: 'PAYMENT', note, hlc: stamp(ctx),
    debit: partyType === 'supplier' ? amount : 0, credit: partyType === 'patient' ? amount : 0,
  };
  await db.transaction('rw', db.ledger, db.outbox, db.audit, async () => {
    await db.ledger.put(entry);
    const a = await logAuditRow(ctx, 'ledger.payment', { entity: partyType, entityId: partyId, details: { amount } });
    await enqueue(ctx, makeOp(ctx, 'upsert', [{ tbl: 'ledger', row: entry }, { tbl: 'audit', row: a }]));
  });
  return entry;
}

/** Supplier → what we owe them. Patient → what they owe us (udhaar). */
export async function partyBalance(ctx: Ctx, partyType: 'supplier' | 'patient', partyId: string) {
  const rows = await ctx.db.ledger.where('[partyType+partyId]').equals([partyType, partyId]).toArray();
  const credit = rows.reduce((s, r) => s + r.credit, 0), debit = rows.reduce((s, r) => s + r.debit, 0);
  return partyType === 'supplier' ? credit - debit : debit - credit;
}

/** Cancel a purchase that has not been received yet (needs "Cancel purchases"). */
export async function cancelPurchase(ctx: Ctx, purchaseId: string) {
  if (!can(ctx.user, 'purchases.delete')) throw new PermissionError('You are not allowed to cancel purchases');
  const p = await ctx.db.purchases.get(purchaseId);
  if (!p) throw new AppError('NOT_FOUND', 'Purchase not found');
  if (p.status === 'received') throw new AppError('LOCKED', 'This purchase is already in stock — use stock adjustment or a return instead');
  const db = ctx.db;
  const next: Purchase = { ...p, status: 'cancelled', deleted: true, hlc: stamp(ctx) };
  await db.transaction('rw', db.purchases, db.outbox, db.audit, async () => {
    await db.purchases.put(next);
    const a = await logAuditRow(ctx, 'purchase.cancel', { entity: 'purchases', entityId: p.id, details: { number: p.number } });
    await enqueue(ctx, makeOp(ctx, 'upsert', [{ tbl: 'purchases', row: next }, { tbl: 'audit', row: a }]));
  });
  emit(ctx, 'data-changed', { tbl: 'purchases' });
  return next;
}
