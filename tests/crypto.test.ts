import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { pbkdf2Sha256, sha256 } from '../client/core/sha256.ts';

describe('pure-JS PIN hashing (for http pages on shop Wi-Fi)', () => {
  it('sha256 matches Node', () => {
    for (const s of ['', 'abc', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'w'.repeat(200)]) {
      expect(Buffer.from(sha256(new TextEncoder().encode(s))).toString('hex')).toBe(crypto.createHash('sha256').update(s).digest('hex'));
    }
  });
  it('PBKDF2-HMAC-SHA256 matches Node (server) for PIN hashes', () => {
    const salt = crypto.randomBytes(16);
    for (const pin of ['123456', '222222', 'a long password!']) {
      const mine = Buffer.from(pbkdf2Sha256(new TextEncoder().encode(pin), salt, 2000)).toString('base64');
      expect(mine).toBe(crypto.pbkdf2Sync(pin, salt, 2000, 32, 'sha256').toString('base64'));
    }
  });
  it('is fast enough for a phone (210k iterations)', () => {
    const t0 = Date.now();
    pbkdf2Sha256(new TextEncoder().encode('123456'), crypto.randomBytes(16), 210000);
    expect(Date.now() - t0).toBeLessThan(5000);
    console.log('210k iterations took', Date.now() - t0, 'ms');
  });
});
