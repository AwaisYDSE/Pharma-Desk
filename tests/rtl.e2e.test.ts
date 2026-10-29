// Real browser: switch the POS to Urdu → layout flips to right-to-left, the search box
// keeps keyboard focus, and F2/Enter billing still works.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import type { Browser } from 'playwright';
// Playwright is pre-installed globally on CI machines; locally run: npm i -D playwright
const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
import { openDb } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { createOwner, openSessionTable } from '../server/supervision.ts';
import { seedMedicine } from './helpers.ts';

const dist = path.resolve(import.meta.dirname, '..', 'dist');
let server: Server, browser: Browser, url = '';

beforeAll(async () => {
  if (!fs.existsSync(path.join(dist, 'app.js'))) throw new Error('Run "npm run build" first');
  const db = openDb(':memory:');
  const app = createApp(db, { staticDir: dist });
  openSessionTable(db);
  createOwner(db, { name: 'Awais', username: 'owner', pin: '123456' });
  seedMedicine(db, 'Panadol 500mg', 'Paracetamol', 270, [{ batchNo: '402', qty: 100, expiresInDays: 12 }]);
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', () => r()); });
  url = `http://localhost:${(server.address() as AddressInfo).port}/`;
  browser = await chromium.launch();
}, 30000);
afterAll(async () => { await browser?.close(); server?.close(); });

describe('Urdu / RTL switch', () => {
  it('flips the layout to RTL without breaking POS keyboard focus', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url);
    await page.fill('input[autocomplete=username]', 'owner');
    await page.fill('input[type=password]', '123456');
    await page.click('button:has-text("Log in")');
    await page.waitForSelector('#pos-search');
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('ltr');
    const sideLtr = await page.locator('nav.side').boundingBox();
    expect(sideLtr!.x).toBeLessThan(50);                      // menu on the left

    await page.locator('#pos-search').click();
    await page.selectOption('select[aria-label="Language"]', 'ur');
    await page.keyboard.press('F2');                           // shortcut still works after the switch
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ur');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('pos-search');
    const sideRtl = await page.locator('nav.side').boundingBox();
    expect(sideRtl!.x).toBeGreaterThan(1000);                  // menu moved to the right
    expect(await page.textContent('body')).toContain('فوری بلنگ'); // "POS" in Urdu
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Nastaliq');

    await page.keyboard.type('panad');
    await page.waitForSelector('.result');
    await page.keyboard.press('Enter');
    await page.waitForSelector('table.t >> text=Panadol');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('pos-search');
    await page.close();
  }, 30000);
});
