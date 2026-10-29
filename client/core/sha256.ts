// Pure-JS PBKDF2-HMAC-SHA256 — used when the browser has no WebCrypto
// (pages opened over plain http on the shop Wi-Fi are not a "secure context").
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const W = new Uint32Array(64);

function compress(state: Uint32Array, block: Uint8Array, off: number) {
  for (let i = 0; i < 16; i++) W[i] = (block[off + i * 4] << 24) | (block[off + i * 4 + 1] << 16) | (block[off + i * 4 + 2] << 8) | block[off + i * 4 + 3];
  for (let i = 16; i < 64; i++) {
    const a = W[i - 15], b = W[i - 2];
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  state[0] += a; state[1] += b; state[2] += c; state[3] += d; state[4] += e; state[5] += f; state[6] += g; state[7] += h;
}

const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

export function sha256(data: Uint8Array): Uint8Array {
  const state = new Uint32Array(IV);
  const len = data.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(data); padded[len] = 0x80;
  const bits = len * 8;
  padded[padded.length - 4] = bits >>> 24; padded[padded.length - 3] = bits >>> 16; padded[padded.length - 2] = bits >>> 8; padded[padded.length - 1] = bits;
  padded[padded.length - 5] = Math.floor(bits / 2 ** 32);
  for (let off = 0; off < padded.length; off += 64) compress(state, padded, off);
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) { out[i * 4] = state[i] >>> 24; out[i * 4 + 1] = state[i] >>> 16; out[i * 4 + 2] = state[i] >>> 8; out[i * 4 + 3] = state[i]; }
  return out;
}

/** PBKDF2-HMAC-SHA256 producing 32 bytes, with precomputed HMAC pads for speed. */
export function pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number): Uint8Array {
  let key = password.length > 64 ? sha256(password) : password;
  const k = new Uint8Array(64); k.set(key);
  const ipad = new Uint8Array(64), opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c; }
  const inner = new Uint32Array(IV), outer = new Uint32Array(IV);
  compress(inner, ipad, 0); compress(outer, opad, 0);
  // HMAC of a 32-byte message using the precomputed states: one block each.
  const block = new Uint8Array(64);
  const hmac32 = (msg: Uint8Array, out: Uint8Array) => {
    const st = new Uint32Array(inner);
    block.fill(0); block.set(msg); block[32] = 0x80; block[62] = 0x03; block[63] = 0x00; // length = (64+32)*8 = 768 bits
    compress(st, block, 0);
    const st2 = new Uint32Array(outer);
    for (let i = 0; i < 8; i++) { block[i * 4] = st[i] >>> 24; block[i * 4 + 1] = st[i] >>> 16; block[i * 4 + 2] = st[i] >>> 8; block[i * 4 + 3] = st[i]; }
    block.fill(0, 32); block[32] = 0x80; block[62] = 0x03;
    compress(st2, block, 0);
    for (let i = 0; i < 8; i++) { out[i * 4] = st2[i] >>> 24; out[i * 4 + 1] = st2[i] >>> 16; out[i * 4 + 2] = st2[i] >>> 8; out[i * 4 + 3] = st2[i]; }
  };
  // First iteration: HMAC(salt || INT(1)) — any length, done the general way.
  const first = new Uint8Array(salt.length + 4); first.set(salt); first[salt.length + 3] = 1;
  const innerMsg = new Uint8Array(64 + first.length); innerMsg.set(ipad); innerMsg.set(first, 64);
  const ih = sha256(innerMsg);
  const outerMsg = new Uint8Array(96); outerMsg.set(opad); outerMsg.set(ih, 64);
  let u = sha256(outerMsg);
  const t = new Uint8Array(u);
  const next = new Uint8Array(32);
  for (let i = 1; i < iterations; i++) {
    hmac32(u, next);
    u = new Uint8Array(next);
    for (let j = 0; j < 32; j++) t[j] ^= u[j];
  }
  key = t;
  return key;
}
