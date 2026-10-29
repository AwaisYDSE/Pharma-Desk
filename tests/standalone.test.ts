// "This device only" mode — the whole shop on one device, no server PC.
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openCtx } from '../client/core/db.ts';
import { setupStandalone } from '../client/core/standalone.ts';
import { login, saveUser } from '../client/core/auth.ts';
import { saveMedicine, saveRecord, savePurchase, receivePurchase, stockOf } from '../client/core/inventory.ts';
import { newCart, addToCart, checkout } from '../client/core/pos.ts';
import { exportBackup, importBackup } from '../client/core/backup.ts';
import { builtinCatalog } from '../shared/catalog.ts';
import { addDays, isoDate } from '../shared/util.ts';
import type { Supplier } from '../shared/types.ts';

let n = 0;
async function shop(catalog: 'builtin' | 'own' = 'builtin') {
  const ctx = await openCtx({ name: `standalone-${Date.now()}-${n++}` });
  const added = await setupStandalone(ctx, { shopName: 'Al-Shifa', name: 'Awais', username: 'owner', pin: '123456', catalog });
  await login(ctx, 'owner', '123456', null);
  return { ctx, added };
}

describe('This device only mode', () => {
  it('sets up the owner and loads the built-in list (or not), only once', async () => {
    const { ctx, added } = await shop('builtin');
    expect(added).toBe(builtinCatalog().length);
    expect(await ctx.db.medicines.count()).toBe(added);
    expect(ctx.user!.owner).toBe(true);
    await expect(setupStandalone(ctx, { shopName: 'X', name: 'Y', username: 'z', pin: '123456', catalog: 'builtin' })).rejects.toThrow(/already set up/);
    const own = await shop('own');
    expect(await own.ctx.db.medicines.count()).toBe(0);
  });

  it('runs the full purchase → stock → sale flow with nothing queued for a server', async () => {
    const { ctx } = await shop('own');
    const sup = await saveRecord<Supplier>(ctx, 'suppliers', { name: 'S' });
    const med = await saveMedicine(ctx, { name: 'Panadol', generic: 'Paracetamol', salePrice: 270 });
    const po = await savePurchase(ctx, { supplierId: sup.id, date: isoDate(), status: 'ordered' }, [{ medicineId: med.id, qty: 100, freeQty: 0, costPrice: 200, salePrice: null, batchNo: 'P1', mfgDate: null, expiryDate: addDays(isoDate(), 300) }]);
    await receivePurchase(ctx, po.id);
    const cart = newCart(); await addToCart(ctx, cart, med, 12);
    const r = await checkout(ctx, cart, { method: 'cash', paid: 5000 }, null);
    expect(r.invoice.total).toBe(3240);
    expect(await stockOf(ctx, med.id)).toBe(88);
    expect(await ctx.db.outbox.count()).toBe(0);
  });

  it('permissions work without a server: a cashier cannot create items', async () => {
    const { ctx } = await shop('own');
    await saveUser(ctx, { username: 'sana', name: 'Sana', role: 'cashier' }, '222222');
    await login(ctx, 'sana', '222222', null);
    await expect(saveMedicine(ctx, { name: 'X', generic: 'Y', salePrice: 1 })).rejects.toThrow(/not allowed/);
  });

  it('backup → erase → restore brings everything back; bad files are refused', async () => {
    const a = await shop('builtin');
    const blob = await exportBackup(a.ctx);
    const text = await blob.text();
    const b = await shop('own');
    expect(await b.ctx.db.medicines.count()).toBe(0);
    await importBackup(b.ctx, text);
    expect(await b.ctx.db.medicines.count()).toBe(builtinCatalog().length);
    await expect(importBackup(b.ctx, 'not json')).rejects.toThrow(/not a PharmaDesk backup/);
    await expect(importBackup(b.ctx, JSON.stringify({ format: 'pharmadesk-backup', tables: { users: [] } }))).rejects.toThrow(/owner/);
  });
});
