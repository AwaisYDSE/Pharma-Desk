// Owner supervision: who is working now, per-user module switches, add/delete users,
// log out / disable instantly, full activity log (logins, logouts, server on/off, sales actions).
import React, { useEffect, useState } from 'react';
import { dateLocale } from '../phrases.ts';
import { motion } from 'framer-motion';
import { useStore, useLive } from '../store.tsx';
import { Icon, Modal, Toggle, Empty, Skeleton, useAsync, UserAvatar, PhotoPicker } from '../components.tsx';
import { money } from '../i18n.ts';
import { ROLE_PRESETS, PERMISSION_GROUPS, can } from '../../../shared/permissions.ts';
import { saveUser, setPermission, deleteUser, setUserActive, forceLogout, resetPin, setUserPhoto } from '../../core/auth.ts';
import type { User, AuditEntry } from '../../../shared/types.ts';

interface Person { id: string; name: string; status: string; device: string | null; since: string | null; today: { bills: number; sales: number; discounts: number; voids: number } }
interface Run { started_at: string; stopped_at: string | null; clean: number | null }

const ACTION_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  'auth.login': d => d.offline ? `Logged in on ${d.device || 'a device'} (while server was off)` : `Logged in on ${d.device || 'a device'}`,
  'auth.logout': d => (d.device ? `Logged out on ${d.device}` : 'Logged out') + (d.reason && d.reason !== 'Logged out' ? ` — ${d.reason}` : ''),
  'auth.failed': d => `Wrong PIN on ${d.device || 'a device'}`, 'auth.login.failed': () => 'Wrong PIN',
  'auth.force_logout': () => 'Owner logged this user out', 'server.on': () => 'Server PC turned ON',
  'server.off': d => d.clean ? 'Server PC turned OFF (normal shutdown)' : 'Server PC went OFF unexpectedly (power cut or crash)',
  'user.created': d => `Created user ${d.username}`, 'user.create': d => `Created user ${d.username}`, 'user.deleted': d => `Deleted user ${d.username || d.user}`,
  'user.delete': d => `Deleted user ${d.user}`, 'user.permission': d => `${d.on ? 'Turned ON' : 'Turned OFF'} "${d.perm}" for ${d.user}`,
  'user.disable': d => `Disabled ${d.user}`, 'user.enable': d => `Enabled ${d.user}`, 'user.pin_reset': d => `PIN changed for ${d.user}`,
  'invoice.void': d => `Voided bill ${d.number} — ${d.reason}`, 'pos.fefo_override': () => 'Sold a newer batch (FEFO override)',
  'fefo.reallocated': d => String(d.message || 'Batch reallocated'), 'stock.conflict': d => String(d.message || 'Stock conflict'),
  'stock.adjust': d => `Stock adjusted ${Number(d.delta) > 0 ? '+' : ''}${d.delta} — ${d.reason}`, 'stock.opening': d => `Added stock ${d.qty} (batch ${d.batchNo})`,
  'purchase.receive': () => 'Received a purchase', 'device.paired': d => `New device paired: ${d.name}`, 'device.removed': () => 'A device was removed',
  'settings.ai': () => 'Changed AI settings', 'settings.shop': () => 'Changed shop details', 'shop.setup': () => 'Set up the shop',
  'user.owner_created': () => 'Created the owner account', 'user.photo': () => 'Changed a profile photo',
  'user.update': d => `Updated user ${d.username || d.user || ''}`, 'user.updated': d => `Updated user ${d.username || d.user || ''}`,
  'user.force_logout': d => `Logged out ${d.user || d.username || ''}`, 'auth.blocked': () => 'Blocked a device after wrong PINs',
  'purchase.create': () => 'Created a purchase', 'purchase.update': () => 'Changed a purchase', 'purchase.cancel': () => 'Cancelled a purchase',
  'server.restored': () => 'Data restored from the last good copy after a crash', 'device.reset_all': () => 'All devices were disconnected',
};
const TBL: Record<string, string> = { medicines: 'medicine', suppliers: 'supplier', patients: 'patient', prescriptions: 'repeat prescription', batches: 'batch' };
function describe(action: string, d: Record<string, unknown>) {
  if (ACTION_TEXT[action]) return ACTION_TEXT[action](d);
  const m = action.match(/^(\w+)\.(create|update|delete)$/);
  if (m) return `${m[2] === 'create' ? 'Added' : m[2] === 'update' ? 'Edited' : 'Deleted'} ${TBL[m[1]] || m[1]}${d.name ? ` "${d.name}"` : ''}`;
  return 'Activity';
}
const dotFor = (a: string) => a.startsWith('server') ? 'var(--accent2)' : a.includes('fail') || a.includes('void') || a.includes('delete') || a.includes('conflict') ? 'var(--bad)' : a.startsWith('auth.login') ? 'var(--ok)' : a.startsWith('auth') ? 'var(--faint)' : 'var(--warn)';

export function Users() {
  const { ctx, client, t, lang, user: me, online, toast } = useStore();
  const users = useLive(() => ctx.db.users.filter(u => !u.deleted).toArray(), [], [] as User[]);
  const localLog = useLive(() => ctx.db.audit.orderBy('at').reverse().limit(400).toArray(), [], [] as AuditEntry[]);
  const [live, setLive] = useState<{ people: Person[]; serverRuns: Run[]; devices: { id: string; name: string; last_seen: string; revoked: number }[] } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [pinFor, setPinFor] = useState<User | null>(null);

  useEffect(() => {
    let on = true;
    const load = () => online && ctx.sessionId && client.request<typeof live>('GET', '/api/supervision').then(r => on && setLive(r)).catch(() => {});
    load();
    const id = setInterval(load, 15000);
    return () => { on = false; clearInterval(id); };
  }, [online]); // eslint-disable-line

  const selected = users.find(u => u.id === sel) || null;
  const log = localLog.filter(a => !filter || a.userId === filter);
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast('ok', ok); } catch (e) { toast('bad', (e as Error).message); } };

  return (
    <>
      <div className="row"><div className="col" style={{ gap: 2 }}><span className="small" style={{ color: 'var(--accent)', fontWeight: 800, letterSpacing: '.08em' }}>OWNER SUPERVISION</span><h1>{t('users')}</h1></div>
        <span className="spacer" />{can(me, 'users.create') && <button type="button" className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" /> {t('addUser')}</button>}</div>

      <section aria-label={t('workingNow')} className="grid g-auto">
        {(live?.people || users.map(u => ({ id: u.id, name: u.name, status: u.active === false ? 'disabled' : 'unknown', device: null, since: null, today: { bills: 0, sales: 0, discounts: 0, voids: 0 } }))).map((p, i) => {
          const color = p.status === 'working' ? 'var(--ok)' : p.status === 'away' ? 'var(--warn)' : p.status === 'disabled' ? 'var(--bad)' : 'var(--faint)';
          return (
            <motion.button type="button" key={p.id} className="card col" style={{ gap: 6, cursor: 'pointer', textAlign: 'start' }} onClick={() => setSel(p.id)} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .04 }}>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <UserAvatar user={users.find(u => u.id === p.id) || p} size={40} />
                <div className="col" style={{ gap: 0, flex: 1 }}><strong>{p.name}</strong><span className="small muted">{p.device ? `${p.device} · since ${new Date(p.since!).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })}` : live ? 'Not logged in' : 'Connect to server for live status'}</span></div>
                <span className="small" style={{ color, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="status-dot" style={{ color }}>{p.status === 'working' && <i />}<b /></span>{p.status}</span>
              </div>
              {live && <span className="small muted num">{p.today.bills} bills · {money(p.today.sales, lang)} · {p.today.voids} voids</span>}
            </motion.button>
          );
        })}
        {live?.serverRuns?.[0] && <div className="card col" style={{ gap: 6 }}>
          <div className="row"><Icon name="pc" /><strong>Server PC</strong><span className="spacer" /><span className="badge ok">running</span></div>
          <span className="small muted">On since {new Date(live.serverRuns[0].started_at).toLocaleString(dateLocale())}</span>
          {live.serverRuns[1] && <span className="small muted">Last off: {new Date(live.serverRuns[1].stopped_at!).toLocaleString(dateLocale())} ({live.serverRuns[1].clean ? 'normal' : 'power cut'})</span>}
        </div>}
      </section>

      <div className="grid g-2" style={{ alignItems: 'start' }}>
        <section className="card col" style={{ gap: 6 }}>
          <h2>{selected ? `${selected.name} — what they can use` : 'Choose a user'}</h2>
          <div className="col" style={{ gap: 4 }}>
            {users.map(u => <button type="button" key={u.id} className={`result ${sel === u.id ? 'sel' : ''}`} style={{ borderRadius: 12 }} onClick={() => setSel(u.id)}>
              <UserAvatar user={u} size={36} />
              <div className="col" style={{ gap: 0, flex: 1 }}><strong>{u.name}</strong><span className="small muted">@{u.username} · {ROLE_PRESETS[u.role]?.label || u.role}</span></div>
              {u.owner && <span className="badge acc"><Icon name="lock" size={12} /> {t('owner')}</span>}
              {u.active === false && <span className="badge bad">disabled</span>}
            </button>)}
          </div>
          {selected && (!selected.owner || selected.id === me?.id) && <div style={{ marginTop: 8 }}><PhotoPicker label={`Photo of ${selected.name}`} max={192} value={selected.photo} onChange={v => act(() => setUserPhoto(ctx, selected.id, v), 'Photo saved')} /></div>}
          {selected && !selected.owner && <>
            <div className="row" style={{ marginTop: 8 }}>
              {can(me, 'users.logout') && <button type="button" className="btn sm danger" onClick={() => act(() => forceLogout(ctx, selected.id).then(() => client.request('POST', `/api/users/${selected.id}/logout`).catch(() => {})), 'Logged out')}>{t('logoutNow')}</button>}
              {can(me, 'users.edit') && <button type="button" className="btn sm" onClick={() => act(() => setUserActive(ctx, selected.id, selected.active === false), selected.active === false ? t('enable') : t('disable'))}>{selected.active === false ? t('enable') : t('disable')}</button>}
              {can(me, 'users.edit') && <button type="button" className="btn sm" onClick={() => setPinFor(selected)}>{t('resetPin')}</button>}
              {can(me, 'users.delete') && <button type="button" className="btn sm danger" onClick={() => confirm(t('confirmDelete')) && act(async () => { await deleteUser(ctx, selected.id); setSel(null); }, 'Deleted')}><Icon name="trash" size={14} /> {t('delete')}</button>}
            </div>
            {can(me, 'users.edit') ? <>
              <label className="field">{t('role')} (quick preset — then switch anything on or off below)<select className="input" value={ROLE_PRESETS[selected.role] ? selected.role : 'custom'} onChange={e => e.target.value !== 'custom' && act(() => saveUser(ctx, { ...selected, role: e.target.value, perms: ROLE_PRESETS[e.target.value]?.perms || selected.perms }), t('save'))}>
                {Object.entries(ROLE_PRESETS).filter(([k]) => k !== 'admin' || me?.owner).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}<option value="custom">Custom</option></select></label>
              <PermissionEditor user={selected} onToggle={(perm, on, label) => act(() => setPermission(ctx, selected.id, perm, on), `${label}: ${on ? 'ON' : 'OFF'}`)} />
            </> : <p className="small muted">You can see this user but you are not allowed to change their permissions.</p>}
          </>}
          {selected?.owner && <p className="small muted">The owner account is locked: it always has every permission and can't be disabled or deleted.</p>}
        </section>

        <section className="card col" style={{ gap: 2 }} aria-label={t('activityLog')}>
          <div className="row" style={{ marginBottom: 6 }}><h2 style={{ margin: 0 }}>{t('activityLog')}</h2><span className="spacer" />
            <select className="input" style={{ width: 'auto', minHeight: 36 }} value={filter} onChange={e => setFilter(e.target.value)}><option value="">{t('all')}</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
          {localLog.length === 0 ? <><Skeleton /><Skeleton w="70%" /></> : log.length === 0 ? <Empty icon="receipt" text="Nothing recorded yet" /> :
            log.slice(0, 200).map(a => {
              const d = (a.details || {}) as Record<string, unknown>;
              const who = a.userName || users.find(u => u.id === a.userId)?.name || (a.action.startsWith('server') ? 'Server' : '—');
              return (
                <div key={a.id} className="row" style={{ padding: '7px 0', borderTop: '1px solid var(--line)', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <span className="num small faint" style={{ width: 92, flexShrink: 0 }}>{new Date((d.at as string) || a.at).toLocaleString(dateLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: dotFor(a.action), marginTop: 6, flexShrink: 0 }} />
                  <div className="col" style={{ gap: 0 }}><strong className="small">{who}</strong><span className="small muted">{describe(a.action, d)}</span></div>
                </div>
              );
            })}
        </section>
      </div>

      {live?.devices && <section className="card"><h2>{t('devices')}</h2>
        {live.devices.map(d => <div key={d.id} className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}><Icon name={/phone|android|iphone/i.test(d.name) ? 'phone' : 'pc'} /><strong>{d.name}</strong>
          <span className="small muted">last seen {new Date(d.last_seen).toLocaleString(dateLocale())}</span><span className="spacer" />
          {d.revoked ? <span className="badge bad">removed</span> : <button type="button" className="btn sm danger" onClick={() => confirm('Remove this device? It will need the Server PIN to connect again.') && act(() => client.request('POST', `/api/devices/${d.id}/revoke`), 'Device removed')}>Remove</button>}</div>)}
      </section>}

      {adding && <AddUser onClose={() => setAdding(false)} />}
      {pinFor && <Modal title={`${t('resetPin')} — ${pinFor.name}`} onClose={() => setPinFor(null)}><PinForm onSave={async p => { await resetPin(ctx, pinFor.id, p); setPinFor(null); toast('ok', t('save')); }} /></Modal>}
    </>
  );
}

function PinForm({ onSave }: { onSave: (pin: string) => Promise<void> }) {
  const [p, setP] = useState('');
  const a = useAsync(() => onSave(p));
  return <form className="col" onSubmit={e => { e.preventDefault(); void a.run(); }}><input className="input" type="password" inputMode="numeric" autoFocus placeholder="New PIN (6+ digits)" value={p} onChange={e => setP(e.target.value)} />{a.err && <span className="err">{a.err}</span>}<button className="btn primary" disabled={a.busy}>Save</button></form>;
}

function AddUser({ onClose }: { onClose: () => void }) {
  const { ctx, t, toast, user } = useStore();
  const [f, setF] = useState({ name: '', username: '', role: 'cashier', pin: '', email: '', photo: null as string | null });
  const a = useAsync(async () => {
    await saveUser(ctx, { name: f.name, username: f.username, role: f.role, email: f.email, perms: ROLE_PRESETS[f.role].perms, photo: f.photo }, f.pin);
    toast('ok', `${f.name} added`); onClose();
  });
  return (
    <Modal title={t('addUser')} onClose={onClose}>
      <form className="col" onSubmit={e => { e.preventDefault(); void a.run(); }}>
        <PhotoPicker label="Photo (optional)" max={192} value={f.photo} onChange={v => setF({ ...f, photo: v })} />
        <label className="field">{t('name')}<input className="input" required autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">{t('username')}<input className="input" required autoCapitalize="none" value={f.username} onChange={e => setF({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, '') })} /></label>
        <label className="field">{t('role')}<select className="input" value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>
          {Object.entries(ROLE_PRESETS).filter(([k]) => k !== 'admin' || user?.owner).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <span className="small muted">You can switch each module on or off for this person after saving.</span>
        <label className="field">{t('pin')}<input className="input" type="password" inputMode="numeric" required value={f.pin} onChange={e => setF({ ...f, pin: e.target.value })} /></label>
        {a.err && <span className="err">{a.err}</span>}
        <button className="btn primary" disabled={a.busy}>{t('save')}</button>
      </form>
    </Modal>
  );
}

/** Every module with its own on/off switch, and inside it every single action. */
function PermissionEditor({ user, onToggle }: { user: User; onToggle: (perm: string, on: boolean, label: string) => void }) {
  const admin = user.role === 'admin';
  const has = (k: string) => admin || user.perms.includes(k);
  return (
    <div className="col" style={{ gap: 8 }}>
      {PERMISSION_GROUPS.map(g => {
        const on = has(g.key);
        return (
          <div key={g.key} className="perm-group" data-on={on}>
            <label className="row" style={{ flexWrap: 'nowrap' }}>
              <Toggle on={on} disabled={admin} label={g.label} onChange={v => onToggle(g.key, v, g.label)} />
              <strong className="small" style={{ flex: 1 }}>{g.label}</strong>
              {g.actions.length > 0 && <span className="small faint">{g.actions.filter(a => has(a.key)).length}/{g.actions.length}</span>}
            </label>
            {g.actions.length > 0 && <div className="perm-actions">
              {g.actions.map(a => (
                <label key={a.key} className="row" style={{ flexWrap: 'nowrap', opacity: on ? 1 : .45 }}>
                  <Toggle on={has(a.key)} disabled={admin || !on} label={a.label} onChange={v => onToggle(a.key, v, a.label)} />
                  <span className="small">{a.label}</span>
                </label>
              ))}
            </div>}
          </div>
        );
      })}
    </div>
  );
}
