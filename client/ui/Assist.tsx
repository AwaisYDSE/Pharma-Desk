// Comfort features: tips that slide in, keyboard help (F1), quick jump (Ctrl+K), and update notices.
// © Awais Amin
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from './store.tsx';
import { Icon, Modal } from './components.tsx';
import { can, moduleOn, NAV_MODULES } from '../../shared/permissions.ts';
import { APP_VERSION } from '../../shared/version.ts';
import { VENDOR } from '../../shared/vendor.ts';
import { compareVersions, updateNeed, type LatestRelease, type UpdateNeed } from '../../shared/update.ts';
import { KEY_NAMES } from '../../shared/keys.ts';
import { UpdateGate } from './screens/Lock.tsx';

const TIPS = [
  'Press F2 from anywhere to start a bill and search for a medicine.',
  'Press F8 to check out and print the bill.',
  'Press F4 on the bill to choose the customer.',
  'Press Ctrl + K to jump to any screen by typing its name.',
  'Press F1 to see every keyboard shortcut.',
  'Use Alt and a number to open a screen from the menu.',
  'A USB barcode scanner works anywhere on the billing screen.',
  'See sales and purchases together in Accounts, under Statements.',
  'Cash book shows exactly how much cash should be in the drawer.',
  'Save a backup regularly from Settings and keep it somewhere safe.',
  'The owner chooses what each user can do in Users & Access.',
  'Everything keeps working without internet and syncs when it is back.',
];
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export function TipSlider() {
  const [off, setOff] = useState(() => get('pd-tips') === 'off');
  const [i, setI] = useState(() => Number(get('pd-tip') || 0) % TIPS.length);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (off) return;
    const first = setTimeout(() => setShow(true), 12_000);
    const every = setInterval(() => setShow(true), 4 * 60_000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [off]);
  useEffect(() => { if (!show) return; const t = setTimeout(() => next(false), 11_000); return () => clearTimeout(t); }, [show, i]);
  const next = (stay: boolean) => { const n = (i + 1) % TIPS.length; setI(n); set('pd-tip', String(n)); setShow(stay); };
  return (
    <AnimatePresence>
      {show && !off && (
        <motion.aside className="tip-slide" initial={{ x: 380, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 380, opacity: 0 }} transition={{ type: 'spring', stiffness: 150, damping: 20 }} role="status">
          <div className="tip-head"><Icon name="chart" size={16} /><strong>Tip</strong><span className="spacer" /><button type="button" className="tip-x" aria-label="Close" onClick={() => setShow(false)}>×</button></div>
          <p>{TIPS[i]}</p>
          <div className="row" style={{ gap: 8 }}><button type="button" className="btn sm" onClick={() => next(true)}>Next tip</button><button type="button" className="btn sm ghost" onClick={() => { set('pd-tips', 'off'); setOff(true); }}>Don't show tips</button></div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

const KEYS: [string, string][] = [
  [KEY_NAMES.help, 'Keyboard help'], [KEY_NAMES.jump, 'Jump to any screen'], [KEY_NAMES.bill, 'New bill, search medicine'], [KEY_NAMES.customer, 'Choose customer'], [KEY_NAMES.rx, 'Prescription reader'],
  [KEY_NAMES.checkout, 'Check out and print'], [KEY_NAMES.reprint, 'Reprint last bill'], [KEY_NAMES.menu, 'Open a screen from the menu'], [KEY_NAMES.close, 'Close or clear'], [KEY_NAMES.list, 'Choose from a list'],
];

export function KeyboardAssist({ go }: { go: (r: string) => void }) {
  const { user, t, shop } = useStore();
  const [help, setHelp] = useState(false), [jump, setJump] = useState(false), [q, setQ] = useState(''), [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const items = useMemo(() => NAV_MODULES.filter(m => can(user, m.key) && moduleOn(m.key, shop)).map(m => ({ key: m.key, label: t(m.label) })), [user, t, shop]);
  const hits = items.filter(m => m.label.toLowerCase().includes(q.trim().toLowerCase()));
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); setHelp(h => !h); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setQ(''); setSel(0); setJump(j => !j); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => { if (jump) setTimeout(() => input.current?.focus(), 30); }, [jump]);
  const open = (r?: string) => { if (r) { go(r); setJump(false); } };
  return (
    <>
      {help && <Modal title="Keyboard shortcuts" onClose={() => setHelp(false)}>
        <table className="t"><tbody>{KEYS.map(([k, l]) => <tr key={k}><td><span className="kbd" dir="ltr">{k}</span></td><td>{l}</td></tr>)}</tbody></table>
      </Modal>}
      <AnimatePresence>
        {jump && <motion.div className="jump-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setJump(false)}>
          <motion.div className="jump" role="dialog" aria-label="Jump to" initial={{ y: -24, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: -24 }} onClick={e => e.stopPropagation()}>
            <input ref={input} autoFocus className="input" placeholder="Type a screen name…" value={q} onChange={e => { setQ(e.target.value); setSel(0); }} onKeyDown={e => {
              if (e.key === 'Escape') setJump(false);
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, hits.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
              if (e.key === 'Enter') open(hits[sel]?.key);
            }} />
            <div className="jump-list">{hits.map((h, i) => <button type="button" key={h.key} className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={() => open(h.key)}>{h.label}</button>)}</div>
          </motion.div>
        </motion.div>}
      </AnimatePresence>
    </>
  );
}

/**
 * The server PC already has a newer version than this open window: fetch the new files and reopen.
 * Returns false if that was just tried and did not help, so a window can never reload for ever.
 */
async function reopenNewVersion(): Promise<boolean> {
  try {
    const last = Number(sessionStorage.getItem('pd-reopened') || 0);
    if (Date.now() - last < 120_000) return false;
    sessionStorage.setItem('pd-reopened', String(Date.now()));
  } catch { /* no storage: still try once */ }
  await Promise.all(['./', './index.html', './app.js', './app.css', './sw.js'].map(u => fetch(u, { cache: 'reload' }).catch(() => null)));
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  await reg?.update().catch(() => {});
  location.reload();
  return true;
}

/** Watches for new versions. Optional: a notice with Later. Must-update: blocks the whole app. */
export function useUpdate() {
  const { isServerPc } = useStore();
  const [latest, setLatest] = useState<LatestRelease | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [later, setLater] = useState(false);
  useEffect(() => {
    const check = () => fetch(`${VENDOR.appUrl.replace(/\/?$/, '/')}version.json?t=${Date.now()}`).then(r => r.ok ? r.json() : null).then(d => { if (d) setLatest(d); }).catch(() => {});
    const a = setTimeout(check, 4000), b = setInterval(check, 30 * 60_000);
    // After the server PC updates, every open window moves to the new version by itself.
    const server = () => fetch('/api/hello').then(r => r.ok ? r.json() : null).then((h: { v?: string } | null) => { if (h?.v && compareVersions(h.v, APP_VERSION) > 0) void reopenNewVersion(); }).catch(() => {});
    const c = setTimeout(server, 1500), d = setInterval(server, 20_000);
    return () => { clearTimeout(a); clearInterval(b); clearTimeout(c); clearInterval(d); };
  }, []);
  const apply = async () => {
    setBusy(true); setError('');
    try {
      if (isServerPc) {
        const r = await fetch('/local/update', { method: 'POST' });
        if (!r.ok) {
          const body = await r.json().catch(() => ({})) as { code?: string; message?: string };
          // The server PC is already on the new version; only this window is behind.
          if (body.code === 'UP_TO_DATE') {
            if (await reopenNewVersion()) return;
            throw new Error('Close PharmaDesk and open it again to finish updating');
          }
          throw new Error(body.message || 'The update could not be installed');
        }
        setError('The installer is opening. Please follow it, then PharmaDesk restarts by itself.');
      } else if (location.href.startsWith(VENDOR.appUrl)) {
        const reg = await navigator.serviceWorker?.getRegistration();
        await reg?.update().catch(() => {});
        location.reload();
      } else setError('Please update PharmaDesk on the shop server PC first.');
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const need: UpdateNeed = updateNeed(APP_VERSION, latest);
  return { need, latest, busy, error, apply, later, setLater };
}

export function UpdateNotice({ u }: { u: ReturnType<typeof useUpdate> }) {
  if (u.need !== 'optional' || u.later) return null;
  return (
    <motion.div className="update-bar" role="status" initial={{ y: 70, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
      <Icon name="download" size={18} />
      <span>New version available: <strong dir="ltr">{u.latest?.version}</strong></span>
      <button type="button" className="btn sm primary" disabled={u.busy} onClick={u.apply}>{u.busy ? 'Updating…' : 'Update now'}</button>
      <button type="button" className="btn sm" onClick={() => u.setLater(true)}>Later</button>
      {u.error && <span className="small">{u.error}</span>}
    </motion.div>
  );
}
export function UpdateBlock({ u }: { u: ReturnType<typeof useUpdate> }) {
  return <UpdateGate version={u.latest?.version || ''} notes={u.latest?.notes} onUpdate={u.apply} busy={u.busy} error={u.error} />;
}
