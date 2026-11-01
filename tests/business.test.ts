// Accounts, returns, automatic purchase orders, messages and FBR — end to end against a real shop server.
import { describe, it, expect, afterEach } from 'vitest';
import { startShop, stop, newDevice, serverStock, type Shop } from './helpers.ts';
import { login } from '../client/core/auth.ts';
import { saveRecord, saveMedicine, savePurchase, receivePurchase, setPurchaseStatus, saveExpense, stockOf } from '../client/core/inventory.ts';
import { newCart, addToCart, checkout, refundItems } from '../client/core/pos.ts';
import { summarize } from '../shared/accounting.ts';
import { planReorders } from '../shared/purchase-flow.ts';
import { runReorder, queuePurchaseOrder, queueReceipt } from '../server/automation.ts';
import { processQueue, enqueueMessage, saveConfig, getConfig, normPhone, recentMessages } from '../server/notify.ts';
import { saveFbr, reportInvoice, fbrPayload, getFbr } from '../server/fbr.ts';
import { allRows, getRow } from '../server/db.ts';
import { formatBillNumber } from '../shared/region.ts';
import { addDays, isoDate } from '../shared/util.ts';
import type { Supplier, Patient, Purchase, Invoice, InvoiceItem } from '../shared/types.ts';

const shops: Shop[] = [];
afterEach(async () => { while (shops.length) await stop(shops.pop()!); });
async function owner() {
  const S = await startShop(); shops.push(S);
  const d = await newDevice(S);
  await login(d.ctx, 'owner', '111111', d.client);
  return { S, ...d };
}
async function stocked() {
  const o = await owner();
  const sup = await saveRecord<Supplier>(o.ctx, 'suppliers', { name: 'Muller', phone: '03001112222', email: 'orders@muller.test' });
  const med = await saveMedicine(o.ctx, { name: 'Panadol', generic: 'Paracetamol', salePrice: 0, gstBp: 1700, reorderLevel: 5 });
  const po = await savePurchase(o.ctx, { supplierId: sup.id, date: isoDate(), status: 'sent' }, [{ medicineId: med.id, qty: 10, freeQty: 0, costPrice: 8000, salePrice: 12000, batchNo: 'B1', mfgDate: null, expiryDate: addDays(isoDate(), 300) }]);
  await receivePurchase(o.ctx, po.id);
  await o.sync.syncNow();
  return { ...o, sup, med };
}

describe('Accounts', () => {
  it('sale, partial return and expense give the right profit, tax and status', async () => {
    const { ctx, client, sync, S, med } = await stocked();
    const cart = newCart(true);
    await addToCart(ctx, cart, (await ctx.db.medicines.get(med.id))!, 4);
    expect(cart.lines[0].unitPrice).toBe(12000);                 // price from the purchase, never 0
    const { invoice } = await checkout(ctx, cart, { method: 'cash', paid: 48000 }, client);
    const item = (await ctx.db.invoiceItems.where('invoiceId').equals(invoice.id).toArray())[0];
    await expect(refundItems(ctx, invoice.id, [{ itemId: item.id, qty: 5 }], 'x')).rejects.toThrow(/at most 4/);
    const rf = await refundItems(ctx, invoice.id, [{ itemId: item.id, qty: 1 }], 'Not needed');
    expect(rf.total).toBe(12000);
    expect((await ctx.db.invoices.get(invoice.id))!.status).toBe('partial_refund');
    expect(await stockOf(ctx, med.id)).toBe(7);
    await saveExpense(ctx, { date: isoDate(), category: 'Rent', amount: 5000 });
    await sync.syncNow();
    expect(serverStock(S.db, med.id)).toBe(7);
    expect(getRow<Invoice>(S.db, 'invoices', invoice.id)!.status).toBe('partial_refund');

    const data = { invoices: await ctx.db.invoices.toArray(), invoiceItems: await ctx.db.invoiceItems.toArray(), refunds: await ctx.db.refunds.toArray(),
      purchases: await ctx.db.purchases.toArray(), expenses: await ctx.db.expenses.toArray(), ledger: await ctx.db.ledger.toArray() };
    const T = summarize(data, isoDate(), isoDate()).totals;
    const tax4 = item.tax, tax1 = Math.round(tax4 / 4);
    expect(T.sales).toBe(48000);
    expect(T.refunds).toBe(12000);
    expect(T.netSales).toBe(36000);
    expect(T.tax).toBe(tax4 - tax1);
    expect(T.cogs).toBe(3 * 8000);
    expect(T.grossProfit).toBe(36000 - (tax4 - tax1) - 24000);
    expect(T.netProfit).toBe(T.grossProfit - 5000);
    expect(T.purchases).toBe(80000);
    expect(T.cashIn).toBe(48000);
    expect(T.cashOut).toBe(12000 + 5000);
    // Same numbers from the server API
    const api = await client.request<{ totals: typeof T }>('GET', `/api/accounting/summary?from=${isoDate()}&to=${isoDate()}&group=month`);
    expect(api.totals.netProfit).toBe(T.netProfit);
    // Returning the rest makes it "refunded"; nothing more can come back
    await refundItems(ctx, invoice.id, [{ itemId: item.id, qty: 3 }], 'All back');
    expect((await ctx.db.invoices.get(invoice.id))!.status).toBe('refunded');
    await expect(refundItems(ctx, invoice.id, [{ itemId: item.id, qty: 1 }], 'x')).rejects.toThrow(/Nothing left/);
  });
});

describe('Automatic purchase orders', () => {
  it('low stock → one draft per supplier, not twice; flow to restocked updates stock and supplier bill', async () => {
    const { ctx, client, sync, S, sup, med } = await stocked();
    const cart = newCart(true);
    await addToCart(ctx, cart, (await ctx.db.medicines.get(med.id))!, 6);
    await checkout(ctx, cart, { method: 'cash', paid: 72000 }, client);
    const r1 = runReorder(S.db);
    expect(r1.drafts).toHaveLength(1);
    expect(r1.drafts[0].supplierId).toBe(sup.id);
    const items = allRows(S.db, 'purchaseItems').filter(i => (i as unknown as { purchaseId: string }).purchaseId === r1.drafts[0].id) as unknown as { qty: number; costPrice: number }[];
    expect(items[0].qty).toBe(5 * 2 - 4);
    expect(items[0].costPrice).toBe(8000);
    expect(runReorder(S.db).drafts).toHaveLength(0);              // already on order → no duplicate
    await sync.syncNow();
    const id = r1.drafts[0].id;
    await setPurchaseStatus(ctx, id, 'pending_approval');
    await setPurchaseStatus(ctx, id, 'sent');
    await expect(setPurchaseStatus(ctx, id, 'draft')).rejects.toThrow(/not possible/);
    await expect(receivePurchase(ctx, id)).rejects.toThrow(/batch/i);  // fill batch/expiry before restocking
    const its = await ctx.db.purchaseItems.where('purchaseId').equals(id).toArray();
    await savePurchase(ctx, { id, supplierId: sup.id, date: isoDate(), status: 'sent' }, its.map(i => ({ ...i, batchNo: 'B2', expiryDate: addDays(isoDate(), 400) })));
    await setPurchaseStatus(ctx, id, 'arrived');
    await receivePurchase(ctx, id);
    await sync.syncNow();
    expect(getRow<Purchase>(S.db, 'purchases', id)!.status).toBe('received');
    expect(serverStock(S.db, med.id)).toBe(4 + 6);
    expect(allRows(S.db, 'ledger').some(l => (l as unknown as { ref: string }).ref === r1.drafts[0].number)).toBe(true);
    // turning it off stops drafts
    await client.request('POST', '/api/settings/automation', { autoPo: false });
    expect(planReorders({ medicines: [], batches: [], purchases: [], purchaseItems: [] })).toEqual([]);
  });
});

describe('Email & SMS', () => {
  it('queues once, retries with back-off, never blocks, and normalises Pakistani numbers', async () => {
    const { S, sup } = await stocked();
    expect(normPhone('0300 1112222')).toBe('+923001112222');
    saveConfig(S.db, { ...getConfig(S.db, {}), email: { provider: 'resend', resendKey: 're_x' }, sms: { provider: 'textbee', textbeeKey: 'k', textbeeDevice: 'd' } });
    const po = allRows<Purchase>(S.db, 'purchases')[0];
    expect(queuePurchaseOrder(S.db, po.id)).toBe(2);
    expect(queuePurchaseOrder(S.db, po.id)).toBe(0);              // no double messages
    expect(enqueueMessage(S.db, { channel: 'email', kind: 't', to: 'not-an-email', text: 'x' })).toBe(false);
    const calls: string[] = [];
    let fail = true;
    const f = (async (url: string) => { calls.push(String(url)); return new Response(fail ? 'down' : '{}', { status: fail ? 503 : 200 }); }) as unknown as typeof fetch;
    expect(await processQueue(S.db, { fetch: f })).toEqual({ sent: 0, failed: 2 });
    expect(calls.some(u => u.includes('resend.com')) && calls.some(u => u.includes('textbee.dev'))).toBe(true);
    S.db.prepare(`UPDATE notifications SET next_at = ?`).run(new Date(0).toISOString());
    fail = false;
    expect(await processQueue(S.db, { fetch: f })).toEqual({ sent: 2, failed: 0 });
    expect((recentMessages(S.db) as { status: string }[]).every(m => m.status === 'sent')).toBe(true);
    void sup;
  });
});

describe('FBR (optional)', () => {
  it('is off by default, Pakistan only, and saves the FBR number on the bill', async () => {
    const { S, ctx, client, sync, med } = await stocked();
    expect(getFbr(S.db).enabled).toBe(false);
    expect(() => saveFbr(S.db, { enabled: true })).toThrow(/POS ID/);
    saveFbr(S.db, { enabled: true, posId: '123456', token: 'tok' });
    const cart = newCart(true);
    await addToCart(ctx, cart, (await ctx.db.medicines.get(med.id))!, 1);
    const { invoice } = await checkout(ctx, cart, { method: 'card', paid: 12000 }, client);
    let body: Record<string, unknown> = {};
    const f = (async (_u: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ InvoiceNumber: 'FBR-777', Code: '100' })); }) as unknown as typeof fetch;
    expect(await reportInvoice(S.db, invoice.id, f)).toBe('FBR-777');
    expect(body.POSID).toBe(123456);
    expect(body.PaymentMode).toBe(2);
    expect(body.TotalBillAmount).toBe(120);
    await sync.syncNow();
    expect((await ctx.db.invoices.get(invoice.id))!.fbrNumber).toBe('FBR-777');
    const inv = getRow<Invoice>(S.db, 'invoices', invoice.id)!;
    expect(fbrPayload(getFbr(S.db), inv, allRows<InvoiceItem>(S.db, 'invoiceItems', 'WHERE invoice_id = ?', inv.id)).Items).toHaveLength(1);
  });
});

describe('Bill numbers', () => {
  it('follow the owner style', () => {
    expect(formatBillNumber({ invoicePrefix: 'INV ', invoiceDigits: 0, deviceCode: false }, 1011)).toBe('INV 1011');
    expect(formatBillNumber({ invoicePrefix: '', invoiceDigits: 6, deviceCode: true }, 7, 'AB12')).toBe('AB12-000007');
  });
});

describe('Receipts to customers', () => {
  it('needs an email or mobile', async () => {
    const { S, ctx, client, sync, med } = await stocked();
    const p = await saveRecord<Patient>(ctx, 'patients', { name: 'Bilal', phone: '03001234567' });
    const cart = newCart(true); cart.patientId = p.id;
    await addToCart(ctx, cart, (await ctx.db.medicines.get(med.id))!, 1);
    const { invoice } = await checkout(ctx, cart, { method: 'cash', paid: 12000 }, client);
    await sync.syncNow();
    expect(queueReceipt(S.db, invoice.id)).toBe(1);
  });
});
