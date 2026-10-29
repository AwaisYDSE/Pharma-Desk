// Point of Sale engine: cart with automatic FEFO batch selection, GST, discounts,
// FEFO-override and negative-stock supervisor checks, and an atomic checkout that is
// strict when the server is reachable and still works when it is not.
// © Awais Amin
import type { Ctx } from './db.ts';
import { stamp, enqueue, nextNumber, emit } from './db.ts';
import type { ServerClient } from './sync.ts';
import { flushOutbox } from './sync.ts';
import { allocateFEFO, pendingBatchId, isSellable, fefoSort } from '../../shared/fefo.ts';
import { invoiceTotals } from '../../shared/money.ts';
import { can } from '../../shared/permissions.ts';
import { uuid, isoDate, daysBetween, OutOfStockError, OverrideRequiredError, PermissionError, NetworkError, AppError } from '../../shared/util.ts';
import type { Batch, Medicine, Invoice, InvoiceItem, Delta, OpResult, User } from '../../shared/types.ts';

export interface CartLine {
  key: string;
  medicine: Medicine;
  batch: Batch;          // the batch this line sells from (FEFO-chosen unless overridden)
  qty: number;
  unitPrice: number;
  discountBp: number;
  taxBp: number;
  overriddenBy?: string; // supervisor who approved a non-FEFO batch
  listPrice?: number;    // the normal price; unitPrice differs only if someone changed it
}

export interface Cart { lines: CartLine[]; billDiscount: number; patientId: string | null; inclusive: boolean }

export const newCart = (inclusive = true): Cart => ({ lines: [], billDiscount: 0, patientId: null, inclusive });

export async function batchesFor(ctx: Ctx, medicineId: string): Promise<Batch[]> {
  return (await ctx.db.batches.where('medicineId').equals(medicineId).toArray()) as unknown as Batch[];
}

/** Units of each batch already in the cart. */
const inCart = (cart: Cart) => {
  const m = new Map<string, number>();
  for (const l of cart.lines) m.set(l.batch.id, (m.get(l.batch.id) || 0) + l.qty);
  return m;
};

/**
 * Add qty of a medicine. Batches are picked FEFO (nearest expiry first), splitting
 * across batches when one is short. Returns the warnings to show (e.g. expiring soon).
 */
export async function addToCart(ctx: Ctx, cart: Cart, medicine: Medicine, qty = 1, opts: { allowNegative?: boolean } = {}) {
  if (!Number.isInteger(qty) || qty <= 0 || qty > 100000) throw new AppError('INVALID_QTY', 'Quantity must be a whole number between 1 and 100,000');
  if (medicine.deleted) throw new AppError('DELETED', `${medicine.name} was deleted from Inventory`);
  const today = isoDate();
  const used = inCart(cart);
  const batches = (await batchesFor(ctx, medicine.id)).map(b => ({ ...b, qty: b.qty - (used.get(b.id) || 0) }));
  const { allocations, shortfall } = allocateFEFO(batches, qty, today);
  const warnings: { kind: string; message: string; batchNo?: string; days?: number }[] = [];
  if (shortfall > 0) {
    if (!opts.allowNegative) {
      const have = qty - shortfall;
      throw new OutOfStockError(have > 0 ? `Only ${have} of ${medicine.name} in stock` : `${medicine.name} is out of stock`, { medicineId: medicine.id, available: have });
    }
    if (!can(ctx.user, 'pos.negative_stock')) throw new OverrideRequiredError('pos.negative_stock', `${medicine.name}: not enough in stock. A supervisor must approve selling before stock is entered.`);
    const pend: Batch = (batches.find(b => b.id === pendingBatchId(medicine.id)) as Batch) ||
      { id: pendingBatchId(medicine.id), medicineId: medicine.id, batchNo: 'PENDING-INTAKE', expiryDate: '9999-12-31', qty: 0, costPrice: 0, pending: true };
    allocations.push({ batch: pend, qty: shortfall });
  }
  for (const a of allocations) {
    const existing = cart.lines.find(l => l.batch.id === a.batch.id);
    const price = a.batch.salePrice || medicine.salePrice;
    if (existing) existing.qty += a.qty;
    else cart.lines.push({ key: uuid(), medicine, batch: a.batch, qty: a.qty, unitPrice: price, listPrice: price, discountBp: 0, taxBp: medicine.gstBp || 0 });
    const days = a.batch.pending ? null : daysBetween(today, a.batch.expiryDate);
    if (days !== null && days <= 30) warnings.push({ kind: 'fefo', batchNo: a.batch.batchNo, days, message: `FEFO: Batch #${a.batch.batchNo} expires in ${days} days — sell this one first!` });
  }
  if (allocations.length > 1) warnings.push({ kind: 'split', message: `${medicine.name} taken from ${allocations.length} batches (nearest expiry first)` });
  return warnings;
}

/** Sell from a different batch than FEFO suggests — needs pos.override_fefo (own or a supervisor's). */
export async function overrideBatch(ctx: Ctx, cart: Cart, lineKey: string, newBatchId: string, supervisor?: User) {
  const line = cart.lines.find(l => l.key === lineKey);
  if (!line) throw new AppError('NOT_FOUND', 'Line not found');
  const approver = can(ctx.user, 'pos.override_fefo') ? ctx.user! : supervisor;
  if (!approver || !can(approver, 'pos.override_fefo')) throw new OverrideRequiredError('pos.override_fefo', 'Selling a newer batch first needs a supervisor PIN.');
  const today = isoDate();
  const batches = await batchesFor(ctx, line.medicine.id);
  const target = batches.find(b => b.id === newBatchId);
  if (!target || !isSellable(target, today)) throw new AppError('INVALID', 'That batch cannot be sold (empty or expired)');
  const used = inCart(cart).get(target.id) || 0;
  if (target.qty - used < line.qty) throw new OutOfStockError(`Only ${target.qty - used} left in batch ${target.batchNo}`);
  const fefoFirst = batches.filter(b => isSellable(b, today)).sort(fefoSort)[0];
  line.batch = target;
  line.overriddenBy = fefoFirst && fefoFirst.id !== target.id ? approver.id : undefined;
}

/** Change the selling price of one line (paisa). Needs pos.price — checked again at checkout. */
export function setPrice(cart: Cart, lineKey: string, paisa: number) {
  const l = cart.lines.find(x => x.key === lineKey);
  if (!l) return;
  if (!Number.isFinite(paisa) || paisa < 0 || paisa > 100_000_000) throw new AppError('INVALID', 'Enter a valid price');
  l.unitPrice = Math.round(paisa);
}

/** True when any line is sold at a price different from its normal price. */
export const priceChanged = (cart: Cart) => cart.lines.some(l => l.listPrice != null && l.unitPrice !== l.listPrice);

export function setQty(cart: Cart, lineKey: string, qty: number) {
  const l = cart.lines.find(x => x.key === lineKey);
  if (!l) return;
  if (qty <= 0) cart.lines = cart.lines.filter(x => x.key !== lineKey);
  else l.qty = Math.min(100000, Math.floor(qty));
}

export function totals(cart: Cart) {
  return invoiceTotals(cart.lines.map(l => ({ unitPrice: l.unitPrice, qty: l.qty, discountBp: l.discountBp, taxBp: l.taxBp })),
    { billDiscount: cart.billDiscount, inclusive: cart.inclusive });
}

export interface Payment { method: Invoice['payMethod']; paid: number }

/**
 * Checkout. Builds the invoice + items + stock deltas as ONE operation.
 *  • Server reachable → sent immediately in strict mode. If another counter sold the
 *    last units a moment earlier, the server refuses: nothing is saved, the cashier
 *    sees "Out of stock". (Exactly one of two simultaneous sales wins.)
 *  • Server unreachable → saved locally and queued (non-strict); it syncs later.
 */
export async function checkout(ctx: Ctx, cart: Cart, pay: Payment, client: ServerClient | null, opts: { supervisorId?: string } = {}): Promise<{ invoice: Invoice; offline: boolean; result?: OpResult }> {
  if (!ctx.user || !can(ctx.user, 'pos')) throw new PermissionError();
  if (!cart.lines.length) throw new AppError('EMPTY', 'The bill is empty');
  const shopRow = await ctx.db.shop.get('shop');
  if (shopRow?.planLock) throw new AppError('LICENSE_LOCKED', shopRow.planLock.status === 'suspended' ? 'The plan is paused, so billing is off. Please contact the developer.' : 'The plan has ended, so billing is off. Please renew.');
  const t = totals(cart);
  const discounted = cart.billDiscount > 0 || cart.lines.some(l => l.discountBp > 0);
  if (discounted && !can(ctx.user, 'pos.discount') && !opts.supervisorId) throw new OverrideRequiredError('pos.discount', 'Discounts need a supervisor PIN');
  if (priceChanged(cart) && !can(ctx.user, 'pos.price') && !opts.supervisorId) throw new OverrideRequiredError('pos.price', 'Changing the price needs a supervisor PIN');
  if (pay.method === 'credit' && !can(ctx.user, 'pos.credit_sale') && !opts.supervisorId) throw new OverrideRequiredError('pos.credit_sale', 'Credit sales need a supervisor PIN');
  if (pay.method === 'credit' && !cart.patientId) throw new AppError('PATIENT_REQUIRED', 'Choose the customer for a credit sale');
  if (pay.method !== 'credit' && pay.paid < t.total) throw new AppError('UNDERPAID', 'Amount received is less than the total');

  const invoiceId = uuid();
  const now = new Date().toISOString();
  const invoice: Invoice = {
    id: invoiceId, number: await nextNumber(ctx, 'INV'), patientId: cart.patientId, cashierId: ctx.user.id, createdAt: now,
    status: pay.method === 'credit' ? 'credit' : 'paid', gross: t.gross, discount: t.discount, tax: t.tax, total: t.total,
    paid: pay.method === 'credit' ? 0 : pay.paid, change: pay.method === 'credit' ? 0 : pay.paid - t.total, payMethod: pay.method,
    deviceId: ctx.deviceId, hlc: stamp(ctx),
    ...(opts.supervisorId ? { note: `approved by ${opts.supervisorId}` } : {}),
  };
  const items: InvoiceItem[] = cart.lines.map((l, i) => ({
    id: uuid(), invoiceId, medicineId: l.medicine.id, batchId: l.batch.id, qty: l.qty, unitPrice: l.unitPrice,
    costPrice: l.batch.costPrice || 0, discount: t.lines[i].discount, taxBp: l.taxBp, tax: t.lines[i].tax, total: t.lines[i].total,
    name: l.medicine.name, generic: l.medicine.generic, batchNo: l.batch.batchNo, expiryDate: l.batch.expiryDate, hlc: stamp(ctx),
  }));
  const deltas: Delta[] = items.map(it => ({ batchId: it.batchId, medicineId: it.medicineId, delta: -it.qty, itemId: it.id }));
  const rows = [
    { tbl: 'invoices' as const, row: invoice },
    ...items.map(row => ({ tbl: 'invoiceItems' as const, row })),
  ];
  if (pay.method === 'credit') rows.push({ tbl: 'ledger' as never, row: { id: uuid(), partyType: 'patient', partyId: cart.patientId, date: isoDate(), debit: t.total, credit: 0, ref: invoice.number, note: 'Credit sale', hlc: stamp(ctx) } as never });
  const overrides = cart.lines.filter(l => l.overriddenBy);
  const repriced = cart.lines.filter(l => l.listPrice != null && l.unitPrice !== l.listPrice);
  if (repriced.length) rows.push({ tbl: 'audit' as never, row: { id: uuid(), at: now, userId: ctx.user.id, userName: ctx.user.name, deviceId: ctx.deviceId, action: 'pos.price_change', entity: 'invoices', entityId: invoiceId, details: { bill: invoice.number, approvedBy: opts.supervisorId || ctx.user.id, items: repriced.map(l => ({ medicine: l.medicine.name, from: l.listPrice, to: l.unitPrice })) }, hlc: stamp(ctx) } as never });
  if (overrides.length) rows.push({ tbl: 'audit' as never, row: { id: uuid(), at: now, userId: ctx.user.id, userName: ctx.user.name, deviceId: ctx.deviceId, action: 'pos.fefo_override', entity: 'invoices', entityId: invoiceId, details: overrides.map(l => ({ medicine: l.medicine.name, batch: l.batch.batchNo, approvedBy: l.overriddenBy })), hlc: stamp(ctx) } as never });

  const opId = uuid();
  // 1) Online: strict, server decides atomically.
  if (client && ctx.pairing) {
    try {
      // Send changes made on this device first (e.g. stock just received) so the
      // server knows every batch this sale uses.
      await flushOutbox(ctx, client);
      const { results } = await client.request<{ results: OpResult[] }>('POST', '/api/ops', {
        ops: [{ id: opId, kind: 'sale', strict: true, deviceId: ctx.deviceId, userId: ctx.user.id, createdAt: now, rows, deltas }],
      }, { session: false });
      const r = results[0];
      if (!r.ok) {
        if (r.code === 'OUT_OF_STOCK') {
          const short = r.conflicts?.[0];
          const name = cart.lines.find(l => l.medicine.id === short?.medicineId)?.medicine.name || 'An item';
          throw new OutOfStockError(`${name} just sold out on another counter. Remove it or reduce the quantity.`, { ...short });
        }
        throw new AppError(r.code || 'REJECTED', r.message || 'The server refused this sale');
      }
      await saveLocally(ctx, invoice, items, rows, { id: opId, deltas }, false);
      emit(ctx, 'sale', { invoice, offline: false, result: r });
      return { invoice, offline: false, result: r };
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      // fall through to offline mode
    }
  }
  // 2) Offline: commit locally + outbox in one transaction.
  await saveLocally(ctx, invoice, items, rows, { id: opId, deltas }, true);
  emit(ctx, 'sale', { invoice, offline: true });
  return { invoice, offline: true };
}

async function saveLocally(ctx: Ctx, invoice: Invoice, items: InvoiceItem[], rows: { tbl: string; row: unknown }[], queued: { id: string; deltas: Delta[] }, offline: boolean) {
  const db = ctx.db;
  await db.transaction('rw', [db.invoices, db.invoiceItems, db.batches, db.outbox, db.ledger, db.audit, db.meta], async () => {
    await db.invoices.put(invoice as never);
    await db.invoiceItems.bulkPut(items as never[]);
    for (const r of rows) if (r.tbl === 'ledger' || r.tbl === 'audit') await db.table(r.tbl).put(r.row);
    {
      for (const d of queued.deltas) {
        const b = await db.batches.get(d.batchId);
        if (b) await db.batches.update(d.batchId, { qty: Number(b.qty || 0) + d.delta });
        else await db.batches.put({ id: d.batchId, medicineId: d.medicineId, batchNo: 'PENDING-INTAKE', expiryDate: '9999-12-31', qty: d.delta, costPrice: 0, pending: true } as never);
      }
      // Online sales are already on the server; the next pull replaces these local numbers with the server's.
      if (offline) await enqueue(ctx, { id: queued.id, kind: 'sale', strict: false, rows: rows as never, deltas: queued.deltas });
    }
  });
}

/** Void (return) a whole invoice: stock goes back to the batches it came from. Needs invoices.void. */
export async function voidInvoice(ctx: Ctx, invoiceId: string, reason: string, supervisor?: User) {
  const approver = can(ctx.user, 'invoices.void') ? ctx.user! : supervisor;
  if (!approver || !can(approver, 'invoices.void')) throw new OverrideRequiredError('invoices.void', 'Voiding a bill needs a supervisor PIN');
  if (!reason.trim()) throw new AppError('REASON_REQUIRED', 'Please give a reason');
  const db = ctx.db;
  const inv = await db.invoices.get(invoiceId);
  if (!inv) throw new AppError('NOT_FOUND', 'Invoice not found');
  if (inv.status === 'void') throw new AppError('DUPLICATE', 'This bill is already void');
  const items = await db.invoiceItems.where('invoiceId').equals(invoiceId).toArray();
  const updated = { ...inv, status: 'void' as const, note: `VOID: ${reason} (by ${approver.name})`, hlc: stamp(ctx) };
  const deltas: Delta[] = items.map(i => ({ batchId: i.batchId, medicineId: i.medicineId, delta: i.qty }));
  const audit = { id: uuid(), at: new Date().toISOString(), userId: ctx.user!.id, userName: ctx.user!.name, deviceId: ctx.deviceId, action: 'invoice.void', entity: 'invoices', entityId: invoiceId, details: { number: inv.number, total: inv.total, reason, approvedBy: approver.name }, hlc: stamp(ctx) };
  await db.transaction('rw', [db.invoices, db.batches, db.outbox, db.audit], async () => {
    await db.invoices.put(updated);
    await db.audit.put(audit as never);
    for (const d of deltas) { const b = await db.batches.get(d.batchId); if (b) await db.batches.update(d.batchId, { qty: b.qty + d.delta }); }
    await enqueue(ctx, { kind: 'void', strict: false, rows: [{ tbl: 'invoices', row: updated }, { tbl: 'audit', row: audit as never }], deltas, userId: approver.id } as never); // checked on the server against the approver
  });
  emit(ctx, 'stock-changed');
  return updated;
}
