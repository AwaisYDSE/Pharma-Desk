// Owner supervision: users, permissions, login/logout log, server on/off history.
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { startShop, stop, addUser, newDevice, type Shop } from './helpers.ts';
import * as sup from '../server/supervision.ts';
import { openDb } from '../server/db.ts';
import { ensureIdentity } from '../server/identity.ts';
import { login, logout, enforceSession } from '../client/core/auth.ts';
import { can } from '../shared/permissions.ts';

const shops: Shop[] = [];
afterEach(async () => { while (shops.length) await stop(shops.pop()!); });

const actions = (db: Shop['db']) => sup.activity(db).map(a => a.action);

describe('Users and permissions', () => {
  it('the owner is created once and can never be deleted or disabled', async () => {
    const S = await startShop(); shops.push(S);
    expect(() => sup.createOwner(S.db, { name: 'x', username: 'x', pin: '123456' })).toThrow(/already exists/);
    expect(() => sup.deleteUser(S.db, S.owner, S.owner.id)).toThrow();
    const mgr = sup.saveUser(S.db, S.owner, { username: 'mgr', name: 'Manager', role: 'custom', perms: ['users', 'users.create', 'users.edit', 'users.delete', 'users.logout'], pin: '333333' });
    expect(() => sup.deleteUser(S.db, mgr, S.owner.id)).toThrow(/owner/i);
    expect(() => sup.saveUser(S.db, mgr, { id: S.owner.id, username: 'owner', name: 'x', role: 'cashier', active: false })).toThrow(/owner/i);
  });

  it('per-user module switches: a module turned off is refused', async () => {
    const S = await startShop(); shops.push(S);
    const u = sup.saveUser(S.db, S.owner, { username: 'sana', name: 'Sana', role: 'cashier', perms: ['pos', 'invoices'], pin: '222222' });
    expect(can(u, 'pos')).toBe(true);
    expect(can(u, 'reports')).toBe(false);
    const off = sup.saveUser(S.db, S.owner, { id: u.id, username: 'sana', name: 'Sana', role: 'cashier', perms: ['invoices'] });
    expect(can(off, 'pos')).toBe(false);
    const log = sup.activity(S.db).find(a => a.action === 'user.updated')!;
    expect((log.details as { removed: string[] }).removed).toEqual(['pos']);
  });

  it('deleting a user keeps their history and blocks their login', async () => {
    const S = await startShop(); shops.push(S);
    const u = addUser(S, 'bilal');
    sup.deleteUser(S.db, S.owner, u.id);
    expect(() => sup.login(S.db, 'bilal', '222222', { id: 'd', name: 'Phone' })).toThrow();
    expect(actions(S.db)).toContain('user.deleted');
  });
});

describe('Activity log', () => {
  it('records every login and logout with time and device; failed PINs too', async () => {
    const S = await startShop(); shops.push(S);
    addUser(S, 'sana');
    const dev = await newDevice(S, 'Counter 1');
    await expect(login(dev.ctx, 'sana', '999999', dev.client)).rejects.toThrow(/Wrong/);
    await login(dev.ctx, 'sana', '222222', dev.client);
    expect(dev.ctx.sessionId).toBeTruthy();
    const now = sup.workingNow(S.db).find(p => p.username === 'sana')!;
    expect(now.status).toBe('working');
    expect(now.device).toBe('Counter 1');
    await logout(dev.ctx, dev.client);
    const log = sup.activity(S.db);
    const lin = log.find(a => a.action === 'auth.login')!, lout = log.find(a => a.action === 'auth.logout')!;
    expect((lin.details as { device: string }).device).toBe('Counter 1');
    expect(Date.parse(lout.at)).toBeGreaterThanOrEqual(Date.parse(lin.at));
    expect(sup.workingNow(S.db).find(p => p.username === 'sana')!.status).toBe('off');
  });

  it('owner "Log out now" ends the worker session on the server and on the device', async () => {
    const S = await startShop(); shops.push(S);
    const u = addUser(S, 'sana');
    const dev = await newDevice(S);
    await login(dev.ctx, 'sana', '222222', dev.client);
    sup.forceLogout(S.db, S.owner, u.id);
    const r = await request(S.app).post('/api/heartbeat').set('authorization', `Bearer ${dev.ctx.pairing!.token}`).set('x-session', dev.ctx.sessionId!);
    expect(r.status).toBe(401);
    // Disabling the account also signs the device out after its next sync.
    sup.saveUser(S.db, S.owner, { id: u.id, username: 'sana', name: 'sana', role: 'cashier', active: false });
    await dev.sync.pull();
    expect(await enforceSession(dev.ctx, dev.client)).toMatch(/disabled/);
    expect(dev.ctx.user).toBeNull();
  });

  it('only users with the Users module can open the supervision screen', async () => {
    const S = await startShop(); shops.push(S);
    addUser(S, 'sana');
    const dev = await newDevice(S);
    await login(dev.ctx, 'sana', '222222', dev.client);
    await expect(dev.client.request('GET', '/api/supervision')).rejects.toThrow(/permission/);
    await logout(dev.ctx, dev.client);
    await login(dev.ctx, 'owner', '111111', dev.client);
    const r = await dev.client.request<{ people: unknown[]; serverRuns: unknown[] }>('GET', '/api/supervision');
    expect(r.people.length).toBe(2);
  });
});

describe('Server on / off history', () => {
  it('logs clean shutdowns and detects power cuts', () => {
    const db = openDb(':memory:');
    ensureIdentity(db); sup.openSessionTable(db);
    const run1 = sup.serverStarted(db);
    sup.serverHeartbeat(db, run1);
    sup.serverStopped(db, run1);                  // normal shutdown
    sup.serverStarted(db);                        // … then the power goes, no stop recorded
    sup.serverStarted(db);                        // next morning
    const offs = sup.activity(db).filter(a => a.action === 'server.off').map(a => (a.details as { clean: boolean }).clean);
    expect(offs.sort()).toEqual([false, true]);
    expect(sup.activity(db).filter(a => a.action === 'server.on')).toHaveLength(3);
    const runs = sup.serverRuns(db) as { clean: number | null }[];
    expect(runs.map(r => r.clean)).toEqual([null, 0, 1]);
  });
});
