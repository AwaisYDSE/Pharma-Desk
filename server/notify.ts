// Email & SMS for the shop — free providers, swappable from Settings or environment variables.
//   Email: Resend (free tier, API key) · or any SMTP account (Gmail App Password, Brevo, Mailjet… free)
//   SMS:   TextBee (free — sends through the shop's own Android phone SIM) · or Twilio (trial/sandbox)
// Messages go into a queue in the database and are retried with back-off, so a message is never lost
// when the internet is down; nothing here can stop billing.
// © Awais Amin
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import { getSetting, setSetting, type DB } from './db.ts';
import { getIdentity, encryptSecret, decryptSecret } from './identity.ts';

export interface NotifyConfig {
  email: { provider: 'none' | 'resend' | 'smtp'; resendKey?: string; from?: string; smtp?: { host: string; port: number; user: string; pass: string } };
  sms: { provider: 'none' | 'textbee' | 'twilio'; textbeeKey?: string; textbeeDevice?: string; twilioSid?: string; twilioToken?: string; twilioFrom?: string };
  ownerEmail?: string; ownerPhone?: string;
  auto: { lowStock: boolean; poToSupplier: boolean; receiptToCustomer: boolean };
}

export const DEFAULT_CONFIG: NotifyConfig = {
  email: { provider: 'none' }, sms: { provider: 'none' },
  auto: { lowStock: true, poToSupplier: true, receiptToCustomer: false },
};

/** Saved config (secrets encrypted with this shop's key), with environment variables taking priority. */
export function getConfig(db: DB, env: NodeJS.ProcessEnv = process.env): NotifyConfig {
  let c: NotifyConfig = structuredClone(DEFAULT_CONFIG);
  const raw = getSetting(db, 'notify_config');
  if (raw) {
    const plain = decryptSecret(raw, getIdentity(db)!.jwtSecret);
    if (plain) try { c = { ...c, ...JSON.parse(plain) }; c.auto = { ...DEFAULT_CONFIG.auto, ...c.auto }; } catch { /* keep defaults */ }
  }
  if (env.RESEND_API_KEY) c.email = { ...c.email, provider: 'resend', resendKey: env.RESEND_API_KEY };
  if (env.SMTP_HOST) c.email = { ...c.email, provider: c.email.provider === 'resend' ? 'resend' : 'smtp', smtp: { host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), user: env.SMTP_USER || '', pass: env.SMTP_PASS || '' } };
  if (env.EMAIL_FROM) c.email.from = env.EMAIL_FROM;
  if (env.TEXTBEE_API_KEY) c.sms = { ...c.sms, provider: 'textbee', textbeeKey: env.TEXTBEE_API_KEY, textbeeDevice: env.TEXTBEE_DEVICE_ID || '' };
  if (env.TWILIO_ACCOUNT_SID && c.sms.provider === 'none') c.sms = { ...c.sms, provider: 'twilio', twilioSid: env.TWILIO_ACCOUNT_SID, twilioToken: env.TWILIO_AUTH_TOKEN || '', twilioFrom: env.TWILIO_FROM || '' };
  return c;
}

export function saveConfig(db: DB, c: NotifyConfig) {
  setSetting(db, 'notify_config', encryptSecret(JSON.stringify(c), getIdentity(db)!.jwtSecret));
}

/** What a phone may see: everything except the secrets (shown only as "set"). */
export function publicConfig(c: NotifyConfig) {
  return {
    email: { provider: c.email.provider, from: c.email.from || '', resendKeySet: !!c.email.resendKey, smtp: c.email.smtp ? { host: c.email.smtp.host, port: c.email.smtp.port, user: c.email.smtp.user, passSet: !!c.email.smtp.pass } : null },
    sms: { provider: c.sms.provider, textbeeDevice: c.sms.textbeeDevice || '', textbeeKeySet: !!c.sms.textbeeKey, twilioSid: c.sms.twilioSid || '', twilioFrom: c.sms.twilioFrom || '', twilioTokenSet: !!c.sms.twilioToken },
    ownerEmail: c.ownerEmail || '', ownerPhone: c.ownerPhone || '', auto: c.auto,
  };
}

/** Merge a settings form into the saved config. Empty secret fields keep the saved secret. */
export function mergeConfig(cur: NotifyConfig, inp: Record<string, unknown>): NotifyConfig {
  const s = (v: unknown, max = 300) => typeof v === 'string' ? v.trim().slice(0, max) : undefined;
  const e = (inp.email || {}) as Record<string, unknown>, m = (inp.sms || {}) as Record<string, unknown>, a = (inp.auto || {}) as Record<string, unknown>;
  const smtpIn = (e.smtp || {}) as Record<string, unknown>;
  const ep = ['none', 'resend', 'smtp'].includes(String(e.provider)) ? e.provider as NotifyConfig['email']['provider'] : cur.email.provider;
  const sp = ['none', 'textbee', 'twilio'].includes(String(m.provider)) ? m.provider as NotifyConfig['sms']['provider'] : cur.sms.provider;
  return {
    email: {
      provider: ep, from: s(e.from) ?? cur.email.from, resendKey: s(e.resendKey) || cur.email.resendKey,
      smtp: ep === 'smtp' || cur.email.smtp ? { host: s(smtpIn.host) ?? cur.email.smtp?.host ?? '', port: Number(smtpIn.port) || cur.email.smtp?.port || 587, user: s(smtpIn.user) ?? cur.email.smtp?.user ?? '', pass: s(smtpIn.pass) || cur.email.smtp?.pass || '' } : undefined,
    },
    sms: {
      provider: sp, textbeeKey: s(m.textbeeKey) || cur.sms.textbeeKey, textbeeDevice: s(m.textbeeDevice) ?? cur.sms.textbeeDevice,
      twilioSid: s(m.twilioSid) ?? cur.sms.twilioSid, twilioToken: s(m.twilioToken) || cur.sms.twilioToken, twilioFrom: s(m.twilioFrom) ?? cur.sms.twilioFrom,
    },
    ownerEmail: s(inp.ownerEmail) ?? cur.ownerEmail, ownerPhone: s(inp.ownerPhone) ?? cur.ownerPhone,
    auto: { lowStock: a.lowStock != null ? !!a.lowStock : cur.auto.lowStock, poToSupplier: a.poToSupplier != null ? !!a.poToSupplier : cur.auto.poToSupplier, receiptToCustomer: a.receiptToCustomer != null ? !!a.receiptToCustomer : cur.auto.receiptToCustomer },
  };
}

/* ---------------- providers ---------------- */

export interface EmailMsg { to: string; subject: string; html: string; text: string }
export interface SmsMsg { to: string; text: string }
type Fetch = typeof fetch;

/** Pakistani mobile numbers → international form (03xx… → +923xx…). Other numbers are kept. */
export function normPhone(p: string): string {
  const d = String(p || '').replace(/[^\d+]/g, '');
  if (/^03\d{9}$/.test(d)) return '+92' + d.slice(1);
  if (/^923\d{9}$/.test(d)) return '+' + d;
  if (/^00\d+$/.test(d)) return '+' + d.slice(2);
  return d;
}
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim());
export const validPhone = (p: string) => /^\+?\d{10,15}$/.test(normPhone(p));

async function failIfBad(r: Response, who: string) {
  if (r.ok) return;
  const body = (await r.text().catch(() => '')).slice(0, 200);
  throw new Error(`${who} answered ${r.status}${body ? ': ' + body : ''}`);
}

export async function sendEmail(c: NotifyConfig, m: EmailMsg, f: Fetch = fetch): Promise<void> {
  const from = c.email.from || (c.email.provider === 'resend' ? 'PharmaDesk <onboarding@resend.dev>' : c.email.smtp?.user || '');
  if (c.email.provider === 'resend') {
    if (!c.email.resendKey) throw new Error('Resend API key is missing');
    const r = await f('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: `Bearer ${c.email.resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text }), signal: AbortSignal.timeout(20_000),
    });
    return failIfBad(r, 'Resend');
  }
  if (c.email.provider === 'smtp') {
    const s = c.email.smtp;
    if (!s?.host || !s.user) throw new Error('SMTP server or user is missing');
    const t = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: { user: s.user, pass: s.pass }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 });
    await t.sendMail({ from, to: m.to, subject: m.subject, html: m.html, text: m.text });
    return;
  }
  throw new Error('Email is not set up (Settings → Email & SMS)');
}

export async function sendSms(c: NotifyConfig, m: SmsMsg, f: Fetch = fetch): Promise<void> {
  const to = normPhone(m.to);
  const text = m.text.slice(0, 600);
  if (c.sms.provider === 'textbee') {
    if (!c.sms.textbeeKey || !c.sms.textbeeDevice) throw new Error('TextBee API key or device ID is missing');
    const r = await f(`https://api.textbee.dev/api/v1/gateway/devices/${encodeURIComponent(c.sms.textbeeDevice)}/send-sms`, {
      method: 'POST', headers: { 'x-api-key': c.sms.textbeeKey, 'content-type': 'application/json' },
      body: JSON.stringify({ recipients: [to], message: text }), signal: AbortSignal.timeout(20_000),
    });
    return failIfBad(r, 'TextBee');
  }
  if (c.sms.provider === 'twilio') {
    if (!c.sms.twilioSid || !c.sms.twilioToken || !c.sms.twilioFrom) throw new Error('Twilio SID, token or from-number is missing');
    const r = await f(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.sms.twilioSid)}/Messages.json`, {
      method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(`${c.sms.twilioSid}:${c.sms.twilioToken}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: c.sms.twilioFrom, Body: text }).toString(), signal: AbortSignal.timeout(20_000),
    });
    return failIfBad(r, 'Twilio');
  }
  throw new Error('SMS is not set up (Settings → Email & SMS)');
}

/* ---------------- queue ---------------- */

export function openNotifyTable(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, channel TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT,
    recipient TEXT NOT NULL, subject TEXT, body TEXT NOT NULL, html TEXT,
    status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT, sent_at TEXT, error TEXT);
    CREATE INDEX IF NOT EXISTS notifications_status ON notifications(status, next_at);
    CREATE INDEX IF NOT EXISTS notifications_ref ON notifications(kind, ref);`);
}

export interface QueueItem { channel: 'email' | 'sms'; kind: string; ref?: string; to: string; subject?: string; text: string; html?: string }

/** Add a message. Same kind + ref + recipient is queued once only (no double messages). */
export function enqueueMessage(db: DB, m: QueueItem): boolean {
  openNotifyTable(db);
  const to = m.channel === 'sms' ? normPhone(m.to) : m.to.trim();
  if (m.channel === 'email' ? !validEmail(to) : !validPhone(to)) return false;
  if (m.ref && db.prepare(`SELECT 1 FROM notifications WHERE kind = ? AND ref = ? AND recipient = ? AND channel = ?`).get(m.kind, m.ref, to, m.channel)) return false;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO notifications(id, created_at, channel, kind, ref, recipient, subject, body, html, next_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(), now, m.channel, m.kind, m.ref ?? null, to, m.subject ?? null, m.text, m.html ?? null, now);
  return true;
}

const BACKOFF_MIN = [1, 5, 15, 60, 240];

/** Sends what is due. Called every 30 s; one bad message never blocks the others. */
export async function processQueue(db: DB, opts: { fetch?: Fetch; send?: { email?: typeof sendEmail; sms?: typeof sendSms }; limit?: number } = {}) {
  openNotifyTable(db);
  const now = new Date().toISOString();
  const due = db.prepare(`SELECT * FROM notifications WHERE status = 'queued' AND (next_at IS NULL OR next_at <= ?) ORDER BY created_at LIMIT ?`).all(now, opts.limit ?? 20) as Record<string, string | number | null>[];
  if (!due.length) return { sent: 0, failed: 0 };
  const c = getConfig(db);
  let sent = 0, failed = 0;
  for (const n of due) {
    try {
      if (n.channel === 'email') await (opts.send?.email || sendEmail)(c, { to: String(n.recipient), subject: String(n.subject || ''), html: String(n.html || ''), text: String(n.body) }, opts.fetch);
      else await (opts.send?.sms || sendSms)(c, { to: String(n.recipient), text: String(n.body) }, opts.fetch);
      db.prepare(`UPDATE notifications SET status = 'sent', sent_at = ?, attempts = attempts + 1, error = NULL WHERE id = ?`).run(new Date().toISOString(), n.id);
      sent++;
    } catch (e) {
      const tries = Number(n.attempts) + 1;
      const notSetUp = /not set up|missing/i.test((e as Error).message);
      const give = tries >= BACKOFF_MIN.length || notSetUp;
      db.prepare(`UPDATE notifications SET status = ?, attempts = ?, error = ?, next_at = ? WHERE id = ?`)
        .run(give ? 'failed' : 'queued', tries, String((e as Error).message).slice(0, 300), new Date(Date.now() + BACKOFF_MIN[Math.min(tries, BACKOFF_MIN.length - 1)] * 60_000).toISOString(), n.id);
      failed++;
    }
  }
  return { sent, failed };
}

export function recentMessages(db: DB, limit = 50) {
  openNotifyTable(db);
  return db.prepare(`SELECT id, created_at, channel, kind, recipient, subject, status, attempts, sent_at, error FROM notifications ORDER BY created_at DESC LIMIT ?`).all(limit);
}

export function retryMessage(db: DB, id: string) {
  db.prepare(`UPDATE notifications SET status = 'queued', attempts = 0, next_at = ?, error = NULL WHERE id = ? AND status = 'failed'`).run(new Date().toISOString(), id);
}
