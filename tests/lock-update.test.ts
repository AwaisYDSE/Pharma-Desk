import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import request from 'supertest';
import { startShop, stop, newDevice, type Shop } from './helpers.ts';
import { licenseState, activateLicense, setRevoked, setSuspended, isRevoked } from '../server/license.ts';
import { getSetting, setSetting } from '../server/db.ts';
import { VENDOR } from '../shared/vendor.ts';
import { bytesToB64url } from '../shared/license.ts';
import { updateNeed, compareVersions } from '../shared/update.ts';
import { APP_VERSION } from '../shared/version.ts';
import { installUpdate } from '../server/updater.ts';
import { makeBackup, restoreBackup } from '../server/backup.ts';
import { openDb } from '../server/db.ts';
import { TERMS } from '../shared/terms.ts';
import { login } from '../client/core/auth.ts';
import { createApp } from '../server/app.ts';

const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString();
function vendor() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = bytesToB64url(new Uint8Array((publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32)));
  const issue = (p: object) => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return `PD1.${b}.${crypto.sign(null, Buffer.from(b), privateKey).toString('base64url')}`; };
  return { pub, issue };
}

describe('Locked licence', () => {
  const saved = { ...VENDOR };
  let S: Shop | null = null;
  afterEach(async () => { Object.assign(VENDOR, saved); if (S) await stop(S); S = null; });

  it('a new key replaces a cancelled one, but the same key cannot clear the cancel', async () => {
    S = await startShop();
    const v = vendor(); Object.assign(VENDOR, { publicKey: v.pub, requireLicense: true, vendorApi: '' });
    const k1 = v.issue({ id: 'L-1', shop: 'S', issued: day(0), expires: day(100) }), k2 = v.issue({ id: 'L-2', shop: 'S', issued: day(0), expires: day(100) });
    await activateLicense(S.db, k1);
    setRevoked(S.db, true);
    expect(await licenseState(S.db)).toMatchObject({ locked: true, status: 'cancelled', needsKey: false });
    await activateLicense(S.db, k1);
    expect(isRevoked(S.db)).toBe(true);
    await activateLicense(S.db, k2);
    expect(await licenseState(S.db)).toMatchObject({ locked: false, status: 'valid' });
    setSuspended(S.db, true);
    expect((await licenseState(S.db)).status).toBe('suspended');
  });

  it('an expired key cannot overwrite a working one', async () => {
    S = await startShop();
    const v = vendor(); Object.assign(VENDOR, { publicKey: v.pub, requireLicense: true, vendorApi: '' });
    const good = v.issue({ id: 'L-1', shop: 'S', issued: day(0), expires: day(100) });
    await activateLicense(S.db, good);
    await activateLicense(S.db, v.issue({ id: 'L-2', shop: 'S', issued: day(-99), expires: day(-1) }));
    expect(getSetting(S.db, 'license_token')).toBe(good);
  });

  it('a shop that never reaches the licence server locks after 30 days', async () => {
    S = await startShop();
    const v = vendor(); Object.assign(VENDOR, { publicKey: v.pub, requireLicense: true, vendorApi: 'https://x.invalid' });
    await activateLicense(S.db, v.issue({ id: 'L-1', shop: 'S', issued: day(0), expires: null }));
    expect((await licenseState(S.db)).locked).toBe(false);
    setSetting(S.db, 'vendor_checkin', day(-31));
    expect(await licenseState(S.db)).toMatchObject({ locked: true, status: 'offline_too_long' });
  });

  it('while locked a device gets no shop data, then everything once unlocked', async () => {
    S = await startShop();
    const d = await newDevice(S); await login(d.ctx, 'owner', '111111', d.client);
    const v = vendor(); Object.assign(VENDOR, { publicKey: v.pub, requireLicense: true, vendorApi: '' });
    const db = openDb(':memory:');
    const app = createApp(db);
    await new Promise(r => setTimeout(r, 50));
    const { getIdentity } = await import('../server/identity.ts');
    await request(app).post('/local/activate').send({ token: v.issue({ id: 'L-1', shop: 'S', issued: day(0), expires: day(-1) }) });
    await request(app).post('/local/activate').send({ token: v.issue({ id: 'L-2', shop: 'S', issued: day(0), expires: day(100) }) });
    const owner = await request(app).post('/local/setup-owner').send({ name: 'O', username: 'owner', pin: '123456', shopName: 'S', catalog: 'own' });
    expect(owner.status).toBe(200);
    const id = getIdentity(db)!;
    const token = (await request(app).post('/api/pair').send({ sid: id.serverId, pin: id.pin })).body.token;
    const auth = { authorization: `Bearer ${token}` };
    expect((await request(app).get('/api/pull?since=0').set(auth)).body.changes.length).toBeGreaterThan(1);
    setRevoked(db, true);
    await request(app).post('/local/checkin-now');
    const locked = await request(app).get('/api/pull?since=0').set(auth);
    expect(locked.body.changes.map((c: { tbl: string }) => c.tbl)).toEqual(['shop']);
    expect(locked.body.changes[0].data.planLock.status).toBe('cancelled');
    expect(locked.body.rev).toBe(0);
    expect((await request(app).post('/api/login').set(auth).send({ username: 'owner', pin: '123456' })).status).toBe(423);
    expect((await request(app).get('/api/storage').set(auth)).status).toBe(423);
    await request(app).post('/local/activate').send({ token: v.issue({ id: 'L-3', shop: 'S', issued: day(0), expires: day(100) }) });
    const back = await request(app).get('/api/pull?since=0').set(auth);
    expect(back.body.changes.length).toBeGreaterThan(1);
    db.close();
  });
});

describe('Backup', () => {
  it('needs the owner PIN, shows nothing readable, and restores only into an empty shop', async () => {
    const S = await startShop();
    try {
      expect(() => makeBackup(S.db, '000000')).toThrow(/Wrong/);
      const file = makeBackup(S.db, '111111');
      expect(file).not.toContain('Owner');
      expect(() => restoreBackup(S.db, file, '111111')).toThrow(/empty/);
      const fresh = openDb(':memory:');
      expect(() => restoreBackup(fresh, file, '999999')).toThrow(/Wrong/);
      expect(restoreBackup(fresh, file, '111111').rows).toBeGreaterThan(0);
      expect((fresh.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n).toBe(1);
      fresh.close();
    } finally { await stop(S); }
  });
});

describe('Updates', () => {
  it('versions compare as numbers', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });
  it('optional, must-update and minimum version rules', () => {
    expect(updateNeed('1.1.0', { version: '1.1.0' })).toBe('none');
    expect(updateNeed('1.2.0', { version: '1.1.0', mandatory: true })).toBe('none');
    expect(updateNeed('1.1.0', { version: '1.2.0' })).toBe('optional');
    expect(updateNeed('1.1.0', { version: '1.2.0', mandatory: true })).toBe('mandatory');
    expect(updateNeed('1.0.0', { version: '1.2.0', minVersion: '1.1.0' })).toBe('mandatory');
    expect(updateNeed('1.1.0', null)).toBe('none');
  });
  it('package, release file and app agree on the version', () => {
    expect(JSON.parse(fs.readFileSync('package.json', 'utf8')).version).toBe(APP_VERSION);
    expect(JSON.parse(fs.readFileSync('release.json', 'utf8')).version).toBe(APP_VERSION);
  });
  const fake = (bin: Buffer, sha: string) => (async (u: string) => String(u).includes('version.json')
    ? new Response(JSON.stringify({ version: '9.9.9', sha256: { windows: sha, mac: sha } })) : new Response(bin)) as typeof fetch;
  it('a damaged download is never opened', async () => {
    let opened = false;
    await expect(installUpdate({ fetch: fake(Buffer.from('x'), 'wrong'), platform: 'win32', open: () => { opened = true; } })).rejects.toThrow(/damaged/);
    expect(opened).toBe(false);
  });
  it('a good download is opened', async () => {
    const bin = Buffer.from('installer');
    let opened = '';
    const r = await installUpdate({ fetch: fake(bin, crypto.createHash('sha256').update(bin).digest('hex')), platform: 'win32', open: f => { opened = f; } });
    expect(r.version).toBe('9.9.9');
    expect(opened).toMatch(/PharmaDesk-Setup\.exe$/);
  });
});

describe('Terms', () => {
  it('exist in every language with the same points, including data loss', () => {
    for (const l of ['ur', 'ar', 'hi', 'es'] as const) expect(TERMS[l].points.length).toBe(TERMS.en.points.length);
    expect(TERMS.en.points.join(' ')).toMatch(/loss of data/);
  });
});
