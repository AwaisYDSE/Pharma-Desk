// Main layout: collapsible sidebar (desktop), bottom navigation (phones), top bar
// with connection status, language switch and user menu. Modules the user is not
// allowed to use are simply not shown.
import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../store.tsx';
import { Icon, UserAvatar, Modal, PhotoPicker } from '../components.tsx';
import { Heart } from './About.tsx';
import { setUserPhoto, resetPin } from '../../core/auth.ts';
import { can, MODULES } from '../../../shared/permissions.ts';
import { LANGS } from '../i18n.ts';

const ICONS: Record<string, string> = {
  dashboard: 'grid', pos: 'cart', invoices: 'receipt', inventory: 'box', purchases: 'truck', suppliers: 'factory',
  patients: 'users', alerts: 'bell', reports: 'chart', ai: 'spark', users: 'shield', settings: 'gear',
};

export function Shell({ route, go, children }: { route: string; go: (r: string) => void; children: React.ReactNode }) {
  const { user, t, online, pending, alerts, lang, setLang, logout, ctx, settings, setSettings } = useStore();
  const [collapsed, setCollapsed] = useState(false);
  const [profile, setProfile] = useState(false);
  const allowed = MODULES.filter(m => can(user, m.key));
  const critical = alerts.filter(a => a.level !== 'info').length;
  const mobileTabs = ['pos', 'dashboard', 'inventory', 'alerts'].filter(k => can(user, k)).slice(0, 4);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'F2' && can(user, 'pos')) { e.preventDefault(); go('pos'); setTimeout(() => document.getElementById('pos-search')?.focus(), 50); }
      if (e.altKey && /^[1-9]$/.test(e.key)) { const m = allowed[Number(e.key) - 1]; if (m) { e.preventDefault(); go(m.key); } }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [user, allowed, go]);

  return (
    <div className="shell">
      <nav className={`side ${collapsed ? 'collapsed' : ''}`} aria-label="Main menu">
        <div className="brand">
          <motion.button type="button" className="logo" style={{ border: 0, cursor: 'pointer', overflow: 'hidden', padding: 0, background: '#fff' }} aria-label="Collapse menu" onClick={() => setCollapsed(c => !c)} whileHover={{ rotate: 12, scale: 1.08 }} whileTap={{ scale: .9 }}>
            <img src={settings.logoDataUrl || './brand/logo-mark.png'} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: settings.logoDataUrl ? 0 : 3 }} />
          </motion.button>
          <div className="col brand-text" style={{ gap: 0 }}><strong style={{ fontSize: 16 }}>PharmaDesk</strong><span className="small faint">{ctx.pairing?.serverName || settings.storeName}</span></div>
        </div>
        {allowed.map(m => (
          <button type="button" key={m.key} className={`nav-item ${route === m.key ? 'on' : ''}`} onClick={() => go(m.key)} title={t(m.key)} style={{ position: 'relative' }}>
            {route === m.key && <motion.span layoutId="nav-on" className="nav-glow" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
            <Icon name={ICONS[m.key]} /><span className="lbl">{t(m.key)}</span>
            {m.key === 'alerts' && critical > 0 && <span className="badge warn">{critical}</span>}
          </button>
        ))}
        <button type="button" className={`nav-item ${route === 'about' ? 'on' : ''}`} onClick={() => go('about')} title="About"><Heart size={18} /><span className="lbl">About · Credits</span></button>
        <div className="credit"><span>Developed by</span><br /><strong style={{ color: 'var(--accent)', fontSize: 13 }}>Awais Amin</strong></div>
      </nav>
      <div className="main">
        <header className="topbar">
          <strong className="hide-sm" style={{ fontSize: 15 }}>{t(route)}</strong>
          <span className="spacer" />
          <strong className="small" style={{ display: 'none' }} />
          <span className={`badge ${ctx.standalone ? 'acc' : online ? 'ok' : 'warn'}`} role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px' }}>
            {ctx.standalone ? <Icon name="phone" size={14} /> : online ? <span className="status-dot"><i /><b /></span> : <Icon name="wifiOff" size={14} />}
            {ctx.standalone ? 'This device only' : online ? t('online') : t('offline')}{pending > 0 && <> · <span className="num">{pending}</span> {t('pending')}</>}
          </span>
          <select className="input" style={{ width: 'auto', minHeight: 38 }} aria-label={t('language')} value={lang} onChange={e => setLang(e.target.value as never)}>
            {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <button type="button" className="btn icon sm hide-sm" aria-label={t('theme')} onClick={() => setSettings({ theme: document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches) ? 'light' : 'dark' })}><Icon name="moon" /></button>
          <button type="button" className="row" style={{ gap: 8, border: 0, background: 'none', cursor: 'pointer', padding: 0, color: 'inherit' }} onClick={() => setProfile(true)} aria-label="My profile">
            <UserAvatar user={user} />
            <div className="col hide-sm" style={{ gap: 0, textAlign: 'start' }}><strong className="small">{user?.name}</strong><span className="small faint">{user?.owner ? t('owner') : user?.role}</span></div>
          </button>
          <button type="button" className="btn sm" onClick={() => logout()}><Icon name="logout" size={16} /><span className="hide-sm">{t('logout')}</span></button>
        </header>
        <AnimatePresence mode="wait">
          <motion.main key={route} className="page" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .18 }}>
            {children}
          </motion.main>
        </AnimatePresence>
      </div>
      {profile && <MyProfile onClose={() => setProfile(false)} />}
      <nav className="bottom-nav" aria-label="Quick menu">
        {mobileTabs.map(k => <button type="button" key={k} className={route === k ? 'on' : ''} onClick={() => go(k)}><Icon name={ICONS[k]} size={22} /><span>{t(k)}</span></button>)}
        <button type="button" className={!mobileTabs.includes(route) ? 'on' : ''} onClick={() => go('more')}><Icon name="more" size={22} /><span>More</span></button>
      </nav>
    </div>
  );
}

export function MoreMenu({ go }: { go: (r: string) => void }) {
  const { user, t } = useStore();
  return (
    <div className="grid g-auto">
      {MODULES.filter(m => can(user, m.key)).map(m => (
        <button type="button" key={m.key} className="card row" style={{ cursor: 'pointer', textAlign: 'start' }} onClick={() => go(m.key)}>
          <span className="badge acc" style={{ padding: 10, borderRadius: 12 }}><Icon name={ICONS[m.key]} size={20} /></span><strong>{t(m.key)}</strong>
        </button>
      ))}
      <button type="button" className="card row" style={{ cursor: 'pointer', textAlign: 'start' }} onClick={() => go('about')}>
        <span className="badge acc" style={{ padding: 10, borderRadius: 12 }}><Heart size={20} /></span><strong>About · Credits</strong>
      </button>
    </div>
  );
}

function MyProfile({ onClose }: { onClose: () => void }) {
  const { user, ctx, setUser, toast, t } = useStore();
  const [pin, setPin] = useState('');
  if (!user) return null;
  return (
    <Modal title={user.name} onClose={onClose}>
      <div className="col">
        <PhotoPicker label="My photo" max={192} value={user.photo} onChange={async v => { try { setUser({ ...(await setUserPhoto(ctx, user.id, v)) }); toast('ok', 'Photo saved'); } catch (e) { toast('bad', (e as Error).message); } }} />
        <span className="small muted">@{user.username} · {user.owner ? t('owner') : user.role}</span>
        <form className="row" onSubmit={async e => { e.preventDefault(); try { await resetPin(ctx, user.id, pin); setPin(''); toast('ok', 'PIN changed'); } catch (x) { toast('bad', (x as Error).message); } }}>
          <input className="input" style={{ flex: 1 }} type="password" inputMode="numeric" placeholder="New PIN (6+ digits)" value={pin} onChange={e => setPin(e.target.value)} />
          <button className="btn" disabled={!pin}>{t('resetPin')}</button>
        </form>
      </div>
    </Modal>
  );
}
