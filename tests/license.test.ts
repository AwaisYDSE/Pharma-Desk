// Licence keys: only the vendor's private key can make a working key; expired, tampered,
// wrong-key and other-PC keys are all rejected. And with licensing OFF (the default build),
// the shop works exactly as before — no key needed, nothing locked.
import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { verifyLicense, machineFingerprint } from '../shared/license.ts';
import { licensingOn } from '../shared/vendor.ts';
import { licenseState } from '../server/license.ts';
import { startShop, stop, seedMedicine, newDevice, serverStock, type Shop } from './helpers.ts';
import { login } from '../client/core/auth.ts';
import { newCart, addToCart, checkout } from '../client/core/pos.ts';

const b64url = (b: Buffer) => b.toString('base64url');

// A throwaway vendor keypair, like `make-key.mjs init` produces.
function vendor() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'jwk' }).x as string;
  return { pub, privateKey };
}
function issue(priv: crypto.KeyObject, payload: object) {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.sign(null, Buffer.from(body), priv));
  return `PD1.${body}.${sig}`;
}
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

describe('Licence keys', () => {
  it('a key the vendor issued is accepted, and its shop + expiry are read from it', async () => {
    const v = vendor();
    const key = issue(v.privateKey, { id: 'L-1', shop: 'Al-Shifa Pharmacy', issued: day(0), expires: day(365), plan: 'standard' });
    const st = await verifyLicense(key, v.pub);
    expect(st.state).toBe('valid');
    if (st.state === 'valid') { expect(st.payload.shop).toBe('Al-Shifa Pharmacy'); expect(st.daysLeft).toBeGreaterThan(360); }
  });

  it('rejects an expired key, a tampered key, a key from another vendor, and junk', async () => {
    const v = vendor(), other = vendor();
    const good = issue(v.privateKey, { id: 'L-2', shop: 'S', issued: day(-400), expires: day(365), plan: 'standard' });
    expect((await verifyLicense(issue(v.privateKey, { id: 'L-3', shop: 'S', issued: day(-40), expires: day(-1) }), v.pub)).state).toBe('expired');
    expect((await verifyLicense(good.slice(0, -6) + 'AAAAAA', v.pub)).state).toBe('invalid');     // changed signature
    expect((await verifyLicense(good, other.pub)).state).toBe('invalid');                          // another vendor's public key
    expect((await verifyLicense('PD1.' + b64url(Buffer.from('{"shop":"Hacker","expires":null}')) + '.x', v.pub)).state).toBe('invalid'); // unsigned
    expect((await verifyLicense('not-a-key', v.pub)).state).toBe('invalid');
    expect((await verifyLicense('', v.pub)).state).toBe('none');
  });

  it('a hand-edited expiry does not pass (it breaks the signature)', async () => {
    const v = vendor();
    const key = issue(v.privateKey, { id: 'L-4', shop: 'S', issued: day(-40), expires: day(-1) });
    const [, body, sig] = key.split('.');
    const forged = JSON.parse(Buffer.from(body, 'base64url').toString());
    forged.expires = day(3650); // try to extend it
    const tampered = `PD1.${b64url(Buffer.from(JSON.stringify(forged)))}.${sig}`;
    expect((await verifyLicense(tampered, v.pub)).state).toBe('invalid');
  });

  it('a key bound to one PC is refused on a different PC', async () => {
    const v = vendor();
    const key = issue(v.privateKey, { id: 'L-5', shop: 'S', issued: day(0), expires: day(365), machine: 'PC-ONE' });
    expect((await verifyLicense(key, v.pub, { machine: 'PC-ONE' })).state).toBe('valid');
    expect((await verifyLicense(key, v.pub, { machine: 'PC-TWO' })).state).toBe('machine_mismatch');
  });

  it('a machine fingerprint is stable for the same inputs and differs for others', async () => {
    expect(await machineFingerprint(['host-a', 'mac-1'])).toBe(await machineFingerprint(['host-a', 'mac-1']));
    expect(await machineFingerprint(['host-a'])).not.toBe(await machineFingerprint(['host-b']));
  });
});

const shops: Shop[] = [];
afterEach(async () => { while (shops.length) await stop(shops.pop()!); });

describe('Default build is unlicensed and unchanged', () => {
  it('licensing is OFF by default', () => {
    expect(licensingOn()).toBe(false);
  });

  it('with licensing off the shop reports no lock and sells normally', async () => {
    const S = await startShop(); shops.push(S);
    expect(await licenseState(S.db)).toMatchObject({ on: false, locked: false, needsKey: false });
    const { med } = seedMedicine(S.db, 'Panadol', 'Paracetamol', 270, [{ batchNo: '1', qty: 50, expiresInDays: 300 }]);
    const d = await newDevice(S); await login(d.ctx, 'owner', '111111', d.client);
    const cart = newCart(); await addToCart(d.ctx, cart, (await d.ctx.db.medicines.get(med.id))!, 5);
    await checkout(d.ctx, cart, { method: 'cash', paid: 5000 }, d.client);
    expect(serverStock(S.db, med.id)).toBe(45);
  });
});

describe('Shipped build', () => {
  it('requires a licence key signed by the vendor key and reports to the vendor dashboard', async () => {
    const { SHIPPED } = await import('./setup.ts');
    expect(SHIPPED.requireLicense).toBe(true);
    expect(Buffer.from(SHIPPED.publicKey, 'base64url').length).toBe(32);
    expect(SHIPPED.vendorApi).toMatch(/^https:\/\/pharmadesk-admin\.[\w-]+\.workers\.dev$/);
  });
});
