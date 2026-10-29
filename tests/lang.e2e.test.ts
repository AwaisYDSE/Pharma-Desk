// Real browser: pick each language and visit every screen. Nothing of the app's own text
// may stay in English (medicine names, formulas and company names are data and stay as typed).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import type { Browser, Page } from 'playwright';
const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
import { openDb } from '../server/db.ts';
import { createApp, setupShop } from '../server/app.ts';
import { createOwner, openSessionTable } from '../server/supervision.ts';
import { builtinCatalog } from '../shared/catalog.ts';

const dist = path.resolve(import.meta.dirname, '..', 'dist');
let shopServer: Server, plainServer: Server, browser: Browser, shopUrl = '', plainUrl = '';

// Words that are data or names, not app text.
const DATA = new Set<string>();
for (const m of builtinCatalog()) for (const k of ['name', 'generic', 'manufacturer', 'strength'] as const) if (m[k]) DATA.add(String(m[k]));
const KEEP = /^(PharmaDesk|pharmadesk:…|Al-Shifa Pharmacy|My Pharmacy|Awais Amin|owner|Rs|PDF|CSV|A4|58mm|80mm|FEFO|NTN|STRN|CNIC|Gemini|Tailscale:|Cloudflare:|English|Español|AIza…|https?:\/\/\S+|awaisdpw\.co@gmail\.com|.*github\.com\/AwaisYDSE\/Pharma-Desk.*|Tab\. Augmentin .*|.*\b(INR|OCD|COPD|ORS|USB|QR|Gemini|API|AI|Chrome|Edge|Windows|PharmaDesk|aistudio\.google\.com|H\. pylori|MIT|PDF|CSV|FEFO)\b.*)$/;

async function untranslated(page: Page): Promise<string[]> {
  const found: string[] = await page.evaluate(() => {
    const out = new Set<string>();
    const skip = (el: Element | null) => { for (let e = el; e; e = e.parentElement) if (['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'svg'].includes(e.tagName)) return true; return false; };
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const v = (n.nodeValue || '').trim();
      if (/[A-Za-z]{3}/.test(v) && !skip(n.parentElement) && (n.parentElement as HTMLElement).offsetParent !== null) out.add(v);
    }
    document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(e => ['placeholder', 'title', 'aria-label'].forEach(a => { const v = e.getAttribute(a); if (v && /[A-Za-z]{3}/.test(v)) out.add(v); }));
    return [...out];
  });
  // Remove names (medicines, companies, shop, owner) from each text; whatever English is left is a miss.
  const names = [...DATA, 'Al-Shifa Pharmacy', 'My Pharmacy', 'Awais Amin', 'PharmaDesk', 'Google', 'OpenAI', 'Anthropic', 'Groq', 'API'].sort((a, b) => b.length - a.length);
  return found.filter(s => {
    if (DATA.has(s) || KEEP.test(s)) return false;
    let rest = s;
    for (const n of names) if (rest.includes(n)) rest = rest.split(n).join(' ');
    rest = rest.replace(/\bRs\b/g, ' ');
    return /[A-Za-z]{3}/.test(rest);
  });
}

beforeAll(async () => {
  if (!fs.existsSync(path.join(dist, 'app.js'))) throw new Error('Run "npm run build" first');
  const db = openDb(':memory:');
  openSessionTable(db);
  const owner = createOwner(db, { name: 'Awais Amin', username: 'owner', pin: '123456' });
  setupShop(db, 'Al-Shifa Pharmacy', 'builtin', owner);
  const app = createApp(db, { staticDir: dist });
  await new Promise<void>(r => { shopServer = app.listen(0, '127.0.0.1', () => r()); });
  shopUrl = `http://localhost:${(shopServer.address() as AddressInfo).port}/`;
  // The same app on a plain web host (like the public link) — shows the connect screen.
  const plain = express().use(express.static(dist));
  await new Promise<void>(r => { plainServer = plain.listen(0, '127.0.0.1', () => r()); });
  plainUrl = `http://127.0.0.1:${(plainServer.address() as AddressInfo).port}/`;
  browser = await chromium.launch();
}, 30000);
afterAll(async () => { await browser?.close(); shopServer?.close(); plainServer?.close(); });

describe('Language switching in a real browser', () => {
  it('connect screen: every language button really changes the words (the bug that was reported)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(plainUrl);
    await page.waitForSelector('text=Scan QR', { timeout: 15000 });
    const expectWords: Record<string, string[]> = {
      'हिन्दी': ['अपनी दुकान के सर्वर से जोड़ें', 'QR स्कैन करें', 'इस पीसी को सर्वर बनाएँ', 'विकसितकर्ता'],
      'العربية': ['اتصل بخادم صيدليتك', 'مسح رمز QR', 'استخدم هذا الحاسوب كخادم'],
      'اردو': ['اپنی دکان کے سرور سے جوڑیں', 'کیو آر سکین کریں', 'اس پی سی کو سرور بنائیں'],
      'Español': ['Conéctese al servidor de su farmacia', 'Escanear QR', 'Usar este PC como servidor'],
    };
    for (const [label, words] of Object.entries(expectWords)) {
      await page.click(`button:has-text("${label}")`);
      for (const w of words) await page.locator(`text=${w}`).first().waitFor({ state: 'visible', timeout: 5000 });
      if (label !== 'Español') expect(await untranslated(page), label).toEqual([]);
      else for (const w of ['Scan QR', 'Connect', 'Use this PC as the server', 'Developed by']) expect(await page.locator(`text="${w}"`).count(), w).toBe(0);
    }
    await page.click('button:has-text("English")');
    await page.waitForSelector('text=Scan QR');
    // Choosing a language must never submit the form (it used to show "pairing code is not valid").
    expect(await page.locator('[role=alert]').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('ltr');
    await page.close();
  }, 60000);

  it('the "Use this PC as the server" option is only offered on PCs', async () => {
    const pc = await browser.newPage();
    await pc.goto(plainUrl);
    await pc.locator('text=Use this PC as the server').first().waitFor({ state: 'visible', timeout: 15000 });
    await pc.click('text=Use this PC as the server');
    await pc.locator('a:has-text("Download for Windows")').first().waitFor({ state: 'visible', timeout: 5000 });
    await pc.close();
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', viewport: { width: 400, height: 860 } });
    const phone = await ctx.newPage();
    await phone.goto(plainUrl);
    await phone.waitForSelector('text=Scan QR', { timeout: 15000 });
    expect(await phone.locator('text=Use this PC as the server').count()).toBe(0);
    await ctx.close();
  }, 60000);

  it('every screen is fully translated in Urdu, Arabic, Hindi and Spanish', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(shopUrl);
    await page.fill('input[autocomplete=username]', 'owner');
    await page.fill('input[type=password]', '123456');
    await page.click('button:has-text("Log in")');
    await page.waitForSelector('#pos-search', { timeout: 20000 });
    const routes = ['dashboard', 'pos', 'invoices', 'inventory', 'purchases', 'suppliers', 'patients', 'alerts', 'reports', 'ai', 'users', 'settings', 'about'];
    const left: string[] = [];
    for (const lang of ['ur', 'ar', 'hi', 'es']) {
      await page.selectOption('header select', lang);
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(lang === 'ur' || lang === 'ar' ? 'rtl' : 'ltr');
      for (const r of routes) {
        await page.evaluate(r => window.dispatchEvent(new CustomEvent('pd-nav', { detail: r })), r);
        await page.waitForTimeout(500);
        for (const s of await untranslated(page)) left.push(`${lang}/${r}: ${s}`);
        if (['inventory', 'purchases', 'suppliers', 'patients', 'users'].includes(r)) {
          const btn = page.locator('main .btn.primary').first();
          if (await btn.count()) {
            await btn.click(); await page.waitForTimeout(500);
            for (const s of await untranslated(page)) left.push(`${lang}/${r}/new: ${s}`);
            await page.keyboard.press('Escape'); await page.waitForTimeout(200);
          }
        }
      }
    }
    // Spanish uses Latin letters, so only the words we know are English count there.
    const real = left.filter(x => !x.startsWith('es/') || /\b(the|and|of|to|is|with|this|your|for|in|on|bill|item)\b/i.test(x.split(': ').slice(1).join(': ')));
    expect(real).toEqual([]);
    await page.close();
  }, 180000);
});
