// Forgot the owner PIN? On the shop's server PC only: the owner reads out this PC's code and the
// vendor's app signs a one-time reset key for that PC. Nobody else can make one (it needs the
// vendor's signing key).
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

/** Set a new owner PIN with a vendor reset key. */
export function resetOwnerPin(db: DB, input: { code: string; pin: string }): { username: string } {
  const lock = JSON.parse(getSetting(db, 'reset_fail') || '{"n":0,"at":0}') as { n: number; at: number };
  if (lock.n >= 5 && Date.now() - lock.at < 15 * 60_000) throw new AppError('LOCKED', 'Too many wrong tries. Wait 15 minutes and try again.');
  const fail = (msg: string): never => {
    const n = Date.now() - lock.at > 15 * 60_000 ? 1 : lock.n + 1;
    setSetting(db, 'reset_fail', JSON.stringify({ n, at: Date.now() }));
    sup.logEvent(db, 'owner.reset_failed', {});
    throw new AppError('INVALID', msg);
  };
  sup.validatePin(input.pin);
  const v = vendorKeyOk(db, input.code);
  if (!v.ok) return fail(v.why);
  const nonce = v.nonce;

  const owner = allRows<User & { owner?: boolean }>(db, 'users').find(u => u.owner && !u.deleted);
  if (!owner) throw new AppError('NOT_FOUND', 'No owner account on this PC yet');
  putRow(db, 'users', { ...owner, ...sup.hashPin(input.pin), active: true } as User, serverClock.tick());
  const used = JSON.parse(getSetting(db, 'reset_used') || '[]') as string[];
  setSetting(db, 'reset_used', JSON.stringify([...used, nonce].slice(-200)));
  setSetting(db, 'reset_fail', null);
  sup.logEvent(db, 'owner.pin_reset', {}, owner.id, owner.name);
  return { username: owner.username };
}
