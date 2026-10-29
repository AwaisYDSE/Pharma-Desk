import 'fake-indexeddb/auto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb, putRow, type DB } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { getIdentity } from '../server/identity.ts';
import { createOwner, saveUser, openSessionTable } from '../server/supervision.ts';
import { serverClock } from '../server/ops.ts';
import { openCtx, type Ctx } from '../client/core/db.ts';
import { ServerClient, SyncEngine, pair } from '../client/core/sync.ts';
import type { Batch, Medicine, User } from '../shared/types.ts';
import { uuid, addDays, isoDate } from '../shared/util.ts';

export interface Shop { db: DB; app: ReturnType<typeof createApp>; server: Server | null; url: string; owner: User; port: number }

export async function startShop(name = 'Shop A', opts: { aiFetch?: typeof fetch } = {}): Promise<Shop> {
  const db = openDb(':memory:');
  const app = createApp(db, { aiFetch: opts.aiFetch });
  openSessionTable(db);
  const owner = createOwner(db, { name: `${name} Owner`, username: 'owner', pin: '111111' });
  db.prepare(`UPDATE server_identity SET name = ?`).run(name);
  const shop: Shop = { db, app, server: null, url: '', owner, port: 0 };
  await listen(shop);
  return shop;
}

export function listen(shop: Shop, port = shop.port): Promise<void> {
  return new Promise(resolve => {
    shop.server = shop.app.listen(port, '127.0.0.1', () => {
      shop.port = (shop.server!.address() as AddressInfo).port;
      shop.url = `http://127.0.0.1:${shop.port}`;
      resolve();
    });
  });
}
export function stop(shop: Shop): Promise<void> {
  return new Promise(resolve => {
    if (!shop.server) return resolve();
    shop.server.closeAllConnections?.();
    shop.server.close(() => resolve());
    shop.server = null;
  });
}

export function addUser(shop: Shop, username: string, role = 'cashier', pin = '222222'): User {
  return saveUser(shop.db, shop.owner, { username, name: username, role, pin });
}

export function seedMedicine(db: DB, name: string, generic: string, salePrice: number, batches: { batchNo: string; qty: number; expiresInDays: number }[]) {
  const med: Medicine = { id: uuid(), name, generic, salePrice, gstBp: 0, reorderLevel: 5 };
  putRow(db, 'medicines', med, serverClock.tick());
  const out: Batch[] = [];
  batches.forEach((b, i) => {
    const row: Batch = {
      id: uuid(), medicineId: med.id, batchNo: b.batchNo, expiryDate: addDays(isoDate(), b.expiresInDays), qty: b.qty,
      costPrice: Math.round(salePrice * 0.8), receivedAt: new Date(Date.now() + i).toISOString(),
    };
    putRow(db, 'batches', row, serverClock.tick());
    out.push(row);
  });
  return { med, batches: out };
}

export const serverStock = (db: DB, medicineId: string) =>
  (db.prepare(`SELECT COALESCE(SUM(json_extract(data,'$.qty')),0) AS q FROM batches WHERE medicine_id = ?`).get(medicineId) as { q: number }).q;

export const serverBatchQty = (db: DB, id: string) =>
  (db.prepare(`SELECT json_extract(data,'$.qty') AS q FROM batches WHERE id = ?`).get(id) as { q: number }).q;

let n = 0;
export async function newDevice(shop: Shop, name = 'Phone') {
  const ctx: Ctx = await openCtx({ name: `test-device-${Date.now()}-${n++}` });
  const id = getIdentity(shop.db)!;
  await pair(ctx, { sid: id.serverId, name: id.name, urls: [shop.url] }, id.pin, name);
  const client = new ServerClient(ctx);
  client.timeoutMs = 1500;
  const sync = new SyncEngine(ctx, client);
  await sync.syncNow();
  return { ctx, client, sync };
}

export async function deviceStock(ctx: Ctx, medicineId: string) {
  return (await ctx.db.batches.where('medicineId').equals(medicineId).toArray()).reduce((s, b) => s + (b.qty || 0), 0);
}
