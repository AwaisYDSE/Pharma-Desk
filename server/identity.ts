// Server identity, PIN pairing and device tokens.
// Each shop's server PC has its own Server UUID, 6-digit PIN and JWT secret.
// A device must know THIS server's UUID and PIN to pair; afterwards every request
// carries a token signed with THIS server's secret. Tokens from another shop's
// server fail the signature check → 401.
// © Awais Amin
import crypto from 'node:crypto';
import os from 'node:os';
import type { Request, Response, NextFunction } from 'express';
import type { DB } from './db.ts';
import { uuid, PIN_MISMATCH_MESSAGE } from '../shared/util.ts';

export interface Identity { serverId: string; name: string; pin: string; jwtSecret: string; beaconKey: string; createdAt: string }

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const newPin = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

export function getIdentity(db: DB): Identity | null {
  const r = db.prepare(`SELECT * FROM server_identity WHERE id = 1`).get() as Record<string, string> | undefined;
  return r ? { serverId: r.server_id, name: r.name, pin: r.pin, jwtSecret: r.jwt_secret, beaconKey: r.beacon_key, createdAt: r.created_at } : null;
}

/** First launch as "Main Server PC": create the persistent identity. */
export function ensureIdentity(db: DB, name = 'My Pharmacy'): Identity {
  const cur = getIdentity(db);
  if (cur) return cur;
  db.prepare(`INSERT INTO server_identity(id, server_id, name, pin, jwt_secret, beacon_key, created_at) VALUES (1, ?, ?, ?, ?, ?, ?)`)
    .run(uuid(), name, newPin(), crypto.randomBytes(32).toString('base64url'), crypto.randomBytes(32).toString('base64'), new Date().toISOString());
  return getIdentity(db)!;
}

export function rotatePin(db: DB): string {
  const pin = newPin();
  db.prepare(`UPDATE server_identity SET pin = ? WHERE id = 1`).run(pin);
  return pin;
}

/** Signs out every paired device at once (new secret) — e.g. after a phone is stolen. */
export function resetPairings(db: DB, reencrypt?: (oldSecret: string, newSecret: string) => void) {
  const old = getIdentity(db)!.jwtSecret;
  const fresh = crypto.randomBytes(32).toString('base64url');
  db.prepare(`UPDATE server_identity SET jwt_secret = ? WHERE id = 1`).run(fresh);
  db.prepare(`UPDATE paired_devices SET revoked = 1`).run();
  reencrypt?.(old, fresh);
}

export function renameServer(db: DB, name: string) {
  db.prepare(`UPDATE server_identity SET name = ? WHERE id = 1`).run(name);
}

/* ---------------- JWT (HS256, no dependency) ---------------- */

export interface DeviceClaims { sid: string; did: string; jti: string; iat: number }

export function signToken(claims: DeviceClaims, secret: string): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verifyToken(token: string, secret: string): DeviceClaims | null {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  let given: Buffer;
  try { given = Buffer.from(parts[2], 'base64url'); } catch { return null; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (head.alg !== 'HS256') return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as DeviceClaims;
  } catch { return null; }
}

/* ---------------- brute-force protection ---------------- */

export class PairLimiter {
  perIp = new Map<string, { fails: number; until: number }>();
  globalFails: number[] = [];
  maxPerIp = 5; windowMs = 10 * 60 * 1000; globalMax = 30;

  check(ip: string): string | null {
    const now = Date.now();
    this.globalFails = this.globalFails.filter(t => now - t < this.windowMs);
    if (this.globalFails.length >= this.globalMax) return 'Too many wrong PINs on this server. Pairing is paused for 10 minutes.';
    const st = this.perIp.get(ip);
    if (st && st.until > now) return `Too many wrong PINs. Try again in ${Math.ceil((st.until - now) / 60000)} min.`;
    return null;
  }
  fail(ip: string) {
    const now = Date.now();
    this.globalFails.push(now);
    const st = this.perIp.get(ip) || { fails: 0, until: 0 };
    st.fails++;
    if (st.fails >= this.maxPerIp) { st.until = now + this.windowMs; st.fails = 0; }
    this.perIp.set(ip, st);
  }
  ok(ip: string) { this.perIp.delete(ip); }
}

export const clientIp = (req: Request) =>
  String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

/** True only for requests made on the server PC itself (not via a tunnel or proxy). */
export function isLocalRequest(req: Request): boolean {
  const ra = req.socket.remoteAddress || '';
  const local = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
  const forwarded = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers['forwarded'] ||
    req.headers['tailscale-user-login'] || req.headers['cf-ray'];
  return local && !forwarded;
}

export interface PairResult { token: string; deviceId: string; serverId: string; serverName: string; beaconKey: string }

export function pairDevice(db: DB, limiter: PairLimiter, input: { sid?: string; pin?: string; deviceName?: string; platform?: string }, ip: string):
  { ok: true; result: PairResult } | { ok: false; status: number; code: string; message: string } {
  const id = getIdentity(db)!;
  const blocked = limiter.check(ip);
  if (blocked) return { ok: false, status: 429, code: 'LOCKED', message: blocked };
  const pinOk = typeof input.pin === 'string' && input.pin.length === id.pin.length &&
    crypto.timingSafeEqual(Buffer.from(input.pin), Buffer.from(id.pin));
  if (input.sid !== id.serverId || !pinOk) {
    limiter.fail(ip);
    logBlocked(db, ip, input.deviceName);
    return { ok: false, status: 401, code: 'PIN_MISMATCH', message: PIN_MISMATCH_MESSAGE };
  }
  limiter.ok(ip);
  const deviceId = uuid();
  const jti = crypto.randomBytes(12).toString('base64url');
  db.prepare(`INSERT INTO paired_devices(id, name, platform, jti, paired_at, last_seen, last_ip) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(deviceId, String(input.deviceName || 'Device').slice(0, 60), String(input.platform || '').slice(0, 40), jti, new Date().toISOString(), new Date().toISOString(), ip);
  const token = signToken({ sid: id.serverId, did: deviceId, jti, iat: Math.floor(Date.now() / 1000) }, id.jwtSecret);
  return { ok: true, result: { token, deviceId, serverId: id.serverId, serverName: id.name, beaconKey: id.beaconKey } };
}

function logBlocked(db: DB, ip: string, name?: string) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `blocked:${day}`;
  const cur = Number((db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined)?.value || 0);
  db.prepare(`INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(cur + 1));
  console.warn(`[pairing] blocked attempt from ${ip}${name ? ` (${name})` : ''}`);
}

export function blockedToday(db: DB): number {
  const key = `blocked:${new Date().toISOString().slice(0, 10)}`;
  return Number((db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined)?.value || 0);
}

/** Express middleware: requires `Authorization: Bearer <device token>` for THIS server. */
export function requireDevice(db: DB) {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = getIdentity(db)!;
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    const claims = m ? verifyToken(m[1], id.jwtSecret) : null;
    if (!claims || claims.sid !== id.serverId) {
      return res.status(401).json({ code: 'UNAUTHORIZED', message: PIN_MISMATCH_MESSAGE });
    }
    const dev = db.prepare(`SELECT id, revoked, jti FROM paired_devices WHERE id = ?`).get(claims.did) as { id: string; revoked: number; jti: string } | undefined;
    if (!dev || dev.revoked || dev.jti !== claims.jti) {
      return res.status(401).json({ code: 'DEVICE_REMOVED', message: 'This device was removed from the shop server. Pair it again with the Server PIN.' });
    }
    db.prepare(`UPDATE paired_devices SET last_seen = ?, last_ip = ? WHERE id = ?`).run(new Date().toISOString(), clientIp(req), dev.id);
    (req as Request & { device?: DeviceClaims }).device = claims;
    next();
  };
}

/* ---------------- secrets at rest (Gemini key, SMTP password) ---------------- */

const keyFrom = (secret: string) => crypto.createHash('sha256').update(`${secret}|${os.hostname()}|pharmadesk`).digest();

export function encryptSecret(plain: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}
export function decryptSecret(blob: string, secret: string): string | null {
  try {
    const [iv, tag, enc] = blob.split('.').map(s => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return null; }
}
