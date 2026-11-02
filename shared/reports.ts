// Stock and profit reports. Pure functions, same numbers on every device. Money is integer paisa.
// © Awais Amin
import type { Batch, Invoice, InvoiceItem, Medicine, Refund } from './types.ts';
import { dayOf } from './accounting.ts';
import { addDays } from './util.ts';

const live = (b: Batch) => !b.deleted && !b.pending && b.qty > 0;
const nameOf = (meds: Medicine[]) => { const m = new Map(meds.map(x => [x.id, x.name])); return (id: string) => m.get(id) || '?'; };

/** Stock already past its expiry date: what is sitting on the shelf and what it cost. */
export function expiryLoss(batches: Batch[], meds: Medicine[], today: string) {
  const name = nameOf(meds);
  const rows = batches.filter(b => live(b) && b.expiryDate && b.expiryDate <= today)
    .map(b => ({ id: b.id, name: name(b.medicineId), batchNo: b.batchNo, expiryDate: b.expiryDate, qty: b.qty, loss: b.qty * (b.costPrice || 0) }))
    .sort((a, b) => b.loss - a.loss);
  return { rows, total: rows.reduce((s, r) => s + r.loss, 0) };
}

/** In stock, but nothing sold in the last `days` days. Stock locked up, at cost. */
export function deadStock(batches: Batch[], meds: Medicine[], invoices: Invoice[], items: InvoiceItem[], today: string, days = 90) {
  const since = addDays(today, -days);
  const recent = new Set(invoices.filter(i => !i.deleted && i.status !== 'void' && dayOf(i.createdAt) >= since).map(i => i.id));
  const sold = new Set(items.filter(i => !i.deleted && recent.has(i.invoiceId)).map(i => i.medicineId));
  const name = nameOf(meds);
  const by = new Map<string, { id: string; name: string; qty: number; value: number }>();
  for (const b of batches) {
    if (!live(b) || sold.has(b.medicineId) || (b.expiryDate && b.expiryDate <= today)) continue;
    const r = by.get(b.medicineId) || { id: b.medicineId, name: name(b.medicineId), qty: 0, value: 0 };
    r.qty += b.qty; r.value += b.qty * (b.costPrice || 0); by.set(b.medicineId, r);
  }
  const rows = [...by.values()].sort((a, b) => b.value - a.value);
  return { rows, total: rows.reduce((s, r) => s + r.value, 0) };
}

/** Sales (without tax), cost and profit for each medicine, after returns. Voided bills do not count. */
export function profitByMedicine(invoices: Invoice[], items: InvoiceItem[], refunds: Refund[], meds: Medicine[], from: string, to: string) {
  const inRange = (d: string) => d >= from && d <= to;
  const ok = new Set(invoices.filter(i => !i.deleted && i.status !== 'void' && inRange(dayOf(i.createdAt))).map(i => i.id));
  const voided = new Set(invoices.filter(i => i.status === 'void').map(i => i.id));
  const name = nameOf(meds);
  const by = new Map<string, { id: string; name: string; qty: number; sales: number; cost: number; profit: number }>();
  const row = (id: string) => { const r = by.get(id) || { id, name: name(id), qty: 0, sales: 0, cost: 0, profit: 0 }; by.set(id, r); return r; };
  for (const i of items) {
    if (i.deleted || !ok.has(i.invoiceId)) continue;
    const r = row(i.medicineId);
    r.qty += i.qty; r.sales += i.total - i.tax; r.cost += (i.costPrice || 0) * i.qty;
  }
  for (const f of refunds) {
    if (f.deleted || voided.has(f.invoiceId) || !inRange(dayOf(f.date || f.createdAt))) continue;
    for (const i of f.items) { const r = row(i.medicineId); r.qty -= i.qty; r.sales -= i.amount - i.tax; r.cost -= (i.cost || 0) * i.qty; }
  }
  const rows = [...by.values()].map(r => ({ ...r, profit: r.sales - r.cost })).sort((a, b) => b.profit - a.profit);
  return { rows, total: rows.reduce((s, r) => s + r.profit, 0) };
}

const CODES: Record<string, string> = { pk: '92', ae: '971', sa: '966', in: '91', bd: '880', af: '93' };
/** A free WhatsApp link with the bill typed in. The person presses Send in WhatsApp themselves. */
export function whatsappLink(phone: string | undefined | null, text: string, region = 'pk'): string {
  let d = String(phone || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0') && CODES[region]) d = CODES[region] + d.slice(1);
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}
