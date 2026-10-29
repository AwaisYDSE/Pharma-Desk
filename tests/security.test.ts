// Multi-tenant security: a device paired with Shop A can never read or change Shop B.
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { startShop, stop, newDevice, type Shop } from './helpers.ts';
import { getIdentity, signToken, verifyToken } from '../server/identity.ts';
import { PIN_MISMATCH_MESSAGE } from '../shared/util.ts';

const shops: Shop[] = [];
afterEach(async () => { while (shops.length) await stop(shops.pop()!); });

describe('Multi-tenant pairing security', () => {
  it("rejects Shop A's device token on Shop B with 401", async () => {
    const A = await startShop('Shop A'); const B = await startShop('Shop B'); shops.push(A, B);
    const dev = await newDevice(A);
    const token = dev.ctx.pairing!.token;

    const okA = await request(A.app).get('/api/pull?since=0').set('authorization', `Bearer ${token}`);
    expect(okA.status).toBe(200);
    expect(okA.body.changes.length).toBeGreaterThan(0);

    const onB = await request(B.app).get('/api/pull?since=0').set('authorization', `Bearer ${token}`);
    expect(onB.status).toBe(401);
    expect(onB.body.message).toBe(PIN_MISMATCH_MESSAGE);
    for (const path of ['/api/ops', '/api/sessions/offline', '/api/login']) {
      const r = await request(B.app).post(path).set('authorization', `Bearer ${token}`).send({ ops: [], username: 'owner', pin: '111111' });
      expect(r.status).toBe(401);
    }
  });

  it("refuses to pair with Shop B using Shop A's QR and PIN", async () => {
    const A = await startShop('Shop A'); const B = await startShop('Shop B'); shops.push(A, B);
    const a = getIdentity(A.db)!;
    const r = await request(B.app).post('/api/pair').send({ sid: a.serverId, pin: a.pin, deviceName: 'Intruder' });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('PIN_MISMATCH');
    expect(r.body.message).toBe("Server PIN Mismatch - Ensure you are scanning your own shop's server QR code.");
  });

  it('rejects requests with no token, a forged token, or a token signed with a different secret', async () => {
    const A = await startShop(); shops.push(A);
    const id = getIdentity(A.db)!;
    expect((await request(A.app).get('/api/pull')).status).toBe(401);
    expect((await request(A.app).get('/api/pull').set('authorization', 'Bearer abc.def.ghi')).status).toBe(401);
    const forged = signToken({ sid: id.serverId, did: 'x', jti: 'y', iat: 0 }, 'not-the-secret');
    expect((await request(A.app).get('/api/pull').set('authorization', `Bearer ${forged}`)).status).toBe(401);
    expect(verifyToken(forged, id.jwtSecret)).toBeNull();
  });

  it('a wrong PIN is refused, and repeated guesses lock pairing', async () => {
    const A = await startShop(); shops.push(A);
    const id = getIdentity(A.db)!;
    const wrong = id.pin === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) expect((await request(A.app).post('/api/pair').send({ sid: id.serverId, pin: wrong })).status).toBe(401);
    const locked = await request(A.app).post('/api/pair').send({ sid: id.serverId, pin: id.pin });
    expect(locked.status).toBe(429); // even the right PIN waits after 5 wrong guesses from that address
  });

  it('a removed device is locked out immediately', async () => {
    const A = await startShop(); shops.push(A);
    const dev = await newDevice(A);
    A.db.prepare(`UPDATE paired_devices SET revoked = 1`).run();
    const r = await request(A.app).get('/api/pull').set('authorization', `Bearer ${dev.ctx.pairing!.token}`);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('DEVICE_REMOVED');
  });

  it('server-PC-only screens (PIN, QR) cannot be opened through a tunnel', async () => {
    const A = await startShop(); shops.push(A);
    const viaTunnel = await request(A.app).get('/local/status').set('cf-connecting-ip', '203.0.113.9');
    expect(viaTunnel.status).toBe(403);
    expect(JSON.stringify(viaTunnel.body)).not.toContain(getIdentity(A.db)!.pin);
  });
});
