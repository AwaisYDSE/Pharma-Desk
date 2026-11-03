// One financial year at a time: balances must match the full history, and nothing is ever lost.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startShop, stop, newDevice, type Shop } from './helpers.ts';
import { putRow, allRows } from '../server/db.ts';
import { serverClock, pullChanges } from '../server/ops.ts';
import { yearCarry } from '../server/years.ts';
import { yearOf, yearsBetween } from '../shared/years.ts';
import { journalItems, trialBalance, partnerLedger, ACC } from '../shared/ledger.ts';
import { moneyBook } from '../shared/books.ts';
import { chooseYear } from '../client/core/years.ts';
import { recordPayment } from '../client/core/inventory.ts';
import { login } from '../client/core/auth.ts';
import { isoDate } from '../shared/util.ts';
import type { Invoice, LedgerEntry, Purchase, Expense } from '../shared/types.ts';

const OLD = '2024-03-15', LAST = '2025-02-10', NOW = isoDate();
const inv = (id: string, day: string, total: number, credit = false): Invoice => ({ id, number: id, patientId: credit ? 'p1' : null, cashierId: 'u', createdAt: `${day}T12:00:00`, status: credit ? 'credit' : 'paid', gross: total, discount: 0, tax: 0, total, paid: credit ? 0 : total, change: 0, payMethod: credit ? 'credit' : 'cash', deviceId: 'd' });
const led = (id: string, day: string, o: Partial<LedgerEntry>): LedgerEntry => ({ id, partyType: 'patient', partyId: 'p1', date: day, debit: 0, credit: 0, ref: id, ...o });

function seed(shop: Shop) {
  const put = (t: Parameters<typeof putRow>[1], r: object) => putRow(shop.db, t, r as never, serverClock.tick());
  put('patients', { id: 'p1', name: 'Ali' }); put('suppliers', { id: 's1', name: 'Ahmed' });
  // 2024: credit sale 500 part paid 200, a cash sale 300, a bill 1000 half paid, rent 50
  put('invoices', inv('INV-A', OLD, 50000, true)); put('ledger', led('INV-A', OLD, { debit: 50000 })); put('ledger', led('P-A', OLD, { credit: 20000, ref: 'PAYMENT', method: 'cash', matchDoc: 'INV-A' }));
  put('invoices', inv('INV-B', OLD, 30000)); put('invoiceItems', { id: 'it', invoiceId: 'INV-B', medicineId: 'm', batchId: 'b', qty: 1, unitPrice: 30000, costPrice: 10000, discount: 0, taxBp: 0, tax: 0, total: 30000 });
  put('purchases', { id: 'po1', number: 'PO1', supplierId: 's1', date: OLD, status: 'received', total: 100000, paid: 0, receivedAt: `${OLD}T09:00:00` } as Purchase);
  put('purchaseItems', { id: 'pi1', purchaseId: 'po1', medicineId: 'm', qty: 10, costPrice: 10000, batchNo: 'B', expiryDate: '2030-01-01' });
  put('ledger', led('PO1', OLD, { partyType: 'supplier', partyId: 's1', credit: 100000 })); put('ledger', led('P-B', OLD, { partyType: 'supplier', partyId: 's1', debit: 50000, ref: 'PAYMENT', method: 'cash', matchDoc: 'PO1' }));
  put('expenses', { id: 'e1', date: OLD, category: 'Rent', amount: 5000, payMethod: 'cash' } as Expense);
  // an open order from long ago, and last year's cash sale
  put('purchases', { id: 'po2', number: 'PO2', supplierId: 's1', date: OLD, status: 'sent', total: 700, paid: 0 } as Purchase);
  put('invoices', inv('INV-C', LAST, 11000));
  // this year
  put('invoices', inv('INV-D', NOW, 7000));
}

const everything = (shop: Shop) => ({ invoices: allRows<Invoice>(shop.db, 'invoices'), invoiceItems: allRows(shop.db, 'invoiceItems') as never[], refunds: [], purchases: allRows<Purchase>(shop.db, 'purchases'), expenses: allRows<Expense>(shop.db, 'expenses'), ledger: allRows<LedgerEntry>(shop.db, 'ledger'), patients: allRows(shop.db, 'patients') as never[], suppliers: allRows(shop.db, 'suppliers') as never[] });

describe('Year dates', () => {
  it('January and July years', () => {
    expect(yearOf('2026-11-03', 7)).toEqual({ from: '2026-07-01', to: '2027-06-30', label: '2026-27' });
    expect(yearOf('2026-02-03', 7).from).toBe('2025-07-01');
    expect(yearOf('2024-02-03', 3).to).toBe('2024-02-29');
    expect(yearOf('2026-11-03', 1)).toEqual({ from: '2026-01-01', to: '2026-12-31', label: '2026' });
    expect(yearsBetween('2024-03-15', '2026-11-03', 1).map(y => y.label)).toEqual(['2026', '2025', '2024']);
  });
});

describe('One financial year at a time', () => {
  let shop: Shop;
  beforeEach(async () => { shop = await startShop(); seed(shop); });
  afterEach(async () => { await stop(shop); });

  const turnOn = async (d: Awaited<ReturnType<typeof newDevice>>) => {
    putRow(shop.db, 'shop', { id: 'shop', name: 'S', years: { on: true, startMonth: 1 } } as never, serverClock.tick());
    await d.sync.syncNow(); await d.sync.syncNow();
  };

  it('off by default: the device holds every year', async () => {
    const d = await newDevice(shop);
    expect(await d.ctx.db.invoices.count()).toBe(4);
  });

  it('on: the device holds this year, open orders and everything that is not year data', async () => {
    const d = await newDevice(shop);
    await turnOn(d);
    expect((await d.ctx.db.invoices.toArray()).map(i => i.id)).toEqual(['INV-D']);
    expect((await d.ctx.db.purchases.toArray()).map(p => p.id)).toEqual(['po2']);
    expect(await d.ctx.db.patients.count()).toBe(1);
    expect(allRows(shop.db, 'invoices').length).toBe(4); // the server keeps all of it
  });

  it('this year on a device gives the same balances as the whole history', async () => {
    const d = await newDevice(shop);
    await turnOn(d);
    const from = yearOf(NOW, 1).from;
    const full = everything(shop);
    const fullItems = journalItems(full);
    const dev = { invoices: await d.ctx.db.invoices.toArray(), invoiceItems: await d.ctx.db.invoiceItems.toArray(), refunds: [], purchases: await d.ctx.db.purchases.toArray(), expenses: await d.ctx.db.expenses.toArray(), ledger: await d.ctx.db.ledger.toArray(), patients: await d.ctx.db.patients.toArray(), suppliers: await d.ctx.db.suppliers.toArray() };
    const carry = await d.ctx.db.meta.get('carry').then(m => m!.value as { accounts: { code: string; name: string; net: number }[]; money: Record<string, number> });
    const devItems = journalItems({ ...dev, carryAccounts: carry.accounts });
    const end = (items: typeof fullItems, code: string) => trialBalance(items, from, NOW).rows.filter(r => r.account.code === code).reduce((s, r) => s + r.endDebit - r.endCredit, 0);
    for (const a of [ACC.cash, ACC.ar, ACC.ap, ACC.stock]) expect([a.name, end(devItems, a.code)]).toEqual([a.name, end(fullItems, a.code)]);
    const t = trialBalance(devItems, from, NOW);
    expect(t.total.endDebit).toBe(t.total.endCredit);
    // customers and suppliers
    const bal = (data: Parameters<typeof partnerLedger>[0]) => Object.fromEntries(partnerLedger(data, { from, to: NOW }).partners.filter(p => p.balance).map(p => [p.partyId, p.balance]));
    expect(bal(dev as never)).toEqual(bal(full as never));
    expect(bal(dev as never)).toEqual({ p1: 30000, s1: -50000 });
    // cash book
    expect(moneyBook(dev as never, 'cash', from, NOW, carry.money.cash).closing).toBe(moneyBook(full as never, 'cash', from, NOW, 0).closing);
  });

  it('a payment against an old balance works and reaches the server', async () => {
    const d = await newDevice(shop);
    await turnOn(d);
    await login(d.ctx, 'owner', '111111', d.client);
    await recordPayment(d.ctx, 'patient', 'p1', 10000, 'old balance', 'cash');
    await d.sync.syncNow();
    expect(allRows<LedgerEntry>(shop.db, 'ledger').some(l => l.note === 'old balance')).toBe(true);
    const s = await d.ctx.db.ledger.where('[partyType+partyId]').equals(['patient', 'p1']).toArray();
    expect(s.reduce((n, l) => n + l.debit - l.credit, 0)).toBe(20000);
    // brought forward lines never reach the server
    expect(allRows<LedgerEntry>(shop.db, 'ledger').some(l => l.id.startsWith('carry:'))).toBe(false);
  });

  it('switching to an older year shows that year, with its own opening balances, for looking only', async () => {
    const d = await newDevice(shop);
    await turnOn(d);
    await chooseYear(d.ctx, LAST);
    await d.sync.syncNow();
    expect((await d.ctx.db.invoices.toArray()).map(i => i.id)).toEqual(['INV-C']);
    const s = await d.ctx.db.ledger.toArray();
    expect(s.find(l => l.partyId === 'p1')!.debit).toBe(30000);
    await login(d.ctx, 'owner', '111111', d.client);
    await expect(recordPayment(d.ctx, 'patient', 'p1', 100, 'x', 'cash')).rejects.toThrow(/older year/);
    expect(await d.ctx.db.outbox.where('status').equals('pending').count()).toBe(0);
    await chooseYear(d.ctx, null);
    await d.sync.syncNow();
    expect((await d.ctx.db.invoices.toArray()).map(i => i.id)).toEqual(['INV-D']);
  });

  it('a change still waiting to be sent keeps the device on its year until it has gone', async () => {
    const d = await newDevice(shop);
    await turnOn(d);
    await login(d.ctx, 'owner', '111111', d.client);
    await recordPayment(d.ctx, 'patient', 'p1', 100, 'waiting', 'cash');
    await chooseYear(d.ctx, null);
    await d.sync.pull();
    expect(await d.ctx.db.ledger.filter(l => l.note === 'waiting').count()).toBe(1);
  });

  it('a late entry in an older year updates the balance brought forward', async () => {
    const d = await newDevice(shop);
    await turnOn(d);
    const before = (await yearCarry(shop.db, yearOf(NOW, 1).from)).parties.find(p => p.partyId === 'p1')!.net;
    expect(before).toBe(30000);
    putRow(shop.db, 'ledger', led('LATE', '2025-01-05', { credit: 1000, ref: 'PAYMENT', method: 'cash' }) as never, serverClock.tick());
    await d.sync.syncNow();
    expect((await d.ctx.db.ledger.get('carry:patient:p1'))!.debit).toBe(29000);
    expect(await d.ctx.db.ledger.get('LATE')).toBeUndefined();
  });

  it('turning it off brings every year back', async () => {
    const d = await newDevice(shop);
    await turnOn(d);
    putRow(shop.db, 'shop', { id: 'shop', name: 'S', years: { on: false, startMonth: 1 } } as never, serverClock.tick());
    await d.sync.syncNow(); await d.sync.syncNow();
    expect(await d.ctx.db.invoices.count()).toBe(4);
    expect(await d.ctx.db.ledger.where('id').startsWith('carry:').count()).toBe(0);
  });

  it('a page moves on past other years even when it has nothing to carry', () => {
    const p = pullChanges(shop.db, 0, 2, { from: '2099-01-01' });
    expect(p.rev).toBeGreaterThan(0);
    expect(p.more).toBe(true);
  });
});
