// The books: statements for any customer or supplier, cash and credit, sales and purchases together,
// the cash book, who owes what, and the business position. Pure functions over the synced data,
// so the same numbers appear on every device and offline. Money is integer paisa.
// © Awais Amin
import type { Invoice, Refund, Purchase, Expense, LedgerEntry, Batch, Patient, Supplier } from './types.ts';
import { dayOf } from './accounting.ts';
import { daysBetween } from './util.ts';

export interface BooksData {
  invoices: Invoice[]; refunds: Refund[]; purchases: Purchase[]; expenses: Expense[]; ledger: LedgerEntry[];
  batches?: Batch[]; patients?: Patient[]; suppliers?: Supplier[];
}

export type EntryKind = 'sale' | 'sale_return' | 'purchase' | 'purchase_return' | 'receipt' | 'payment' | 'expense';
export type Method = 'cash' | 'bank' | 'credit';

/** One line in a statement. Amount is the document's value; moneyIn and moneyOut are what actually moved. */
export interface Entry {
  id: string; date: string; kind: EntryKind; doc: string; method: Method;
  partyType: 'patient' | 'supplier' | null; partyId: string | null; partyName: string; note: string;
  amount: number; moneyIn: number; moneyOut: number;
}

export interface StatementFilter {
  from: string; to: string;
  side?: 'all' | 'sales' | 'purchases';
  method?: 'all' | Method;
  partyType?: 'patient' | 'supplier' | null;
  partyId?: string | null;
}

const methodOf = (m: string | undefined): Method => m === 'credit' ? 'credit' : m === 'cash' ? 'cash' : 'bank';
const isSalesSide = (k: EntryKind, partyType: Entry['partyType']) => k === 'sale' || k === 'sale_return' || (k === 'receipt' && partyType === 'patient');
const isPurchaseSide = (k: EntryKind) => k === 'purchase' || k === 'purchase_return' || k === 'payment';

/** Every money document of the shop, oldest first. */
export function allEntries(data: BooksData): Entry[] {
  const pName = new Map((data.patients || []).map(p => [p.id, p.name]));
  const sName = new Map((data.suppliers || []).map(s => [s.id, s.name]));
  const out: Entry[] = [];
  for (const inv of data.invoices) {
    if (inv.deleted || inv.status === 'void') continue;
    const method = methodOf(inv.payMethod);
    out.push({
      id: inv.id, date: dayOf(inv.createdAt), kind: 'sale', doc: inv.number, method, partyType: inv.patientId ? 'patient' : null, partyId: inv.patientId || null,
      partyName: inv.patientId ? pName.get(inv.patientId) || '' : '', note: '', amount: inv.total, moneyIn: method === 'credit' ? 0 : inv.total, moneyOut: 0,
    });
  }
  const invById = new Map(data.invoices.map(i => [i.id, i]));
  for (const r of data.refunds) {
    if (r.deleted) continue;
    const inv = invById.get(r.invoiceId);
    if (inv?.status === 'void') continue;
    const method: Method = r.method === 'credit' ? 'credit' : r.method === 'cash' ? 'cash' : 'bank';
    out.push({
      id: r.id, date: dayOf(r.date || r.createdAt), kind: 'sale_return', doc: r.number, method, partyType: inv?.patientId ? 'patient' : null, partyId: inv?.patientId || null,
      partyName: inv?.patientId ? pName.get(inv.patientId) || '' : '', note: r.reason || '', amount: r.total, moneyIn: 0, moneyOut: method === 'credit' ? 0 : r.total,
    });
  }
  for (const p of data.purchases) {
    if (p.deleted || p.status !== 'received') continue;
    out.push({
      id: p.id, date: dayOf(p.receivedAt || p.date), kind: 'purchase', doc: p.number, method: 'credit', partyType: 'supplier', partyId: p.supplierId,
      partyName: sName.get(p.supplierId) || '', note: '', amount: p.total, moneyIn: 0, moneyOut: 0,
    });
  }
  for (const l of data.ledger) {
    if (!l.deleted && l.partyType === 'supplier' && l.ref.startsWith('PRET-')) {
      out.push({ id: l.id, date: l.date, kind: 'purchase_return', doc: l.ref, method: 'credit', partyType: 'supplier', partyId: l.partyId, partyName: sName.get(l.partyId) || '', note: l.note || '', amount: l.debit, moneyIn: 0, moneyOut: 0 });
      continue;
    }
    if (l.deleted || l.ref !== 'PAYMENT' || (l as { foreign?: boolean }).foreign) continue; // money taken at another branch is that branch's cash
    const sup = l.partyType === 'supplier';
    const amount = sup ? l.debit : l.credit;
    out.push({
      id: l.id, date: l.date, kind: sup ? 'payment' : 'receipt', doc: 'PAYMENT', method: l.method === 'bank' ? 'bank' : 'cash', partyType: l.partyType, partyId: l.partyId,
      partyName: (sup ? sName : pName).get(l.partyId) || '', note: l.note || '', amount, moneyIn: sup ? 0 : amount, moneyOut: sup ? amount : 0,
    });
  }
  for (const e of data.expenses) {
    if (e.deleted) continue;
    out.push({
      id: e.id, date: e.date, kind: 'expense', doc: e.category || 'Other', method: e.payMethod === 'cash' ? 'cash' : 'bank', partyType: null, partyId: null,
      partyName: e.paidTo || '', note: e.note || '', amount: e.amount, moneyIn: 0, moneyOut: e.amount,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.doc.localeCompare(b.doc));
}

export interface StatementTotals { sales: number; returns: number; purchases: number; purchaseReturns: number; received: number; paid: number; moneyIn: number; moneyOut: number; count: number }

/** A statement: filter by dates, customer or supplier, cash or credit, sales or purchases or both. */
export function statement(data: BooksData, f: StatementFilter): { rows: Entry[]; totals: StatementTotals } {
  const side = f.side || 'all', method = f.method || 'all';
  const rows = allEntries(data).filter(e => {
    if (e.date < f.from || e.date > f.to) return false;
    if (e.kind === 'expense' && (side !== 'all' || f.partyId)) return false;
    if (side === 'sales' && !isSalesSide(e.kind, e.partyType)) return false;
    if (side === 'purchases' && !isPurchaseSide(e.kind)) return false;
    if (method !== 'all' && e.method !== method) return false;
    if (f.partyId && (e.partyId !== f.partyId || (f.partyType && e.partyType !== f.partyType))) return false;
    return true;
  });
  const totals: StatementTotals = { sales: 0, returns: 0, purchases: 0, purchaseReturns: 0, received: 0, paid: 0, moneyIn: 0, moneyOut: 0, count: rows.length };
  for (const e of rows) {
    if (e.kind === 'sale') totals.sales += e.amount;
    if (e.kind === 'sale_return') totals.returns += e.amount;
    if (e.kind === 'purchase') totals.purchases += e.amount;
    if (e.kind === 'purchase_return') totals.purchaseReturns += e.amount;
    if (e.kind === 'receipt') totals.received += e.amount;
    if (e.kind === 'payment') totals.paid += e.amount;
    totals.moneyIn += e.moneyIn; totals.moneyOut += e.moneyOut;
  }
  return { rows, totals };
}

export interface BookLine extends Entry { balance: number }

/** Cash book or bank book: opening balance, every movement with a running balance, closing balance. */
export function moneyBook(data: BooksData, book: 'cash' | 'bank', from: string, to: string, startingBalance = 0): { opening: number; rows: BookLine[]; closing: number; moneyIn: number; moneyOut: number } {
  const moves = allEntries(data).filter(e => e.method === book && (e.moneyIn || e.moneyOut));
  let bal = startingBalance;
  for (const e of moves) if (e.date < from) bal += e.moneyIn - e.moneyOut;
  const opening = bal;
  let moneyIn = 0, moneyOut = 0;
  const rows: BookLine[] = [];
  for (const e of moves) {
    if (e.date < from || e.date > to) continue;
    bal += e.moneyIn - e.moneyOut; moneyIn += e.moneyIn; moneyOut += e.moneyOut;
    rows.push({ ...e, balance: bal });
  }
  return { opening, rows, closing: bal, moneyIn, moneyOut };
}

export interface PartyBalance { partyId: string; name: string; balance: number; current: number; d31: number; d61: number; d90: number }

/**
 * What customers owe us or what we owe suppliers, split by how old it is.
 * Money received pays off the oldest amounts first.
 */
export function agedBalances(data: BooksData, partyType: 'patient' | 'supplier', today: string): { rows: PartyBalance[]; total: number } {
  const names = new Map(((partyType === 'patient' ? data.patients : data.suppliers) || []).map(p => [p.id, p.name]));
  const by = new Map<string, LedgerEntry[]>();
  for (const l of data.ledger) {
    if (l.deleted || l.partyType !== partyType) continue;
    const a = by.get(l.partyId) || []; a.push(l); by.set(l.partyId, a);
  }
  const rows: PartyBalance[] = [];
  for (const [partyId, list] of by) {
    const owed = (l: LedgerEntry) => partyType === 'patient' ? l.debit : l.credit;
    const settled = (l: LedgerEntry) => partyType === 'patient' ? l.credit : l.debit;
    let paid = list.reduce((s, l) => s + settled(l), 0);
    const r: PartyBalance = { partyId, name: names.get(partyId) || '', balance: 0, current: 0, d31: 0, d61: 0, d90: 0 };
    for (const l of [...list].sort((a, b) => a.date.localeCompare(b.date))) {
      const use = Math.min(paid, owed(l)); paid -= use;
      const left = owed(l) - use;
      if (!left) continue;
      const age = daysBetween(l.date, today);
      if (age <= 30) r.current += left; else if (age <= 60) r.d31 += left; else if (age <= 90) r.d61 += left; else r.d90 += left;
    }
    r.balance = r.current + r.d31 + r.d61 + r.d90 - paid; // anything left over is an advance
    if (paid > 0) r.current -= paid;
    if (r.balance !== 0) rows.push(r);
  }
  rows.sort((a, b) => b.balance - a.balance);
  return { rows, total: rows.reduce((s, r) => s + r.balance, 0) };
}

/** What the business has and owes right now. Equity is the difference, not a typed figure. */
export function businessPosition(data: BooksData, today: string, startingCash = 0, startingBank = 0) {
  const cash = moneyBook(data, 'cash', today, today, startingCash).closing;
  const bank = moneyBook(data, 'bank', today, today, startingBank).closing;
  const receivable = agedBalances(data, 'patient', today).total;
  const payable = agedBalances(data, 'supplier', today).total;
  const stock = (data.batches || []).filter(b => !b.deleted && !b.pending && b.qty > 0).reduce((s, b) => s + b.qty * (b.costPrice || 0), 0);
  const assets = cash + bank + receivable + stock;
  return { cash, bank, receivable, stock, assets, payable, worth: assets - payable };
}
