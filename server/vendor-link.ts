// Link between a licensed shop and the vendor dashboard (only when the vendor set it up in
// shared/vendor.ts). It sends a small check-in — licence, shop name, counts; never patient data —
// and receives "paused" if the plan was paused from the dashboard.
// Support access is a switch the OWNER controls: while ON, the vendor gets a support login,
// every device shows a "support access is ON" banner, and it is in the activity log. OFF = no access.
import crypto from 'node:crypto';
import { getSetting, setSetting, allRows, getRow, putRow, type DB } from './db.ts';
import { getIdentity, encryptSecret, decryptSecret } from './identity.ts';
import { serverClock } from './ops.ts';
import * as sup from './supervision.ts';
import { pairingPayload, type Endpoints } from './tunnel.ts';
import { getLicenseToken, installId, setSuspended, trustedNow } from './license.ts';
import { VENDOR, licensingOn } from '../shared/vendor.ts';
import { AppError } from '../shared/util.ts';
import type { User, Shop, Invoice, Medicine, Patient } from '../shared/types.ts';

export const SUPPORT_USER = 'vendor-support';
export const supportOn = (db: DB) => getSetting(db, 'support_access') === '1';

/** The owner switches vendor support access on or off. */
export function setSupportAccess(db: DB, actor: User, on: boolean): { on: boolean } {
  if (!(actor as User & { owner?: boolean }).owner) throw new AppError('FORBIDDEN', 'Only the owner can change support access');
  const existing = allRows<User>(db, 'users', `WHERE username = ? AND deleted = 0`, SUPPORT_USER)[0];
  const secret = getIdentity(db)!.jwtSecret;
  if (on) {
    const pin = String(crypto.randomInt(0, 100_000_000)).padStart(8, '0');
    sup.saveUser(db, actor, {
      id: existing?.id, username: SUPPORT_USER, name: `${VENDOR.name} (support)`, role: 'custom', active: true, pin,
      perms: ['dashboard', 'pos', 'invoices', 'inventory', 'purchases', 'suppliers', 'patients', 'alerts', 'reports', 'settings', 'invoices.view_all', 'invoices.reprint'],
    });
    setSetting(db, 'support_pin', encryptSecret(pin, secret));
  } else if (existing) {
    sup.saveUser(db, actor, { id: existing.id, username: SUPPORT_USER, name: existing.name, role: existing.role, perms: existing.perms, active: false });
    setSetting(db, 'support_pin', null);
  }
  setSetting(db, 'support_access', on ? '1' : null);
  const shop = getRow<Shop>(db, 'shop', 'shop') || ({ id: 'shop', name: getIdentity(db)!.name } as Shop);
  putRow(db, 'shop', { ...shop, supportAccess: on } as Shop, serverClock.tick());
  sup.logEvent(db, on ? 'support.on' : 'support.off', {}, actor.id, actor.name);
  return { on };
}

export interface CheckinDeps { fetch?: typeof fetch; endpoints?: () => Endpoints; version?: string }

/** One check-in. Returns what the dashboard answered (or null when offline / not set up). */
export async function checkIn(db: DB, deps: CheckinDeps = {}): Promise<{ suspended: boolean; message: string | null } | null> {
  if (!VENDOR.vendorApi || !licensingOn()) return null;
  const license = getLicenseToken(db);
  if (!license) return null;
  const shop = getRow<Shop>(db, 'shop', 'shop');
  const since = Date.now() - 7 * 86_400_000;
  const bills = allRows<Invoice>(db, 'invoices').filter(i => Date.parse(i.createdAt) >= since && i.status !== 'void');
  const stats = {
    bills7d: bills.length, sales7d: bills.reduce((s, i) => s + (i.total || 0), 0),
    medicines: allRows<Medicine>(db, 'medicines').filter(m => !m.deleted).length,
    users: allRows<User>(db, 'users').filter(u => !u.deleted).length,
    patients: allRows<Patient>(db, 'patients').filter(p => !p.deleted).length,
    devices: (db.prepare(`SELECT COUNT(*) AS n FROM paired_devices WHERE revoked = 0`).get() as { n: number }).n,
  };
  let support: Record<string, string> | null = null;
  if (supportOn(db)) {
    const id = getIdentity(db)!;
    const ep = deps.endpoints?.() || { lan: [], tailscale: null, cloudflare: null };
    const pin = decryptSecret(getSetting(db, 'support_pin') || '', id.jwtSecret) || '';
    support = {
      username: SUPPORT_USER, pin, serverPin: id.pin,
      pairCode: 'pharmadesk:' + Buffer.from(JSON.stringify(pairingPayload(id.serverId, id.name, ep))).toString('base64url'),
      url: ep.cloudflare || ep.tailscale || ep.lan[0] || '',
    };
  }
  const body = { license, installId: installId(db), shop: shop?.name || getIdentity(db)!.name, phone: shop?.phone || '', city: shop?.address || '', version: deps.version || '1.0.0', platform: process.platform, stats, support };
  const f = deps.fetch || fetch;
  try {
    const res = await f(VENDOR.vendorApi.replace(/\/$/, '') + '/checkin', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const served = Date.parse(res.headers?.get?.('date') || '');
    if (Number.isFinite(served)) trustedNow(db, served); // the dashboard's clock also moves time forward
    const d = await res.json() as { suspended?: boolean; message?: string | null };
    setSuspended(db, !!d.suspended);
    setSetting(db, 'vendor_message', d.message || null);
    setSetting(db, 'vendor_checkin', new Date().toISOString());
    return { suspended: !!d.suspended, message: d.message || null };
  } catch { return null; } // offline: keep the last known state
}

/** Check in shortly after start, then every few hours. */
export function startVendorLink(db: DB, deps: CheckinDeps & { log?: (m: string) => void } = {}): () => void {
  if (!VENDOR.vendorApi || !licensingOn()) return () => {};
  const run = () => checkIn(db, deps).then(r => { if (r?.suspended) deps.log?.('Vendor dashboard: this shop is paused.'); }).catch(() => {});
  const a = setTimeout(run, 15_000), b = setInterval(run, VENDOR.checkinMinutes * 60_000);
  return () => { clearTimeout(a); clearInterval(b); };
}
