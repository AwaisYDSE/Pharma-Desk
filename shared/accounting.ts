// Accounts: money in, money out, profit and tax for any date range, grouped by day, month or year.
// Pure functions — the same numbers on the server (API) and on every device (offline).
// Money is integer paisa. A "day" is the local calendar day of the record (YYYY-MM-DD).
// © Awais Amin
import type { Invoice, InvoiceItem, Refund, Purchase, Expense, LedgerEntry, Medicine } from './types.ts';

export type Group = 'day' | 'month' | 'year';

export interface Period {
  key: string;            // 2026-11-01 · 2026-11 · 2026
  bills: number;
  sales: number;          // bill totals (incl. tax), after discounts, before returns
  salesRx: number;        // bills with at least one prescription medicine
  salesOtc: number;       // over-the-counter bills
  refunds: number;        // money given back for returned items
  netSales: number;       // sales − refunds
  tax: number;            // GST collected (output tax) after returns
  cogs: number;           // cost of what was sold (after returns)
  grossProfit: number;    // (netSales − tax) − cogs
  expenses: number;       // rent, salaries, bills…
  netProfit: number;      // grossProfit − expenses
  cashIn: number;         // money actually received: paid bills + udhaar collected
  creditSales: number;    // sold on udhaar (not yet paid)
  creditCollected: number;
  purchases: number;      // supplier bills for stock received (restocked)
  supplierPaid: number;   // payments made to suppliers
  cashOut: number;        // supplierPaid + expenses + cash refunds
}

export interface TaxRow { rateBp: number; taxable: number; tax: number }
export interface Summary {
  from: string; to: string; group: Group;
  periods: Period[]; totals: Period;
  taxByRate: TaxRow[];
  byPayMethod: Record<string, number>;
  expensesByCategory: Record<string, number>;
  invoiceStatus: Record<string, { count: number; total: number }>;
}

export interface AccountsData {
  invoices: Invoice[]; invoiceItems: InvoiceItem[]; refunds: Refund[]; purchases: Purchase[];
  expenses: Expense[]; ledger: LedgerEntry[]; medicines?: Medicine[];
}

/** Local calendar day of an ISO timestamp (or a plain date). */
export function dayOf(iso: string | undefined | null): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const keyOf = (day: string, g: Group) => g === 'year' ? day.slice(0, 4) : g === 'month' ? day.slice(0, 7) : day;

const empty = (key: string): Period => ({
  key, bills: 0, sales: 0, salesRx: 0, salesOtc: 0, refunds: 0, netSales: 0, tax: 0, cogs: 0, grossProfit: 0, expenses: 0, netProfit: 0,
  cashIn: 0, creditSales: 0, creditCollected: 0, purchases: 0, supplierPaid: 0, cashOut: 0,
});

/** Every period key between from and to (inclusive), so empty days/months still show. */
export function periodKeys(from: string, to: string, g: Group): string[] {
  const out: string[] = [];
  const d = new Date(from + 'T12:00:00'), end = new Date(to + 'T12:00:00');
  let guard = 0;
  while (d <= end && guard++ < 4000) {
    const k = keyOf(dayOf(d.toISOString().slice(0, 10)), g);
    if (out[out.length - 1] !== k) out.push(k);
    if (g === 'day') d.setDate(d.getDate() + 1);
    else if (g === 'month') { d.setDate(1); d.setMonth(d.getMonth() + 1); }
    else { d.setMonth(0, 1); d.setFullYear(d.getFullYear() + 1); }
  }
  return out;
}

export function summarize(data: AccountsData, from: string, to: string, group: Group = 'day'): Summary {
  const inRange = (day: string) => day >= from && day <= to;
  const periods = new Map(periodKeys(from, to, group).map(k => [k, empty(k)]));
  const P = (day: string) => { const k = keyOf(day, group); let p = periods.get(k); if (!p) { p = empty(k); periods.set(k, p); } return p; };
  const rx = new Set((data.medicines || []).filter(m => m.rxRequired).map(m => m.id));
  const itemsBy = new Map<string, InvoiceItem[]>();
  for (const it of data.invoiceItems) if (!it.deleted) { const a = itemsBy.get(it.invoiceId) || []; a.push(it); itemsBy.set(it.invoiceId, a); }
  const itemById = new Map(data.invoiceItems.map(i => [i.id, i]));
  const taxBy = new Map<number, TaxRow>();
  const byPay: Record<string, number> = {};
  const status: Record<string, { count: number; total: number }> = {};

  for (const inv of data.invoices) {
    if (inv.deleted) continue;
    const day = dayOf(inv.createdAt);
    if (!inRange(day)) continue;
    const st = inv.status === 'void' ? 'void' : inv.status;
    const s = status[st] || (status[st] = { count: 0, total: 0 }); s.count++; s.total += inv.total;
    if (inv.status === 'void') continue;
    const p = P(day);
    const items = itemsBy.get(inv.id) || [];
    p.bills++; p.sales += inv.total; p.tax += inv.tax;
    if (items.some(i => rx.has(i.medicineId))) p.salesRx += inv.total; else p.salesOtc += inv.total;
    p.cogs += items.reduce((s, i) => s + (i.costPrice || 0) * i.qty, 0);
    const credit = inv.payMethod === 'credit' || inv.baseStatus === 'credit' || inv.status === 'credit';
    if (credit) p.creditSales += inv.total; else p.cashIn += inv.total;
    byPay[inv.payMethod] = (byPay[inv.payMethod] || 0) + inv.total;
    for (const i of items) {
      const r = taxBy.get(i.taxBp || 0) || { rateBp: i.taxBp || 0, taxable: 0, tax: 0 };
      r.taxable += i.total - i.tax; r.tax += i.tax; taxBy.set(r.rateBp, r);
    }
  }

  for (const rf of data.refunds) {
    if (rf.deleted) continue;
    const day = dayOf(rf.date || rf.createdAt);
    if (!inRange(day)) continue;
    const p = P(day);
    p.refunds += rf.total; p.tax -= rf.tax;
    p.cogs -= rf.items.reduce((s, i) => s + (i.cost || 0) * i.qty, 0);
    if (rf.method !== 'credit') p.cashOut += rf.total;
    for (const i of rf.items) {
      const inv = itemById.get(i.itemId);
      const r = taxBy.get(inv?.taxBp || 0) || { rateBp: inv?.taxBp || 0, taxable: 0, tax: 0 };
      r.taxable -= i.amount - i.tax; r.tax -= i.tax; taxBy.set(r.rateBp, r);
    }
  }

  const expByCat: Record<string, number> = {};
  for (const e of data.expenses) {
    if (e.deleted || !inRange(e.date)) continue;
    const p = P(e.date);
    p.expenses += e.amount; p.cashOut += e.amount;
    expByCat[e.category || 'Other'] = (expByCat[e.category || 'Other'] || 0) + e.amount;
  }

  for (const po of data.purchases) {
    if (po.deleted || po.status !== 'received') continue;
    const day = dayOf(po.receivedAt || po.date);
    if (inRange(day)) P(day).purchases += po.total;
  }

  for (const l of data.ledger) {
    if (l.deleted || !inRange(l.date) || l.ref !== 'PAYMENT') continue;
    const p = P(l.date);
    if (l.partyType === 'patient') { p.creditCollected += l.credit; p.cashIn += l.credit; }
    else { p.supplierPaid += l.debit; p.cashOut += l.debit; }
  }

  const list = [...periods.values()].sort((a, b) => a.key.localeCompare(b.key));
  const totals = empty('total');
  for (const p of list) {
    p.netSales = p.sales - p.refunds;
    p.grossProfit = (p.netSales - p.tax) - p.cogs;
    p.netProfit = p.grossProfit - p.expenses;
    for (const k of Object.keys(totals) as (keyof Period)[]) if (k !== 'key') (totals[k] as number) += p[k] as number;
  }
  return {
    from, to, group, periods: list, totals,
    taxByRate: [...taxBy.values()].filter(r => r.taxable || r.tax).sort((a, b) => a.rateBp - b.rateBp),
    byPayMethod: byPay, expensesByCategory: expByCat, invoiceStatus: status,
  };
}

/** Simple date-range presets. */
export function presetRange(preset: 'today' | 'week' | 'month' | 'year' | 'lastMonth', today: string): { from: string; to: string; group: Group } {
  const d = new Date(today + 'T12:00:00');
  const iso = (x: Date) => dayOf(x.toISOString().slice(0, 10) === today ? today : `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`);
  if (preset === 'today') return { from: today, to: today, group: 'day' };
  if (preset === 'week') { const s = new Date(d); s.setDate(d.getDate() - 6); return { from: iso(s), to: today, group: 'day' }; }
  if (preset === 'month') return { from: today.slice(0, 8) + '01', to: today, group: 'day' };
  if (preset === 'lastMonth') { const s = new Date(d.getFullYear(), d.getMonth() - 1, 1, 12), e = new Date(d.getFullYear(), d.getMonth(), 0, 12); return { from: iso(s), to: iso(e), group: 'day' }; }
  return { from: today.slice(0, 4) + '-01-01', to: today, group: 'month' };
}

export const EXPENSE_CATEGORIES = ['Rent', 'Salaries', 'Electricity & utilities', 'Internet & phone', 'Transport & delivery', 'Repairs & maintenance', 'Marketing', 'Bank charges', 'Taxes & fees', 'Other'];
