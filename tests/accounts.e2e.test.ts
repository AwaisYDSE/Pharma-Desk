// Real browser: a purchase half paid, the rest paid later, its picture, a sale part paid, and the ledgers showing it all.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import type { Browser, Page } from 'playwright';
const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
import { openDb, putRow, allRows, type DB } from '../server/db.ts';
import { createApp, setupShop } from '../server/app.ts';
import { createOwner, openSessionTable } from '../server/supervision.ts';
import { serverClock } from '../server/ops.ts';
import type { LedgerEntry } from '../shared/types.ts';

const dist = path.resolve(import.meta.dirname, '..', 'dist');
const shots = process.env.PD_SHOTS || '';
let server: Server, browser: Browser, db: DB, page: Page;
const errors: string[] = [];
const shot = async (n: string) => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png'), fullPage: true }); };
// A very small real picture, as a shop would attach.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGP8z4APMOGVHbHSAJqKARNpcyTWAAAAAElFTkSuQmCC', 'base64');

beforeAll(async () => {
  if (!fs.existsSync(path.join(dist, 'app.js'))) throw new Error('Run "npm run build" first');
  db = openDb(':memory:');
  openSessionTable(db);
  const owner = createOwner(db, { name: 'Awais Amin', username: 'owner', pin: '123456' });
  setupShop(db, 'Al-Shifa Pharmacy', 'own', owner);
  putRow(db, 'suppliers', { id: 's1', name: 'Ahmed Traders' } as never, serverClock.tick());
  putRow(db, 'patients', { id: 'p1', name: 'Ali Khan' } as never, serverClock.tick());
  putRow(db, 'medicines', { id: 'm1', name: 'Panadol', generic: 'Paracetamol', salePrice: 2000, gstBp: 0, source: 'own' } as never, serverClock.tick());
  const app = createApp(db, { staticDir: dist });
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', () => r()); });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${(server.address() as AddressInfo).port}/`);
  await page.waitForSelector('input', { timeout: 20000 });
  await page.locator('input').nth(0).fill('owner');
  await page.locator('input').nth(1).fill('123456');
  await page.keyboard.press('Enter');
  await page.waitForSelector('nav, .side, aside', { timeout: 20000 });
}, 60000);
afterAll(async () => { await browser?.close(); await new Promise(r => server?.close(r)); db?.close(); });

const go = async (r: string) => { await page.evaluate(x => window.dispatchEvent(new CustomEvent('pd-nav', { detail: x })), r); await page.waitForTimeout(600); };
const tab = async (name: string) => { await page.getByRole('tab', { name, exact: true }).click(); await page.waitForTimeout(500); };
const kpi = (label: string) => page.locator('.kpi', { hasText: label }).first().locator('.num, .kpi-v').first();

describe('Money through purchases, sales and ledgers', () => {
  it('a purchase half paid in cash shows in Money out, and the rest stays due', async () => {
    await go('purchases');
    await page.getByRole('button', { name: 'New purchase' }).click();
    const modal = page.locator('.modal, [role=dialog]').last();
    await modal.locator('select').first().selectOption('s1');
    await modal.locator('label.field', { hasText: 'Bill Reference' }).locator('input').fill('VND-7788');
    await modal.locator('.line-card input').first().fill('Panadol');
    await page.waitForTimeout(300);
    await modal.locator('.line-card').first().getByText('Panadol').first().click();
    const f = modal.locator('.line-card').first().locator('.form-grid input');
    await f.nth(0).fill('10'); await f.nth(1).fill('10'); await f.nth(2).fill('20'); await f.nth(3).fill('S1');
    await modal.locator('label.field', { hasText: 'Payment' }).locator('select').selectOption('cash');
    await modal.locator('label.field', { hasText: 'Amount paid on receipt' }).locator('input').fill('50');
    const pic = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pd-')), 'bill.png'); fs.writeFileSync(pic, PNG);
    await modal.locator('input[type=file]').last().setInputFiles(pic);
    await modal.locator('img').first().waitFor({ timeout: 5000 });
    await shot('1-new-purchase');
    await modal.getByRole('button', { name: 'Save' }).click();
    await page.locator('.modal, [role=dialog]', { hasText: 'Waiting for approval' }).getByRole('button', { name: 'Receive stock' }).click();
    await page.waitForTimeout(800);
    await shot('2-purchase-received');
    expect(await page.locator('.modal, [role=dialog]').last().innerText()).toMatch(/Amount Due\s*Rs\s*50\.00/);
    expect(await page.locator('.modal, [role=dialog]').last().locator('img').count()).toBeGreaterThan(0);
  }, 60000);

  it('Register Payment settles the rest and Money out follows', async () => {
    const m = page.locator('.modal, [role=dialog]').last();
    await m.getByRole('button', { name: 'Register Payment' }).click();
    const r = page.locator('.modal, [role=dialog]').last();
    await r.getByRole('button', { name: 'Half' }).click();
    await shot('3-register-payment');
    await r.getByRole('button', { name: 'Create Payment' }).click();
    await page.waitForTimeout(800);
    expect(await page.locator('.modal, [role=dialog]').last().innerText()).toMatch(/Amount Due\s*Rs\s*25\.00/);
    await page.keyboard.press('Escape');
    await go('accounts');
    await page.waitForTimeout(800);
    await shot('4-overview');
    expect(await kpi('Money out').innerText()).toMatch(/75\.00/);
  }, 60000);

  it('a sale half paid at the counter leaves the rest on the customer', async () => {
    await go('pos');
    const s = page.locator('input').first();
    await s.fill('Panadol'); await page.waitForTimeout(300); await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.press('F4'); await page.waitForTimeout(300);
    await page.getByText('Ali Khan').first().click();
    await page.getByRole('button', { name: 'Credit', exact: true }).click();
    await page.getByRole('button', { name: 'Half' }).click();
    await shot('5-pos-part-paid');
    await page.keyboard.press('F8');
    await page.waitForTimeout(1500);
    const rows = allRows<LedgerEntry>(db, 'ledger').filter(l => l.partyType === 'patient');
    expect(rows.map(l => [l.ref === 'PAYMENT' ? 'PAYMENT' : 'BILL', l.debit, l.credit]).sort()).toEqual([['BILL', 2000, 0], ['PAYMENT', 0, 1000]]);
  }, 60000);

  it('the ledgers show it all in Odoo wording, and they balance', async () => {
    await go('accounts');
    await tab('Partner Ledger');
    for (const w of ['Journal', 'Account', 'Invoice Date', 'Due Date', 'Matching', 'Debit', 'Credit', 'Balance']) await page.getByRole('columnheader', { name: w, exact: true }).waitFor({ timeout: 5000 });
    await page.locator('.ledger-group', { hasText: 'Ahmed Traders' }).click();
    await page.locator('.ledger-group', { hasText: 'Ali Khan' }).click();
    await page.waitForTimeout(400);
    await shot('6-partner-ledger');
    const text = await page.locator('table').innerText();
    expect(text).toMatch(/VND-7788/); expect(text).toMatch(/BILL/); expect(text).toMatch(/CSH1/); expect(text).toMatch(/INV/); expect(text).toMatch(/Initial Balance/); expect(text).toMatch(/P\d/);
    await tab('General Ledger');
    await page.waitForTimeout(500);
    await shot('7-general-ledger');
    await tab('Trial Balance');
    await page.waitForTimeout(500);
    await shot('8-trial-balance');
    const total = (await page.locator('table tr').last().locator('td').allInnerTexts()).slice(1);
    expect(total[2]).toBe(total[3]); expect(total[4]).toBe(total[5]);
    await tab('Statements'); await page.waitForTimeout(500);
    expect(await page.locator('table').first().innerText()).toMatch(/VND-7788/);
    await tab('Aged Partner Balance'); await shot('9-aged');
    await tab('Balance Sheet'); await shot('10-balance-sheet');
    expect(errors).toEqual([]);
  }, 60000);

  it('owner turns on financial years, switches to an older year and back', async () => {
    putRow(db, 'expenses', { id: 'old1', date: '2024-05-05', category: 'Rent', amount: 12300, payMethod: 'cash' } as never, serverClock.tick());
    await go('settings');
    await page.getByRole('switch', { name: 'Work one financial year at a time' }).or(page.getByLabel('Work one financial year at a time')).first().click();
    await page.locator('select[aria-label="Financial year"]').waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await shot('11-year-setting');
    const y = page.locator('select[aria-label="Financial year"]');
    const labels = await y.locator('option').allInnerTexts();
    expect(labels.length).toBeGreaterThan(1);
    await y.selectOption({ index: labels.length - 1 });
    await page.getByText('You are looking at an older year', { exact: false }).first().waitFor({ timeout: 20000 });
    await y.and(page.locator(':enabled')).waitFor({ timeout: 20000 });
    await go('accounts');
    await page.waitForTimeout(800);
    await tab('General Ledger');
    await page.waitForTimeout(800);
    await shot('12-older-year');
    expect(await page.locator('.ledger-group', { hasText: '600000 Expenses' }).innerText()).toMatch(/123\.00[\s\S]*0\.00[\s\S]*123\.00/);
    expect(await page.locator('input[type=date]').first().inputValue()).toMatch(/^2023-|^2024-/);
    await y.selectOption({ index: 0 });
    await page.getByText('You are looking at an older year', { exact: false }).first().waitFor({ state: 'detached', timeout: 20000 });
    await y.and(page.locator(':enabled')).waitFor({ timeout: 20000 });
    await page.waitForTimeout(800); // the screen reopens on the year that was chosen
    await tab('Trial Balance');
    await page.waitForTimeout(800);
    await shot('13-this-year-trial');
    const total = (await page.locator('table tr').last().locator('td').allInnerTexts()).slice(1);
    expect(total[4]).toBe(total[5]);
    expect(errors).toEqual([]);
  }, 90000);
});
