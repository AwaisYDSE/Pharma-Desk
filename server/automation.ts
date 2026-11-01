// Server background jobs: the low-stock watchdog (draft purchase orders + owner alert) and the
// message triggers (supplier orders, customer receipts). All optional, switched in Settings.
// © Awais Amin
import crypto from 'node:crypto';
import { allRows, getRow, putRow, getSetting, setSetting, tx, type DB } from './db.ts';
import { getIdentity } from './identity.ts';
import { serverClock } from './ops.ts';
import { logEvent } from './supervision.ts';
import { planReorders } from '../shared/purchase-flow.ts';
import { getConfig, enqueueMessage } from './notify.ts';
import { invoiceMessage, lowStockMessage, poMessage, type ShopInfo } from './message-templates.ts';
import type { Medicine, Batch, Purchase, PurchaseItem, Supplier, Invoice, InvoiceItem, Patient, Shop, Op } from '../shared/types.ts';
import { isoDate } from '../shared/util.ts';

export const autoPoOn = (db: DB) => getSetting(db, 'auto_po') !== '0';

export function shopInfo(db: DB): ShopInfo {
  const s = getRow<Shop>(db, 'shop', 'shop');
  return { name: s?.name || getIdentity(db)?.name || 'Pharmacy', phone: s?.phone, address: s?.address, ntn: s?.ntn };
}

function nextAutoNumber(db: DB) {
  const n = Number(getSetting(db, 'auto_po_seq') || 0) + 1;
  setSetting(db, 'auto_po_seq', String(n));
  return `PO-AUTO-${String(n).padStart(5, '0')}`;
}

/**
 * Low-stock watchdog. Writes one draft purchase order per supplier for items at or below their
 * reorder point (if "automatic purchase orders" is on) and tells the owner by email/SMS
 * (at most once a day per item). Items with no known supplier are only reported.
 */
export function runReorder(db: DB, now = new Date()): { drafts: Purchase[]; low: number } {
  const meds = allRows<Medicine>(db, 'medicines', 'WHERE deleted = 0');
  const plans = planReorders({
    medicines: meds, batches: allRows<Batch>(db, 'batches', 'WHERE deleted = 0'),
    purchases: allRows<Purchase>(db, 'purchases'), purchaseItems: allRows<PurchaseItem>(db, 'purchaseItems', 'WHERE deleted = 0'),
    suppliers: allRows<Supplier>(db, 'suppliers', 'WHERE deleted = 0'),
  });
  const drafts: Purchase[] = [];
  const sups = new Map(allRows<Supplier>(db, 'suppliers').map(s => [s.id, s]));
  if (autoPoOn(db)) {
    tx(db, () => {
      for (const plan of plans) {
        if (!plan.supplierId || !plan.lines.length) continue;
        const id = crypto.randomUUID();
        const po: Purchase = {
          id, number: nextAutoNumber(db), supplierId: plan.supplierId, date: isoDate(now), status: 'draft', total: plan.total, paid: 0,
          auto: true, notes: 'Made automatically: these items reached their reorder point.',
        };
        putRow(db, 'purchases', po, serverClock.tick());
        for (const l of plan.lines) {
          const it: PurchaseItem = { id: crypto.randomUUID(), purchaseId: id, medicineId: l.medicineId, qty: l.qty, freeQty: 0, costPrice: l.costPrice, salePrice: l.salePrice, batchNo: '', mfgDate: null, expiryDate: '' };
          putRow(db, 'purchaseItems', it, serverClock.tick());
        }
        drafts.push(po);
      }
    });
    for (const d of drafts) logEvent(db, 'purchase.auto_draft', { number: d.number, supplier: sups.get(d.supplierId)?.name, total: d.total });
  }
  // Tell the owner (once a day per item).
  const low = plans.flatMap(p => p.lines);
  const c = getConfig(db);
  if (low.length && c.auto.lowStock && (c.ownerEmail || c.ownerPhone)) {
    let seen: Record<string, string> = {};
    try { seen = JSON.parse(getSetting(db, 'lowstock_told') || '{}'); } catch { /* reset */ }
    const today = isoDate(now);
    const fresh = low.filter(l => seen[l.medicineId] !== today);
    if (fresh.length) {
      const msg = lowStockMessage(shopInfo(db), fresh.map(l => ({ name: l.name, qty: l.stock, reorderLevel: l.reorderLevel })),
        drafts.map(d => ({ number: d.number, supplier: sups.get(d.supplierId)?.name || '', total: d.total })));
      const ref = `${today}:${crypto.createHash('sha1').update(fresh.map(f => f.medicineId).sort().join()).digest('hex').slice(0, 12)}`;
      if (c.ownerEmail) enqueueMessage(db, { channel: 'email', kind: 'low_stock', ref, to: c.ownerEmail, subject: msg.subject, html: msg.html, text: msg.text });
      if (c.ownerPhone) enqueueMessage(db, { channel: 'sms', kind: 'low_stock', ref, to: c.ownerPhone, text: msg.sms });
      for (const f of fresh) seen[f.medicineId] = today;
      for (const k of Object.keys(seen)) if (seen[k] < today) delete seen[k];
      setSetting(db, 'lowstock_told', JSON.stringify(seen));
    }
  }
  return { drafts, low: low.length };
}

/** Queue the purchase order to its supplier (email and/or SMS). Returns how many messages were queued. */
export function queuePurchaseOrder(db: DB, purchaseId: string): number {
  const po = getRow<Purchase>(db, 'purchases', purchaseId);
  if (!po) return 0;
  const sup = getRow<Supplier>(db, 'suppliers', po.supplierId);
  if (!sup) return 0;
  const items = allRows<PurchaseItem>(db, 'purchaseItems', 'WHERE purchase_id = ? AND deleted = 0', po.id);
  const meds = new Map(allRows<Medicine>(db, 'medicines').map(m => [m.id, m]));
  const msg = poMessage(shopInfo(db), { number: po.number, date: po.date, supplier: sup.name, notes: po.notes, total: po.total,
    items: items.map(i => ({ name: [meds.get(i.medicineId)?.name, meds.get(i.medicineId)?.strength].filter(Boolean).join(' ') || 'Item', qty: i.qty, cost: i.costPrice })) });
  let n = 0;
  if (sup.email && enqueueMessage(db, { channel: 'email', kind: 'po', ref: po.id, to: sup.email, subject: msg.subject, html: msg.html, text: msg.text })) n++;
  if (sup.phone && enqueueMessage(db, { channel: 'sms', kind: 'po', ref: po.id, to: sup.phone, text: msg.sms })) n++;
  return n;
}

/** Queue a bill to a customer. Pass email/phone to send somewhere else than the saved customer. */
export function queueReceipt(db: DB, invoiceId: string, to: { email?: string; phone?: string } = {}): number {
  const inv = getRow<Invoice>(db, 'invoices', invoiceId);
  if (!inv) return 0;
  const p = inv.patientId ? getRow<Patient>(db, 'patients', inv.patientId) : null;
  const email = to.email ?? p?.email ?? '';
  const phone = to.phone ?? p?.phone ?? '';
  const items = allRows<InvoiceItem>(db, 'invoiceItems', 'WHERE invoice_id = ?', inv.id);
  const msg = invoiceMessage(shopInfo(db), {
    number: inv.number, date: new Date(inv.createdAt).toLocaleString('en-PK'), customer: p?.name, status: inv.status, refunded: inv.refunded,
    gross: inv.gross, discount: inv.discount, tax: inv.tax, total: inv.total, paid: inv.paid,
    items: items.map(i => ({ name: i.name || 'Item', qty: i.qty, price: i.unitPrice, total: i.total })),
  });
  // A manual "send again" gets its own reference so it is not blocked as a duplicate.
  const ref = to.email || to.phone ? `${inv.id}:${Date.now()}` : inv.id;
  let n = 0;
  if (email && enqueueMessage(db, { channel: 'email', kind: 'receipt', ref, to: email, subject: msg.subject, html: msg.html, text: msg.text })) n++;
  if (phone && enqueueMessage(db, { channel: 'sms', kind: 'receipt', ref, to: phone, text: msg.sms })) n++;
  return n;
}

/** Runs after operations from devices were applied: event-driven triggers. Never throws. */
export function afterOps(db: DB, ops: Op[], okIds: Set<string>, schedule: () => void) {
  try {
    const c = getConfig(db);
    let sold = false;
    for (const op of ops) {
      if (!okIds.has(op.id)) continue;
      if (op.kind === 'sale') sold = true;
      for (const r of op.rows) {
        if (r.tbl === 'purchases' && c.auto.poToSupplier && ['sent', 'ordered'].includes((r.row as Purchase).status) && (r.row as Purchase).sentAt) queuePurchaseOrder(db, r.row.id);
        if (r.tbl === 'invoices' && op.kind === 'sale' && c.auto.receiptToCustomer && (r.row as Invoice).patientId) queueReceipt(db, r.row.id);
      }
    }
    if (sold) schedule();
  } catch { /* messages must never break syncing */ }
}
