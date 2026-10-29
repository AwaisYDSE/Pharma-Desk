#!/usr/bin/env node
// PharmaDesk key maker — stays on YOUR computer only. Do not share or commit vendor-private.json.
//
//   node license/make-key.mjs init
//       Makes your signing keys once. Prints the publicKey to paste into shared/vendor.ts.
//
//   node license/make-key.mjs issue --shop "Al-Shifa Pharmacy" --days 365 [--plan standard] [--machine <fingerprint>]
//       Prints a licence key for one shop. Give this key to that shop.
//
//   node license/make-key.mjs issue --shop "Trial" --days 14 --plan trial
//
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PRIV = path.join(HERE, 'vendor-private.json');
const b64url = b => Buffer.from(b).toString('base64url');

function loadKeys() {
  if (!fs.existsSync(PRIV)) { console.error('No keys yet. Run:  node license/make-key.mjs init'); process.exit(1); }
  return JSON.parse(fs.readFileSync(PRIV, 'utf8'));
}

const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[i + 1];

if (cmd === 'init') {
  if (fs.existsSync(PRIV)) { console.error('Keys already exist at', PRIV, '— delete it only if you want to start over (all old keys stop working).'); process.exit(1); }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubRaw = publicKey.export({ format: 'jwk' }).x;           // raw 32-byte public key, base64url
  const privPkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  fs.writeFileSync(PRIV, JSON.stringify({ publicKey: pubRaw, privatePkcs8: privPkcs8, created: new Date().toISOString() }, null, 2));
  fs.chmodSync(PRIV, 0o600);
  console.log('\nYour keys are saved in', PRIV, '(keep this file private — back it up, never share it).\n');
  console.log('1) Open shared/vendor.ts and set:');
  console.log(`     publicKey: '${pubRaw}',`);
  console.log("     requireLicense: true,");
  console.log('2) Rebuild and republish. From now on a shop needs a key you issue.\n');
} else if (cmd === 'issue') {
  const keys = loadKeys();
  const shop = args.shop;
  if (!shop) { console.error('Need a shop name:  --shop "Al-Shifa Pharmacy"'); process.exit(1); }
  const days = args.days ? Number(args.days) : null;
  const payload = {
    id: 'L-' + crypto.randomBytes(5).toString('hex').toUpperCase(),
    shop: String(shop).slice(0, 80),
    issued: new Date().toISOString().slice(0, 10),
    expires: days ? new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) : null,
    plan: args.plan || 'standard',
    machine: args.machine || null,
  };
  const body = b64url(JSON.stringify(payload));
  const priv = crypto.createPrivateKey({ key: Buffer.from(keys.privatePkcs8, 'base64'), format: 'der', type: 'pkcs8' });
  const sig = b64url(crypto.sign(null, Buffer.from(body), priv));
  const token = `PD1.${body}.${sig}`;
  console.log('\nLicence for:', payload.shop);
  console.log('  Licence id:', payload.id, '| plan:', payload.plan, '| expires:', payload.expires || 'never');
  console.log('\nGive this key to the shop:\n');
  console.log(' ', token, '\n');
} else {
  console.log('Usage:\n  node license/make-key.mjs init\n  node license/make-key.mjs issue --shop "Name" --days 365 [--plan standard] [--machine <fp>]');
}
