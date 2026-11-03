// Part payments, matching of payments and returns, Partner Ledger, General Ledger and Trial Balance.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startShop, stop, type Shop } from './helpers.ts';
import { openDb, allRows, getRow } from '../server/db.ts';
import { applyOp, pullChanges } from '../server/ops.ts';
import { matchParty, partnerLedger, journalItems, generalLedger, trialBalance, invoiceMatches, billMatches, ACC, type JournalData } from '../shared/ledger.ts';
import { summarize } from '../shared/accounting.ts';
import { moneyBook, agedBalances, statement } from '../shared/books.ts';
import type { Invoice, LedgerEntry, Op, Purchase, Refund } from '../shared/types.ts';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const D = '2026-11-03';
const row = (over: Partial<LedgerEntry>): LedgerEntry => ({ id: Math.random().toString(36).slice(2), partyType: 'supplier', partyId: 's1', date: D, debit: 0, credit: 0, ref: 'X', ...over });
const inv = (over: Partial<Invoice>): Invoice => ({ id: 'i1', number: 'INV1', patientId: 'p1', cashierId: 'u', createdAt: `${D}T09:00:00`, status: 'paid', gross: 10000, discount: 0, tax: 0, total: 10000, paid: 10000, change: 0, payMethod: 'cash', deviceId: 'd', ...over });

describe('Matching', () => {
  it('a bill part paid and part returned: both cross against it and only the rest is due', () => {
    const m = matchParty('supplier', [
      row({ id: 'b', credit: 10000, ref: 'PO1' }),
      row({ id: 'p', debit: 5000, ref: 'PAYMENT', matchDoc: 'PO1' }),
      row({ id: 'r', debit: 3000, ref: 'PRET-1', matchDoc: 'PO1' }),
    ]);
    const d = m.byNumber.get('PO1')!;
    expect([d.paid, d.reversed, d.residual, d.state]).toEqual([5000, 3000, 2000, 'partial']);
    expect(d.matching).toMatch(/^P/);
    expect(m.matching.get('p')).toBe(d.matching);
    expect(m.matching.get('r')).toBe(d.matching);
  });

  it('settling the rest makes it Paid with a full match', () => {
    const d = matchParty('supplier', [row({ id: 'b', credit: 10000, ref: 'PO1' }), row({ debit: 7000, ref: 'PAYMENT', matchDoc: 'PO1' }), row({ debit: 3000, ref: 'PRET-1', matchDoc: 'PO1' })]).byNumber.get('PO1')!;
    expect([d.residual, d.state]).toEqual([0, 'paid']);
    expect(d.matching).toMatch(/^A/);
  });

  it('everything returned is Reversed', () => {
    expect(matchParty('supplier', [row({ credit: 10000, ref: 'PO1' }), row({ debit: 10000, ref: 'PRET-1', matchDoc: 'PO1' })]).byNumber.get('PO1')!.state).toBe('reversed');
  });

  it('a payment against no document settles the oldest, and what is left stays as an outstanding credit', () => {
    const m = matchParty('supplier', [row({ credit: 1000, ref: 'PO1', date: '2026-01-01' }), row({ credit: 1000, ref: 'PO2', date: '2026-02-01' }), row({ debit: 2500, ref: 'PAYMENT' })]);
    expect(m.byNumber.get('PO1')!.state).toBe('paid');
    expect(m.byNumber.get('PO2')!.state).toBe('paid');
    expect(m.outstanding).toBe(500);
  });

  it('more paid on a bill than is due moves on to the next one', () => {
    const m = matchParty('supplier', [row({ credit: 1000, ref: 'PO1', date: '2026-01-01' }), row({ credit: 1000, ref: 'PO2', date: '2026-02-01' }), row({ debit: 1500, ref: 'PAYMENT', matchDoc: 'PO1' })]);
    expect(m.byNumber.get('PO2')!.residual).toBe(500);
    expect(m.byNumber.get('PO1')!.matching).toBe(m.byNumber.get('PO2')!.matching);
  });

  it('a bill paid at the counter is Paid, and Reversed when all of it came back', () => {
    expect(invoiceMatches([inv({})], [], []).get('INV1')!.state).toBe('paid');
    expect(invoiceMatches([inv({ refunded: 10000, status: 'refunded', baseStatus: 'paid' })], [], []).get('INV1')!.state).toBe('reversed');
  });

  it('an item return settles the bill it came from, also on older lines with no link', () => {
    const refund = { id: 'r', invoiceId: 'i1', number: 'RET1' } as Refund;
    const ledger = [row({ partyType: 'patient', partyId: 'p1', debit: 10000, ref: 'INV1' }), row({ partyType: 'patient', partyId: 'p1', credit: 4000, ref: 'RET1' })];
    const d = invoiceMatches([inv({ status: 'partial_refund', baseStatus: 'credit', payMethod: 'credit', paid: 0 })], ledger, [refund]).get('INV1')!;
    expect([d.reversed, d.residual, d.state]).toEqual([4000, 6000, 'partial']);
  });
});

/** A small shop's month: every way money can move. */
function month(): JournalData {
  const ledger: LedgerEntry[] = [
    // credit sale 200 part paid 50, 30 returned, 20 paid later
    row({ id: 'l1', partyType: 'patient', partyId: 'p1', debit: 20000, ref: 'INV2' }),
    row({ id: 'l2', partyType: 'patient', partyId: 'p1', credit: 5000, ref: 'PAYMENT', method: 'cash', matchDoc: 'INV2' }),
    row({ id: 'l3', partyType: 'patient', partyId: 'p1', credit: 3000, ref: 'RET2', matchDoc: 'INV2' }),
    row({ id: 'l4', partyType: 'patient', partyId: 'p1', credit: 2000, ref: 'PAYMENT', method: 'bank', matchDoc: 'INV2', date: '2026-11-04' }),
    // voided credit sale nets to nothing
    row({ id: 'l5', partyType: 'patient', partyId: 'p1', debit: 900, ref: 'INV3' }), row({ id: 'l6', partyType: 'patient', partyId: 'p1', credit: 900, ref: 'INV3', note: 'Bill voided' }),
    // bill 100 half paid in cash, 10 returned
    row({ id: 'l7', credit: 10000, ref: 'PO1' }), row({ id: 'l8', debit: 5000, ref: 'PAYMENT', method: 'cash', matchDoc: 'PO1' }), row({ id: 'l9', debit: 1000, ref: 'PRET-1', matchDoc: 'PO1' }),
    // opening balances
    row({ id: 'l10', debit: 0, credit: 7000, ref: 'OPENING', date: '2026-01-01' }), row({ id: 'l11', partyType: 'patient', partyId: 'p2', debit: 1500, ref: 'OPENING', date: '2026-01-01' }),
  ];
  return {
    invoices: [
      inv({ id: 'i1', number: 'INV1', tax: 1000 }),
      inv({ id: 'i2', number: 'INV2', total: 20000, gross: 20000, tax: 2000, status: 'partial_refund', baseStatus: 'credit', payMethod: 'credit', paid: 5000, refunded: 3000 }),
      inv({ id: 'i3', number: 'INV3', total: 900, gross: 900, status: 'void', baseStatus: 'credit', payMethod: 'credit', paid: 0 }),
      inv({ id: 'i4', number: 'INV4', patientId: null, total: 700, gross: 700, payMethod: 'card' }),
    ],
    invoiceItems: [{ id: 'x', invoiceId: 'i1', medicineId: 'm', batchId: 'b', qty: 2, unitPrice: 5000, costPrice: 1000, discount: 0, taxBp: 0, tax: 0, total: 10000 }],
    refunds: [
      { id: 'r2', invoiceId: 'i2', number: 'RET2', date: D, createdAt: `${D}T10:00:00`, userId: 'u', reason: 'x', method: 'credit', items: [{ itemId: 'y', medicineId: 'm', batchId: 'b', qty: 1, amount: 3000, tax: 300, cost: 500 }], total: 3000, tax: 300 },
      { id: 'r1', invoiceId: 'i1', number: 'RET1', date: D, createdAt: `${D}T11:00:00`, userId: 'u', reason: 'x', method: 'cash', items: [{ itemId: 'x', medicineId: 'm', batchId: 'b', qty: 1, amount: 5000, tax: 500, cost: 1000 }], total: 5000, tax: 500 },
    ],
    purchases: [{ id: 'po', number: 'PO1', supplierId: 's1', date: D, status: 'received', total: 10000, paid: 0, receivedAt: `${D}T08:00:00` } as Purchase],
    expenses: [{ id: 'e', date: D, category: 'Rent', amount: 400, payMethod: 'cash' }],
    ledger,
    patients: [{ id: 'p1', name: 'Ali' }, { id: 'p2', name: 'Sara' }], suppliers: [{ id: 's1', name: 'Ahmed Traders' }],
    moneyMoves: [{ id: 'mv', date: D, from: 'cash', to: 'acc:a1', fromName: 'Cash', toName: 'HBL', amount: 100, at: D }],
    shop: { openingCash: 12300, payAccounts: [{ id: 'a1', type: 'bank', provider: 'HBL', title: 'Shop', number: '1', active: true, opening: 500 }] },
  };
}
const FROM = '2026-11-01', TO = '2026-11-30';

describe('Books', () => {
  const data = month();
  const items = journalItems(data);
  const end = (code: string) => trialBalance(items, FROM, TO).rows.filter(r => r.account.code === code).reduce((s, r) => s + r.endDebit - r.endCredit, 0);

  it('debits equal credits on every document and in the Trial Balance', () => {
    const moves = new Map<string, number>();
    for (const i of items) { const k = i.id.split(':').slice(0, i.id.startsWith('open:') ? 2 : 1).join(':'); moves.set(k, (moves.get(k) || 0) + i.debit - i.credit); }
    // cost of goods and money lines are both inside their document, so each document nets to zero
    for (const [k, v] of moves) expect([k, v]).toEqual([k, 0]);
    const t = trialBalance(items, FROM, TO);
    expect(t.total.debit).toBe(t.total.credit);
    expect(t.total.endDebit).toBe(t.total.endCredit);
    expect(t.total.initialDebit).toBe(t.total.initialCredit);
  });

  it('Account Receivable and Account Payable equal the Partner Ledger', () => {
    const p = partnerLedger(data as never, { from: FROM, to: TO });
    const sum = (t: string) => p.partners.filter(x => x.partyType === t).reduce((s, x) => s + x.balance, 0);
    expect(end(ACC.ar.code)).toBe(sum('patient'));
    expect(end(ACC.ap.code)).toBe(sum('supplier'));
  });

  it('the Partner Ledger shows Debit, Credit and a running Balance from the Initial Balance', () => {
    const r = partnerLedger(data as never, { from: FROM, to: TO, partyType: 'supplier', partyId: 's1' });
    const s = r.partners[0];
    expect(s.name).toBe('Ahmed Traders');
    expect(s.initial).toBe(-7000);
    expect(s.balance).toBe(-7000 - 10000 + 5000 + 1000);
    expect(s.lines.map(l => l.journal)).toEqual(['BILL', 'CSH1', 'RBILL']);
    expect(s.lines[s.lines.length - 1].balance).toBe(s.balance);
  });

  it('a bill paid in full at the counter shows as invoice and payment and nets to zero', () => {
    const r = partnerLedger({ ledger: [], invoices: [inv({})], refunds: [], patients: [{ id: 'p1', name: 'Ali' }] }, { from: FROM, to: TO });
    expect(r.partners[0].lines.map(l => [l.journal, l.debit, l.credit])).toEqual([['INV', 10000, 0], ['CSH1', 0, 10000]]);
    expect(r.partners[0].balance).toBe(0);
    expect(r.partners[0].lines[0].matching).toBe(r.partners[0].lines[1].matching);
  });

  it('the Cash account equals the cash book', () => {
    const book = moneyBook(data as never, 'cash', FROM, TO, 12300);
    expect(end(ACC.cash.code)).toBe(book.closing);
  });

  it('General Ledger balances carry on from the Initial Balance', () => {
    const g = generalLedger(items, FROM, TO);
    const ap = g.accounts.find(a => a.account.code === ACC.ap.code)!;
    expect(ap.initial).toBe(-7000);
    expect(ap.lines[ap.lines.length - 1].balance).toBe(ap.balance);
    expect(g.balance).toBe(0);
  });

  it('half paid purchase: Money out shows what was paid, what is left stays owed', () => {
    const s = summarize({ ...data, invoiceItems: [] } as never, FROM, TO);
    expect(s.totals.supplierPaid).toBe(5000);
    expect(s.totals.cashOut).toBeGreaterThanOrEqual(5000);
    expect(agedBalances(data as never, 'supplier', D).total).toBe(7000 + 10000 - 5000 - 1000);
    expect(billMatches(data.ledger).get('PO1')!.residual).toBe(4000);
  });
});

describe('Bill Reference', () => {
  const data = month();
  data.purchases[0].vendorRef = 'VND-7788';
  it('shows in the Partner Ledger on the bill, its payment and its return', () => {
    const r = partnerLedger(data as never, { from: FROM, to: TO, partyType: 'supplier', partyId: 's1' });
    const refs = r.partners[0].lines.map(l => l.ref);
    expect(refs).toEqual(['PO1 - VND-7788', 'Payment PO1 - VND-7788', 'PRET-1 (PO1 - VND-7788)']);
  });
  it('shows in the General Ledger', () => {
    const lines = generalLedger(journalItems(data), FROM, TO).accounts.find(a => a.account.code === ACC.ap.code)!.lines;
    expect(lines.map(l => l.label)).toContain('PO1 - VND-7788');
  });
  it('shows in the statement and cash book', () => {
    const rows = statement(data as never, { from: FROM, to: TO, partyType: 'supplier', partyId: 's1' }).rows;
    expect(rows.find(e => e.kind === 'purchase')!.vendorRef).toBe('VND-7788');
    expect(rows.find(e => e.kind === 'payment')!.vendorRef).toBe('VND-7788');
  });
});

describe('The server accepts only honest payments inside sales and receipts', () => {
  let shop: Shop;
  beforeEach(async () => { shop = await startShop(); });
  afterEach(async () => { await stop(shop); });
  const op = (rows: Op['rows'], kind: Op['kind'] = 'sale'): Op => ({ id: Math.random().toString(36).slice(2), kind, strict: true, deviceId: 'd', userId: shop.owner.id, createdAt: new Date().toISOString(), rows, deltas: [] });
  const base = { id: 'n1', number: 'N1', patientId: 'p', payMethod: 'credit', total: 1000, status: 'credit', hlc: 'a' };
  const pay = (over: object) => ({ tbl: 'ledger' as const, row: { id: 'pay', partyType: 'patient', partyId: 'p', date: D, debit: 0, credit: 400, ref: 'PAYMENT', matchDoc: 'N1', hlc: 'a', ...over } as never });

  it('takes a part payment against its own bill', () => {
    const r = applyOp(shop.db, op([{ tbl: 'invoices', row: base as never }, { tbl: 'ledger', row: { id: 'c', partyType: 'patient', partyId: 'p', date: D, debit: 1000, credit: 0, ref: 'N1', hlc: 'a' } as never }, pay({})]));
    expect(r.ok, r.message).toBe(true);
    expect(getRow(shop.db, 'ledger', 'pay')).toBeTruthy();
  });

  it('refuses a payment that wipes out the bill or settles another document', () => {
    for (const bad of [{ credit: 1000 }, { matchDoc: 'OTHER' }, { ref: 'OPENING' }]) {
      const r = applyOp(shop.db, op([{ tbl: 'invoices', row: base as never }, pay(bad)]));
      expect(r.ok).toBe(false);
      expect(r.code).toBe('FORBIDDEN');
    }
    expect(allRows(shop.db, 'ledger').length).toBe(0);
  });

  it('refuses a receipt that pays more than the bill or another bill', () => {
    const po = { tbl: 'purchases' as const, row: { id: 'po1', number: 'PO9', supplierId: 's', date: D, status: 'received', total: 1000, paid: 0, hlc: 'a' } as never };
    for (const bad of [{ debit: 1001, matchDoc: 'PO9' }, { debit: 10, matchDoc: 'PO8' }]) {
      const r = applyOp(shop.db, op([po, { tbl: 'ledger', row: { id: 'x', partyType: 'supplier', partyId: 's', date: D, credit: 0, ref: 'PAYMENT', hlc: 'a', ...bad } as never }], 'stock'));
      expect(r.code).toBe('FORBIDDEN');
    }
  });
});

describe('Pictures and older databases', () => {
  it('a page of changes stops at about 8 MB and says there is more', () => {
    const db = openDb(':memory:');
    const big = 'x'.repeat(3_000_000);
    for (let i = 0; i < 5; i++) db.prepare(`INSERT INTO attachments(id, data, hlc, rev) VALUES (?, ?, 'a', ?)`).run(`a${i}`, JSON.stringify({ id: `a${i}`, docId: 'd', data: big }), i + 1);
    const first = pullChanges(db, 0);
    expect(first.changes.length).toBe(2);
    expect(first.more).toBe(true);
    const second = pullChanges(db, first.rev);
    expect(second.changes[0].id).toBe('a2');
  });

  it('a shop database made before this version gets the new columns and keeps its data', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pd-')), 'old.db');
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE purchase_items (id TEXT PRIMARY KEY, data TEXT NOT NULL, hlc TEXT NOT NULL DEFAULT '', rev INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, purchase_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.purchaseId')) VIRTUAL)`);
    old.prepare(`INSERT INTO purchase_items(id, data, rev) VALUES ('k', '{"id":"k","medicineId":"m9"}', 1)`).run();
    old.close();
    const db = openDb(file);
    expect(allRows(db, 'purchaseItems', 'WHERE medicine_id = ?', 'm9').length).toBe(1);
    db.close();
  });
});
