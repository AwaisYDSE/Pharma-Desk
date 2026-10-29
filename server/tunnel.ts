// Connection manager for the shop server PC (all free):
//  1. LAN address — phones on the shop Wi-Fi connect directly (fastest, no internet needed).
//  2. Tailscale — fixed private address that works from anywhere (recommended).
//  3. Cloudflare Quick Tunnel — public https URL, no account. Its address changes on
//     every restart, so the server publishes the new address to a "beacon" that is
//     end-to-end encrypted with this shop's key; paired phones follow it automatically.
// © Awais Amin
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import crypto from 'node:crypto';
import { VENDOR } from '../shared/vendor.ts';
import QRCode from 'qrcode';

export interface Endpoints { lan: string[]; tailscale: string | null; cloudflare: string | null }

export function lanUrls(port: number): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(`http://${a.address}:${port}`);
    }
  }
  return out;
}

const run = (cmd: string, args: string[], timeout = 8000) => new Promise<string>((resolve, reject) =>
  execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => err ? reject(err) : resolve(String(stdout))));

/** Exposes the server on this PC's Tailscale name (https://<pc>.<tailnet>.ts.net). */
export async function startTailscale(port: number, log: (m: string) => void): Promise<string | null> {
  try {
    const status = JSON.parse(await run('tailscale', ['status', '--json']));
    const dns = String(status?.Self?.DNSName || '').replace(/\.$/, '');
    if (!dns || status?.BackendState !== 'Running') { log('Tailscale is installed but not logged in.'); return null; }
    await run('tailscale', ['serve', '--bg', String(port)]).catch(() => run('tailscale', ['serve', '--bg', `http://127.0.0.1:${port}`]));
    log(`Tailscale ready: https://${dns}`);
    return `https://${dns}`;
  } catch {
    log('Tailscale not found (optional). Install it free from tailscale.com for a fixed address.');
    return null;
  }
}

const CF_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/**
 * Launches `cloudflared tunnel --url http://localhost:PORT`, reads the public URL
 * from its output, and restarts it (with back-off) whenever it dies.
 */
export class CloudflareTunnel {
  port: number; bin: string; log: (m: string) => void; onUrl: (url: string | null) => void;
  proc: ChildProcess | null = null; url: string | null = null; stopped = false; failures = 0;
  spawnFn: typeof spawn;
  constructor(port: number, opts: { bin?: string; log?: (m: string) => void; onUrl?: (u: string | null) => void; spawnFn?: typeof spawn } = {}) {
    this.port = port;
    this.bin = opts.bin || process.env.CLOUDFLARED || 'cloudflared';
    this.log = opts.log || console.log;
    this.onUrl = opts.onUrl || (() => {});
    this.spawnFn = opts.spawnFn || spawn;
  }
  start() {
    if (this.stopped) return;
    let proc: ChildProcess;
    try {
      proc = this.spawnFn(this.bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${this.port}`], { windowsHide: true });
    } catch (e) { this.log(`cloudflared could not start: ${(e as Error).message}`); return; }
    this.proc = proc;
    const scan = (buf: Buffer) => {
      const m = String(buf).match(CF_URL);
      if (m && m[0] !== this.url) { this.url = m[0]; this.failures = 0; this.log(`Cloudflare tunnel: ${this.url}`); this.onUrl(this.url); }
    };
    proc.stdout?.on('data', scan);
    proc.stderr?.on('data', scan);
    proc.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') { this.log('cloudflared not found (optional). The installer can download it for you.'); this.stopped = true; }
    });
    proc.on('exit', code => {
      this.proc = null;
      if (this.url) { this.url = null; this.onUrl(null); }
      if (this.stopped) return;
      this.failures++;
      const wait = Math.min(60_000, 2000 * 2 ** Math.min(this.failures, 5));
      this.log(`Cloudflare tunnel stopped (code ${code}); restarting in ${Math.round(wait / 1000)}s`);
      setTimeout(() => this.start(), wait).unref?.();
    });
  }
  stop() { this.stopped = true; this.proc?.kill(); }
}

/* ---------------- encrypted address beacon (free, via ntfy.sh) ---------------- */

const BEACON_HOST = process.env.PHARMADESK_BEACON || 'https://ntfy.sh';
export const beaconTopic = (serverId: string) => 'pd-' + crypto.createHash('sha256').update('pharmadesk-beacon|' + serverId).digest('hex').slice(0, 32);

export function sealBeacon(payload: object, beaconKeyB64: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(beaconKeyB64, 'base64'), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(payload)), c.final(), c.getAuthTag()]);
  return Buffer.concat([iv, enc]).toString('base64');
}

export async function publishBeacon(serverId: string, beaconKey: string, endpoints: Endpoints, log: (m: string) => void, f: typeof fetch = fetch) {
  try {
    const body = sealBeacon({ v: 1, sid: serverId, at: Date.now(), tailscale: endpoints.tailscale, cloudflare: endpoints.cloudflare }, beaconKey);
    await f(`${BEACON_HOST}/${beaconTopic(serverId)}`, { method: 'POST', body, headers: { 'Cache': 'yes' } });
  } catch (e) { log(`Could not publish address beacon: ${(e as Error).message}`); }
}

/* ---------------- QR pairing payload ---------------- */

/**
 * The QR holds the server's ID and addresses — NOT the PIN. Pairing needs both:
 * scanning this shop's QR *and* typing the PIN shown on this shop's server screen.
 */
export function pairingPayload(serverId: string, name: string, endpoints: Endpoints) {
  return { v: 1, app: 'pharmadesk', sid: serverId, name, urls: [...endpoints.lan, endpoints.tailscale, endpoints.cloudflare].filter(Boolean) };
}

export async function pairingQr(payload: object) {
  const code = 'pharmadesk:' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  // The QR is a normal web link: a phone camera opens PharmaDesk straight from the shop PC
  // (same Wi-Fi), with the pairing code already filled in. In-app scanners read the code from it.
  const urls = (payload as { urls?: string[] }).urls || [];
  // With a secure address (Cloudflare/Tailscale https) phones use the fixed public app — it works from
  // anywhere and keeps working offline. Without one, open the app from this PC on the shop Wi-Fi.
  const secure = urls.some(u => u.startsWith('https://'));
  const lan = urls.find(u => u.startsWith('http://') && !/localhost|127\.0\.0\.1/.test(u));
  const home = secure ? VENDOR.appUrl : lan || urls[0];
  const text = home ? `${home.replace(/\/$/, '')}/#pair=${code}` : code;
  return {
    text,
    svg: await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
    terminal: await QRCode.toString(text, { type: 'terminal', small: true }),
  };
}

export function decodePairingText(text: string): { sid: string; name: string; urls: string[] } | null {
  try {
    const m = text.match(/[#&?]pair=([^&\s]+)/);
    const t = m ? decodeURIComponent(m[1]) : text;
    const raw = t.startsWith('pharmadesk:') ? t.slice(11) : t;
    const p = JSON.parse(Buffer.from(raw, 'base64url').toString());
    return p.app === 'pharmadesk' && p.sid ? p : null;
  } catch { return null; }
}
