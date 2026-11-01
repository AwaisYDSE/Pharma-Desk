// The vendor app in a real browser, served by the real Worker code (KV mocked):
// make a signing key → make a licence key → PharmaDesk accepts it → shop checks in →
// it shows in Shops → Pause from the app → the shop is told it is paused.
import { it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
import { verifyLicense } from '../shared/license.ts';
// @ts-expect-error plain JS worker
import worker from '../vendor/worker.js';

const kv = new Map<string, string>();
const env = { ADMIN_TOKEN: 'secret-pass-123', PUBLIC_KEY: '', SHOPS: {
  get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); },
  list: async ({ prefix }: { prefix: string }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }),
} };
let srv: http.Server, base = '';
beforeAll(async () => {
  srv = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const r: Response = await worker.fetch(new Request(base + req.url, { method: req.method, headers: req.headers as HeadersInit, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method!) ? undefined : Buffer.concat(chunks) }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => srv?.close());

it('keys and shops work end to end', async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', e => { throw e; });
  await p.goto(base + '/');
  // Sign in once; the signing key is created and kept on the dashboard server (never in the browser).
  await p.fill('#c-tok', 'wrong'); await p.click('#conn button[type=submit], #conn button:not([type])');
  await p.waitForSelector('text=Wrong admin password');
  await p.fill('#c-tok', 'secret-pass-123'); await p.click('#conn button:not([type])');
  await p.click('#t-setup'); await p.click('#b-sgcreate');
  await p.waitForFunction(() => /^[\w-]{43}$/.test(document.querySelector('#k-pub')!.textContent!.trim()));
  const pub = (await p.textContent('#k-pub'))!.trim();
  expect(await p.evaluate(() => Object.keys(localStorage).some(k => k.includes('keys')))).toBe(false);

  await p.click('#t-keys'); await p.fill('#i-shop', 'Al-Shifa Pharmacy'); await p.selectOption('#i-days', '365'); await p.click('#b-issue');
  await p.waitForFunction(() => document.querySelector('#r-key')!.textContent!.startsWith('PD1.'));
  const token = (await p.textContent('#r-key'))!.trim();
  const st = await verifyLicense(token, pub);
  expect(st.state).toBe('valid');
  await p.waitForFunction(() => document.querySelectorAll('#hist tr').length === 1);

  // A shop checks in with that key
  const ci = await fetch(base + '/checkin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ license: token, installId: 'abc-1', shop: 'Al-Shifa Pharmacy', stats: { bills7d: 5, sales7d: 120000 } }) });
  expect((await ci.json()).suspended).toBe(false);
  expect((await fetch(base + '/checkin', { method: 'POST', body: JSON.stringify({ license: token.slice(0, -4) + 'AAAA', installId: 'x' }) })).status).toBe(403);

  await p.click('#conn button:not([type])'); await p.click('#t-shops');
  await p.waitForSelector('.shop h3:has-text("Al-Shifa Pharmacy")');
  await p.click('[data-act="pause"]'); await p.fill('[data-box] input', 'Plan expired'); await p.click('[data-box] .btn.danger.solid');
  await p.waitForSelector('.pill.wait:has-text("Paused")');
  const post = async (path: string) => (await fetch(base + path, { method: 'POST', body: JSON.stringify({ license: token, installId: 'abc-1', shop: 'Al-Shifa Pharmacy' }) })).json();
  expect(await post('/ping')).toEqual({ suspended: true, revoked: false, message: 'Plan expired' });
  expect(await post('/checkin')).toEqual({ suspended: true, revoked: false, message: 'Plan expired' });
  // The dashboard shows when the shop has actually stopped
  await p.click('#conn button:not([type])'); await p.waitForSelector('.pill.bad:has-text("billing stopped")');
  // Removing from the list does NOT lift the pause
  await p.click('[data-act="forget"]'); await p.click('[data-box] .btn.danger.solid');
  expect((await post('/checkin')).suspended).toBe(true);
  await p.click('#conn button:not([type])'); await p.waitForSelector('.shop h3:has-text("Al-Shifa Pharmacy")');
  // Resume, then cancel the licence
  await p.click('[data-act="resume"]'); await p.waitForSelector('.pill.good');
  expect((await post('/ping')).suspended).toBe(false);
  await p.click('[data-act="cancel"]'); await p.click('[data-box] .btn.danger.solid');
  await p.waitForSelector('.pill:has-text("Cancelled")');
  expect(await post('/ping')).toMatchObject({ suspended: true, revoked: true });
  await p.click('[data-act="restore"]'); await p.waitForSelector('.pill.good');
  expect((await post('/ping')).revoked).toBe(false);

  // A copy of the same key on a second PC is blocked; the vendor can move the licence to it
  const copy = await (await fetch(base + '/checkin', { method: 'POST', body: JSON.stringify({ license: token, installId: 'abc-2', shop: 'Pirate' }) })).json();
  expect(copy).toMatchObject({ suspended: true });
  expect(copy.message).toMatch(/another PC/);
  await p.click('#conn button:not([type])'); await p.waitForSelector('text=Copied key — blocked');
  await p.click('[data-act="move"]');
  // Now the new PC owns the key and the old one is the blocked copy
  await p.waitForFunction(() => [...document.querySelectorAll('.shop')].some(c => c.textContent!.includes('Pirate') && !c.textContent!.includes('Copied key')));
  expect((await (await fetch(base + '/ping', { method: 'POST', body: JSON.stringify({ license: token, installId: 'abc-2' }) })).json()).suspended).toBe(false);
  expect((await (await fetch(base + '/ping', { method: 'POST', body: JSON.stringify({ license: token, installId: 'abc-1' }) })).json()).suspended).toBe(true);
  await b.close();
}, 60000);
