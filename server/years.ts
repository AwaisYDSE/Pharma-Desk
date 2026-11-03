// Balances brought forward for a financial year. Totals are kept per month and only months that
// changed are worked out again, so opening a year stays quick however old the shop is.
// © Awais Amin
import type { DB } from './db.ts';
import { allRows, getRow } from './db.ts';
import { dayOf } from '../shared/accounting.ts';
import { allEntries } from '../shared/books.ts';
import { journalItems, ACC } from '../shared/ledger.ts';
import { addDays } from '../shared/util.ts';
import type { YearCarry } from '../shared/years.ts';
import type { Expense, Invoice, InvoiceItem, LedgerEntry, MoneyMove, Purchase, Refund, Shop } from '../shared/types.ts';

interface MonthTotals { accounts: Record<string, { code: string; name: string; net: number }>; parties: Record<string, number>; money: Record<string, number> }
const ym = (day: string) => day.slice(0, 7);

function ensureTable(db: DB) { db.exec(`CREATE TABLE IF NOT EXISTS month_totals (ym TEXT PRIMARY KEY, data TEXT NOT NULL)`); }

function monthDocs(db: DB, month: string, shop: Shop | null) {
  const start = `${month}-01`, end = `${month}-31`;
  const inMonth = (d: string | undefined | null) => !!d && ym(d) === month;
  const looseFrom = addDays(start, -2), looseTo = addDays(end.replace(/-31$/, '-28'), 6);
  const invoices = allRows<Invoice>(db, 'invoices', 'WHERE created_at >= ? AND created_at < ?', looseFrom, looseTo).filter(i => inMonth(dayOf(i.createdAt)));
  const invoiceItems: InvoiceItem[] = invoices.flatMap(i => allRows<InvoiceItem>(db, 'invoiceItems', 'WHERE invoice_id = ?', i.id));
  const refunds = allRows<Refund>(db, 'refunds', 'WHERE date >= ? AND date <= ?', start, end);
  const invoiceLookup = refunds.map(r => getRow<Invoice>(db, 'invoices', r.invoiceId)).filter(Boolean) as Invoice[];
  const purchases = allRows<Purchase>(db, 'purchases', `WHERE json_extract(data, '$.status') = 'received'`).filter(p => inMonth(dayOf(p.receivedAt || p.date)));
  const ledger = allRows<LedgerEntry>(db, 'ledger', 'WHERE date >= ? AND date <= ?', start, end);
  const expenses = allRows<Expense>(db, 'expenses', 'WHERE date >= ? AND date <= ?', start, end);
  const moneyMoves = allRows<MoneyMove>(db, 'moneyMoves', 'WHERE date >= ? AND date <= ?', start, end);
  // Named accounts keep their codes; the starting amounts belong to the year they are added back in, not to a month.
  const quietShop = shop ? { payAccounts: (shop.payAccounts || []).map(a => ({ ...a, opening: 0 })) } : null;
  return { invoices, invoiceItems, refunds, invoiceLookup, purchases, ledger, expenses, moneyMoves, shop: quietShop };
}

function computeMonth(db: DB, month: string, shop: Shop | null): MonthTotals {
  const data = monthDocs(db, month, shop);
  const out: MonthTotals = { accounts: {}, parties: {}, money: {} };
  for (const i of journalItems(data)) {
    // Profit of earlier years is closed into equity, as at any year end.
    const a = Number(i.account.code) >= 400000 ? ACC.equity : i.account;
    const key = a.code + a.name, r = out.accounts[key] || (out.accounts[key] = { code: a.code, name: a.name, net: 0 });
    r.net += i.debit - i.credit;
  }
  for (const l of data.ledger) {
    if (l.deleted) continue;
    const k = `${l.partyType}:${l.partyId}`;
    out.parties[k] = (out.parties[k] || 0) + l.debit - l.credit;
  }
  const add = (k: string, v: number) => { out.money[k] = (out.money[k] || 0) + v; };
  for (const e of allEntries(data)) {
    const v = e.moneyIn - e.moneyOut;
    if (!v) continue;
    add(e.method, v);
    if (e.accountId) add(`acc:${e.accountId}`, v); else add(`loose:${e.method}`, v);
  }
  return out;
}

/** Throws away the totals of months something changed in since last time. */
function markChanged(db: DB) {
  const seen = (db.prepare(`SELECT value FROM meta WHERE key = 'carry_rev'`).get() as { value: string } | undefined)?.value;
  const head = (db.prepare(`SELECT value FROM meta WHERE key = 'rev'`).get() as { value: string }).value;
  if (seen !== undefined && seen !== head) {
    const months = new Set<string>();
    const scan = <T>(tbl: 'invoices' | 'refunds' | 'purchases' | 'ledger' | 'expenses' | 'moneyMoves', day: (r: T) => string | undefined | null) => { for (const r of allRows(db, tbl, 'WHERE rev > ?', Number(seen)) as unknown as T[]) { const d = day(r); if (d) months.add(ym(d)); } };
    scan<Invoice>('invoices', i => dayOf(i.createdAt));
    scan<Refund>('refunds', r => r.date);
    scan<Purchase>('purchases', p => dayOf(p.receivedAt || p.date));
    scan<LedgerEntry>('ledger', l => l.date);
    scan<Expense>('expenses', e => e.date);
    scan<MoneyMove>('moneyMoves', m => m.date);
    // A bill cancelled later also changes the months its returns were in.
    for (const i of allRows<Invoice>(db, 'invoices', 'WHERE rev > ?', Number(seen))) for (const r of allRows<Refund>(db, 'refunds', 'WHERE invoice_id = ?', i.id)) months.add(ym(r.date));
    // Shop settings carry the account codes.
    if ((db.prepare(`SELECT COUNT(*) AS n FROM shop WHERE rev > ?`).get(Number(seen)) as { n: number }).n) db.exec(`DELETE FROM month_totals`);
    const del = db.prepare(`DELETE FROM month_totals WHERE ym = ?`);
    for (const m of months) del.run(m);
  }
  db.prepare(`INSERT INTO meta(key, value) VALUES ('carry_rev', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(head);
}

/** The first day anything was recorded, so the year list starts there. */
export function firstDay(db: DB): string {
  const q = (t: string, c: string) => (db.prepare(`SELECT MIN(${c}) AS d FROM ${t} WHERE ${c} IS NOT NULL`).get() as { d: string | null }).d;
  const days = [q('invoices', 'created_at'), q('refunds', 'date'), q('ledger', 'date'), q('expenses', 'date'), q('money_moves', 'date')].filter(Boolean).map(d => d!.slice(0, 10));
  for (const p of allRows<Purchase>(db, 'purchases', `WHERE json_extract(data, '$.status') = 'received'`)) days.push(dayOf(p.receivedAt || p.date));
  return days.sort()[0] || '';
}

/** Everything before this day, added up. Gives way between months so the shop never waits on it. */
export async function yearCarry(db: DB, from: string): Promise<YearCarry> {
  ensureTable(db);
  markChanged(db);
  const shop = getRow<Shop>(db, 'shop', 'shop');
  const first = firstDay(db);
  const accounts = new Map<string, { code: string; name: string; net: number }>();
  const parties = new Map<string, number>();
  const money: Record<string, number> = {};
  if (first && first < from) {
    const get = db.prepare(`SELECT data FROM month_totals WHERE ym = ?`), put = db.prepare(`INSERT OR REPLACE INTO month_totals(ym, data) VALUES (?, ?)`);
    let y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7));
    for (let month = ym(first); `${month}-01` < from; month = `${y}-${String(m).padStart(2, '0')}`) {
      const saved = get.get(month) as { data: string } | undefined;
      let t: MonthTotals;
      if (saved) t = JSON.parse(saved.data);
      else {
        await new Promise(r => setImmediate(r));
        t = computeMonth(db, month, shop);
        put.run(month, JSON.stringify(t));
      }
      for (const [k, v] of Object.entries(t.accounts)) { const r = accounts.get(k); if (r) r.net += v.net; else accounts.set(k, { ...v }); }
      for (const [k, v] of Object.entries(t.parties)) parties.set(k, (parties.get(k) || 0) + v);
      for (const [k, v] of Object.entries(t.money)) money[k] = (money[k] || 0) + v;
      if (++m > 12) { m = 1; y++; }
    }
  }
  return {
    accounts: [...accounts.values()].filter(a => a.net),
    parties: [...parties.entries()].filter(([, net]) => net).map(([k, net]) => { const i = k.indexOf(':'); return { partyType: k.slice(0, i) as 'patient' | 'supplier', partyId: k.slice(i + 1), net }; }),
    money,
  };
}
