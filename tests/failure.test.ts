// How the software can fail, lag or fall back, and proof of what happens. PD_REPORT prints the timings.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { startShop, stop, listen, newDevice, seedMedicine, serverStock, deviceStock, addUser, type Shop } from './helpers.ts';
import { openDb, openWithRecovery, snapshot, putRow, allRows, tx } from '../server/db.ts';
import { applyOp, pullChanges, serverClock } from '../server/ops.ts';
import { dailyStats } from '../server/app.ts';
import { getIdentity } from '../server/identity.ts';
import { summarize } from '../shared/accounting.ts';
import { statement, moneyBook } from '../shared/books.ts';
import { login } from '../client/core/auth.ts';
import { newCart, addToCart, checkout } from '../client/core/pos.ts';
import { adjustStock } from '../client/core/inventory.ts';
import { HLC, uuid, isoDate } from '../shared/util.ts';
import type { Invoice, InvoiceItem, Medicine, Op } from '../shared/types.ts';

const report: string[] = [];
const time = <T,>(name: string, fn: () => T, limit: number): T => {
  const t = performance.now(); const out = fn(); const ms = Math.round(performance.now() - t);
  report.push(`${name}: ${ms} ms (limit ${limit})`); expect(ms, name).toBeLessThan(limit); return out;
};
let S: Shop | null = null;
afterEach(async () => { if (S) await stop(S); S = null; if (report.length && process.env.PD_REPORT) fs.writeFileSync(process.env.PD_REPORT, report.join('\n') + '\n'); });

describe('Fail: internet or server goes away', () => {
  it('server dies in the middle of a day: bills continue and nothing is lost or doubled', async () => {
    S = await startShop();
    const { med } = seedMedicine(S.db, 'Brufen', 'Ibuprofen', 500, [{ batchNo: 'B1', qty: 100, expiresInDays: 200 }]);
    const d = await newDevice(S); await login(d.ctx, 'owner', '111111', d.client); await d.sync.syncNow();
    const port = S.port; await stop(S);
    const m = (await d.ctx.db.medicines.get(med.id))!;
    for (let i = 0; i < 5; i++) { const c = newCart(); await addToCart(d.ctx, c, m, 1); const r = await checkout(d.ctx, c, { method: 'cash', paid: 500 }, d.client); expect(r.offline).toBe(true); }
    expect(serverStock(S.db, med.id)).toBe(100);
    await listen(S, port); await d.sync.syncNow(); await d.sync.syncNow();
    expect(serverStock(S.db, med.id)).toBe(95);
    expect(await deviceStock(d.ctx, med.id)).toBe(95);
  });

  it('answer lost after the server saved: sending the same sale again changes nothing', async () => {
    S = await startShop();
    const c = addUser(S, 'cashier');
    const { med, batches: [b] } = seedMedicine(S.db, 'Brufen', 'Ibuprofen', 500, [{ batchNo: 'B1', qty: 10, expiresInDays: 200 }]);
    const op: Op = { id: uuid(), kind: 'sale', strict: false, deviceId: 'd', userId: c.id, createdAt: '', rows: [], deltas: [{ batchId: b.id, medicineId: med.id, delta: -1 }] };
    for (let i = 0; i < 20; i++) expect(applyOp(S.db, op).ok).toBe(true);
    expect(serverStock(S.db, med.id)).toBe(9);
  });

  it('a change that fails halfway saves nothing at all', async () => {
    S = await startShop();
    const { med, batches: [b] } = seedMedicine(S.db, 'Brufen', 'Ibuprofen', 500, [{ batchNo: 'B1', qty: 10, expiresInDays: 200 }]);
    const r = applyOp(S.db, { id: uuid(), kind: 'stock', strict: true, deviceId: 'd', userId: S.owner.id, createdAt: '', rows: [], deltas: [{ batchId: b.id, medicineId: med.id, delta: -1 }, { batchId: 'missing', medicineId: med.id, delta: -1 }] });
    expect(r.ok).toBe(false);
    expect(serverStock(S.db, med.id)).toBe(10);
  });
});

describe('Fail: wrong clocks', () => {
  it('a device a year ahead cannot stop later edits from sticking forever on the same device order', () => {
    let t = Date.now() + 365 * 864e5;
    const ahead = new HLC('a', () => t), normal = new HLC('b');
    const s1 = ahead.tick();
    normal.receive(s1);
    expect(normal.tick() > s1).toBe(true); // once it has seen the stamp, it continues after it
    t = Date.now();
    expect(ahead.tick() > s1).toBe(true);
  });
});

describe('Fail: power cut and damaged database', () => {
  it('a damaged database restores from the latest backup automatically and keeps the damaged copy', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfail-'));
    const file = path.join(dir, 'p.db'), backups = path.join(dir, 'b');
    const a = openDb(file);
    putRow(a, 'medicines', { id: 'm1', name: 'Kept', generic: '', salePrice: 1 } as Medicine, serverClock.tick());
    snapshot(a, backups); a.close();
    fs.writeFileSync(file, Buffer.alloc(8192, 7));
    const { db, restored } = openWithRecovery(file, backups, () => {});
    expect(restored).toBeTruthy();
    expect(allRows<Medicine>(db, 'medicines')[0].name).toBe('Kept');
    expect(fs.readdirSync(dir).some(f => f.includes('.corrupt-'))).toBe(true);
    db.close(); fs.rmSync(dir, { recursive: true });
  });
  it('no backup at all: starts empty instead of refusing to start, and the damaged file is kept', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfail-'));
    const file = path.join(dir, 'p.db');
    fs.writeFileSync(file, Buffer.alloc(8192, 7));
    const { db, restored } = openWithRecovery(file, path.join(dir, 'none'), () => {});
    expect(restored).toBeNull();
    expect(fs.readdirSync(dir).some(f => f.includes('.corrupt-'))).toBe(true);
    db.close(); fs.rmSync(dir, { recursive: true });
  });
});

describe('Fail: bad or huge requests', () => {
  it('rubbish never crashes the server', async () => {
    S = await startShop();
    const id = getIdentity(S.db)!;
    const auth = { authorization: `Bearer ${(await request(S.app).post('/api/pair').send({ sid: id.serverId, pin: id.pin })).body.token}` };
    expect((await request(S.app).post('/api/ops').set(auth).set('content-type', 'application/json').send('{not json')).status).toBe(400);
    expect((await request(S.app).post('/api/ops').set(auth).send({ ops: 'x' })).status).toBe(200);
    expect((await request(S.app).post('/api/ops').set(auth).send({ ops: [null, 1, 'x', {}] })).status).toBeLessThan(500);
    expect((await request(S.app).get('/api/pull?since=abc').set(auth)).status).toBeLessThan(500);
    const big = { ops: [{ id: 'x', rows: [{ tbl: 'medicines', row: { id: 'a', name: 'x'.repeat(13 * 1024 * 1024) } }], deltas: [] }] };
    expect((await request(S.app).post('/api/ops').set(auth).send(big)).status).toBe(413);
    expect((await request(S.app).get('/api/hello')).status).toBe(200); // still alive
  }, 30000);
});

describe('Fail: many people at once', () => {
  it('50 online sales at the same time for 10 units: exactly 10 succeed and stock never goes negative', async () => {
    S = await startShop();
    const id = getIdentity(S.db)!;
    const { med, batches: [b] } = seedMedicine(S.db, 'Brufen', 'Ibuprofen', 500, [{ batchNo: 'B1', qty: 10, expiresInDays: 200 }]);
    const auth = { authorization: `Bearer ${(await request(S.app).post('/api/pair').send({ sid: id.serverId, pin: id.pin })).body.token}` };
    await request(S.app).post('/api/login').set(auth).send({ username: 'owner', pin: '111111' });
    const sell = () => request(S!.app).post('/api/ops').set(auth).send({ ops: [{ id: uuid(), kind: 'sale', strict: true, userId: S!.owner.id, createdAt: '', rows: [], deltas: [{ batchId: b.id, medicineId: med.id, delta: -1 }] }] });
    const all = await Promise.all(Array.from({ length: 50 }, sell));
    expect(all.filter(r => r.body.results[0].ok).length).toBe(10);
    expect(serverStock(S.db, med.id)).toBe(0);
  }, 30000);
});

describe('Lag: a large pharmacy after years of use', () => {
  it('stays usable with 5,000 medicines and 100,000 bills', async () => {
    S = await startShop();
    const db = S.db;
    const day = (i: number) => new Date(Date.now() - (i % 1095) * 864e5).toISOString();
    tx(db, () => {
      for (let i = 0; i < 5000; i++) putRow(db, 'medicines', { id: `m${i}`, name: `Medicine ${i}`, generic: 'g', salePrice: 100 } as Medicine, serverClock.tick());
      for (let i = 0; i < 100000; i++) {
        putRow(db, 'invoices', { id: `i${i}`, number: `I${i}`, cashierId: 'u', createdAt: day(i), status: 'paid', gross: 500, discount: 0, tax: 0, total: 500, paid: 500, change: 0, payMethod: 'cash', deviceId: 'd' } as Invoice, serverClock.tick());
        putRow(db, 'invoiceItems', { id: `t${i}`, invoiceId: `i${i}`, medicineId: `m${i % 5000}`, batchId: 'b', qty: 1, unitPrice: 500, costPrice: 400, discount: 0, taxBp: 0, tax: 0, total: 500 } as InvoiceItem, serverClock.tick());
      }
    });
    const { batches: [b], med } = seedMedicine(db, 'Fast', 'x', 500, [{ batchNo: 'B', qty: 1000, expiresInDays: 300 }]);
    time('one online sale on the server', () => applyOp(db, { id: uuid(), kind: 'sale', strict: true, deviceId: 'd', userId: S!.owner.id, createdAt: '', rows: [], deltas: [{ batchId: b.id, medicineId: med.id, delta: -1 }] }), 500);
    time('one sync page of 2000 changes', () => pullChanges(db, 0, 2000), 3000);
    const invoices = allRows<Invoice>(db, 'invoices'), invoiceItems = allRows<InvoiceItem>(db, 'invoiceItems');
    const data = { invoices, invoiceItems, refunds: [], purchases: [], expenses: [], ledger: [] };
    const to = isoDate(), from = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    time('accounts for a year', () => summarize(data, from, to, 'month'), 3000);
    time('statement for a year', () => statement(data, { from, to }), 3000);
    time('cash book for a year', () => moneyBook(data, 'cash', from, to), 3000);
    time('dashboard daily summary', () => dailyStats(db), 8000);
    time('backup of the whole database', () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pdbk-')); snapshot(db, d); fs.rmSync(d, { recursive: true }); }, 15000);
  }, 240000);
});

describe('Fall back: stock changed while offline by two devices', () => {
  it('a stock count made offline merges with sales instead of overwriting them', async () => {
    S = await startShop();
    const { med, batches: [b] } = seedMedicine(S.db, 'Brufen', 'Ibuprofen', 500, [{ batchNo: 'B1', qty: 10, expiresInDays: 200 }]);
    const a = await newDevice(S, 'A'); await login(a.ctx, 'owner', '111111', a.client); await a.sync.syncNow();
    const c = await newDevice(S, 'B'); await login(c.ctx, 'owner', '111111', c.client); await c.sync.syncNow();
    const port = S.port; await stop(S);
    await adjustStock(a.ctx, b.id, -2, 'Stock count');
    const cart = newCart(); await addToCart(c.ctx, cart, (await c.ctx.db.medicines.get(med.id))!, 3); await checkout(c.ctx, cart, { method: 'cash', paid: 5000 }, c.client);
    await listen(S, port); await a.sync.syncNow(); await c.sync.syncNow(); await a.sync.syncNow();
    expect(serverStock(S.db, med.id)).toBe(5);
    expect(await deviceStock(a.ctx, med.id)).toBe(5); expect(await deviceStock(c.ctx, med.id)).toBe(5);
  }, 30000);
});
