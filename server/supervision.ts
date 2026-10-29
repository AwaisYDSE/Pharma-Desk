// Owner supervision: users, login/logout sessions, server on/off history,
// "who is working now", and remote force-logout.
// © Awais Amin
import crypto from 'node:crypto';
import type { DB } from './db.ts';
import { getRow, allRows, putRow, tx } from './db.ts';
import { serverClock } from './ops.ts';
import { uuid, AppError } from '../shared/util.ts';
import { ROLE_PRESETS, ALL_PERMS, can } from '../shared/permissions.ts';
import type { User, AuditEntry } from '../shared/types.ts';

const ITER = 210000;

export function hashPin(pin: string, salt?: string) {
  const s = salt ? Buffer.from(salt, 'base64') : crypto.randomBytes(16);
  const h = crypto.pbkdf2Sync(String(pin), s, ITER, 32, 'sha256');
  return { pinHash: h.toString('base64'), pinSalt: s.toString('base64') };
}
export function pinMatches(user: User, pin: string): boolean {
  if (!user.pinHash || !user.pinSalt) return false;
  const a = Buffer.from(hashPin(pin, user.pinSalt).pinHash, 'base64');
  const b = Buffer.from(user.pinHash, 'base64');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function validatePin(pin: string) {
  if (!/^\d{6,}$/.test(String(pin || '')) && String(pin || '').length < 8) throw new AppError('WEAK_PIN', 'Use a PIN of at least 6 digits, or a password of at least 8 characters');
}

export function logEvent(db: DB, action: string, details: Record<string, unknown> = {}, userId: string | null = null, userName: string | null = null, deviceId = 'server') {
  const row: AuditEntry = { id: uuid(), at: new Date().toISOString(), userId, userName, deviceId, action, entity: null, entityId: null, details };
  putRow(db, 'audit', row, serverClock.tick());
  return row;
}

export const userCount = (db: DB) => (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE deleted = 0`).get() as { n: number }).n;

/** First start: creates the owner (admin). Only works while there are no users. */
export function createOwner(db: DB, data: { name: string; username: string; pin: string; email?: string; photo?: string | null }): User {
  return tx(db, () => {
    if (userCount(db) > 0) throw new AppError('EXISTS', 'The owner account already exists');
    validatePin(data.pin);
    const user: User = {
      id: uuid(), username: data.username.trim().toLowerCase(), name: data.name.trim(), email: data.email || '',
      role: 'admin', perms: ALL_PERMS, active: true, owner: true, photo: data.photo || null, ...hashPin(data.pin),
    } as User;
    putRow(db, 'users', user, serverClock.tick());
    logEvent(db, 'user.owner_created', { username: user.username }, user.id, user.name);
    return user;
  });
}

export interface UserInput { id?: string; username: string; name: string; email?: string; role: string; perms?: string[]; active?: boolean; pin?: string }

export function saveUser(db: DB, actor: User, input: UserInput): User {
  if (!can(actor, input.id ? 'users.edit' : 'users.create')) throw new AppError('FORBIDDEN', input.id ? 'Not allowed to modify users' : 'Not allowed to create users');
  return tx(db, () => {
    const existing = input.id ? getRow<User>(db, 'users', input.id) : null;
    const isOwner = !!(existing as User & { owner?: boolean } | null)?.owner;
    if (isOwner && actor.id !== existing!.id) throw new AppError('LOCKED', 'The owner account can only be changed by the owner');
    const username = input.username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,30}$/.test(username)) throw new AppError('INVALID', 'Username: 2–30 letters, numbers, dot, dash');
    const clash = allRows<User>(db, 'users', `WHERE username = ? AND deleted = 0`, username).find(u => u.id !== input.id);
    if (clash) throw new AppError('DUPLICATE', 'That username is taken');
    if (!existing && !input.pin) throw new AppError('INVALID', 'Set a PIN for the new user');
    if (input.pin) validatePin(input.pin);
    // Only the owner can create other admins.
    const role = isOwner ? 'admin' : (input.role === 'admin' && !(actor as User & { owner?: boolean }).owner ? 'pharmacist' : input.role);
    const perms = role === 'admin' ? ALL_PERMS : (input.perms ?? ROLE_PRESETS[role]?.perms ?? []).filter(p => ALL_PERMS.includes(p));
    const user: User = {
      ...(existing || {}), id: existing?.id || uuid(), username, name: input.name.trim(), email: input.email || '',
      role, perms, active: isOwner ? true : input.active !== false,
      ...(input.pin ? hashPin(input.pin) : {}),
    } as User;
    putRow(db, 'users', user, serverClock.tick());
    const changes: Record<string, unknown> = { username, role, perms, active: user.active };
    if (existing) {
      const added = perms.filter(p => !existing.perms.includes(p)), removed = existing.perms.filter(p => !perms.includes(p));
      Object.assign(changes, { added, removed, pinReset: !!input.pin, wasActive: existing.active });
    }
    logEvent(db, existing ? 'user.updated' : 'user.created', changes, actor.id, actor.name);
    if (existing && existing.active && !user.active) forceLogout(db, actor, user.id, 'Account disabled');
    return user;
  });
}

export function deleteUser(db: DB, actor: User, userId: string) {
  if (!can(actor, 'users.delete')) throw new AppError('FORBIDDEN', 'Not allowed to delete users');
  const u = getRow<User & { owner?: boolean }>(db, 'users', userId);
  if (!u || u.deleted) throw new AppError('NOT_FOUND', 'User not found');
  if (u.owner) throw new AppError('LOCKED', 'The owner account cannot be deleted');
  if (u.id === actor.id) throw new AppError('LOCKED', 'You cannot delete yourself');
  tx(db, () => {
    // Soft delete: their past sales and log entries keep their name.
    putRow(db, 'users', { ...u, active: false, deleted: true, pinHash: undefined, pinSalt: undefined } as User, serverClock.tick());
    forceLogout(db, actor, u.id, 'Account deleted');
    logEvent(db, 'user.deleted', { username: u.username, name: u.name }, actor.id, actor.name);
  });
}

/* ---------------- sessions (login / logout / who is working) ---------------- */

export function openSessionTable(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT, device_name TEXT,
    login_at TEXT NOT NULL, last_seen TEXT NOT NULL, logout_at TEXT, logout_reason TEXT, offline INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS server_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, last_beat TEXT NOT NULL, stopped_at TEXT, clean INTEGER);`);
}

export function login(db: DB, username: string, pin: string, device: { id: string; name: string }, opts: { at?: string; offline?: boolean } = {}) {
  const u = allRows<User>(db, 'users', `WHERE username = ? AND deleted = 0`, username.trim().toLowerCase())[0];
  if (!u || !pinMatches(u, pin)) {
    logEvent(db, 'auth.failed', { username, device: device.name }, u?.id ?? null, u?.name ?? null, device.id);
    throw new AppError('BAD_LOGIN', 'Wrong username or PIN');
  }
  if (u.active === false) {
    logEvent(db, 'auth.blocked', { reason: 'disabled', device: device.name }, u.id, u.name, device.id);
    throw new AppError('DISABLED', 'Your account has been disabled by the owner');
  }
  return startSession(db, u, device, opts);
}

export function startSession(db: DB, u: User, device: { id: string; name: string }, opts: { at?: string; offline?: boolean } = {}) {
  const id = uuid(), at = opts.at || new Date().toISOString();
  db.prepare(`INSERT INTO sessions(id, user_id, device_id, device_name, login_at, last_seen, offline) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, u.id, device.id, device.name, at, at, opts.offline ? 1 : 0);
  logEvent(db, 'auth.login', { device: device.name, offline: !!opts.offline, at }, u.id, u.name, device.id);
  return { sessionId: id, user: u };
}

export function logout(db: DB, sessionId: string, reason = 'Logged out', at?: string) {
  const s = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as Record<string, string> | undefined;
  if (!s || s.logout_at) return;
  const when = at || new Date().toISOString();
  db.prepare(`UPDATE sessions SET logout_at = ?, logout_reason = ? WHERE id = ?`).run(when, reason, sessionId);
  const u = getRow<User>(db, 'users', s.user_id);
  logEvent(db, 'auth.logout', { device: s.device_name, reason, at: when }, s.user_id, u?.name ?? null, s.device_id);
}

export function touchSession(db: DB, sessionId: string): { ok: boolean; reason?: string } {
  const s = db.prepare(`SELECT s.*, 0 AS x FROM sessions s WHERE id = ?`).get(sessionId) as Record<string, string> | undefined;
  if (!s) return { ok: false, reason: 'Session not found' };
  if (s.logout_at) return { ok: false, reason: s.logout_reason || 'Logged out' };
  const u = getRow<User>(db, 'users', s.user_id);
  if (!u || u.deleted || u.active === false) { logout(db, sessionId, 'Account disabled'); return { ok: false, reason: 'Account disabled' }; }
  db.prepare(`UPDATE sessions SET last_seen = ? WHERE id = ?`).run(new Date().toISOString(), sessionId);
  return { ok: true };
}

export function forceLogout(db: DB, actor: User, userId: string, reason = 'Logged out by the owner') {
  if (!can(actor, 'users.logout') && actor.id !== userId) throw new AppError('FORBIDDEN', 'Not allowed to log users out');
  const open = db.prepare(`SELECT id FROM sessions WHERE user_id = ? AND logout_at IS NULL`).all(userId) as { id: string }[];
  for (const s of open) logout(db, s.id, reason);
  logEvent(db, 'auth.force_logout', { userId, sessions: open.length, reason }, actor.id, actor.name);
  return open.length;
}

/** Who is working now + today's numbers per user. Sessions idle > 3 min show as "away". */
export function workingNow(db: DB) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const since = today.toISOString();
  const users = allRows<User & { owner?: boolean }>(db, 'users', `WHERE deleted = 0`);
  const sales = db.prepare(`SELECT json_extract(data,'$.cashierId') AS uid, COUNT(*) AS n, SUM(json_extract(data,'$.total')) AS total,
      SUM(json_extract(data,'$.discount')) AS disc, SUM(CASE WHEN status='void' THEN 1 ELSE 0 END) AS voids
      FROM invoices WHERE created_at >= ? GROUP BY uid`).all(since) as { uid: string; n: number; total: number; disc: number; voids: number }[];
  const byUser = new Map(sales.map(s => [s.uid, s]));
  return users.map(u => {
    const s = db.prepare(`SELECT * FROM sessions WHERE user_id = ? ORDER BY login_at DESC LIMIT 1`).get(u.id) as Record<string, string> | undefined;
    const open = s && !s.logout_at;
    const idle = s ? Date.now() - Date.parse(s.last_seen) : Infinity;
    const st = byUser.get(u.id);
    return {
      id: u.id, name: u.name, username: u.username, role: u.role, active: u.active, owner: !!u.owner,
      status: !u.active ? 'disabled' : open ? (idle < 3 * 60_000 ? 'working' : 'away') : 'off',
      device: s?.device_name || null, since: open ? s!.login_at : null, lastLogout: s?.logout_at || null,
      today: { bills: st?.n || 0, sales: st?.total || 0, discounts: st?.disc || 0, voids: st?.voids || 0 },
    };
  });
}

/* ---------------- server on / off history ---------------- */

/**
 * Called once at start. If the previous run never recorded a clean stop, it was a
 * power cut or crash — logged as such, with the last heartbeat as the "off" time.
 */
export function serverStarted(db: DB): number {
  const prev = db.prepare(`SELECT * FROM server_runs ORDER BY id DESC LIMIT 1`).get() as Record<string, string | number> | undefined;
  if (prev && !prev.stopped_at) {
    db.prepare(`UPDATE server_runs SET stopped_at = last_beat, clean = 0 WHERE id = ?`).run(prev.id);
    logEvent(db, 'server.off', { at: prev.last_beat, clean: false, message: 'Server PC switched off unexpectedly (power cut or crash)' });
  }
  const now = new Date().toISOString();
  const r = db.prepare(`INSERT INTO server_runs(started_at, last_beat) VALUES (?, ?) RETURNING id`).get(now, now) as { id: number };
  logEvent(db, 'server.on', { at: now });
  // Close sessions left open by the previous run.
  db.prepare(`UPDATE sessions SET logout_at = last_seen, logout_reason = 'Server restarted' WHERE logout_at IS NULL AND offline = 0 AND last_seen < ?`).run(now);
  return r.id;
}
export function serverHeartbeat(db: DB, runId: number) {
  db.prepare(`UPDATE server_runs SET last_beat = ? WHERE id = ?`).run(new Date().toISOString(), runId);
}
export function serverStopped(db: DB, runId: number) {
  const now = new Date().toISOString();
  db.prepare(`UPDATE server_runs SET stopped_at = ?, clean = 1, last_beat = ? WHERE id = ?`).run(now, now, runId);
  logEvent(db, 'server.off', { at: now, clean: true });
}
export function serverRuns(db: DB, limit = 30) {
  return db.prepare(`SELECT * FROM server_runs ORDER BY id DESC LIMIT ?`).all(limit);
}

/** Activity log, newest first, optionally for one user / one day. */
export function activity(db: DB, opts: { userId?: string; day?: string; limit?: number } = {}) {
  let where = 'WHERE 1=1';
  const params: (string | number)[] = [];
  if (opts.userId) { where += ` AND json_extract(data,'$.userId') = ?`; params.push(opts.userId); }
  if (opts.day) { where += ` AND at >= ? AND at < ?`; params.push(`${opts.day}T00:00:00`, `${opts.day}T99`); }
  return allRows<AuditEntry>(db, 'audit', `${where} ORDER BY at DESC LIMIT ${Math.min(opts.limit || 300, 2000)}`, ...params);
}
