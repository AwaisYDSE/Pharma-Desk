// First-run owner setup (server PC), device pairing (QR + PIN) and login.
import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../store.tsx';
import { Icon, FloatingPills, useAsync, PhotoPicker } from '../components.tsx';
import { Heart } from './About.tsx';
import { LANGS } from '../i18n.ts';
import { pair, NeedsLocalOpen } from '../../core/sync.ts';
import { login } from '../../core/auth.ts';
import { PIN_MISMATCH_MESSAGE } from '../../../shared/util.ts';

function Brand({ sub }: { sub?: string }) {
  return (
    <div className="col" style={{ alignItems: 'center', gap: 8 }}>
      <motion.img src="./brand/logo-full.png" alt="Pharmacy Software by Awais Amin" className="brand-logo" style={{ width: 210 }}
        initial={{ scale: .7, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 180, damping: 14 }} />
      {sub && <span style={{ color: '#94A3B8', fontSize: 13 }}>{sub}</span>}
    </div>
  );
}

function LangRow() {
  const { lang, setLang } = useStore();
  return (
    <div className="row" style={{ justifyContent: 'center', gap: 6 }}>
      {LANGS.map(l => <button type="button" key={l.code} className="btn sm" style={l.code === lang ? { borderColor: '#2DD4BF', color: '#5EEAD4' } : undefined} onClick={() => setLang(l.code)}>{l.label}</button>)}
    </div>
  );
}

const Credit = () => <span className="row" style={{ justifyContent: 'center', gap: 6, fontSize: 12, color: '#94A3B8' }}>Developed by <strong style={{ color: '#5EEAD4' }}>Awais Amin</strong> <Heart size={14} /></span>;

/** Shown once, on the server PC, before anything else: create the owner (admin). */
export function OwnerSetup({ onDone, standalone, onBack }: { onDone: () => void; standalone?: boolean; onBack?: () => void }) {
  const { t, ctx } = useStore();
  const [f, setF] = useState({ shopName: '', name: '', username: 'owner', pin: '', pin2: '', catalog: '' as '' | 'builtin' | 'own', logo: null as string | null, photo: null as string | null });
  const [step, setStep] = useState(1);
  const [rc, setRc] = useState<string | null>(null);
  const a = useAsync(async () => {
    if (f.pin !== f.pin2) throw new Error('The two PINs are different');
    if (!f.catalog) throw new Error('Choose how to start your medicine list');
    if (!/^\d{6,}$/.test(f.pin) && f.pin.length < 8) throw new Error('Use a PIN of at least 6 digits');
    if (standalone) {
      const { setupStandalone } = await import('../../core/standalone.ts');
      await setupStandalone(ctx, { ...f, catalog: f.catalog as 'builtin' | 'own' });
    } else {
      const r = await fetch('/local/setup-owner', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || 'The server could not save this. Is it still running?');
      if (d.recoveryCode) { setRc(d.recoveryCode); return; }
    }
    onDone();
  });
  if (rc) return <RecoveryCodeScreen code={rc} onDone={onDone} />;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="auth"><FloatingPills />
      <form className="panel" style={{ width: 'min(560px, 100%)' }} onSubmit={e => { e.preventDefault(); if (step === 1) setStep(2); else void a.run(); }}>
        <Brand sub={standalone ? 'This device only · first start' : 'Main Server PC · first start'} />
        {onBack && step === 1 && <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={onBack}>← Back</button>}
        <div className="row" style={{ justifyContent: 'center', gap: 6 }}>{[1, 2].map(n => <span key={n} style={{ width: 34, height: 6, borderRadius: 4, background: n <= step ? '#2DD4BF' : 'rgba(255,255,255,.15)' }} />)}</div>
        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.div key="s1" className="col" initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -30, opacity: 0 }}>
              <h2 style={{ margin: '6px 0 0', fontSize: 18 }}>{t('setupOwner')}</h2>
              <p style={{ margin: 0, color: '#94A3B8', fontSize: 13 }}>This is the owner (admin) account. It can't be deleted, and it controls every other user.</p>
              <label className="field">{t('shopName')}<input className="input" required value={f.shopName} onChange={set('shopName')} /></label>
              <label className="field">{t('name')}<input className="input" required value={f.name} onChange={set('name')} /></label>
              <label className="field">{t('username')}<input className="input" required value={f.username} onChange={set('username')} autoCapitalize="none" /></label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <label className="field" style={{ flex: 1 }}>{t('pin')}<input className="input" type="password" inputMode="numeric" required minLength={6} value={f.pin} onChange={set('pin')} /></label>
                <label className="field" style={{ flex: 1 }}>Repeat PIN<input className="input" type="password" inputMode="numeric" required value={f.pin2} onChange={set('pin2')} /></label>
              </div>
              <div className="grid g-2" style={{ gap: 12 }}>
                <PhotoPicker label="Shop logo (optional)" shape="square" png value={f.logo} onChange={v => setF({ ...f, logo: v })} />
                <PhotoPicker label="Your photo (optional)" value={f.photo} onChange={v => setF({ ...f, photo: v })} max={192} />
              </div>
              <button className="btn primary">Next</button>
            </motion.div>
          ) : (
            <motion.div key="s2" className="col" initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -30, opacity: 0 }}>
              <h2 style={{ margin: '6px 0 0', fontSize: 18 }}>How do you want to start your medicine list?</h2>
              <p style={{ margin: 0, color: '#94A3B8', fontSize: 13 }}>You can only choose this once, now. Later, anyone with permission can edit or delete each medicine, and add their own.</p>
              {([['builtin', 'Use the built-in list', 'About 150 common medicines sold in Pakistan — brand, formula, strength, company and what each is for. You only add prices and stock.'],
                 ['own', 'Start empty — I will add my own', 'Nothing pre-filled. You type each medicine and its description yourself.']] as const).map(([k, title, body]) => (
                <motion.button type="button" key={k} whileHover={{ scale: 1.02 }} whileTap={{ scale: .98 }} onClick={() => setF({ ...f, catalog: k })}
                  style={{ textAlign: 'start', padding: 16, borderRadius: 18, cursor: 'pointer', color: '#E2E8F0', background: f.catalog === k ? 'rgba(45,212,191,.16)' : 'rgba(15,23,42,.5)', border: `2px solid ${f.catalog === k ? '#2DD4BF' : 'rgba(255,255,255,.12)'}` }}>
                  <div className="row" style={{ flexWrap: 'nowrap' }}><Icon name={k === 'builtin' ? 'box' : 'plus'} /><strong>{title}</strong>{f.catalog === k && <span style={{ marginInlineStart: 'auto', color: '#5EEAD4' }}><Icon name="check" /></span>}</div>
                  <p style={{ margin: '6px 0 0', fontSize: 13, color: '#94A3B8' }}>{body}</p>
                </motion.button>
              ))}
              {a.err && <span className="err">{a.err}</span>}
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <button type="button" className="btn" onClick={() => setStep(1)}>Back</button>
                <button className="btn primary" style={{ flex: 1 }} disabled={a.busy || !f.catalog}>{a.busy ? 'Setting up…' : 'Finish setup'}</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <LangRow /><Credit />
      </form>
    </div>
  );
}

function decodeCode(text: string) {
  try {
    const m = text.match(/[#&?]pair=([^&\s]+)/);
    const code = m ? decodeURIComponent(m[1]) : text;
    const raw = code.trim().replace(/^pharmadesk:/, '').replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(decodeURIComponent(escape(atob(raw + '==='.slice((raw.length + 3) % 4)))));
    return p.app === 'pharmadesk' && p.sid ? p as { sid: string; name: string; urls: string[] } : null;
  } catch { return null; }
}

/** Phones, tablets and iPads are never the server. */
export const isPhone = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

/** Download the installer for this PC. Installing opens the owner setup by itself. */
const SITE = 'https://awaisydse.github.io/Pharma-Desk/';
function ServerSteps() {
  const mac = /Mac/i.test(navigator.platform || navigator.userAgent);
  const [got, setGot] = useState(false);
  return (
    <motion.div className="col" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} style={{ gap: 8, padding: 14, borderRadius: 16, background: 'rgba(45,212,191,.08)', border: '1px solid rgba(45,212,191,.35)' }}>
      <a className="btn primary" href={SITE + (mac ? 'PharmaDesk-Mac.pkg' : 'PharmaDesk-Setup.exe')} download onClick={() => setGot(true)}>
        <Icon name="download" /> {mac ? 'Download for Mac' : 'Download for Windows'}</a>
      {got && <span style={{ fontSize: 13, color: '#CBD5E1' }}>Open the downloaded file. The owner setup opens by itself.</span>}
      {got && <span style={{ fontSize: 12, color: '#94A3B8' }}>{mac ? 'If your Mac blocks it: System Settings → Privacy & Security → Open Anyway.' : 'If Windows warns: More info → Run anyway.'}</span>}
      <a className="small" style={{ color: '#5EEAD4', textAlign: 'center' }} href="http://localhost:4317/">Already installed? Open PharmaDesk</a>
    </motion.div>
  );
}

/** Phones and other PCs: scan the server's QR, type its PIN. */
export function PairScreen({ onPaired }: { onPaired: () => void }) {
  const { ctx, t, sync } = useStore();
  const [serverInfo, setServerInfo] = useState(false);
  // Opened from a shop server's own address? Then this shop already has its server PC.
  const [onServer, setOnServer] = useState(false);
  useEffect(() => { fetch('./api/hello').then(r => r.json()).then(d => setOnServer(d?.app === 'pharmadesk')).catch(() => setOnServer(false)); }, []);
  const [code, setCode] = useState(''), [pin, setPin] = useState(''), [name, setName] = useState(/Android/i.test(navigator.userAgent) ? 'Android phone' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone' : 'Counter PC');
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const qr = decodeCode(code);
  useEffect(() => {
    const p = new URLSearchParams(location.hash.slice(1)).get('pair');
    if (p) setCode(p);
  }, []);
  useEffect(() => {
    if (!scanning) return;
    let stop = () => {};
    (async () => {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromVideoDevice(undefined, video.current!, res => { if (res) { setCode(res.getText()); setScanning(false); } });
      stop = () => controls.stop();
    })().catch(() => setScanning(false));
    return () => stop();
  }, [scanning]);
  const a = useAsync(async () => {
    if (!qr) throw new Error('This pairing code is not valid. Scan the QR on your own shop server.');
    try {
      await pair(ctx, qr, pin.trim(), name, navigator.platform);
    } catch (e) {
      if (e instanceof NeedsLocalOpen) {
        // This secure page can't talk to the shop PC's Wi-Fi address — open PharmaDesk from the shop PC itself.
        const c = (code.match(/[#&?]pair=([^&\s]+)/)?.[1]) || encodeURIComponent(code.trim());
        window.location.href = `${e.url.replace(/\/$/, '')}/#pair=${c}`;
        return;
      }
      throw new Error((e as { code?: string }).code === 'PIN_MISMATCH' ? PIN_MISMATCH_MESSAGE : (e as Error).message);
    }
    sync.start(5000);
    await sync.syncNow().catch(() => {});
    onPaired();
  });
  useEffect(() => { a.setErr(''); }, [code, pin]); // an old error disappears as soon as you type again
  return (
    <div className="auth"><FloatingPills />
      <form className="panel" onSubmit={e => { e.preventDefault(); void a.run(); }}>
        <Brand sub={t('pairTitle')} />
        {!isPhone() && !onServer && (
          <button type="button" className="btn" onClick={() => setServerInfo(v => !v)} style={{ flexDirection: 'column', alignItems: 'flex-start', minHeight: 64, padding: '10px 14px', textAlign: 'start', whiteSpace: 'normal' }}>
            <strong><Icon name="server" size={16} /> Use this PC as the server</strong>
            <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 400 }}>Keeps all the shop's data. Phones connect to it.</span>
          </button>)}
        {serverInfo && !isPhone() && !onServer && <ServerSteps />}
        <div className="row" style={{ gap: 8, color: '#94A3B8', fontSize: 12 }}><span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.12)' }} />or connect to your shop's server PC<span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.12)' }} /></div>
        <p style={{ margin: 0, color: '#CBD5E1', fontSize: 13, textAlign: 'center' }}>{t('pairHelp')}</p>
        {scanning
          ? <video ref={video} style={{ width: '100%', borderRadius: 16, background: '#000', aspectRatio: '1' }} muted playsInline />
          : <button type="button" className="btn primary" onClick={() => setScanning(true)}><Icon name="scan" /> {t('scanQr')}</button>}
        <label className="field">{t('pasteCode')}<input className="input" value={code} onChange={e => setCode(e.target.value)} placeholder="pharmadesk:…" autoCapitalize="none" /></label>
        {qr && <span style={{ color: '#6EE7B7', fontSize: 13 }}>✓ {qr.name}</span>}
        <label className="field">{t('serverPin')}<input className="input" inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} style={{ fontSize: 24, letterSpacing: '.4em', textAlign: 'center' }} /></label>
        <label className="field">{t('deviceName')}<input className="input" value={name} onChange={e => setName(e.target.value)} /></label>
        {a.err && <motion.span className="err" initial={{ x: -8 }} animate={{ x: [8, -6, 4, 0] }} role="alert">{a.err}</motion.span>}
        <button className="btn primary" disabled={a.busy || !qr || pin.length !== 6}>{t('connect')}</button>
        <LangRow /><Credit />
      </form>
    </div>
  );
}

export function LoginScreen() {
  const { ctx, client, t, setUser, online, sync } = useStore();
  const [u, setU] = useState(''), [p, setP] = useState('');
  const [forgot, setForgot] = useState(false);
  const a = useAsync(async () => {
    // Just paired? Make sure this device has the users list before checking the PIN.
    if (!(await ctx.db.users.where('username').equals(u.trim().toLowerCase()).count())) await sync.syncNow().catch(() => {});
    try { setUser(await login(ctx, u, p, client)); }
    catch (e) {
      // The PIN may have been changed on another device: fetch the latest users once, then try again.
      if (!online) throw e;
      await sync.syncNow().catch(() => {});
      setUser(await login(ctx, u, p, client));
    }
  });
  if (forgot) return <ForgotPin onBack={() => setForgot(false)} onReset={async (name) => { await sync.syncNow().catch(() => {}); setU(name); setP(''); setForgot(false); }} />;
  return (
    <div className="auth"><FloatingPills />
      <form className="panel" onSubmit={e => { e.preventDefault(); void a.run(); }}>
        <Brand sub={ctx.standalone ? 'This device only' : `${ctx.pairing?.serverName || ''} · ${online ? t('online') : t('offline')}`} />
        <label className="field">{t('username')}<input className="input" autoFocus autoCapitalize="none" autoComplete="username" value={u} onChange={e => setU(e.target.value)} /></label>
        <label className="field">{t('pin')}<input className="input" type="password" inputMode="numeric" autoComplete="current-password" value={p} onChange={e => setP(e.target.value)} style={{ fontSize: 22, letterSpacing: '.3em' }} /></label>
        {a.err && <motion.span className="err" role="alert" animate={{ x: [8, -6, 4, 0] }}>{a.err}</motion.span>}
        <button className="btn primary" disabled={a.busy || !u || !p}>{t('login')}</button>
        <button type="button" className="btn ghost sm" style={{ alignSelf: 'center' }} onClick={() => setForgot(true)}>Forgot PIN?</button>
        <LangRow /><Credit />
      </form>
    </div>
  );
}

/** Shown once after setup: the owner's recovery code for a forgotten PIN. */
function RecoveryCodeScreen({ code, onDone }: { code: string; onDone: () => void }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="auth"><FloatingPills />
      <div className="panel" style={{ width: 'min(520px, 100%)' }}>
        <Brand sub="Main Server PC · first start" />
        <h2 style={{ margin: '6px 0 0', fontSize: 18 }}>Save your recovery code</h2>
        <p style={{ margin: 0, color: '#94A3B8', fontSize: 13 }}>If you ever forget the owner PIN, this code lets you set a new one on this PC. Write it down or take a photo and keep it safe. It is shown only now.</p>
        <div data-no-tr className="num" style={{ fontSize: 26, fontWeight: 800, letterSpacing: '.08em', textAlign: 'center', padding: '16px 10px', borderRadius: 14, border: '2px dashed #2DD4BF', userSelect: 'all' }}>{code}</div>
        <button type="button" className="btn" onClick={() => { navigator.clipboard?.writeText(code).catch(() => {}); }}><Icon name="copy" /> Copy code</button>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /> I have saved this code</label>
        <button type="button" className="btn primary" disabled={!ok} onClick={onDone}>Continue</button>
      </div>
    </div>
  );
}

/** Forgot PIN: staff ask the owner; the owner resets on the server PC with the recovery code or a reset key. */
function ForgotPin({ onBack, onReset }: { onBack: () => void; onReset: (username: string) => Promise<void> }) {
  const [info, setInfo] = useState<{ pcCode: string; hasRecovery: boolean; vendor: string; vendorReset: boolean } | null | 'remote'>(null);
  const [method, setMethod] = useState<'recovery' | 'vendor'>('recovery');
  const [f, setF] = useState({ code: '', pin: '', pin2: '' });
  const [done, setDone] = useState<{ recoveryCode: string; username: string } | null>(null);
  useEffect(() => { fetch('/local/owner-reset').then(r => r.ok ? r.json() : Promise.reject()).then(d => { setInfo(d); if (!d.hasRecovery && d.vendorReset) setMethod('vendor'); }).catch(() => setInfo('remote')); }, []);
  const a = useAsync(async () => {
    if (f.pin !== f.pin2) throw new Error('The two PINs are different');
    const r = await fetch('/local/owner-reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, code: f.code, pin: f.pin }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.message || 'Could not reset the PIN');
    setDone(d);
  });
  if (done) return <RecoveryCodeScreen code={done.recoveryCode} onDone={() => void onReset(done.username)} />;
  return (
    <div className="auth"><FloatingPills />
      <form className="panel" style={{ width: 'min(520px, 100%)' }} onSubmit={e => { e.preventDefault(); void a.run(); }}>
        <Brand sub="Forgot PIN" />
        <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={onBack}>← Back</button>
        <p style={{ margin: 0, fontSize: 14 }}>Staff: ask the owner to set a new PIN for you in Users and Access.</p>
        {info === 'remote' && <p style={{ margin: 0, color: '#94A3B8', fontSize: 13 }}>Owner: open PharmaDesk on the shop's server PC to reset the owner PIN.</p>}
        {info && info !== 'remote' && <>
          <p style={{ margin: 0, fontSize: 14 }}>Owner: set a new owner PIN with one of these.</p>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className={`btn sm ${method === 'recovery' ? 'primary' : ''}`} onClick={() => setMethod('recovery')}>Recovery code</button>
            {info.vendorReset && <button type="button" className={`btn sm ${method === 'vendor' ? 'primary' : ''}`} onClick={() => setMethod('vendor')}>Reset key from the developer</button>}
          </div>
          {method === 'recovery'
            ? <label className="field">Recovery code (from when the shop was set up)<input className="input" required value={f.code} onChange={e => setF({ ...f, code: e.target.value })} placeholder="XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" /></label>
            : <>
                <p style={{ margin: 0, color: '#94A3B8', fontSize: 13 }}>Send this PC code to the developer. You will get a reset key for this PC that works once.</p>
                <div data-no-tr className="num" style={{ fontSize: 22, fontWeight: 800, letterSpacing: '.08em', textAlign: 'center', padding: 12, borderRadius: 12, border: '1px dashed #2DD4BF', userSelect: 'all' }}>{info.pcCode}</div>
                <label className="field">Reset key<textarea className="input" required rows={3} value={f.code} onChange={e => setF({ ...f, code: e.target.value })} placeholder="PDR.…" /></label>
              </>}
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <label className="field" style={{ flex: 1 }}>New PIN<input className="input" type="password" inputMode="numeric" required value={f.pin} onChange={e => setF({ ...f, pin: e.target.value })} /></label>
            <label className="field" style={{ flex: 1 }}>Repeat PIN<input className="input" type="password" inputMode="numeric" required value={f.pin2} onChange={e => setF({ ...f, pin2: e.target.value })} /></label>
          </div>
          {a.err && <span className="err" role="alert">{a.err}</span>}
          <button className="btn primary" disabled={a.busy}>Set new owner PIN</button>
        </>}
        {info === null && <p className="small muted">Checking…</p>}
      </form>
    </div>
  );
}

/** Licence screen on the server PC: paste a key to activate, or renew when the plan has ended.
 *  Only shown when the vendor turned licensing on. */
export interface LicenseInfo { on: boolean; locked: boolean; needsKey: boolean; status: string; shop?: string; plan?: string; expires?: string | null; daysLeft?: number | null; vendor: string }

export function LicenseGate({ info, onActivated }: { info: LicenseInfo; onActivated: () => void }) {
  const [token, setToken] = useState('');
  const a = useAsync(async () => {
    const r = await fetch('/local/activate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: token.trim() }) });
    const d = await r.json().catch(() => ({}));
    const st = (d.license || {}) as LicenseInfo;
    if (!st.on || st.locked || st.needsKey) {
      const msg = st.status === 'expired' ? 'That key has expired. Ask the vendor for a renewal key.'
        : st.status === 'machine_mismatch' ? 'That key belongs to another PC.'
        : 'That key is not valid. Check you copied all of it.';
      throw new Error(msg);
    }
    onActivated();
  });
  const expired = info.status === 'expired', suspended = info.status === 'suspended';
  const title = suspended ? 'Your plan is paused' : expired ? 'Your plan has ended' : 'Enter your licence key';
  const note = suspended ? `Please contact ${info.vendor} to continue.`
    : expired ? `Your licence ended${info.expires ? ' on ' + info.expires : ''}. Enter a renewal key from ${info.vendor}.`
    : `PharmaDesk by ${info.vendor} needs a licence key for this shop. Paste the key you were given.`;
  return (
    <div className="auth"><FloatingPills />
      <form className="panel" onSubmit={e => { e.preventDefault(); void a.run(); }}>
        <Brand sub={title} />
        <p style={{ margin: 0, color: '#CBD5E1', fontSize: 13, textAlign: 'center' }}>{note}</p>
        {info.shop && <p style={{ margin: 0, color: '#94A3B8', fontSize: 12, textAlign: 'center' }}>This PC: {info.shop}{info.plan ? ` · ${info.plan}` : ''}</p>}
        {!suspended && <>
          <label className="field">Licence key<input className="input" autoFocus value={token} onChange={e => setToken(e.target.value)} placeholder="PD1.…" autoCapitalize="none" spellCheck={false} /></label>
          {a.err && <motion.span className="err" role="alert" animate={{ x: [8, -6, 4, 0] }}>{a.err}</motion.span>}
          <button className="btn primary" disabled={a.busy || token.trim().length < 20}>{expired ? 'Renew' : 'Activate'}</button>
        </>}
        <LangRow /><Credit />
      </form>
    </div>
  );
}
