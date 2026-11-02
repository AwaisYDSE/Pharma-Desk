import { describe, it, expect } from 'vitest';
import { statement, moneyBook, agedBalances, businessPosition, type BooksData } from '../shared/books.ts';
import type { Invoice, Purchase, LedgerEntry, Expense, Refund, Batch } from '../shared/types.ts';

const inv = (id: string, day: string, total: number, payMethod: Invoice['payMethod'], patientId: string | null = null, status: Invoice['status'] = payMethod === 'credit' ? 'credit' : 'paid'): Invoice =>
  ({ id, number: id, patientId, cashierId: 'u', createdAt: `${day}T12:00:00`, status, gross: total, discount: 0, tax: 0, total, paid: total, change: 0, payMethod, deviceId: 'd' });
const po = (id: string, day: string, total: number): Purchase => ({ id, number: id, supplierId: 's1', date: day, status: 'received', total, paid: 0, receivedAt: `${day}T12:00:00` });
const led = (id: string, partyType: 'patient' | 'supplier', partyId: string, date: string, debit: number, credit: number, ref: string): LedgerEntry => ({ id, partyType, partyId, date, debit, credit, ref });
const exp = (id: string, date: string, amount: number, payMethod: Expense['payMethod']): Expense => ({ id, date, category: 'Rent', amount, payMethod });
const refund = (id: string, invoiceId: string, date: string, total: number, method: Refund['method']): Refund => ({ id, invoiceId, number: id, date, createdAt: `${date}T12:00:00`, userId: 'u', reason: 'x', method, items: [], total, tax: 0 });

const data: BooksData = {
  invoices: [inv('S1', '2026-01-05', 1000, 'cash'), inv('S2', '2026-01-06', 2000, 'credit', 'c1'), inv('S3', '2026-01-07', 500, 'card', 'c1'), inv('S4', '2026-01-08', 700, 'cash', null, 'void')],
  refunds: [refund('R1', 'S1', '2026-01-09', 100, 'cash')],
  purchases: [po('P1', '2026-01-02', 5000)],
  expenses: [exp('E1', '2026-01-10', 300, 'cash'), exp('E2', '2026-01-10', 200, 'bank')],
  ledger: [led('L1', 'patient', 'c1', '2026-01-06', 2000, 0, 'S2'), led('L2', 'patient', 'c1', '2026-01-11', 0, 500, 'PAYMENT'), led('L3', 'supplier', 's1', '2026-01-02', 0, 5000, 'P1'), led('L4', 'supplier', 's1', '2026-01-12', 1500, 0, 'PAYMENT')],
  batches: [{ id: 'b', medicineId: 'm', batchNo: 'B', expiryDate: '2030-01-01', qty: 10, costPrice: 50 } as Batch],
  patients: [{ id: 'c1', name: 'Ali' }], suppliers: [{ id: 's1', name: 'Getz' }],
};
const all = { from: '2026-01-01', to: '2026-01-31' };

describe('Books', () => {
  it('shows sales and purchases together and leaves void bills out', () => {
    const { rows, totals } = statement(data, all);
    expect(rows.map(r => r.doc)).toContain('P1');
    expect(rows.map(r => r.doc)).toContain('S1');
    expect(rows.map(r => r.doc)).not.toContain('S4');
    expect(totals).toMatchObject({ sales: 3500, returns: 100, purchases: 5000, received: 500, paid: 1500 });
  });
  it('filters by customer, by cash or credit, and by side', () => {
    expect(statement(data, { ...all, partyType: 'patient', partyId: 'c1' }).rows.map(r => r.id)).toEqual(['S2', 'L2', 'S3'].sort((a, b) => ({ S2: 0, L2: 2, S3: 1 } as Record<string, number>)[a] - ({ S2: 0, L2: 2, S3: 1 } as Record<string, number>)[b]));
    expect(statement(data, { ...all, method: 'credit' }).rows.map(r => r.doc).sort()).toEqual(['P1', 'S2']);
    expect(statement(data, { ...all, method: 'cash', side: 'sales' }).totals.sales).toBe(1000);
    expect(statement(data, { ...all, side: 'purchases' }).rows.every(r => r.kind === 'purchase' || r.kind === 'payment')).toBe(true);
    expect(statement(data, { ...all, partyType: 'supplier', partyId: 's1' }).totals).toMatchObject({ purchases: 5000, paid: 1500, sales: 0 });
  });
  it('cash book runs a correct balance, with an opening balance from earlier days', () => {
    const b = moneyBook(data, 'cash', all.from, all.to);
    // 1000 sale, -100 return, +500 received, -1500 supplier, -300 rent
    expect(b).toMatchObject({ opening: 0, moneyIn: 1500, moneyOut: 1900, closing: -400 });
    expect(b.rows.at(-1)!.balance).toBe(-400);
    const later = moneyBook(data, 'cash', '2026-01-10', all.to);
    expect(later.opening).toBe(900);
    expect(later.closing).toBe(-400);
    expect(moneyBook(data, 'bank', all.from, all.to)).toMatchObject({ moneyIn: 500, moneyOut: 200, closing: 300 });
  });
  it('splits what is owed by age, oldest paid first', () => {
    const a = agedBalances(data, 'patient', '2026-03-10');
    expect(a.total).toBe(1500);
    expect(a.rows[0]).toMatchObject({ name: 'Ali', d61: 1500, current: 0 });
    expect(agedBalances(data, 'supplier', '2026-01-15').rows[0]).toMatchObject({ name: 'Getz', balance: 3500, current: 3500 });
  });
  it('an advance payment shows as a negative balance', () => {
    const d: BooksData = { ...data, ledger: [led('A', 'patient', 'c2', '2026-01-01', 100, 0, 'X'), led('B', 'patient', 'c2', '2026-01-02', 0, 150, 'PAYMENT')] };
    expect(agedBalances(d, 'patient', '2026-01-03').rows[0].balance).toBe(-50);
  });
  it('business position adds up', () => {
    const p = businessPosition(data, '2026-01-31');
    expect(p).toMatchObject({ cash: -400, bank: 300, receivable: 1500, payable: 3500, stock: 500 });
    expect(p.worth).toBe(-400 + 300 + 1500 + 500 - 3500);
  });
});

describe('Payment method, returns and reports', () => {
  it('a bank payment goes to the bank book, not the cash book', () => {
    const d: BooksData = { ...data, invoices: [], refunds: [], expenses: [], purchases: [], ledger: [{ ...led('B', 'patient', 'c1', '2026-01-05', 0, 900, 'PAYMENT'), method: 'bank' }, led('C', 'patient', 'c1', '2026-01-05', 0, 100, 'PAYMENT')] };
    expect(moneyBook(d, 'bank', all.from, all.to).closing).toBe(900);
    expect(moneyBook(d, 'cash', all.from, all.to).closing).toBe(100);
  });
  it('a supplier return lowers what we owe and shows in the statement, moving no money', () => {
    const d: BooksData = { ...data, ledger: [led('P', 'supplier', 's1', '2026-01-02', 0, 5000, 'P1'), led('R', 'supplier', 's1', '2026-01-03', 800, 0, 'PRET-1')] };
    const st = statement(d, { ...all, partyType: 'supplier', partyId: 's1' });
    expect(st.totals.purchaseReturns).toBe(800);
    expect(st.rows.find(r => r.kind === 'purchase_return')).toMatchObject({ moneyIn: 0, moneyOut: 0 });
    expect(agedBalances(d, 'supplier', '2026-01-10').total).toBe(4200);
  });
  it('opening cash carries through the book and position', () => {
    expect(moneyBook(data, 'cash', all.from, all.to, 1000).opening).toBe(1000);
    expect(businessPosition(data, '2026-01-31', 1000, 0).cash).toBe(600);
  });
});
