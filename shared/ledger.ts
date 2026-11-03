// Double-entry books in the wording of Odoo Accounting: Partner Ledger, General Ledger, Trial Balance,
// payment status of every invoice and bill, and matching of payments and credit notes against them.
// Pure functions over the synced data, so every device gets the same figures. Money is integer paisa.
// Balance is always Debit minus Credit, as in Odoo, so what we owe a vendor shows as a negative balance.
// © Awais Amin
import type { Invoice, InvoiceItem, Refund, Purchase, Expense, LedgerEntry, Patient, Supplier, MoneyMove, PayAccount, Shop } from './types.ts';
import { dayOf } from './accounting.ts';

export type PayState = 'not_paid' | 'partial' | 'paid' | 'reversed';
export const PAY_STATE_LABEL: Record<PayState, string> = { not_paid: 'Not Paid', partial: 'Partial', paid: 'Paid', reversed: 'Reversed' };

export const ACC = {
  bank: { code: '101401', name: 'Bank' }, wallet: { code: '101405', name: 'Mobile Wallet' }, cash: { code: '101501', name: 'Cash' },
  stock: { code: '110100', name: 'Stock Valuation' }, ar: { code: '121000', name: 'Account Receivable' }, clearing: { code: '129000', name: 'Inter-Branch Clearing' },
  ap: { code: '211000', name: 'Account Payable' }, tax: { code: '251000', name: 'Tax Received' }, sales: { code: '400000', name: 'Product Sales' },
  cogs: { code: '500000', name: 'Cost of Goods Sold' }, expense: { code: '600000', name: 'Expenses' }, equity: { code: '999999', name: 'Undistributed Profits/Losses' },
};
export type Acc = { code: string; name: string };

/* ---------------- matching: which payment and credit note settles which document ---------------- */

export interface Settlement { rowId: string; date: string; ref: string; amount: number; kind: 'payment' | 'credit_note'; method?: string; accountName?: string | null; note?: string }
export interface DocMatch { rowId: string; number: string; date: string; amount: number; paid: number; reversed: number; residual: number; state: PayState; lines: Settlement[]; matching: string }
export interface PartyMatch { docs: DocMatch[]; byNumber: Map<string, DocMatch>; matching: Map<string, string>; outstanding: number; nextSeq: number }

const chargeOf = (t: 'patient' | 'supplier', l: LedgerEntry) => t === 'patient' ? l.debit : l.credit;
const settleOf = (t: 'patient' | 'supplier', l: LedgerEntry) => t === 'patient' ? l.credit : l.debit;
const byDate = (a: LedgerEntry, b: LedgerEntry) => a.date.localeCompare(b.date);

export const stateOf = (amount: number, paid: number, reversed: number): PayState => {
  if (amount - paid - reversed <= 0) return reversed >= amount && amount > 0 ? 'reversed' : 'paid';
  return paid + reversed > 0 ? 'partial' : 'not_paid';
};

/**
 * Matches one customer's or vendor's lines. A payment or credit note made against a document settles that
 * document first. Anything else, or anything left over, settles the oldest open documents. What is still
 * left after that stays on the account as an outstanding credit.
 */
export function matchParty(partyType: 'patient' | 'supplier', rows: LedgerEntry[], refundToInvoice: Map<string, string> = new Map(), startSeq = 1): PartyMatch {
  const live = rows.filter(l => !l.deleted);
  const docs: DocMatch[] = live.filter(l => chargeOf(partyType, l) > 0).sort(byDate).map(l => ({ rowId: l.id, number: l.ref, date: l.date, amount: chargeOf(partyType, l), paid: 0, reversed: 0, residual: chargeOf(partyType, l), state: 'not_paid', lines: [], matching: '' }));
  const byNumber = new Map(docs.map(d => [d.number, d]));
  const parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!; if (r !== x) parent.set(x, r); return r; };
  const join = (a: string, b: string) => { const x = find(a), y = find(b); if (x !== y) parent.set(y, x); parent.has(x) || parent.set(x, x); };
  const apply = (d: DocMatch, l: LedgerEntry, amt: number, kind: Settlement['kind']) => {
    if (kind === 'payment') d.paid += amt; else d.reversed += amt;
    d.residual -= amt;
    d.lines.push({ rowId: l.id, date: l.date, ref: l.ref, amount: amt, kind, method: l.method, accountName: l.accountName, note: l.note });
    join(d.rowId, l.id);
  };
  const pool: { l: LedgerEntry; left: number; kind: Settlement['kind'] }[] = [];
  for (const l of live.filter(x => settleOf(partyType, x) > 0).sort(byDate)) {
    const target = l.matchDoc || refundToInvoice.get(l.ref) || (byNumber.has(l.ref) ? l.ref : '');
    const kind: Settlement['kind'] = l.ref === 'PAYMENT' ? 'payment' : 'credit_note';
    let left = settleOf(partyType, l);
    const d = target ? byNumber.get(target) : undefined;
    if (d && d.residual > 0) { const use = Math.min(left, d.residual); apply(d, l, use, kind); left -= use; }
    if (left > 0) pool.push({ l, left, kind });
  }
  let outstanding = 0;
  for (const p of pool) {
    for (const d of docs) {
      if (!p.left) break;
      if (d.residual <= 0) continue;
      const use = Math.min(p.left, d.residual);
      apply(d, p.l, use, p.kind); p.left -= use;
    }
    outstanding += p.left;
  }
  const leftover = new Set(pool.filter(p => p.left > 0).map(p => p.l.id));
  const clusters = new Map<string, { docs: DocMatch[]; open: boolean }>();
  for (const d of docs) {
    d.state = stateOf(d.amount, d.paid, d.reversed);
    if (!d.lines.length) continue;
    const key = find(d.rowId), c = clusters.get(key) || { docs: [], open: false };
    c.docs.push(d); if (d.residual > 0) c.open = true;
    clusters.set(key, c);
  }
  for (const id of leftover) if (parent.has(id)) { const c = clusters.get(find(id)); if (c) c.open = true; }
  const matching = new Map<string, string>();
  let seq = startSeq;
  for (const c of clusters.values()) {
    const label = `${c.open ? 'P' : 'A'}${seq++}`;
    for (const d of c.docs) { d.matching = label; matching.set(d.rowId, label); for (const s of d.lines) matching.set(s.rowId, label); }
  }
  return { docs, byNumber, matching, outstanding, nextSeq: seq };
}

const groupLedger = (ledger: LedgerEntry[], partyType: 'patient' | 'supplier') => {
  const by = new Map<string, LedgerEntry[]>();
  for (const l of ledger) if (l.partyType === partyType && !l.deleted) { const a = by.get(l.partyId); if (a) a.push(l); else by.set(l.partyId, [l]); }
  return by;
};

/** Refund number to bill number, so an item return settles the bill it came from. */
export function refundMap(refunds: Refund[], invoices: Pick<Invoice, 'id' | 'number'>[]) {
  const num = new Map(invoices.map(i => [i.id, i.number]));
  return new Map(refunds.filter(r => !r.deleted && num.has(r.invoiceId)).map(r => [r.number, num.get(r.invoiceId)!]));
}

/** Payment status of every vendor bill, by bill number. */
export function billMatches(ledger: LedgerEntry[]): Map<string, DocMatch> {
  const out = new Map<string, DocMatch>();
  for (const rows of groupLedger(ledger, 'supplier').values()) for (const d of matchParty('supplier', rows).docs) out.set(d.number, d);
  return out;
}

/** Payment status of every customer invoice. A bill paid in full at the counter has no customer balance to match. */
export function invoiceMatches(invoices: Invoice[], ledger: LedgerEntry[], refunds: Refund[]): Map<string, DocMatch> {
  const map = refundMap(refunds, invoices);
  const out = new Map<string, DocMatch>();
  for (const rows of groupLedger(ledger, 'patient').values()) for (const d of matchParty('patient', rows, map).docs) out.set(d.number, d);
  for (const inv of invoices) {
    if (inv.deleted || out.has(inv.number) || (inv.baseStatus || inv.status) === 'credit' || inv.status === 'void') continue;
    const back = inv.refunded || 0;
    out.set(inv.number, { rowId: inv.id, number: inv.number, date: dayOf(inv.createdAt), amount: inv.total, paid: inv.total - Math.min(back, inv.total), reversed: Math.min(back, inv.total), residual: 0, state: stateOf(inv.total, inv.total - Math.min(back, inv.total), Math.min(back, inv.total)), lines: [], matching: '' });
  }
  return out;
}

/* ---------------- journal items: every document as balanced debit and credit lines ---------------- */

export type JournalCode = 'INV' | 'RINV' | 'BILL' | 'RBILL' | 'CSH1' | 'BNK1' | 'MISC' | 'STJ' | 'EXP';
export const JOURNALS: Record<JournalCode, string> = { INV: 'Customer Invoices', RINV: 'Credit Notes', BILL: 'Vendor Bills', RBILL: 'Vendor Credit Notes', CSH1: 'Cash', BNK1: 'Bank', MISC: 'Miscellaneous Operations', STJ: 'Inventory Valuation', EXP: 'Expenses' };

export interface JournalItem { id: string; date: string; journal: JournalCode; move: string; account: Acc; partner: string; label: string; debit: number; credit: number }

export interface JournalData {
  invoices: Invoice[]; invoiceItems?: InvoiceItem[]; refunds: Refund[]; purchases: Purchase[]; expenses: Expense[]; ledger: LedgerEntry[];
  patients?: Patient[]; suppliers?: Supplier[]; moneyMoves?: MoneyMove[]; shop?: Pick<Shop, 'openingCash' | 'openingBank' | 'payAccounts'> | null;
  /** Bills from other periods that returns in this data belong to. */
  invoiceLookup?: Invoice[];
  /** Balances brought forward from earlier financial years. */
  carryAccounts?: { code: string; name: string; net: number }[] | null;
}

const OPENING_DAY = '0000-01-01';

/** Every money document as journal items. Each document always balances: its debits equal its credits. */
export function journalItems(data: JournalData): JournalItem[] {
  const pName = new Map((data.patients || []).map(p => [p.id, p.name]));
  const sName = new Map((data.suppliers || []).map(s => [s.id, s.name]));
  const named = new Map<string, Acc>();
  (data.shop?.payAccounts || []).forEach((a, i) => named.set(a.id, { code: String(101410 + i), name: `${a.provider} · ${a.title}` }));
  const moneyAcc = (method: string | undefined, accountId?: string | null, accountName?: string | null): Acc => {
    if (accountId) { const n = named.get(accountId); if (n) return n; if (accountName) return { code: '101409', name: accountName }; }
    return method === 'cash' ? ACC.cash : method === 'wallet' ? ACC.wallet : ACC.bank;
  };
  const jr = (a: Acc): JournalCode => a === ACC.cash ? 'CSH1' : 'BNK1';
  const out: JournalItem[] = [];
  const line = (id: string, date: string, journal: JournalCode, move: string, account: Acc, partner: string, label: string, debit: number, credit: number) => { if (debit || credit) out.push({ id, date, journal, move, account, partner, label, debit, credit }); };
  const costBy = new Map<string, number>();
  for (const it of data.invoiceItems || []) if (!it.deleted) costBy.set(it.invoiceId, (costBy.get(it.invoiceId) || 0) + (it.costPrice || 0) * it.qty);
  const invById = new Map([...(data.invoiceLookup || []), ...data.invoices].map(i => [i.id, i]));
  const refs = vendorRefs(data.purchases);

  for (const inv of data.invoices) {
    if (inv.deleted || inv.status === 'void') continue;
    const d = dayOf(inv.createdAt), who = inv.patientId ? pName.get(inv.patientId) || '' : '', n = inv.number;
    line(`${inv.id}:ar`, d, 'INV', n, ACC.ar, who, n, inv.total, 0);
    line(`${inv.id}:s`, d, 'INV', n, ACC.sales, who, n, 0, inv.total - inv.tax);
    line(`${inv.id}:t`, d, 'INV', n, ACC.tax, who, n, 0, inv.tax);
    const cost = costBy.get(inv.id) || 0;
    line(`${inv.id}:c`, d, 'STJ', n, ACC.cogs, who, n, cost, 0);
    line(`${inv.id}:v`, d, 'STJ', n, ACC.stock, who, n, 0, cost);
    if ((inv.baseStatus || inv.status) !== 'credit' && inv.payMethod !== 'credit') {
      const m = moneyAcc(inv.payMethod === 'cash' ? 'cash' : inv.payMethod, inv.accountId, inv.accountName);
      line(`${inv.id}:m`, d, jr(m), n, m, who, n, inv.total, 0);
      line(`${inv.id}:r`, d, jr(m), n, ACC.ar, who, n, 0, inv.total);
    }
  }
  for (const r of data.refunds) {
    if (r.deleted) continue;
    const inv = invById.get(r.invoiceId);
    if (inv?.status === 'void') continue;
    const d = dayOf(r.date || r.createdAt), who = inv?.patientId ? pName.get(inv.patientId) || '' : '', n = r.number;
    line(`${r.id}:s`, d, 'RINV', n, ACC.sales, who, n, r.total - r.tax, 0);
    line(`${r.id}:t`, d, 'RINV', n, ACC.tax, who, n, r.tax, 0);
    line(`${r.id}:ar`, d, 'RINV', n, ACC.ar, who, n, 0, r.total);
    const cost = r.items.reduce((s, i) => s + (i.cost || 0) * i.qty, 0);
    line(`${r.id}:v`, d, 'STJ', n, ACC.stock, who, n, cost, 0);
    line(`${r.id}:c`, d, 'STJ', n, ACC.cogs, who, n, 0, cost);
    if (r.method !== 'credit') {
      const m = moneyAcc(r.method === 'cash' ? 'cash' : inv?.payMethod === 'wallet' ? 'wallet' : 'bank', r.accountId ?? inv?.accountId, r.accountName ?? inv?.accountName);
      line(`${r.id}:r`, d, jr(m), n, ACC.ar, who, n, r.total, 0);
      line(`${r.id}:m`, d, jr(m), n, m, who, n, 0, r.total);
    }
  }
  for (const p of data.purchases) {
    if (p.deleted || p.status !== 'received') continue;
    const d = dayOf(p.receivedAt || p.date), who = sName.get(p.supplierId) || '';
    const label = billLabel(p.number, refs);
    line(`${p.id}:v`, d, 'BILL', p.number, ACC.stock, who, label, p.total, 0);
    line(`${p.id}:ap`, d, 'BILL', p.number, ACC.ap, who, label, 0, p.total);
  }
  for (const l of data.ledger) {
    if (l.deleted || l.id.startsWith('carry:')) continue;
    const sup = l.partyType === 'supplier', who = (sup ? sName : pName).get(l.partyId) || '', party = sup ? ACC.ap : ACC.ar;
    if ((l as { foreign?: boolean }).foreign) { // made at another branch: it moves the balance, not this branch's money
      line(`${l.id}:p`, l.date, 'MISC', l.ref, party, who, l.note || l.ref, l.debit, l.credit);
      line(`${l.id}:x`, l.date, 'MISC', l.ref, ACC.clearing, who, l.note || l.ref, l.credit, l.debit);
    } else if (l.ref === 'PAYMENT') {
      const m = moneyAcc(l.method || 'cash', l.accountId, l.accountName), label = l.matchDoc ? billLabel(l.matchDoc, refs) : l.note || 'Payment';
      line(`${l.id}:p`, l.date, jr(m), 'PAYMENT', party, who, label, l.debit, l.credit);
      line(`${l.id}:m`, l.date, jr(m), 'PAYMENT', m, who, label, l.credit, l.debit);
    } else if (l.ref === 'OPENING') {
      line(`${l.id}:p`, l.date, 'MISC', 'OPENING', party, who, 'Opening balance', l.debit, l.credit);
      line(`${l.id}:e`, l.date, 'MISC', 'OPENING', ACC.equity, who, 'Opening balance', l.credit, l.debit);
    } else if (sup && l.ref.startsWith('PRET-')) {
      line(`${l.id}:p`, l.date, 'RBILL', l.ref, ACC.ap, who, l.note || l.ref, l.debit, 0);
      line(`${l.id}:v`, l.date, 'RBILL', l.ref, ACC.stock, who, l.note || l.ref, 0, l.debit);
    }
  }
  for (const e of data.expenses) {
    if (e.deleted) continue;
    const m = moneyAcc(e.payMethod === 'card' ? 'bank' : e.payMethod, e.accountId, e.accountName);
    line(`${e.id}:e`, e.date, 'EXP', e.category || 'Other', ACC.expense, e.paidTo || '', e.note || e.category || 'Other', e.amount, 0);
    line(`${e.id}:m`, e.date, 'EXP', e.category || 'Other', m, e.paidTo || '', e.note || e.category || 'Other', 0, e.amount);
  }
  const place = (w: string, nm: string, m: MoneyMove): Acc => w.startsWith('acc:') ? moneyAcc((m as MoneyMove & { types?: Record<string, string> }).types?.[w] || 'bank', w.slice(4), nm) : ACC.cash;
  for (const m of data.moneyMoves || []) {
    if (m.deleted) continue;
    line(`${m.id}:i`, m.date, 'MISC', 'TRANSFER', place(m.to, m.toName, m), '', m.note || 'Internal Transfer', m.amount, 0);
    line(`${m.id}:o`, m.date, 'MISC', 'TRANSFER', place(m.from, m.fromName, m), '', m.note || 'Internal Transfer', 0, m.amount);
  }
  for (const c of data.carryAccounts || []) line(`carry:${c.code}:${c.name}`, OPENING_DAY, 'MISC', 'OPENING', { code: c.code, name: c.name }, '', 'Balance brought forward', Math.max(c.net, 0), Math.max(-c.net, 0));
  const open = (id: string, a: Acc, amt: number) => { line(`open:${id}:m`, OPENING_DAY, 'MISC', 'OPENING', a, '', 'Opening balance', amt, 0); line(`open:${id}:e`, OPENING_DAY, 'MISC', 'OPENING', ACC.equity, '', 'Opening balance', 0, amt); };
  open('cash', ACC.cash, data.shop?.openingCash || 0);
  open('bank', ACC.bank, data.shop?.openingBank || 0);
  for (const a of (data.shop?.payAccounts || []) as PayAccount[]) open(a.id, named.get(a.id)!, a.opening || 0);
  return out;
}

export interface LedgerLine extends JournalItem { balance: number }
export interface AccountLedger { account: Acc; initial: number; debit: number; credit: number; balance: number; lines: LedgerLine[] }

/** General Ledger: each account with its Initial Balance, journal items and running Balance. */
export function generalLedger(items: JournalItem[], from: string, to: string): { accounts: AccountLedger[]; debit: number; credit: number; balance: number } {
  const by = new Map<string, AccountLedger>();
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  for (const i of sorted) {
    if (i.date > to) continue;
    let a = by.get(i.account.code + i.account.name);
    if (!a) { a = { account: i.account, initial: 0, debit: 0, credit: 0, balance: 0, lines: [] }; by.set(i.account.code + i.account.name, a); }
    if (i.date < from) { a.initial += i.debit - i.credit; a.balance = a.initial; continue; }
    a.debit += i.debit; a.credit += i.credit; a.balance += i.debit - i.credit;
    a.lines.push({ ...i, balance: a.balance });
  }
  const accounts = [...by.values()].filter(a => a.initial || a.lines.length).sort((a, b) => a.account.code.localeCompare(b.account.code));
  return { accounts, debit: accounts.reduce((s, a) => s + a.debit, 0), credit: accounts.reduce((s, a) => s + a.credit, 0), balance: accounts.reduce((s, a) => s + a.balance, 0) };
}

export interface TrialRow { account: Acc; initialDebit: number; initialCredit: number; debit: number; credit: number; endDebit: number; endCredit: number }

/** Trial Balance: Initial Balance, the period and End Balance, each with Debit and Credit. */
export function trialBalance(items: JournalItem[], from: string, to: string): { rows: TrialRow[]; total: Omit<TrialRow, 'account'> } {
  const by = new Map<string, TrialRow & { init: number }>();
  for (const i of items) {
    if (i.date > to) continue;
    const key = i.account.code + i.account.name;
    let r = by.get(key);
    if (!r) { r = { account: i.account, init: 0, initialDebit: 0, initialCredit: 0, debit: 0, credit: 0, endDebit: 0, endCredit: 0 }; by.set(key, r); }
    if (i.date < from) r.init += i.debit - i.credit; else { r.debit += i.debit; r.credit += i.credit; }
  }
  const total = { initialDebit: 0, initialCredit: 0, debit: 0, credit: 0, endDebit: 0, endCredit: 0 };
  const rows: TrialRow[] = [];
  for (const r of [...by.values()].sort((a, b) => a.account.code.localeCompare(b.account.code))) {
    const end = r.init + r.debit - r.credit;
    if (!r.init && !r.debit && !r.credit) continue;
    const row: TrialRow = { account: r.account, initialDebit: Math.max(r.init, 0), initialCredit: Math.max(-r.init, 0), debit: r.debit, credit: r.credit, endDebit: Math.max(end, 0), endCredit: Math.max(-end, 0) };
    rows.push(row);
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += row[k];
  }
  return { rows, total };
}

/* ---------------- Partner Ledger ---------------- */

export interface PartnerLine { id: string; date: string; journal: JournalCode; account: Acc; ref: string; dueDate: string; matching: string; debit: number; credit: number; balance: number }
export interface PartnerLedger { partyType: 'patient' | 'supplier'; partyId: string; name: string; initial: number; debit: number; credit: number; balance: number; outstanding: number; lines: PartnerLine[] }
export interface PartnerData { ledger: LedgerEntry[]; invoices: Invoice[]; refunds: Refund[]; patients?: Patient[]; suppliers?: Supplier[]; purchases?: Pick<Purchase, 'number' | 'vendorRef'>[] }

/** Our purchase number with the vendor's invoice number beside it, when there is one. */
export function billLabel(number: string, refs: Map<string, string>) { const r = refs.get(number); return r ? `${number} - ${r}` : number; }
export const vendorRefs = (purchases: Pick<Purchase, 'number' | 'vendorRef'>[] = []) => new Map(purchases.filter(p => p.vendorRef).map(p => [p.number, p.vendorRef!]));

const journalOfRow = (t: 'patient' | 'supplier', l: LedgerEntry, refunds: Map<string, string>): JournalCode => {
  if (l.ref === 'PAYMENT') return (l.method || 'cash') === 'cash' ? 'CSH1' : 'BNK1';
  if (l.ref === 'OPENING' || (l as { foreign?: boolean }).foreign) return 'MISC';
  if (t === 'supplier') return l.ref.startsWith('PRET-') ? 'RBILL' : 'BILL';
  return refunds.has(l.ref) || l.credit > 0 ? 'RINV' : 'INV';
};

/**
 * Partner Ledger for a period. Lines come from the account lines of each customer and vendor, plus bills they
 * paid in full at the counter, shown as an invoice and its payment so their whole history is there.
 * Those net to zero, so only the period's bills need to be passed in; earlier ones cannot change the balance.
 */
export function partnerLedger(data: PartnerData, f: { from: string; to: string; partyType?: 'patient' | 'supplier' | null; partyId?: string | null }): { partners: PartnerLedger[]; debit: number; credit: number; balance: number } {
  const pName = new Map((data.patients || []).map(p => [p.id, p.name]));
  const sName = new Map((data.suppliers || []).map(s => [s.id, s.name]));
  const refunds = refundMap(data.refunds, data.invoices);
  const refs = vendorRefs(data.purchases);
  const partners: PartnerLedger[] = [];
  let seq = 1;
  const invoicesBy = new Map<string, Invoice[]>();
  for (const inv of data.invoices) if (inv.patientId && !inv.deleted && inv.status !== 'void' && (inv.baseStatus || inv.status) !== 'credit' && inv.payMethod !== 'credit') { const a = invoicesBy.get(inv.patientId); if (a) a.push(inv); else invoicesBy.set(inv.patientId, [inv]); }
  const refundsBy = new Map<string, Refund[]>();
  for (const r of data.refunds) if (!r.deleted) { const a = refundsBy.get(r.invoiceId); if (a) a.push(r); else refundsBy.set(r.invoiceId, [r]); }
  for (const t of ['patient', 'supplier'] as const) {
    if (f.partyType && f.partyType !== t) continue;
    const led = groupLedger(data.ledger, t);
    const ids = new Set<string>([...led.keys(), ...(t === 'patient' ? invoicesBy.keys() : [])]);
    const account = t === 'patient' ? ACC.ar : ACC.ap;
    for (const id of ids) {
      if (f.partyId && f.partyId !== id) continue;
      const rows = led.get(id) || [];
      const m = matchParty(t, rows, refunds, seq); seq = m.nextSeq;
      let initial = 0;
      const lines: Omit<PartnerLine, 'balance'>[] = [];
      for (const l of rows) {
        if (l.date > f.to) continue;
        if (l.date < f.from) { initial += l.debit - l.credit; continue; }
        lines.push({ id: l.id, date: l.date, journal: journalOfRow(t, l, refunds), account, ref: l.ref === 'PAYMENT' ? (l.matchDoc ? `Payment ${billLabel(l.matchDoc, refs)}` : 'Payment') : l.ref === 'OPENING' ? 'Opening balance' : l.matchDoc && l.ref.startsWith('PRET-') ? `${l.ref} (${billLabel(l.matchDoc, refs)})` : billLabel(l.ref, refs), dueDate: l.date, matching: m.matching.get(l.id) || '', debit: l.debit, credit: l.credit });
      }
      for (const inv of (t === 'patient' ? invoicesBy.get(id) : null) || []) {
        const d = dayOf(inv.createdAt), mj: JournalCode = inv.payMethod === 'cash' ? 'CSH1' : 'BNK1';
        if (d >= f.from && d <= f.to) {
          const a = `A${seq++}`;
          lines.push({ id: `${inv.id}:i`, date: d, journal: 'INV', account, ref: inv.number, dueDate: d, matching: a, debit: inv.total, credit: 0 });
          lines.push({ id: `${inv.id}:p`, date: d, journal: mj, account, ref: `Payment ${inv.number}`, dueDate: d, matching: a, debit: 0, credit: inv.total });
        }
        for (const r of refundsBy.get(inv.id) || []) {
          const rd = dayOf(r.date || r.createdAt);
          if (rd < f.from || rd > f.to) continue;
          const a = `A${seq++}`;
          lines.push({ id: `${r.id}:c`, date: rd, journal: 'RINV', account, ref: r.number, dueDate: rd, matching: a, debit: 0, credit: r.total });
          lines.push({ id: `${r.id}:p`, date: rd, journal: r.method === 'cash' ? 'CSH1' : 'BNK1', account, ref: `Payment ${r.number}`, dueDate: rd, matching: a, debit: r.total, credit: 0 });
        }
      }
      lines.sort((a, b) => a.date.localeCompare(b.date));
      if (!initial && !lines.length) continue;
      let bal = initial, debit = 0, credit = 0;
      const withBal = lines.map(x => { bal += x.debit - x.credit; debit += x.debit; credit += x.credit; return { ...x, balance: bal }; });
      partners.push({ partyType: t, partyId: id, name: (t === 'patient' ? pName : sName).get(id) || '', initial, debit, credit, balance: bal, outstanding: m.outstanding, lines: withBal });
    }
  }
  partners.sort((a, b) => a.name.localeCompare(b.name));
  return { partners, debit: partners.reduce((s, p) => s + p.debit, 0), credit: partners.reduce((s, p) => s + p.credit, 0), balance: partners.reduce((s, p) => s + p.balance, 0) };
}
