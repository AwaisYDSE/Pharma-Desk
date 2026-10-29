// Forgot the owner PIN? Two ways back in, both only on the shop's server PC itself:
//   1. Recovery code — shown once when the owner sets up the shop (and can be renewed in Settings).
//   2. Reset key from the vendor — the owner reads out this PC's code; the vendor's app signs a
//      one-time key for that PC only. Nobody else can make one (it needs the vendor's signing key).
// Every reset is written to the activity log, and too many wrong tries pause resets for 15 minutes.
import crypto from 'node:crypto';
import { getSetting, setSetting, allRows, putRow, type DB } from './db.ts';
import { serverClock } from './ops.ts';
import * as sup from './supervision.ts';
import { installId, trustedNow } from './license.ts';
import { VENDOR } from '../shared/vendor.ts';
import { AppError } from '../shared/util.ts';
import type { User } from '../shared/types.ts';

const ABC = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no 0/O, 1/I/L — easy to read over the phone
const group = (s: string) => s.match(/.{1,4}/g)!.join('-');
const clean = (s: string) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** This PC's short code for a vendor reset key (stable, safe to read out). */
export function pcCode(db: DB): string {
  const h = crypto.createHash('sha256').update('pd-pc:' + installId(db)).digest();
  let out = ''; for (let i = 0; i < 10; i++) out += ABC[h[i] % ABC.length];
  return group(out);
}

/** Make a new recovery code (replaces the old one). Shown to the owner once. */
export function newRecoveryCode(db: DB): string {
  const b = crypto.randomBytes(16);
  let code = ''; for (let i = 0; i < 16; i++) code += ABC[b[i] % ABC.length];
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(code, salt, 120_000, 32, 'sha256');
  setSetting(db, 'owner_recovery', JSON.stringify({ salt: salt.toString('base64'), hash: hash.toString('base64'), at: new Date().toISOString() }));
  return group(code);
}

function recoveryMatches(db: DB, code: string): boolean {
  const raw = getSetting(db, 'owner_recovery'); if (!raw) return false;
  const r = JSON.parse(raw) as { salt: string; hash: string };
  const h = crypto.pbkdf2Sync(clean(code), Buffer.from(r.salt, 'base64'), 120_000, 32, 'sha256');
  const want = Buffer.from(r.hash, 'base64');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}

/** Check a vendor reset key: "PDR.<payload>.<signature>", payload {k:'owner-reset', pc, nonce, exp}. */
function vendorKeyOk(db: DB, key: string): { ok: true; nonce: string } | { ok: false; why: string } {
  if (!VENDOR.publicKey) return { ok: false, why: 'Reset keys are not available in this version' };
  const p = String(key || '').trim().replace(/\s+/g, '').split('.');
  if (p.length !== 3 || p[0] !== 'PDR') return { ok: false, why: 'That is not a PharmaDesk reset key' };
  try {
    const pub = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: VENDOR.publicKey }, format: 'jwk' });
    if (!crypto.verify(null, Buffer.from(p[1]), pub, Buffer.from(p[2], 'base64url'))) return { ok: false, why: 'That reset key is not valid' };
    const d = JSON.parse(Buffer.from(p[1], 'base64url').toString('utf8')) as { k?: string; pc?: string; nonce?: string; exp?: string };
    if (d.k !== 'owner-reset' || !d.nonce) return { ok: false, why: 'That reset key is not valid' };
    if (clean(d.pc || '') !== clean(pcCode(db))) return { ok: false, why: 'This reset key was made for a different PC' };
    if (!d.exp || trustedNow(db).getTime() > Date.parse(d.exp)) return { ok: false, why: 'This reset key has expired — ask for a new one' };
    const used = JSON.parse(getSetting(db, 'reset_used') || '[]') as string[];
    if (used.includes(d.nonce)) return { ok: false, why: 'This reset key was already used' };
    return { ok: true, nonce: d.nonce };
  } catch { return { ok: false, why: 'That reset key is not valid' }; }
}

/** Set a new owner PIN with a recovery code or a vendor reset key. Returns a fresh recovery code. */
export function resetOwnerPin(db: DB, input: { method: 'recovery' | 'vendor'; code: string; pin: string }): { recoveryCode: string; username: string } {
  const lock = JSON.parse(getSetting(db, 'reset_fail') || '{"n":0,"at":0}') as { n: number; at: number };
  if (lock.n >= 5 && Date.now() - lock.at < 15 * 60_000) throw new AppError('LOCKED', 'Too many wrong tries. Wait 15 minutes and try again.');
  const fail = (msg: string): never => {
    const n = Date.now() - lock.at > 15 * 60_000 ? 1 : lock.n + 1;
    setSetting(db, 'reset_fail', JSON.stringify({ n, at: Date.now() }));
    sup.logEvent(db, 'owner.reset_failed', { method: input.method });
    throw new AppError('INVALID', msg);
  };
  sup.validatePin(input.pin);
  let nonce: string | null = null;
  if (input.method === 'recovery') { if (!recoveryMatches(db, input.code)) fail('That recovery code is not right'); }
  else { const v = vendorKeyOk(db, input.code); if (!v.ok) fail(v.why); else nonce = v.nonce; }

  const owner = allRows<User & { owner?: boolean }>(db, 'users').find(u => u.owner && !u.deleted);
  if (!owner) throw new AppError('NOT_FOUND', 'No owner account on this PC yet');
  putRow(db, 'users', { ...owner, ...sup.hashPin(input.pin), active: true } as User, serverClock.tick());
  if (nonce) { const used = JSON.parse(getSetting(db, 'reset_used') || '[]') as string[]; setSetting(db, 'reset_used', JSON.stringify([...used, nonce].slice(-200))); }
  setSetting(db, 'reset_fail', null);
  sup.logEvent(db, 'owner.pin_reset', { method: input.method === 'recovery' ? 'recovery code' : 'reset key from the developer' }, owner.id, owner.name);
  return { recoveryCode: newRecoveryCode(db), username: owner.username };
}
