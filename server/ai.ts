// Gemini AI service (free Google AI Studio key) with automatic offline fallback.
//  • The key lives ONLY on the shop server, AES-256-GCM encrypted. Devices never see it.
//  • Patient names / phones / CNIC are stripped before anything is sent to Google.
//  • On a 429 (free limit), bad key, timeout or no internet, every feature falls back
//    to local rules so the POS never freezes.
// © Awais Amin
import type { DB } from './db.ts';
import { getSetting, setSetting } from './db.ts';
import { encryptSecret, decryptSecret, getIdentity } from './identity.ts';
import { parsePrescriptionOffline, type RxItem } from '../shared/rxparse.ts';
import { checkInteractionsOffline, type InteractionWarning, type DrugRef } from '../shared/interactions.ts';

export const DEFAULT_MODEL = 'gemini-flash-lite-latest';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

type Fetch = typeof fetch;
export interface AIDeps { fetch?: Fetch; timeoutMs?: number }

export function setGeminiKey(db: DB, key: string | null) {
  const id = getIdentity(db)!;
  setSetting(db, 'gemini_key', key ? encryptSecret(key.trim(), id.jwtSecret) : null);
}
export function hasGeminiKey(db: DB) { return !!getSetting(db, 'gemini_key'); }
function getKey(db: DB): string | null {
  const blob = getSetting(db, 'gemini_key');
  return blob ? decryptSecret(blob, getIdentity(db)!.jwtSecret) : null;
}
/** After "reset all pairings" the JWT secret changes; re-encrypt the key with it. */
export function reencryptSecrets(db: DB, oldSecret: string, newSecret: string) {
  for (const k of ['gemini_key', 'smtp_pass']) {
    const blob = getSetting(db, k);
    if (!blob) continue;
    const plain = decryptSecret(blob, oldSecret);
    setSetting(db, k, plain ? encryptSecret(plain, newSecret) : null);
  }
}

/** Removes things that identify a patient before text leaves the shop. */
export function redact(text: string): string {
  return String(text || '')
    .replace(/\b\d{5}-?\d{7}-?\d\b/g, '[CNIC]')
    .replace(/(\+?92|0)3\d{2}[\s-]?\d{7}\b/g, '[PHONE]')
    .replace(/\+?\d[\d\s-]{8,}\d/g, '[PHONE]')
    .replace(/^[ \t]*(patient|name|pt|mr|mrs|ms|miss|address|father|husband|s\/o|d\/o|w\/o)\b.*$/gim, (_m, k: string) => `${k}: [REMOVED]`)
    .replace(/\b(?:patient|name|mr|mrs|ms|miss|master|baby)\.?\s*[:.]?\s*[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2}/gi, m => m.split(/[:.\s]/)[0] + ': [NAME]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[EMAIL]');
}

function logAI(db: DB, feature: string, status: string, ms: number, fallback: boolean, error?: string, deviceId?: string) {
  db.prepare(`INSERT INTO ai_logs(at, feature, model, status, latency_ms, fallback, error, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(new Date().toISOString(), feature, getSetting(db, 'gemini_model') || DEFAULT_MODEL, status, ms, fallback ? 1 : 0, error ?? null, deviceId ?? null);
}

export class AIError extends Error {
  kind: 'NO_KEY' | 'RATE_LIMIT' | 'BAD_KEY' | 'TIMEOUT' | 'NETWORK' | 'BAD_RESPONSE';
  constructor(kind: AIError['kind'], message: string) { super(message); this.kind = kind; }
}

/** One Gemini call returning parsed JSON. Throws AIError on any failure. */
async function gemini(db: DB, parts: unknown[], schema: unknown, deps: AIDeps = {}): Promise<unknown> {
  const key = getKey(db);
  if (!key) throw new AIError('NO_KEY', 'No Gemini key set');
  const model = getSetting(db, 'gemini_model') || DEFAULT_MODEL;
  const f = deps.fetch || fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? 15000);
  let res: Response;
  try {
    res = await f(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: schema },
      }),
      signal: ctl.signal,
    });
  } catch (e) {
    throw new AIError((e as Error).name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', (e as Error).message);
  } finally { clearTimeout(timer); }
  if (res.status === 429) throw new AIError('RATE_LIMIT', 'Free Gemini limit reached for now');
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    const body = await res.text().catch(() => '');
    if (/API_KEY|api key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(body) || res.status !== 400) throw new AIError('BAD_KEY', 'Gemini key is invalid or blocked');
    throw new AIError('BAD_RESPONSE', `Gemini rejected the request (${res.status})`);
  }
  if (!res.ok) throw new AIError('NETWORK', `Gemini error ${res.status}`);
  const json = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = json.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  try { return JSON.parse(text); } catch { throw new AIError('BAD_RESPONSE', 'Gemini returned unreadable data'); }
}

const fallbackNote = (e: unknown) => {
  const k = e instanceof AIError ? e.kind : 'NETWORK';
  return ({
    NO_KEY: 'AI is off (no Gemini key) — used the offline reader.',
    RATE_LIMIT: 'Free AI limit reached — used the offline reader. AI will work again later.',
    BAD_KEY: 'Gemini key is not valid — used the offline reader. The owner can fix it in Settings → AI.',
    TIMEOUT: 'AI took too long — used the offline reader.',
    NETWORK: 'No internet for AI — used the offline reader.',
    BAD_RESPONSE: 'AI answer was unclear — used the offline reader.',
  } as const)[k];
};

/* ---------------- 1. prescription parsing ---------------- */

export interface RxResult { items: RxItem[]; source: 'ai' | 'offline'; note?: string }

export async function parsePrescription(db: DB, input: { text?: string; imageBase64?: string; mimeType?: string }, deps: AIDeps = {}, deviceId?: string): Promise<RxResult> {
  const t0 = Date.now();
  const schema = {
    type: 'OBJECT', properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      name: { type: 'STRING' }, strength: { type: 'STRING' }, form: { type: 'STRING' }, dose: { type: 'STRING' },
      perDay: { type: 'NUMBER' }, days: { type: 'NUMBER' }, qty: { type: 'NUMBER' } }, required: ['name'] } } }, required: ['items'],
  };
  const prompt = `You read doctors' prescriptions for a pharmacy in Pakistan. Extract every medicine.
Use brand names as written (Panadol, Augmentin, Risek...). Dose patterns like "1+0+1" mean morning+noon+night.
OD=1/day, BD=2, TDS=3, QID=4. qty = tablets/capsules needed (perDay × days) or 1 for syrups/creams.
Return only medicines; ignore patient details. If a word is unreadable, give your best guess.`;
  try {
    const parts: unknown[] = [{ text: prompt }];
    if (input.text) parts.push({ text: redact(input.text) });
    if (input.imageBase64) parts.push({ inlineData: { mimeType: input.mimeType || 'image/jpeg', data: input.imageBase64 } });
    const out = await gemini(db, parts, schema, deps) as { items: RxItem[] };
    const items = (out.items || []).filter(i => i && i.name).map(i => ({ ...i, raw: i.name }));
    logAI(db, 'prescription', 'ok', Date.now() - t0, false, undefined, deviceId);
    return { items, source: 'ai' };
  } catch (e) {
    logAI(db, 'prescription', (e as AIError).kind || 'error', Date.now() - t0, true, (e as Error).message, deviceId);
    if (!input.text) return { items: [], source: 'offline', note: `${fallbackNote(e)} Photos need AI — please type the prescription.` };
    return { items: parsePrescriptionOffline(input.text), source: 'offline', note: fallbackNote(e) };
  }
}

/* ---------------- 2. drug interaction warning ---------------- */

export interface InteractionResult { warnings: InteractionWarning[]; source: 'ai' | 'offline' | 'both'; note?: string }

export async function checkInteractions(db: DB, drugs: DrugRef[], deps: AIDeps = {}, deviceId?: string): Promise<InteractionResult> {
  const offline = checkInteractionsOffline(drugs);
  if (drugs.length < 2) return { warnings: offline, source: 'offline' };
  const t0 = Date.now();
  const schema = {
    type: 'OBJECT', properties: { warnings: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      a: { type: 'STRING' }, b: { type: 'STRING' }, severity: { type: 'STRING', enum: ['contraindicated', 'major', 'moderate'] },
      effect: { type: 'STRING' }, advice: { type: 'STRING' } }, required: ['a', 'b', 'severity', 'effect', 'advice'] } } }, required: ['warnings'],
  };
  try {
    const list = drugs.map(d => `- ${d.name} (${d.generic || 'unknown generic'})`).join('\n');
    const out = await gemini(db, [{ text: `You are a clinical pharmacist. List ONLY clinically significant interactions (moderate or worse) between these medicines on one bill, including duplicate active ingredients. Keep effect and advice under 15 words each, plain English. If none, return an empty list.\n${list}` }], schema, deps) as { warnings: InteractionWarning[] };
    const ai = (out.warnings || []).map(w => ({ ...w, source: 'ai' as const }));
    // Keep every offline hit too — AI can miss things; never drop a known danger.
    const key = (w: InteractionWarning) => [w.a, w.b].map(s => s.toLowerCase()).sort().join('|');
    const aiKeys = new Set(ai.map(key));
    const merged = [...ai, ...offline.filter(w => !aiKeys.has(key(w)))];
    logAI(db, 'interactions', 'ok', Date.now() - t0, false, undefined, deviceId);
    return { warnings: merged, source: 'both', note: 'AI warnings must be confirmed by the pharmacist.' };
  } catch (e) {
    logAI(db, 'interactions', (e as AIError).kind || 'error', Date.now() - t0, true, (e as Error).message, deviceId);
    return { warnings: offline, source: 'offline', note: fallbackNote(e)?.replace('offline reader', 'basic offline check') };
  }
}

/* ---------------- 3. daily insights ---------------- */

export interface DailyStats {
  date: string; revenue: number; profit: number; invoices: number; vsLastWeekPct: number | null;
  top: { name: string; qty: number }[]; lowStock: { name: string; qty: number; daysLeft: number | null }[];
  expiring: { name: string; batchNo: string; days: number }[];
}

const LANG_NAMES: Record<string, string> = { en: 'English', ur: 'Urdu (اردو script)', ar: 'Arabic', hi: 'Hindi', es: 'Spanish' };

export function offlineSummary(s: DailyStats, lang = 'en'): string {
  const rs = (p: number) => `Rs ${Math.round(p / 100).toLocaleString('en-PK')}`;
  if (lang === 'ur') {
    const parts = [`آج کی فروخت ${rs(s.revenue)}، منافع ${rs(s.profit)}، ${s.invoices} بل۔`];
    if (s.top[0]) parts.push(`سب سے زیادہ بکنے والی: ${s.top.slice(0, 3).map(t => t.name).join('، ')}۔`);
    if (s.lowStock[0]) parts.push(`کم سٹاک: ${s.lowStock.slice(0, 3).map(l => l.name).join('، ')} — دوبارہ آرڈر کریں۔`);
    if (s.expiring.length) parts.push(`${s.expiring.length} بیچ جلد ختم ہونے والے ہیں — انہیں پہلے بیچیں۔`);
    return parts.join(' ');
  }
  const parts = [`Today's sales ${rs(s.revenue)}, profit ${rs(s.profit)}, ${s.invoices} bills${s.vsLastWeekPct != null ? ` (${s.vsLastWeekPct >= 0 ? 'up' : 'down'} ${Math.abs(s.vsLastWeekPct)}% vs last week)` : ''}.`];
  if (s.top[0]) parts.push(`Best sellers: ${s.top.slice(0, 3).map(t => t.name).join(', ')}.`);
  if (s.lowStock[0]) parts.push(`Low stock: ${s.lowStock.slice(0, 3).map(l => `${l.name}${l.daysLeft != null ? ` (~${l.daysLeft} days left)` : ''}`).join(', ')} — reorder soon.`);
  if (s.expiring.length) parts.push(`${s.expiring.length} batch(es) expire soon — sell them first.`);
  return parts.join(' ');
}

export async function dailyInsights(db: DB, stats: DailyStats, lang = 'en', deps: AIDeps = {}): Promise<{ text: string; source: 'ai' | 'offline'; note?: string }> {
  const t0 = Date.now();
  try {
    const out = await gemini(db, [{ text: `You advise a small pharmacy owner in Pakistan. Write a short daily summary (max 70 words) in ${LANG_NAMES[lang] || 'English'}: revenue, fast-moving stock, and concrete restocking advice. Money is in paisa — divide by 100 and write as "Rs". Data:\n${JSON.stringify(stats)}` }],
      { type: 'OBJECT', properties: { summary: { type: 'STRING' } }, required: ['summary'] }, deps) as { summary: string };
    logAI(db, 'insights', 'ok', Date.now() - t0, false);
    return { text: out.summary, source: 'ai' };
  } catch (e) {
    logAI(db, 'insights', (e as AIError).kind || 'error', Date.now() - t0, true, (e as Error).message);
    return { text: offlineSummary(stats, lang), source: 'offline', note: fallbackNote(e) };
  }
}

/** Settings → AI → "Test key". */
export async function testKey(db: DB, deps: AIDeps = {}): Promise<{ ok: boolean; message: string }> {
  try {
    await gemini(db, [{ text: 'Reply with {"ok":true}' }], { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } } }, deps);
    return { ok: true, message: 'Gemini key works' };
  } catch (e) {
    return { ok: false, message: fallbackNote(e)?.split(' — ')[0] || (e as Error).message };
  }
}
