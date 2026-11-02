// Only run on request (PD_LAG=1): how a browser device copes with years of data in its own copy.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
import { openDb, putRow, tx } from '../server/db.ts';
import { createApp, setupShop } from '../server/app.ts';
import { createOwner, openSessionTable } from '../server/supervision.ts';
import { serverClock } from '../server/ops.ts';

describe.runIf(process.env.PD_LAG)('Device with years of data', () => {
  it('first sync and opening Accounts', async () => {
    const db = openDb(':memory:'); openSessionTable(db);
    const owner = createOwner(db, { name: 'A', username: 'owner', pin: '123456' }); setupShop(db, 'S', 'own', owner);
    const n = Number(process.env.PD_LAG);
    tx(db, () => { for (let i = 0; i < n; i++) {
      putRow(db, 'invoices', { id: `i${i}`, number: `I${i}`, cashierId: owner.id, createdAt: new Date(Date.now() - (i % 1000) * 864e5).toISOString(), status: 'paid', gross: 500, discount: 0, tax: 0, total: 500, paid: 500, change: 0, payMethod: 'cash', deviceId: 'd' } as never, serverClock.tick());
      putRow(db, 'invoiceItems', { id: `t${i}`, invoiceId: `i${i}`, medicineId: 'm', batchId: 'b', qty: 1, unitPrice: 500, costPrice: 400, discount: 0, taxBp: 0, tax: 0, total: 500 } as never, serverClock.tick());
    } });
    const app = createApp(db, { staticDir: path.resolve(import.meta.dirname, '..', 'dist') });
    const server = await new Promise<import('node:http').Server>(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://localhost:${(server.address() as AddressInfo).port}/`);
    await page.waitForSelector('input', { timeout: 30000 });
    const t0 = Date.now();
    await page.locator('input').nth(0).fill('owner'); await page.locator('input').nth(1).fill('123456'); await page.keyboard.press('Enter');
    await page.waitForSelector('nav, .side, aside', { timeout: 60000 });
    const count = () => page.evaluate(() => new Promise<number>(res => { const o = indexedDB.open('pharmadesk'); o.onsuccess = () => { const q = o.result.transaction('invoices').objectStore('invoices').count(); q.onsuccess = () => { o.result.close(); res(q.result); }; }; }));
    while (await count() < n) { await page.waitForTimeout(1000); if (Date.now() - t0 > 400000) break; }
    const synced = Date.now() - t0;
    const t1 = Date.now();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('pd-nav', { detail: 'accounts' })));
    await page.getByRole('heading', { name: 'Cash flow' }).waitFor({ timeout: 120000 });
    console.log(`LAG bills=${n} firstSync=${synced}ms openAccounts=${Date.now() - t1}ms`);
    expect(await count()).toBe(n);
    await browser.close(); server.close(); db.close();
  }, 500000);
});
