// Users, login and supervision on the device.
//  • The first user created on a new shop is the OWNER (admin). It is locked:
//    it can't be deleted, disabled or demoted.
//  • The owner adds/deletes other users and switches each module on/off per user.
//  • Every login and logout is recorded with time and device (also when offline;
//    it syncs to the server later). Wrong PINs lock the user out for 5 minutes.
//  • The owner can sign a worker out of every device at once ("Log out now").
// © Awais Amin
import { uuid, AppError, PermissionError } from '../../shared/util.ts';
import { can, ROLE_PRESETS } from '../../shared/permissions.ts';
import type { User } from '../../shared/types.ts';
import { getMeta, setMeta, stamp, emit, type Ctx } from './db.ts';
import { makeOp, enqueue } from './outbox.ts';
import { logAuditRow } from './audit.ts';
import type { HttpTransport } from './sync.ts';
import { pbkdf2Sha256 } from './sha256.ts';

const ITER = 210000;
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60_000;

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function hashPin(pin: string, saltB64?: string) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const pw = new TextEncoder().encode(String(pin));
  if (!globalThis.crypto?.subtle) {
    // Plain-http page on the shop Wi-Fi: no WebCrypto, use the built-in JS version (same result).
    return { pinHash: b64(pbkdf2Sha256(pw, salt, ITER)), pinSalt: b64(salt) };
  }
  const key = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256);
  return { pinHash: b64(bits), pinSalt: b64(salt) };
}

const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

export function validatePin(pin: string) {
  if (!/^\d{6,}$/.test(String(pin || '')) && String(pin || '').length < 8) {
    throw new AppError('WEAK_PIN', 'Use a PIN of at least 6 digits, or a password of at least 8 characters');
  }
}

export const hasAnyUser = async (ctx: Ctx) => (await ctx.db.users.filter(u => !u.deleted).count()) > 0;
export const listUsers = (ctx: Ctx) => ctx.db.users.filter(u => !u.deleted).toArray();

async function writeUser(ctx: Ctx, user: User, action: string, details: unknown) {
  const db = ctx.db;
  await db.transaction('rw', db.users, db.outbox, db.audit, async () => {
    await db.users.put(user);
    const a = await logAuditRow(ctx, action, { entity: 'users', entityId: user.id, details, userId: ctx.user?.id ?? user.id });
    await enqueue(ctx, makeOp(ctx, 'upsert', [{ tbl: 'users', row: user }, { tbl: 'audit', row: a }]));
  });
  emit(ctx, 'users-changed');
}

/** Create or edit a user. The very first user becomes the locked owner. */
export async function saveUser(ctx: Ctx, data: Partial<User> & { username: string; name: string }, pin?: string): Promise<User> {
  const db = ctx.db;
  const first = !(await hasAnyUser(ctx));
  const existing = data.id ? await db.users.get(data.id) : undefined;
  if (!first && !can(ctx.user, existing ? 'users.edit' : 'users.create')) throw new PermissionError();
  const username = String(data.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,30}$/.test(username)) throw new AppError('INVALID', 'Username: 2–30 letters or numbers, no spaces');
  const clash = await db.users.where('username').equals(username).filter(u => !u.deleted).first();
  if (clash && clash.id !== data.id) throw new AppError('DUPLICATE', 'That username is already used');
  if (!first && !existing && !pin) throw new AppError('PIN_REQUIRED', 'Set a PIN for the new user');

  let role = first ? 'admin' : (data.role || existing?.role || 'cashier');
  if (existing?.owner) {
    if (ctx.user?.id !== existing.id && (data.active === false || role !== 'admin')) throw new AppError('OWNER_LOCKED', 'The owner account cannot be disabled or changed by others');
    role = 'admin';
  }
  const user: User = {
    perms: ROLE_PRESETS[role]?.perms || [],
    ...existing,
    ...data,
    id: data.id || uuid(),
    username,
    email: data.email ? String(data.email).trim().toLowerCase() : (existing?.email || ''),
    role,
    active: existing?.owner || first ? true : data.active ?? existing?.active ?? true,
    owner: existing?.owner || first,
    createdAt: existing?.createdAt || new Date().toISOString(),
    hlc: stamp(ctx),
  };
  if (pin) { validatePin(pin); Object.assign(user, await hashPin(pin)); }
  await writeUser(ctx, user, existing ? 'user.update' : (first ? 'user.owner_created' : 'user.create'),
    { username, role: user.role, active: user.active, perms: user.role === 'admin' ? 'all' : user.perms });
  return user;
}

/** Turn one module or action on/off for one user. */
export async function setPermission(ctx: Ctx, userId: string, perm: string, on: boolean) {
  if (!can(ctx.user, 'users.edit')) throw new PermissionError();
  const u = await ctx.db.users.get(userId);
  if (!u) throw new AppError('NOT_FOUND', 'User not found');
  if (u.owner || u.role === 'admin') throw new AppError('OWNER_LOCKED', 'Admins always have every permission');
  const perms = new Set(u.perms || []);
  if (on) perms.add(perm); else perms.delete(perm);
  await writeUser(ctx, { ...u, perms: [...perms], role: u.role === 'custom' ? 'custom' : (matchesPreset([...perms]) || 'custom'), hlc: stamp(ctx) },
    'user.permission', { perm, on, user: u.username });
}

const matchesPreset = (perms: string[]) =>
  Object.entries(ROLE_PRESETS).find(([k, p]) => k !== 'admin' && p.perms.length === perms.length && p.perms.every(x => perms.includes(x)))?.[0] || null;

/** Delete a worker. History (sales, log) is kept; the account can no longer log in. */
export async function deleteUser(ctx: Ctx, userId: string) {
  if (!can(ctx.user, 'users.delete')) throw new PermissionError();
  const u = await ctx.db.users.get(userId);
  if (!u) return;
  if (u.owner) throw new AppError('OWNER_LOCKED', 'The owner account cannot be deleted');
  if (u.id === ctx.user?.id) throw new AppError('SELF', 'You cannot delete yourself');
  await writeUser(ctx, { ...u, deleted: true, active: false, forceLogoutAt: new Date().toISOString(), hlc: stamp(ctx) }, 'user.delete', { user: u.username });
}

export async function setUserActive(ctx: Ctx, userId: string, active: boolean) {
  if (!can(ctx.user, 'users.edit')) throw new PermissionError();
  const u = await ctx.db.users.get(userId);
  if (!u) return;
  if (u.owner) throw new AppError('OWNER_LOCKED', 'The owner account cannot be disabled');
  await writeUser(ctx, { ...u, active, ...(active ? {} : { forceLogoutAt: new Date().toISOString() }), hlc: stamp(ctx) },
    active ? 'user.enable' : 'user.disable', { user: u.username });
}

/** Sign a worker out of every device (takes effect when each device next syncs). */
export async function forceLogout(ctx: Ctx, userId: string) {
  if (!can(ctx.user, 'users.logout')) throw new PermissionError();
  const u = await ctx.db.users.get(userId);
  if (!u || u.owner) throw new AppError('OWNER_LOCKED', 'The owner cannot be signed out by others');
  await writeUser(ctx, { ...u, forceLogoutAt: new Date().toISOString(), hlc: stamp(ctx) }, 'user.force_logout', { user: u.username });
}

/** Change your OWN profile photo (allowed for everyone; also used by the owner for any user). */
export async function setUserPhoto(ctx: Ctx, userId: string, photo: string | null) {
  const u = await ctx.db.users.get(userId);
  if (!u) throw new AppError('NOT_FOUND', 'User not found');
  if (u.id !== ctx.user?.id && !can(ctx.user, 'users.edit')) throw new PermissionError();
  if (u.owner && u.id !== ctx.user?.id) throw new AppError('OWNER_LOCKED', 'Only the owner can change the owner photo');
  const next = { ...u, photo, hlc: stamp(ctx) };
  await writeUser(ctx, next, 'user.photo', { user: u.username });
  if (ctx.user?.id === u.id) ctx.user = next;
  return next;
}

export async function resetPin(ctx: Ctx, userId: string, pin: string) {
  const u = await ctx.db.users.get(userId);
  if (!u) throw new AppError('NOT_FOUND', 'User not found');
  if (u.id !== ctx.user?.id && !can(ctx.user, 'users.edit')) throw new PermissionError();
  if (u.owner && u.id !== ctx.user?.id) throw new AppError('OWNER_LOCKED', 'Only the owner can change the owner PIN');
  validatePin(pin);
  await writeUser(ctx, { ...u, ...(await hashPin(pin)), hlc: stamp(ctx) }, 'user.pin_reset', { user: u.username });
}

/* ---------------- login / logout ---------------- */

async function checkLock(ctx: Ctx, username: string) {
  const st = await getMeta(ctx.db, `fails:${username}`, { n: 0, until: 0 });
  if (st.until > Date.now()) throw new AppError('LOCKED', `Too many wrong PINs. Try again in ${Math.ceil((st.until - Date.now()) / 60000)} min.`);
  return st;
}

async function verifyUserPin(ctx: Ctx, username: string, pin: string): Promise<User> {
  username = String(username || '').trim().toLowerCase();
  const st = await checkLock(ctx, username);
  const user = await ctx.db.users.where('username').equals(username).filter(u => !u.deleted).first();
  let ok = false;
  if (user?.pinHash && user.pinSalt) ok = safeEqual((await hashPin(pin, user.pinSalt)).pinHash, user.pinHash);
  if (!user || !ok || user.active === false) {
    const n = st.n + 1;
    await setMeta(ctx.db, `fails:${username}`, { n: n >= MAX_FAILS ? 0 : n, until: n >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
    if (user) await recordAuth(ctx, 'auth.login.failed', user.id, { username });
    throw new AppError('BAD_LOGIN', user && ok && user.active === false ? 'This user has been disabled by the owner' : 'Wrong username or PIN');
  }
  await setMeta(ctx.db, `fails:${username}`, { n: 0, until: 0 });
  return user;
}

async function recordAuth(ctx: Ctx, action: string, userId: string, details: unknown) {
  const db = ctx.db;
  await db.transaction('rw', db.audit, db.outbox, async () => {
    const a = await logAuditRow(ctx, action, { entity: 'users', entityId: userId, userId, details: { ...(details as object), deviceId: ctx.deviceId } });
    await enqueue(ctx, makeOp(ctx, 'upsert', [{ tbl: 'audit', row: a }]));
  });
}

export interface Session { userId: string; at: number; serverSession?: string | null; localId: string }

/**
 * Log in with username + PIN. Works offline (checked against this device's full
 * copy of the users list). When the server PC is reachable the login is recorded
 * there straight away; otherwise it is recorded on this device and reported to the
 * server (with the real time) as soon as it is back — so the owner's activity log
 * is always complete.
 */
export async function login(ctx: Ctx, username: string, pin: string, client?: HttpTransport | null): Promise<User> {
  const user = await verifyUserPin(ctx, username, pin);
  ctx.user = user;
  const localId = uuid();
  ctx.localSessionId = localId;
  ctx.sessionId = null;
  if (client && ctx.pairing) {
    try {
      const r = await client.request<{ sessionId: string }>('POST', '/api/login', { username, pin }, { session: false });
      ctx.sessionId = r.sessionId;
    } catch { /* server off — offline login below */ }
  }
  if (!ctx.sessionId) await ctx.db.sessionEvents.add({ type: 'login', localId, userId: user.id, at: new Date().toISOString(), sent: 0 });
  await setMeta(ctx.db, 'session', { userId: user.id, at: Date.now(), serverSession: ctx.sessionId, localId } satisfies Session);
  emit(ctx, 'auth-changed');
  return user;
}

export async function logout(ctx: Ctx, client?: HttpTransport | null, reason = 'Logged out') {
  const u = ctx.user;
  if (u) {
    let recorded = false;
    if (client && ctx.sessionId) {
      try { await client.request('POST', '/api/logout', {}); recorded = true; } catch { /* offline */ }
    }
    if (!recorded) {
      await ctx.db.sessionEvents.add({
        type: 'logout', localId: ctx.localSessionId || '', sessionId: ctx.sessionId || undefined,
        userId: u.id, at: new Date().toISOString(), reason, sent: 0,
      });
    }
  }
  ctx.user = null;
  ctx.sessionId = null;
  ctx.localSessionId = null;
  await setMeta(ctx.db, 'session', null);
  emit(ctx, 'auth-changed');
}

export async function restoreSession(ctx: Ctx, maxAgeMs = 14 * 3600_000): Promise<User | null> {
  const s = await getMeta<Session | null>(ctx.db, 'session', null);
  if (!s || Date.now() - s.at > maxAgeMs) return null;
  const user = await ctx.db.users.get(s.userId);
  if (!user || user.active === false || user.deleted) return null;
  ctx.user = user;
  ctx.sessionId = s.serverSession || null;
  ctx.localSessionId = s.localId;
  return user;
}

/**
 * Called after every sync: if the owner disabled, deleted or force-logged-out the
 * current user, sign them out here too. Also refreshes their permissions.
 */
export async function enforceSession(ctx: Ctx, transport?: HttpTransport | null): Promise<string | null> {
  if (!ctx.user) return null;
  const s = await getMeta<Session | null>(ctx.db, 'session', null);
  const fresh = await ctx.db.users.get(ctx.user.id);
  let reason: string | null = null;
  if (!fresh || fresh.deleted) reason = 'Your account was removed by the owner.';
  else if (fresh.active === false) reason = 'Your account was disabled by the owner.';
  else if (fresh.forceLogoutAt && s && Date.parse(fresh.forceLogoutAt) > s.at) reason = 'The owner signed you out.';
  if (reason) { await logout(ctx, transport, reason); return reason; }
  if (fresh && JSON.stringify(fresh.perms) !== JSON.stringify(ctx.user.perms)) { ctx.user = fresh; emit(ctx, 'auth-changed'); }
  else if (fresh) ctx.user = fresh;
  return null;
}

/** Supervisor override: someone allowed to do it types their username + PIN on this screen. */
export async function verifySupervisor(ctx: Ctx, username: string, pin: string, perm: string): Promise<User> {
  const sup = await verifyUserPin(ctx, username, pin);
  if (!can(sup, perm)) throw new PermissionError(`${sup.name || sup.username} is not allowed to approve this`);
  return sup;
}
