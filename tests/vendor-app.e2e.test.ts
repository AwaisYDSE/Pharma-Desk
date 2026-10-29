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
  await p.click('#t-setup'); await p.click('#b-gen');
  const pub = (await p.textContent('#k-pub'))!.trim();
  expect(pub).toMatch(/^[\w-]{43}$/);
  env.PUBLIC_KEY = pub;

  await p.click('#t-keys'); await p.fill('#i-shop', 'Al-Shifa Pharmacy'); await p.selectOption('#i-days', '365'); await p.click('#b-issue');
  const token = (await p.textContent('#r-key'))!.trim();
  const st = await verifyLicense(token, pub);
  expect(st.state).toBe('valid');
  expect(await p.locator('#hist tr').count()).toBe(1);

  // A shop checks in with that key
  const ci = await fetch(base + '/checkin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ license: token, installId: 'abc-1', shop: 'Al-Shifa Pharmacy', stats: { bills7d: 5, sales7d: 120000 } }) });
  expect((await ci.json()).suspended).toBe(false);
  expect((await fetch(base + '/checkin', { method: 'POST', body: JSON.stringify({ license: token.slice(0, -4) + 'AAAA', installId: 'x' }) })).status).toBe(403);

  await p.click('#t-shops'); await p.fill('#c-tok', 'wrong'); await p.click('#conn button');
  await p.waitForSelector('text=Wrong admin password');
  await p.fill('#c-tok', 'secret-pass-123'); await p.click('#conn button');
  await p.waitForSelector('.shop h3:has-text("Al-Shifa Pharmacy")');
  await p.click('[data-act="pause"]'); await p.fill('[data-box] input', 'Plan expired'); await p.click('[data-box] .btn.danger.solid');
  await p.waitForSelector('.pill.bad:has-text("Paused")');
  const again = await (await fetch(base + '/checkin', { method: 'POST', body: JSON.stringify({ license: token, installId: 'abc-1', shop: 'Al-Shifa Pharmacy' }) })).json();
  expect(again).toEqual({ suspended: true, message: 'Plan expired' });

  // Backup → restore on a fresh browser gives the same public key
  await p.click('#t-setup'); await p.click('#b-backup');
  const backup = await p.inputValue('#r-text');
  const p2 = await (await b.newContext()).newPage(); await p2.goto(base + '/'); await p2.click('#t-setup');
  await p2.fill('#r-text', backup); await p2.click('#b-restore');
  expect((await p2.textContent('#k-pub'))!.trim()).toBe(pub);
  await b.close();
}, 60000);
