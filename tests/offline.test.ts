// Server PC offline → devices keep ALL data and keep billing → sync later with zero drift.
import { describe, it, expect, afterEach } from 'vitest';
import { startShop, stop, listen, seedMedicine, serverStock, addUser, newDevice, deviceStock, type Shop } from './helpers.ts';
import { newCart, addToCart, checkout } from '../client/core/pos.ts';
import { login } from '../client/core/auth.ts';
import { allRows } from '../server/db.ts';
import type { Medicine, Invoice } from '../shared/types.ts';

const shops: Shop[] = [];
afterEach(async () => { while (shops.length) await stop(shops.pop()!); });

async function sell(dev: Awaited<ReturnType<typeof newDevice>>, med: Medicine, qty: number) {
  const cart = newCart();
  await addToCart(dev.ctx, cart, med, qty);
  return checkout(dev.ctx, cart, { method: 'cash', paid: 1_000_000 }, dev.client);
}

describe('Offline-first sync', () => {
  it('device holds a full copy: everything is readable while the server PC is off', async () => {
    const S = await startShop(); shops.push(S);
    addUser(S, 'sana');
    seedMedicine(S.db, 'Panadol 500mg', 'Paracetamol', 270, [{ batchNo: '402', qty: 500, expiresInDays: 12 }]);
    seedMedicine(S.db, 'Risek 20mg', 'Omeprazole', 3100, [{ batchNo: 'R1', qty: 40, expiresInDays: 400 }]);
    const dev = await newDevice(S);
    await stop(S); // server PC switched off
    expect(await dev.ctx.db.medicines.count()).toBe(2);
    expect(await dev.ctx.db.batches.count()).toBe(2);
    expect(await dev.ctx.db.users.count()).toBe(2);
    // Login works offline (PIN checked against the synced user list).
    const u = await login(dev.ctx, 'sana', '222222', dev.client);
    expect(u.username).toBe('sana');
    expect(dev.ctx.sessionId).toBeNull();
    await expect(dev.sync.syncNow()).rejects.toThrow();
    expect(dev.ctx.online).toBe(false);
  });

  it('Offline cashier: 10 invoices with the network down → reconnect → all 10 sync, zero inventory drift', async () => {
    const S = await startShop(); shops.push(S);
    addUser(S, 'sana');
    const { med } = seedMedicine(S.db, 'Panadol 500mg', 'Paracetamol', 270, [
      { batchNo: '402', qty: 30, expiresInDays: 12 }, { batchNo: '403', qty: 100, expiresInDays: 200 },
    ]);
    const start = serverStock(S.db, med.id);
    const dev = await newDevice(S);
    const m = (await dev.ctx.db.medicines.get(med.id))!;

    await stop(S); // internet / server down during peak hours
    await login(dev.ctx, 'sana', '222222', dev.client); // logs in while the server is off
    let sold = 0;
    for (let i = 1; i <= 10; i++) {
      const r = await sell(dev, m, i);   // 1+2+…+10 = 55 tablets
      expect(r.offline).toBe(true);
      sold += i;
    }
    expect(await deviceStock(dev.ctx, med.id)).toBe(start - sold); // shown immediately on the device
    expect(await dev.ctx.db.outbox.where('status').equals('pending').count()).toBe(10);

    await listen(S); // back online on the same address
    await dev.sync.syncNow();
    expect(await dev.ctx.db.outbox.where('status').equals('pending').count()).toBe(0);
    const invoices = allRows<Invoice>(S.db, 'invoices');
    expect(invoices).toHaveLength(10);
    expect(serverStock(S.db, med.id)).toBe(start - sold);          // server: zero drift
    expect(await deviceStock(dev.ctx, med.id)).toBe(start - sold); // device: zero drift after pull
    // The offline login is in the owner's activity log, with the device name.
    const actions = (S.db.prepare(`SELECT json_extract(data,'$.action') a, json_extract(data,'$.details') d FROM audit`).all() as { a: string; d: string }[]);
    expect(actions.some(x => x.a === 'auth.login' && JSON.parse(x.d).offline === true)).toBe(true);
  });

  it('5 offline bills on each of two phones selling the same batch → reconnect → 0 stock drift on server and both phones', async () => {
    const S = await startShop(); shops.push(S);
    addUser(S, 'ali'); addUser(S, 'bilal');
    const { med } = seedMedicine(S.db, 'Flagyl 400mg', 'Metronidazole', 400, [
      { batchNo: 'F1', qty: 12, expiresInDays: 20 }, { batchNo: 'F2', qty: 50, expiresInDays: 300 },
    ]);
    const start = serverStock(S.db, med.id);
    const p1 = await newDevice(S, 'Phone 1'), p2 = await newDevice(S, 'Phone 2');
    await login(p1.ctx, 'ali', '222222', p1.client); await login(p2.ctx, 'bilal', '222222', p2.client);
    const m1 = (await p1.ctx.db.medicines.get(med.id))!, m2 = (await p2.ctx.db.medicines.get(med.id))!;
    await stop(S);
    for (let i = 0; i < 5; i++) { await sell(p1, m1, 2); await sell(p2, m2, 2); } // both drain F1 first (FEFO)
    await listen(S);
    await p1.sync.syncNow(); await p2.sync.syncNow(); await p1.sync.syncNow();
    expect(serverStock(S.db, med.id)).toBe(start - 20);
    expect(await deviceStock(p1.ctx, med.id)).toBe(start - 20);
    expect(await deviceStock(p2.ctx, med.id)).toBe(start - 20);
    const batches = allRows<{ id: string; batchNo: string; qty: number }>(S.db, 'batches').filter(b => (b as { medicineId?: string }).medicineId === med.id);
    expect(batches.find(b => b.batchNo === 'F1')!.qty).toBe(0);     // never negative
    expect(batches.find(b => b.batchNo === 'F2')!.qty).toBe(42);    // overflow moved to next-expiring batch
  });

  it('device follows the server to a new address (e.g. a new Cloudflare URL)', async () => {
    const S = await startShop(); shops.push(S);
    const dev = await newDevice(S);
    const oldUrl = S.url;
    await stop(S);
    await listen(S, 0); // new port = new address
    dev.ctx.pairing!.urls = [oldUrl, S.url];
    await dev.sync.syncNow();
    expect(dev.ctx.online).toBe(true);
  });
});
