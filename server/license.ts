// Server-side licensing. Does nothing unless the vendor turned it on in shared/vendor.ts,
// so a plain build runs exactly as before. When on:
//   - a shop must activate a valid key before setup,
//   - an expired key, or a "suspended" flag from the vendor dashboard, locks billing (read stays on),
//   - the status is reported to the UI so it can show a renew screen.
import crypto from 'node:crypto';
import { getSetting, setSetting, type DB } from './db.ts';
import { verifyLicense, type LicenseStatus } from '../shared/license.ts';
import { VENDOR, licensingOn } from '../shared/vendor.ts';

/** The latest time this shop has ever seen. Turning the PC clock back cannot go below it,
 *  so an expired key stays expired. Moves forward with the PC clock and the dashboard's clock. */
export function trustedNow(db: DB, observed = Date.now()): Date {
  const prev = Number(getSetting(db, 'clock_max') || 0);
  const t = Math.max(prev, observed);
  if (t > prev + 60_000) setSetting(db, 'clock_max', String(t));
  return new Date(t);
}

/** A stable id for this install, used for optional machine-binding and the dashboard. */
export function installId(db: DB): string {
  let id = getSetting(db, 'install_id');
  if (!id) { id = crypto.randomBytes(9).toString('base64url'); setSetting(db, 'install_id', id); }
  return id;
}

export function getLicenseToken(db: DB): string | null { return getSetting(db, 'license_token'); }

/** Store a key only if it verifies; returns the resulting status. */
export async function activateLicense(db: DB, token: string): Promise<LicenseStatus> {
  const st = await verifyLicense(token, VENDOR.publicKey, { machine: installId(db), now: trustedNow(db) });
  const old = getLicenseToken(db);
  if (st.state === 'valid') {
    // A different key replaces a cancelled or paused one. Pasting the SAME key again changes nothing.
    const oldSt = old ? await verifyLicense(old, VENDOR.publicKey, { machine: installId(db), now: trustedNow(db) }) : { state: 'none' as const };
    const oldId = 'payload' in oldSt ? oldSt.payload.id : null;
    if (oldId !== st.payload.id) { setSuspended(db, false); setRevoked(db, false); setSetting(db, 'vendor_message', null); }
    setSetting(db, 'license_token', token.trim());
    if (!getSetting(db, 'vendor_checkin')) setSetting(db, 'vendor_checkin', new Date().toISOString());
  } else if (st.state === 'expired' && !old) setSetting(db, 'license_token', token.trim());
  return st;
}

/** 'suspended' is set by the vendor dashboard through check-in; the shop cannot clear it. */
export function isSuspended(db: DB): boolean { return getSetting(db, 'license_suspended') === '1'; }
export function setSuspended(db: DB, on: boolean) { setSetting(db, 'license_suspended', on ? '1' : null); }
/** 'revoked' = the vendor cancelled this licence. Also only cleared by the dashboard. */
export function isRevoked(db: DB): boolean { return getSetting(db, 'license_revoked') === '1'; }
export function setRevoked(db: DB, on: boolean) { setSetting(db, 'license_revoked', on ? '1' : null); }

export const OFFLINE_LIMIT_DAYS = 30;

export interface LicenseState {
  on: boolean;                       // is licensing enforced in this build?
  locked: boolean;                   // billing blocked (expired or suspended)
  needsKey: boolean;                 // no valid key yet — show the activate screen
  status: LicenseStatus['state'] | 'suspended' | 'cancelled' | 'off' | 'offline_too_long';
  shop?: string;
  plan?: string;
  expires?: string | null;
  daysLeft?: number | null;
  vendor: string;
}

export async function licenseState(db: DB): Promise<LicenseState> {
  if (!licensingOn()) return { on: false, locked: false, needsKey: false, status: 'off', vendor: VENDOR.name };
  const token = getLicenseToken(db);
  const st = token ? await verifyLicense(token, VENDOR.publicKey, { machine: installId(db), now: trustedNow(db) }) : { state: 'none' as const };
  const base = { on: true, vendor: VENDOR.name };
  if (isRevoked(db) || isSuspended(db)) {
    const shop = st.state === 'valid' || st.state === 'expired' || st.state === 'machine_mismatch' ? st.payload.shop : undefined;
    return { ...base, locked: true, needsKey: false, status: isRevoked(db) ? 'cancelled' : 'suspended', shop };
  }
  switch (st.state) {
    case 'valid': {
      // A shop that never reaches the licence server (blocked on purpose) cannot run for ever.
      if (VENDOR.vendorApi) {
        const last = getSetting(db, 'vendor_checkin');
        if (!last) setSetting(db, 'vendor_checkin', new Date().toISOString());
        else if (trustedNow(db).getTime() - Date.parse(last) > OFFLINE_LIMIT_DAYS * 86_400_000) return { ...base, locked: true, needsKey: false, status: 'offline_too_long', shop: st.payload.shop };
      }
      return { ...base, locked: false, needsKey: false, status: 'valid', shop: st.payload.shop, plan: st.payload.plan, expires: st.payload.expires, daysLeft: st.daysLeft };
    }
    case 'expired':
      return { ...base, locked: true, needsKey: false, status: 'expired', shop: st.payload.shop, plan: st.payload.plan, expires: st.payload.expires };
    case 'machine_mismatch':
      return { ...base, locked: true, needsKey: true, status: 'machine_mismatch', shop: st.payload.shop };
    case 'none':
      return { ...base, locked: true, needsKey: true, status: 'none' };
    default:
      return { ...base, locked: true, needsKey: true, status: 'invalid' };
  }
}
