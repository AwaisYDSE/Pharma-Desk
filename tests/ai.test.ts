// Gemini: rate limit / bad key / no internet → offline fallback, never a frozen POS.
import { describe, it, expect } from 'vitest';
import { openDb } from '../server/db.ts';
import { ensureIdentity } from '../server/identity.ts';
import * as ai from '../server/ai.ts';
import { getSetting } from '../server/db.ts';

const RX = 'Patient: Ali Khan 0312-1234567\nTab. Augmentin 625mg 1+0+1 x 5 days\nCap Risek 20mg OD 14d';

function shop() {
  const db = openDb(':memory:');
  ensureIdentity(db);
  ai.setGeminiKey(db, 'AIza-test-key');
  return db;
}
const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('Gemini AI service', () => {
  it('stores the key encrypted, never in plain text', () => {
    const db = shop();
    const stored = getSetting(db, 'gemini_key')!;
    expect(stored).not.toContain('AIza-test-key');
    expect(ai.hasGeminiKey(db)).toBe(true);
  });

  it('uses Gemini when it answers, and strips patient name and phone before sending', async () => {
    const db = shop();
    let sent = '';
    const f = (async (_url: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [{ name: 'Augmentin', strength: '625mg', qty: 10 }] }) }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await ai.parsePrescription(db, { text: RX }, { fetch: f });
    expect(r.source).toBe('ai');
    expect(r.items[0].name).toBe('Augmentin');
    expect(sent).not.toContain('Ali Khan');
    expect(sent).not.toContain('1234567');
  });

  it('429 rate limit → falls back to the offline prescription reader', async () => {
    const db = shop();
    const r = await ai.parsePrescription(db, { text: RX }, { fetch: respond(429, { error: { status: 'RESOURCE_EXHAUSTED' } }) });
    expect(r.source).toBe('offline');
    expect(r.note).toMatch(/limit/i);
    expect(r.items.map(i => [i.name, i.qty])).toEqual([['Augmentin', 10], ['Risek', 14]]);
    const log = db.prepare(`SELECT status, fallback FROM ai_logs`).get() as { status: string; fallback: number };
    expect(log).toEqual({ status: 'RATE_LIMIT', fallback: 1 });
  });

  it('invalid key → offline interaction dictionary still catches dangerous pairs', async () => {
    const db = shop();
    const r = await ai.checkInteractions(db, [{ name: 'Viagra', generic: 'Sildenafil' }, { name: 'Isordil', generic: 'Isosorbide dinitrate' }],
      { fetch: respond(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }) });
    expect(r.source).toBe('offline');
    expect(r.warnings[0].severity).toBe('contraindicated');
  });

  it('no internet / timeout → fast fallback (POS keeps working)', async () => {
    const db = shop();
    const hang = ((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch;
    const t0 = Date.now();
    const r = await ai.dailyInsights(db, { date: '2026-10-28', revenue: 5842000, profit: 987000, invoices: 143, vsLastWeekPct: 12, top: [{ name: 'Panadol', qty: 640 }], lowStock: [{ name: 'Risek 20mg', qty: 18, daysLeft: 4 }], expiring: [] }, 'ur', { fetch: hang, timeoutMs: 300 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.source).toBe('offline');
    expect(r.text).toContain('Rs 58,420');
    expect(r.text).toMatch(/[؀-ۿ]/); // Urdu script
  });

  it('AI interaction results never drop a known danger from the offline list', async () => {
    const db = shop();
    const f = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"warnings":[]}' }] } }] }), { status: 200 })) as unknown as typeof fetch;
    const r = await ai.checkInteractions(db, [{ name: 'Warfarin', generic: 'Warfarin' }, { name: 'Brufen', generic: 'Ibuprofen' }], { fetch: f });
    expect(r.warnings.some(w => w.severity === 'major')).toBe(true);
  });

  it('no key set → offline mode with a clear note', async () => {
    const db = openDb(':memory:'); ensureIdentity(db);
    const r = await ai.parsePrescription(db, { text: 'Syp Calpol 120ml TDS' });
    expect(r.source).toBe('offline');
    expect(r.note).toMatch(/no AI key/);
  });
});

describe('Any AI provider works with the key it is given', () => {
  const items = { items: [{ name: 'Augmentin', strength: '625mg', qty: 10 }] };
  const cases: [string, string, (b: unknown) => unknown, RegExp][] = [
    ['OpenAI', 'sk-test-openai', () => ({ choices: [{ message: { content: JSON.stringify(items) } }] }), /api\.openai\.com/],
    ['Groq (free)', 'gsk_test', () => ({ choices: [{ message: { content: '```json\n' + JSON.stringify(items) + '\n```' } }] }), /api\.groq\.com/],
    ['Anthropic', 'sk-ant-test', () => ({ content: [{ type: 'text', text: JSON.stringify(items) }] }), /api\.anthropic\.com/],
    ['OpenRouter', 'sk-or-test', () => ({ choices: [{ message: { content: JSON.stringify(items) } }] }), /openrouter\.ai/],
  ];
  for (const [name, key, body, host] of cases) {
    it(`${name}: recognised from the key, prescription read, patient details removed`, async () => {
      const db = openDb(':memory:'); ensureIdentity(db); ai.setGeminiKey(db, key);
      let url = '', sent = '';
      const f = (async (u: string, init: RequestInit) => { url = u; sent = String(init.body); return new Response(JSON.stringify(body(null)), { status: 200 }); }) as unknown as typeof fetch;
      const r = await ai.parsePrescription(db, { text: RX }, { fetch: f });
      expect(url).toMatch(host);
      expect(r.source).toBe('ai');
      expect(r.items[0].name).toBe('Augmentin');
      expect(sent).not.toContain('Ali Khan');
      expect(ai.keyProvider(db)).toBeTruthy();
    });
  }
  it('a wrong key for any provider falls back to the offline reader', async () => {
    const db = openDb(':memory:'); ensureIdentity(db); ai.setGeminiKey(db, 'sk-bad');
    const r = await ai.parsePrescription(db, { text: RX }, { fetch: respond(401, { error: { code: 'invalid_api_key' } }) });
    expect(r.source).toBe('offline');
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.note).toMatch(/AI key is not valid/);
  });
});

