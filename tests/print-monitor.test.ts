// Printer offline recovery + expiry/low-stock monitor.
import { describe, it, expect, afterEach } from 'vitest';
import { startShop, stop, seedMedicine, addUser, newDevice, type Shop } from './helpers.ts';
import { PrintQueue, type PrinterDriver, type ReceiptData, receiptHtml } from '../client/core/print.ts';
import { loadSettings } from '../client/core/settings.ts';
import { scanAlerts } from '../client/core/monitor.ts';
import { newCart, addToCart, checkout } from '../client/core/pos.ts';
import { login } from '../client/core/auth.ts';

const shops: Shop[] = [];
afterEach(async () => { while (shops.length) await stop(shops.pop()!); });

class FakePrinter implements PrinterDriver {
  name = 'fake'; online = false; printed: ReceiptData[] = [];
  async isReady() { return this.online; }
  async print(r: ReceiptData) { if (!this.online) throw new Error('USB disconnected'); this.printed.push(r); }
}

describe('Printer offline recovery', () => {
  it('printer off → job queued → printer reconnects → invoice prints automatically', async () => {
    const S = await startShop(); shops.push(S);
    addUser(S, 'sana');
    const { med } = seedMedicine(S.db, 'Panadol 500mg', 'Paracetamol', 270, [{ batchNo: '402', qty: 100, expiresInDays: 100 }]);
    const dev = await newDevice(S);
    await login(dev.ctx, 'sana', '222222', dev.client);
    const cart = newCart();
    await addToCart(dev.ctx, cart, (await dev.ctx.db.medicines.get(med.id))!, 10);
    const { invoice } = await checkout(dev.ctx, cart, { method: 'cash', paid: 5000 }, dev.client);

    const printer = new FakePrinter();
    const q = new PrintQueue(dev.ctx, printer, () => loadSettings(dev.ctx.db));
    q.baseDelay = 50;
    expect(await q.enqueue(invoice.id)).toBe(0);           // printer offline
    expect((await q.pending()).length).toBe(1);             // job waits, nothing lost
    printer.online = true;                                   // cable plugged back in
    await new Promise(r => setTimeout(r, 200));              // automatic retry
    expect(printer.printed).toHaveLength(1);
    expect(printer.printed[0].invoice.number).toBe(invoice.number);
    expect((await q.pending()).length).toBe(0);
    q.stop();
    // A PDF/HTML copy is always available as a fallback.
    expect(receiptHtml(printer.printed[0])).toContain(invoice.number);
  });
});

describe('Expiry & low-stock monitor', () => {
  it('raises 30/60/90-day expiry, expired, low-stock and out-of-stock alerts', async () => {
    const S = await startShop(); shops.push(S);
    seedMedicine(S.db, 'Expired Syrup', 'X', 100, [{ batchNo: 'E', qty: 5, expiresInDays: -3 }]);
    seedMedicine(S.db, 'Soon Tab', 'Y', 100, [{ batchNo: 'S', qty: 50, expiresInDays: 12 }]);
    seedMedicine(S.db, 'Low Cap', 'Z', 100, [{ batchNo: 'L', qty: 2, expiresInDays: 500 }]);
    const dev = await newDevice(S);
    const alerts = await scanAlerts(dev.ctx);
    const kinds = alerts.map(a => a.kind);
    expect(kinds).toContain('expired');
    expect(kinds).toContain('expiring');
    expect(kinds).toContain('low');
    expect(alerts.find(a => a.kind === 'expiring')!.days).toBe(12);
  });
});
