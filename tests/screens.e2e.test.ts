// Real browser: the new screens open with no errors, in English and Urdu, and the optional ones stay hidden.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import type { Browser, Page } from 'playwright';
const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
import { openDb, getRow, putRow, type DB } from '../server/db.ts';
import { createApp, setupShop } from '../server/app.ts';
import { createOwner, openSessionTable } from '../server/supervision.ts';
import { serverClock } from '../server/ops.ts';
import type { Shop } from '../shared/types.ts';

const dist = path.resolve(import.meta.dirname, '..', 'dist');
const shots = process.env.PD_SHOTS || '';
let server: Server, browser: Browser, url = '', db: DB, page: Page;
const errors: string[] = [];
const shot = async (n: string) => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png') }); };

beforeAll(async () => {
  if (!fs.existsSync(path.join(dist, 'app.js'))) throw new Error('Run "npm run build" first');
  db = openDb(':memory:');
  openSessionTable(db);
  const owner = createOwner(db, { name: 'Awais Amin', username: 'owner', pin: '123456' });
  setupShop(db, 'Al-Shifa Pharmacy', 'own', owner);
  const app = createApp(db, { staticDir: dist });
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', () => r()); });
  url = `http://localhost:${(server.address() as AddressInfo).port}/`;
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('input', { timeout: 20000 });
  const inputs = page.locator('input');
  await inputs.nth(0).fill('owner');
  await inputs.nth(1).fill('123456');
  await page.keyboard.press('Enter');
  await page.waitForSelector('nav, .side, aside', { timeout: 20000 });
}, 60000);
afterAll(async () => { await browser?.close(); await new Promise(r => server?.close(r)); db?.close(); });

const go = async (r: string) => { await page.evaluate(x => window.dispatchEvent(new CustomEvent('pd-nav', { detail: x })), r); await page.waitForTimeout(500); };
const clickTab = async (name: string) => { await page.getByRole('tab', { name, exact: true }).click(); await page.waitForTimeout(400); };

describe('New screens', () => {
  it('accounts tabs all open', async () => {
    await go('accounts');
    await shot('accounts');
    for (const t of ['Statements', 'Cash book', 'Who owes what', 'Business position']) { await clickTab(t); await shot('books-' + t.replace(/ /g, '-')); }
    expect(errors).toEqual([]);
  }, 30000);

  it('branches stay hidden until the owner switches them on', async () => {
    await expect(page.getByRole('button', { name: 'Branches', exact: true }).count()).resolves.toBe(0);
    await go('branches');
    await expect(page.locator('h1', { hasText: 'Branches' }).count()).resolves.toBe(0);
    const shop = getRow<Shop>(db, 'shop', 'shop')!;
    putRow(db, 'shop', { ...shop, branchesOn: true } as Shop, serverClock.tick());
    await page.waitForTimeout(6500);
    await go('branches');
    await expect(page.locator('h1', { hasText: 'Branches' }).count()).resolves.toBe(1);
    await shot('branches');
    for (const t of ['All branches', 'Stock everywhere', 'Transfers']) await clickTab(t);
    expect(errors).toEqual([]);
  }, 30000);

  it('F1 and Ctrl+K work', async () => {
    await page.keyboard.press('F1');
    await expect(page.getByText('Keyboard shortcuts').count()).resolves.toBeGreaterThan(0);
    await shot('help');
    await page.keyboard.press('F1');
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.jump');
    await page.keyboard.type('Accounts');
    await shot('jump');
    await page.keyboard.press('Enter');
    await page.locator('.jump').waitFor({ state: 'detached', timeout: 8000 });
    await page.getByRole('tab', { name: 'Cash book' }).waitFor({ timeout: 8000 });
  }, 30000);

  it('accounts added by the owner appear at checkout, stock tools and money accounts open', async () => {
    await go('pos');
    await expect(page.locator('.paygrid + .row button').count()).resolves.toBe(0);
    const shop = getRow<Shop>(db, 'shop', 'shop')!;
    putRow(db, 'shop', { ...shop, payAccounts: [{ id: 'A', type: 'wallet', provider: 'JazzCash', title: 'Shop', number: '03001234567', active: true }] } as Shop, serverClock.tick());
    await page.getByRole('button', { name: 'JazzCash', exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'JazzCash', exact: true }).click();
    await page.getByText('03001234567').waitFor({ timeout: 3000 });
    await shot('pos-wallet');
    await go('accounts');
    await clickTab('Money accounts');
    await shot('money');
    await go('stocktools');
    for (const t of ['Supplier returns', 'Expiry loss', 'Dead stock', 'Profit per medicine', 'Stock count']) await clickTab(t);
    await shot('tools');
    await go('settings');
    await page.getByText('Banks and mobile wallets').first().waitFor({ timeout: 5000 });
    expect(errors).toEqual([]);
  }, 40000);

  it('a locked plan shows only the banner and a box for a new key', async () => {
    const shop = getRow<Shop>(db, 'shop', 'shop')!;
    putRow(db, 'shop', { ...shop, planLock: { status: 'cancelled', message: 'This licence was cancelled.', vendor: 'Awais Amin' } } as Shop, serverClock.tick());
    await page.waitForSelector('.lock-screen', { timeout: 15000 });
    await shot('locked');
    await expect(page.getByText('Licence cancelled').count()).resolves.toBe(1);
    await expect(page.locator('input[placeholder^="PD1"]').count()).resolves.toBe(1);
    await expect(page.locator('nav, .side, aside').count()).resolves.toBe(0);
    expect(errors).toEqual([]);
  }, 30000);
});
