// Forgot owner PIN: a one-time reset key signed by the vendor, for one PC only.
// Plan paused/ended: every device gets read-only mode (billing off), and it lifts on resume.
import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { VENDOR } from '../shared/vendor.ts';
import { pcCode, resetOwnerPin } from '../server/owner-reset.ts';
import { pinMatches } from '../server/supervision.ts';
import { allRows, getRow } from '../server/db.ts';
import { startShop, stop, newDevice, seedMedicine, type Shop } from './helpers.ts';
import { login } from '../client/core/auth.ts';
import { newCart, addToCart, checkout } from '../client/core/pos.ts';
import type { User } from '../shared/types.ts';

const shops: Shop[] = [];
const saved = { ...VENDOR };
afterEach(async () => { Object.assign(VENDOR, saved); while (shops.length) await stop(shops.pop()!); });
const owner = (S: Shop) => allRows<User & { owner?: boolean }>(S.db, 'users').find(u => u.owner)!;
function vendorKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  Object.assign(VENDOR, { publicKey: publicKey.export({ format: 'jwk' }).x as string });
  return (payload: object) => { const b = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `PDR.${b}.${crypto.sign(null, Buffer.from(b), privateKey).toString('base64url')}`; };
}

describe('Forgot owner PIN', () => {
  it('a vendor reset key works only for this PC, only once, and only before it expires', async () => {
    const S = await startShop(); shops.push(S);
    const make = vendorKeys();
    const exp = new Date(Date.now() + 864e5).toISOString();
    expect(() => resetOwnerPin(S.db, { code: make({ k: 'owner-reset', pc: 'ABCD-EFGH-JK', nonce: 'n0', exp }), pin: '111222' })).toThrow(/different PC/);
    expect(() => resetOwnerPin(S.db, { code: make({ k: 'owner-reset', pc: pcCode(S.db), nonce: 'n1', exp: new Date(Date.now() - 1000).toISOString() }), pin: '111222' })).toThrow(/expired/);
    const key = make({ k: 'owner-reset', pc: pcCode(S.db), nonce: 'n2', exp });
    expect(() => resetOwnerPin(S.db, { code: key.slice(0, -5) + 'AAAAA', pin: '111222' })).toThrow(/not valid/);
    resetOwnerPin(S.db, { code: key, pin: '111222' });
    expect(pinMatches(owner(S), '111222')).toBe(true);
    expect(() => resetOwnerPin(S.db, { code: key, pin: '333444' })).toThrow(/already used/);
  });

  it('too many wrong tries pause resets', async () => {
    const S = await startShop(); shops.push(S);
    vendorKeys();
    for (let i = 0; i < 5; i++) expect(() => resetOwnerPin(S.db, { code: 'PDR.bad.key', pin: '654321' })).toThrow(/not valid/);
    expect(() => resetOwnerPin(S.db, { code: 'PDR.bad.key', pin: '654321' })).toThrow(/15 minutes/);
  });
});

describe('Plan paused or ended', () => {
  it('turns billing off on devices (read-only) and back on when resumed', async () => {
    const S = await startShop(); shops.push(S);
    seedMedicine(S.db, 'Panadol', 'Paracetamol', 270, [{ batchNo: '1', qty: 50, expiresInDays: 300 }]);
    const shop = getRow(S.db, 'shop', 'shop') || { id: 'shop', name: 'Shop A' };
    const { putRow } = await import('../server/db.ts'); const { serverClock } = await import('../server/ops.ts');
    putRow(S.db, 'shop', { ...shop, planLock: { status: 'suspended', message: 'Plan paused', vendor: 'Awais Amin' } } as never, serverClock.tick());
    const d = await newDevice(S); await login(d.ctx, 'owner', '111111', d.client); await d.sync.syncNow();
    const m = (await d.ctx.db.medicines.toArray()).find(x => x.name === 'Panadol')!;
    const cart = newCart(); await addToCart(d.ctx, cart, m, 1);
    await expect(checkout(d.ctx, cart, { method: 'cash', paid: 100000 }, d.client)).rejects.toThrow(/billing is off/);
    expect((await d.ctx.db.medicines.count())).toBeGreaterThan(0); // still readable
    putRow(S.db, 'shop', { ...(getRow(S.db, 'shop', 'shop') as object), planLock: null } as never, serverClock.tick());
    await d.sync.syncNow();
    const ok = await checkout(d.ctx, cart, { method: 'cash', paid: 100000 }, d.client);
    expect(ok.invoice.total).toBeGreaterThan(0);
  });
});
