// Optional email login codes, sent through the shop's own email account
// (e.g. Gmail with an App Password — free). No SMS: SMS always costs money.
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';

export interface SmtpConfig { host: string; port: number; user: string; pass: string; from?: string }

export class EmailCodes {
  codes = new Map<string, { hash: string; exp: number; tries: number }>();
  getSmtp: () => SmtpConfig | null;
  sendImpl?: (to: string, subject: string, text: string) => Promise<void>;

  constructor(getSmtp: () => SmtpConfig | null, sendImpl?: (to: string, subject: string, text: string) => Promise<void>) {
    this.getSmtp = getSmtp;
    this.sendImpl = sendImpl;
  }

  configured() { return !!this.getSmtp() || !!this.sendImpl; }

  async send(email: string, shopName: string) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    this.codes.set(email.toLowerCase(), { hash, exp: Date.now() + 10 * 60_000, tries: 0 });
    const text = `Your ${shopName} login code is ${code}\n\nIt expires in 10 minutes. If you did not ask for it, ignore this email.`;
    if (this.sendImpl) return this.sendImpl(email, `${code} is your login code`, text);
    const s = this.getSmtp();
    if (!s) throw new Error('Email is not set up on the server (Settings → Email)');
    const t = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: { user: s.user, pass: s.pass } });
    await t.sendMail({ from: s.from || s.user, to: email, subject: `${code} is your ${shopName} login code`, text });
  }

  verify(email: string, code: string): boolean {
    const k = email.toLowerCase();
    const st = this.codes.get(k);
    if (!st || st.exp < Date.now() || st.tries >= 5) { this.codes.delete(k); return false; }
    st.tries++;
    const ok = crypto.createHash('sha256').update(String(code).trim()).digest('hex') === st.hash;
    if (ok) this.codes.delete(k);
    return ok;
  }
}
