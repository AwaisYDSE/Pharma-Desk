// After the shop PC restarts its internet address changes; paired phones must find the new one.
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { sealBeacon, beaconTopic as serverTopic } from '../server/tunnel.ts';
import { openBeacon, readBeacon, mergeUrls, beaconTopic } from '../client/core/beacon.ts';

const key = crypto.randomBytes(32).toString('base64');
const pairing = { serverId: 'srv-1', serverName: 'Al-Shifa', token: 't', deviceId: 'd', beaconKey: key, urls: ['https://old-name.trycloudflare.com', 'http://192.168.1.5:4317'] };

describe('server address beacon', () => {
  it('phone and server use the same topic', async () => {
    expect(await beaconTopic('srv-1')).toBe(serverTopic('srv-1'));
  });

  it('phone decrypts what the server announced; wrong key or other shop gives nothing', async () => {
    const sealed = sealBeacon({ v: 1, sid: 'srv-1', at: 5, tailscale: null, cloudflare: 'https://new-name.trycloudflare.com', lan: ['http://192.168.1.9:4317'] }, key);
    expect(await openBeacon(sealed, key, 'srv-1')).toEqual({ at: 5, urls: ['https://new-name.trycloudflare.com', 'http://192.168.1.9:4317'] });
    expect(await openBeacon(sealed, crypto.randomBytes(32).toString('base64'), 'srv-1')).toBeNull();
    expect(await openBeacon(sealed, key, 'other-shop')).toBeNull();
  });

  it('reads the newest message from the relay and drops the dead address', async () => {
    const msg = (at: number, cf: string) => JSON.stringify({ event: 'message', message: sealBeacon({ v: 1, sid: 'srv-1', at, tailscale: null, cloudflare: cf, lan: [] }, key) });
    const body = [JSON.stringify({ event: 'open' }), msg(1, 'https://older.trycloudflare.com'), msg(9, 'https://newest.trycloudflare.com'), 'not json'].join('\n');
    const f = (async () => new Response(body)) as unknown as typeof fetch;
    const b = await readBeacon(pairing, f);
    expect(b?.urls).toEqual(['https://newest.trycloudflare.com']);
    expect(mergeUrls(b!.urls, pairing.urls)).toEqual(['https://newest.trycloudflare.com', 'http://192.168.1.5:4317']);
  });
});
