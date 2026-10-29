// Vendor dashboard link: check-in reports the shop, the dashboard can pause it, offline keeps
// the last state, and support access is owner-only, visible and logged (no hidden backdoor).
import { describe, it, expect, afterEach } from 'vitest';
import { VENDOR } from '../shared/vendor.ts';
import { checkIn, setSupportAccess, supportOn, SUPPORT_USER } from '../server/vendor-link.ts';
import { isSuspended } from '../server/license.ts';
import { allRows, getRow, getSetting, setSetting } from '../server/db.ts';
import { startShop, stop, addUser, type Shop } from './helpers.ts';

const shops: Shop[] = [];
const saved = { ...VENDOR };
afterEach(async () => { Object.assign(VENDOR, saved); while (shops.length) await stop(shops.pop()!); });

function on() { Object.assign(VENDOR, { vendorApi: 'https://vendor.test', publicKey: 'x'.repeat(43), requireLicense: true }); }
const reply = (body: object, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe('Vendor check-in', () => {
  it('does nothing when the vendor link is off (default build)', async () => {
    const S = await startShop(); shops.push(S);
    let called = false;
    expect(await checkIn(S.db, { fetch: (async () => { called = true; }) as never })).toBeNull();
    expect(called).toBe(false);
  });

  it('sends shop stats, applies a pause and lifts it; offline keeps the last state', async () => {
    const S = await startShop(); shops.push(S); on();
    setSetting(S.db, 'license_token', 'PD1.test.sig');
    let sent: { shop: string; stats: { medicines: number }; support: unknown } | null = null;
    const r = await checkIn(S.db, { fetch: (async (_u: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return { ok: true, json: async () => ({ suspended: true, message: 'Plan expired' }) }; }) as never });
    expect(r).toEqual({ suspended: true, message: 'Plan expired' });
    expect(sent!.shop).toBeTruthy();
    expect(sent!.support).toBeNull();                     // support off → no login details leave the shop
    expect(isSuspended(S.db)).toBe(true);
    expect(await checkIn(S.db, { fetch: (async () => { throw new Error('offline'); }) as never })).toBeNull();
    expect(isSuspended(S.db)).toBe(true);                 // offline: still paused
    await checkIn(S.db, { fetch: reply({ suspended: false }) });
    expect(isSuspended(S.db)).toBe(false);
  });
});

describe('Support access', () => {
  it('only the owner can turn it on; it is visible, logged, and fully removed when turned off', async () => {
    const S = await startShop(); shops.push(S); on();
    const staff = addUser(S, 'sana');
    expect(() => setSupportAccess(S.db, staff, true)).toThrow(/owner/);
    expect(supportOn(S.db)).toBe(false);

    setSupportAccess(S.db, S.owner, true);
    expect(supportOn(S.db)).toBe(true);
    expect((getRow(S.db, 'shop', 'shop') as { supportAccess?: boolean }).supportAccess).toBe(true);
    const u = allRows<{ id: string; username: string; active: boolean; deleted?: boolean }>(S.db, 'users').find(x => x.username === SUPPORT_USER)!;
    expect(u.active).toBe(true);
    setSetting(S.db, 'license_token', 'PD1.test.sig');
    let sent: { support: { username: string; pin: string } } | null = null;
    await checkIn(S.db, { fetch: (async (_u: string, i: RequestInit) => { sent = JSON.parse(String(i.body)); return { ok: true, json: async () => ({}) }; }) as never });
    expect(sent!.support.username).toBe(SUPPORT_USER);
    expect(sent!.support.pin).toMatch(/^\d{8}$/);

    setSupportAccess(S.db, S.owner, false);
    expect(supportOn(S.db)).toBe(false);
    expect(getSetting(S.db, 'support_pin')).toBeNull();
    expect(allRows<{ id: string; username: string; active: boolean }>(S.db, 'users').find(x => x.username === SUPPORT_USER)!.active).toBe(false);
    const log = allRows<{ id: string; action: string }>(S.db, 'audit' as never).map(a => a.action);
    expect(log).toContain('support.on'); expect(log).toContain('support.off');
  });
});
