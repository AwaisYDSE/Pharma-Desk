import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from './store.tsx';

const P: Record<string, string> = {
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  cart: 'M3 4h2l2.4 11h11L21 7H7M9 20h.01M18 20h.01',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  truck: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01',
  factory: 'M3 21V9l6 4V9l6 4V5h6v16z',
  users: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.8M16 4.2a3 3 0 0 1 0 5.6',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21h-4v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1-2.8-2.8.1-.1A1.7 1.7 0 0 0 3 15v-4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1 2.8-2.8.1.1A1.7 1.7 0 0 0 10 3.2V3h4v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 0 0 1.2 2.9h.1v4z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  scan: 'M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M7 12h10',
  plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6 6 18', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  menu: 'M4 6h16M4 12h16M4 18h16', logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11', wifi: 'M2 8.8a15 15 0 0 1 20 0M5 12.9a10 10 0 0 1 14 0M8.5 16.4a5 5 0 0 1 7 0M12 20h.01',
  wifiOff: 'M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5a15 15 0 0 1 11.3 3.8M5 12.9a10 10 0 0 1 3.4-2M15.6 11a10 10 0 0 1 3.4 1.9M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M2 2l20 20',
  warn: 'M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', check: 'M5 12l5 5L20 7',
  server: 'M4 3h16v6H4zM4 13h16v6H4zM8 6h.01M8 16h.01', print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z', download: 'M12 4v12M6 10l6 6 6-6M4 20h16', camera: 'M4 8h3l2-3h6l2 3h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  rx: 'M6 3h9l4 4v14H6zM9 12h6M9 16h4', globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2', pc: 'M3 4h18v12H3zM8 20h8M12 16v4',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z', home: 'M3 11 12 3l9 8v10H3z', more: 'M5 12h.01M12 12h.01M19 12h.01', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
};

export function Icon({ name, size = 18, className }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] || P.more} />
    </svg>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <motion.div className="modal-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide ? 'wide' : ''}`} initial={{ y: 24, scale: .97, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 30 }}>
        <div className="row" style={{ marginBottom: 6 }}><h2 style={{ margin: 0 }}>{title}</h2><span className="spacer" /><button type="button" className="btn icon ghost" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        {children}
      </motion.div>
    </motion.div>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" className="toggle" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

export function Toasts() {
  const { toasts, dismiss } = useStore();
  const icon = { ok: 'check', warn: 'warn', bad: 'warn', info: 'bell' } as const;
  const color = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', info: 'var(--info)' };
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div key={t.id} className={`toast ${t.kind}`} initial={{ y: 20, opacity: 0, scale: .96 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ opacity: 0, x: 40 }} layout>
            <span style={{ color: color[t.kind] }}><Icon name={icon[t.kind]} size={22} /></span>
            <div className="col" style={{ gap: 2, flex: 1 }}><strong>{t.title}</strong>{t.body && <span className="small muted">{t.body}</span>}</div>
            <button type="button" className="btn icon ghost sm" aria-label="Dismiss" onClick={() => dismiss(t.id)}><Icon name="x" size={14} /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** The checkout patient: idle, happy when items are added, worried on warnings, celebrating on checkout. */
export type Mood = 'idle' | 'happy' | 'worried' | 'party';
export function PatientAvatar({ mood, size = 112 }: { mood: Mood; size?: number }) {
  const mouth = mood === 'worried' ? 'M47 66c5-5 13-5 18 0' : mood === 'idle' ? 'M48 63h16' : 'M46 61c5 7 15 7 20 0';
  return (
    <motion.svg width={size} height={size * 1.1} viewBox="0 0 112 124" role="img" aria-label={`Patient is ${mood}`}
      animate={mood === 'party' ? { y: [0, -16, 0, -10, 0], rotate: [0, -4, 4, 0] } : mood === 'worried' ? { x: [0, -3, 3, -2, 0] } : { y: [0, -5, 0] }}
      transition={mood === 'idle' || mood === 'happy' ? { repeat: Infinity, duration: 3, ease: 'easeInOut' } : { duration: .8 }}>
      <ellipse cx="56" cy="118" rx="34" ry="5" fill="rgba(0,0,0,.25)" />
      <path d="M18 112c2-26 18-38 38-38s36 12 38 38z" fill="#0D9488" />
      <path d="M48 76h16v10l-8 6-8-6z" fill="#F1F5F9" />
      <circle cx="56" cy="48" r="28" fill="#F5C9A6" />
      <path d="M28 44c0-18 12-28 28-28s28 10 28 26c-6-6-14-8-22-8-12 0-22-4-28 4-2 2-4 4-6 6z" fill="#1E293B" />
      {mood === 'worried' && <path d="M40 42l10 3M72 42l-10 3" stroke="#1E293B" strokeWidth="2.4" strokeLinecap="round" />}
      <ellipse className="eye" cx="46" cy="51" rx="3" ry="3.6" fill="#0F172A" />
      <ellipse className="eye" cx="66" cy="51" rx="3" ry="3.6" fill="#0F172A" />
      <circle cx="40" cy="60" r="4" fill="#F59E8B" opacity={mood === 'worried' ? .2 : .6} />
      <circle cx="72" cy="60" r="4" fill="#F59E8B" opacity={mood === 'worried' ? .2 : .6} />
      <path d={mouth} stroke="#7C2D12" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <g transform="rotate(-24 82 93)"><rect x="72" y="88" width="20" height="10" rx="5" fill="#F8FAFC" /><rect x="72" y="88" width="10" height="10" rx="5" fill="#34D399" /></g>
      {mood === 'party' && [0, 1, 2, 3, 4, 5].map(i => (
        <motion.circle key={i} cx={56} cy={30} r={3} fill={['#F59E0B', '#34D399', '#60A5FA', '#F472B6', '#2DD4BF', '#FDE68A'][i]}
          initial={{ cx: 56, cy: 30, opacity: 1 }} animate={{ cx: 56 + Math.cos(i) * 48, cy: 30 + Math.sin(i * 2) * 30 - 20, opacity: 0 }} transition={{ duration: 1 }} />
      ))}
    </motion.svg>
  );
}

export function Ecg({ color = 'var(--accent2)', w = 150 }: { color?: string; w?: number }) {
  return <svg className="ecg" width={w} height="34" viewBox="0 0 150 34" aria-hidden="true"><path d="M0 20h40l6-12 8 22 7-26 7 16h82" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function FloatingPills() {
  const spots = [[6, 10, -30, '#2DD4BF', '#F8FAFC'], [80, 18, 40, '#F59E0B', '#F8FAFC'], [70, 70, -10, '#34D399', '#1E293B'], [10, 78, 60, '#F8FAFC', '#F472B6'], [88, 45, 20, '#60A5FA', '#F8FAFC'], [40, 6, -50, '#F8FAFC', '#2DD4BF']] as const;
  return <>{spots.map(([x, y, r, a, b], i) => (
    <motion.div key={i} className="pill" aria-hidden="true" style={{ left: `${x}%`, top: `${y}%` }}
      animate={{ y: [0, -18, 0], rotate: [r, r + 14, r] }} transition={{ repeat: Infinity, duration: 5 + i * .4, ease: 'easeInOut', delay: i * .3 }}>
      <span style={{ background: a }} /><span style={{ background: b }} />
    </motion.div>
  ))}</>;
}

export function Skeleton({ h = 14, w = '100%' }: { h?: number; w?: number | string }) {
  return <div className="skel" style={{ height: h, width: w }} />;
}

export function Empty({ icon = 'box', text }: { icon?: string; text: string }) {
  return <div className="empty"><Icon name={icon} size={36} /><span>{text}</span></div>;
}

export function useAsync<T>(fn: () => Promise<T>) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try { return await fn(); } catch (e) { setErr((e as Error).message); return undefined; } finally { setBusy(false); }
  };
  return { busy, err, run, setErr };
}

export function SupervisorPrompt({ perm, onApproved, onClose }: { perm: string; onApproved: (supId: string) => void; onClose: () => void }) {
  const { ctx, t } = useStore();
  const [u, setU] = useState(''), [p, setP] = useState('');
  const a = useAsync(async () => {
    const { verifySupervisor } = await import('../core/auth.ts');
    const sup = await verifySupervisor(ctx, u, p, perm);
    onApproved(sup.id);
  });
  return (
    <Modal title={t('supervisorPin')} onClose={onClose}>
      <form className="col" onSubmit={e => { e.preventDefault(); void a.run(); }}>
        <p className="muted small" style={{ margin: 0 }}>A supervisor or the owner types their username and PIN here. This approval is saved in the activity log.</p>
        <label className="field">{t('username')}<input className="input" autoFocus value={u} onChange={e => setU(e.target.value)} autoComplete="off" /></label>
        <label className="field">{t('pin')}<input className="input" type="password" inputMode="numeric" value={p} onChange={e => setP(e.target.value)} /></label>
        {a.err && <span className="err">{a.err}</span>}
        <button className="btn primary" disabled={a.busy}>{t('approve')}</button>
      </form>
    </Modal>
  );
}

/** Profile photo, or initials when there is none. */
export function UserAvatar({ user, size = 34 }: { user: { name?: string; photo?: string | null } | null | undefined; size?: number }) {
  const initials = (user?.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return user?.photo
    ? <img src={user.photo} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid var(--accentSoft)' }} />
    : <div aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', background: 'var(--accentSoft)', color: 'var(--accent)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: size * .38, flexShrink: 0 }}>{initials}</div>;
}

/** Numbers that roll up when they change. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const from = shown, to = value, t0 = performance.now(), dur = 700;
    if (from === to) return;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(from + (to - from) * e));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]); // eslint-disable-line
  return <>{format(shown)}</>;
}

/** Picks a picture, shrinks it, returns a data URL. */
export function PhotoPicker({ value, onChange, label, shape = 'circle', max = 256, png }: { value?: string | null; onChange: (v: string | null) => void; label: string; shape?: 'circle' | 'square'; max?: number; png?: boolean }) {
  const [err, setErr] = useState('');
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <label style={{ cursor: 'pointer', position: 'relative' }} title={label}>
        {value
          ? <img src={value} alt="" style={{ width: 72, height: 72, objectFit: shape === 'circle' ? 'cover' : 'contain', borderRadius: shape === 'circle' ? '50%' : 16, background: '#fff', border: '2px dashed var(--accent2)' }} />
          : <span style={{ width: 72, height: 72, display: 'grid', placeItems: 'center', borderRadius: shape === 'circle' ? '50%' : 16, border: '2px dashed var(--accent2)', color: 'var(--accent)' }}><Icon name="camera" size={26} /></span>}
        <input type="file" accept="image/*" hidden onChange={async e => {
          const f = e.target.files?.[0]; if (!f) return;
          try { const { resizeImage } = await import('./image.ts'); onChange(await resizeImage(f, max, png ? 'image/png' : 'image/jpeg')); setErr(''); }
          catch (x) { setErr((x as Error).message); }
        }} />
      </label>
      <div className="col" style={{ gap: 4 }}>
        <strong className="small">{label}</strong>
        <span className="small faint">Tap the picture to choose one</span>
        {value && <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => onChange(null)}>Remove</button>}
        {err && <span className="err">{err}</span>}
      </div>
    </div>
  );
}

/** In-app confirm dialog (replaces the browser's confirm()/alert()). Promise resolves true/false. */
type ConfirmOpts = { title?: string; message: string; confirmText?: string; cancelText?: string; danger?: boolean };
type ConfirmReq = ConfirmOpts & { resolve: (v: boolean) => void };
let confirmSub: ((o: ConfirmReq | null) => void) | null = null;
export function confirmAsk(o: ConfirmOpts): Promise<boolean> {
  return new Promise(resolve => { if (confirmSub) confirmSub({ ...o, resolve }); else resolve(true); });
}
export function ConfirmHost() {
  const [cur, setCur] = useState<ConfirmReq | null>(null);
  useEffect(() => { confirmSub = o => setCur(prev => { if (prev && prev !== o) prev.resolve(false); return o; }); return () => { confirmSub = null; }; }, []);
  if (!cur) return null;
  const done = (v: boolean) => { cur.resolve(v); setCur(null); };
  return (
    <Modal title={cur.title || 'Please confirm'} onClose={() => done(false)}>
      <p style={{ margin: '2px 0 18px', color: 'var(--muted, #94A3B8)', lineHeight: 1.65, whiteSpace: 'pre-line' }}>{cur.message}</p>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
        <button type="button" className="btn" onClick={() => done(false)}>{cur.cancelText || 'Cancel'}</button>
        <button type="button" className={`btn ${cur.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => done(true)}>{cur.confirmText || 'Yes'}</button>
      </div>
    </Modal>
  );
}
