// Real browser: a window left behind by an update must never get stuck on "Update required".
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import type { Browser, Page } from 'playwright';
const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
import { openDb, type DB } from '../server/db.ts';
import { createApp, setupShop } from '../server/app.ts';
import { createOwner, openSessionTable } from '../server/supervision.ts';
import { APP_VERSION } from '../shared/version.ts';

const dist = path.resolve(import.meta.dirname, '..', 'dist');
let server: Server, browser: Browser, db: DB, page: Page, url = '';
const release = { version: '9.9.9', mandatory: true, minVersion: '1.0.0', notes: 'test' };

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
}, 60000);
afterAll(async () => { await browser?.close(); await new Promise(r => server?.close(r)); db?.close(); });
beforeEach(async () => {
  page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' })).newPage();
  await page.route(/version\.json/, r => r.fulfill({ json: release, headers: { 'access-control-allow-origin': '*' } }));
});
afterEach(async () => { await page.context().close(); });

describe('A window left behind by an update', () => {
  it('app files are never kept without asking the server', async () => {
    const r = await fetch(`${url}app.js`);
    expect(r.headers.get('cache-control')).toMatch(/max-age=0/);
  });

  it('Update now on an up to date server reopens the window, and says what to do if that fails, with no loop', async () => {
    let loads = 0;
    page.on('load', () => { loads++; });
    await page.route(/\/local\/update/, r => r.fulfill({ status: 400, json: { code: 'UP_TO_DATE', message: 'PharmaDesk is already up to date' } }));
    await page.goto(url);
    await page.getByRole('button', { name: 'Update now' }).click({ timeout: 20000 });
    await expect.poll(() => loads, { timeout: 10000 }).toBe(2);
    await page.getByRole('button', { name: 'Update now' }).click({ timeout: 20000 });
    await page.getByText('Close PharmaDesk and open it again to finish updating').waitFor({ timeout: 10000 });
    expect(loads).toBe(2);
  }, 60000);

  it('a newer server PC moves the open window on by itself, once', async () => {
    let loads = 0;
    page.on('load', () => { loads++; });
    await page.route(/version\.json/, r => r.fulfill({ json: { version: APP_VERSION }, headers: { 'access-control-allow-origin': '*' } }));
    await page.route(/\/api\/hello/, r => r.fulfill({ json: { app: 'pharmadesk', v: '9.9.9' } }));
    await page.goto(url);
    await expect.poll(() => loads, { timeout: 10000 }).toBe(2);
    await page.waitForTimeout(3000);
    expect(loads).toBe(2);
  }, 60000);
});
