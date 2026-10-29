// "This device only" mode: one PC or phone is the whole shop — no server PC needed.
// Everything (users, permissions, stock, bills, activity log) lives on this device.
import type { Ctx } from './db.ts';
import { setMeta } from './db.ts';
import { saveUser, hasAnyUser } from './auth.ts';
import { builtinCatalog } from '../../shared/catalog.ts';
import { AppError } from '../../shared/util.ts';
import { stamp } from './db.ts';
import { logAuditRow } from './audit.ts';
import type { Shop } from '../../shared/types.ts';

export interface StandaloneSetup {
  shopName: string; name: string; username: string; pin: string;
  catalog: 'builtin' | 'own'; logo?: string | null; photo?: string | null;
}

export async function setupStandalone(ctx: Ctx, f: StandaloneSetup): Promise<number> {
  if (ctx.pairing) throw new AppError('PAIRED', 'This device is already connected to a shop server');
  if (await hasAnyUser(ctx)) throw new AppError('EXISTS', 'This device is already set up');
  if (!f.shopName.trim()) throw new AppError('INVALID', 'Pharmacy name is required');
  ctx.standalone = true;
  await setMeta(ctx.db, 'standalone', true);
  const owner = await saveUser(ctx, { name: f.name.trim(), username: f.username, photo: f.photo || null }, f.pin);
  ctx.user = owner;
  const shop: Shop = { id: 'shop', name: f.shopName.trim(), logo: f.logo || null, catalogChoice: f.catalog, hlc: stamp(ctx) };
  let added = 0;
  const db = ctx.db;
  await db.transaction('rw', [db.shop, db.medicines, db.audit], async () => {
    await db.shop.put(shop);
    if (f.catalog === 'builtin') {
      const list = builtinCatalog().map(m => ({ ...m, hlc: stamp(ctx) }));
      await db.medicines.bulkPut(list);
      added = list.length;
    }
    await logAuditRow(ctx, 'shop.setup', { details: { name: shop.name, catalog: f.catalog, medicines: added } });
  });
  ctx.user = null; // they log in normally next
  return added;
}
