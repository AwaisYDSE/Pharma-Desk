// Licence keys for selling PharmaDesk.
//
// A licence is a small signed token the vendor issues to one shop:
//   PD1.<base64url(payload JSON)>.<base64url(Ed25519 signature)>
// The payload says who it is for and until when:
//   { id, shop, issued, expires, plan, machine? }
// The app verifies the signature with the vendor's PUBLIC key (embedded in the build).
// Only the vendor's PRIVATE key can make a valid token, so a key cannot be forged or edited,
// and verification needs no internet. Expiry is read from the token itself.
//
// This is anti-copying, not unbreakable: a determined attacker with the binary could patch
// the check out. It stops ordinary sharing and makes honest renewal the easy path.

export interface LicensePayload {
  id: string;                 // licence id (shown in the vendor dashboard)
  shop: string;               // shop/pharmacy name this key is for
  issued: string;             // ISO date issued
  expires: string | null;     // ISO date, or null for a perpetual licence
  plan?: string;              // e.g. 'standard', 'trial'
  machine?: string | null;    // optional: bind to one PC's fingerprint
}

export type LicenseStatus =
  | { state: 'none' }                                   // no licence stored
  | { state: 'invalid'; reason: string }                // bad signature / malformed / wrong key
  | { state: 'expired'; payload: LicensePayload }        // signature ok but past expiry
  | { state: 'machine_mismatch'; payload: LicensePayload }
  | { state: 'valid'; payload: LicensePayload; daysLeft: number | null };

const te = new TextEncoder();
const td = new TextDecoder();

function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  s += '==='.slice((s.length + 3) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64url(b: Uint8Array): string {
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Verify a licence token against the vendor public key and decode its payload.
 *  `now` and `machine` let callers test and bind to a device. Pure; needs no network. */
export async function verifyLicense(
  token: string,
  publicKeyB64url: string,
  opts: { now?: Date; machine?: string | null } = {},
): Promise<LicenseStatus> {
  if (!token || !publicKeyB64url) return { state: 'none' };
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'PD1') return { state: 'invalid', reason: 'Not a PharmaDesk key' };
  let payload: LicensePayload;
  try {
    payload = JSON.parse(td.decode(b64urlToBytes(parts[1])));
  } catch {
    return { state: 'invalid', reason: 'Key is damaged' };
  }
  let ok = false;
  try {
    const key = await crypto.subtle.importKey('raw', b64urlToBytes(publicKeyB64url), { name: 'Ed25519' }, false, ['verify']);
    ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, b64urlToBytes(parts[2]), te.encode(parts[1]));
  } catch {
    return { state: 'invalid', reason: 'Key could not be checked on this device' };
  }
  if (!ok) return { state: 'invalid', reason: 'This key was not issued by this vendor' };

  const now = opts.now ?? new Date();
  if (opts.machine != null && payload.machine && payload.machine !== opts.machine) {
    return { state: 'machine_mismatch', payload };
  }
  if (payload.expires) {
    const exp = new Date(payload.expires).getTime();
    if (Number.isFinite(exp) && now.getTime() > exp) return { state: 'expired', payload };
    const daysLeft = Number.isFinite(exp) ? Math.ceil((exp - now.getTime()) / 86_400_000) : null;
    return { state: 'valid', payload, daysLeft };
  }
  return { state: 'valid', payload, daysLeft: null };
}

/** A short, stable fingerprint for a PC (so one key can be tied to one machine). */
export async function machineFingerprint(parts: string[]): Promise<string> {
  const data = te.encode(parts.filter(Boolean).join('|') || 'unknown');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return bytesToB64url(hash.slice(0, 12));
}
