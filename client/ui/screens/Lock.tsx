// Full-screen stops: licence locked (no data at all), update required, and the terms.
// © Awais Amin
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../store.tsx';
import { Icon, Modal } from '../components.tsx';
import { CONTACT } from '../../../shared/keys.ts';
import { termsFor } from '../../../shared/terms.ts';

export function TermsText() {
  const { lang } = useStore();
  const T = termsFor(lang);
  return <ol className="terms-list">{T.points.map((p, i) => <li key={i}>{p}</li>)}</ol>;
}
export function TermsModal({ onClose }: { onClose: () => void }) {
  const { lang } = useStore();
  return <Modal title={termsFor(lang).title} onClose={onClose} wide><TermsText /></Modal>;
}

/** Plan paused, cancelled or ended: nothing else in the app shows. */
export function LockScreen({ lock }: { lock: { status: string; message?: string | null; vendor: string } }) {
  const { isServerPc, sync, toast } = useStore();
  const [key, setKey] = useState(''), [pin, setPin] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const title = lock.status === 'cancelled' ? 'Licence cancelled' : lock.status === 'suspended' ? 'Plan paused' : lock.status === 'offline_too_long' ? 'Connect to the internet' : 'Plan ended';
  const why = lock.status === 'offline_too_long' ? 'This shop has not reached the licence server for 30 days. Connect this PC to the internet and check again.' : lock.message || 'PharmaDesk is locked. Please contact the developer.';
  const refresh = async () => { await sync.syncNow().catch(() => {}); };
  useEffect(() => { const t = setInterval(() => { void refresh(); }, 20_000); return () => clearInterval(t); }, []);
  const again = async () => {
    setBusy(true); setErr('');
    try { await fetch('/local/checkin-now', { method: 'POST' }); await refresh(); toast('ok', 'Checked'); } catch { setErr('No internet — try again'); }
    setBusy(false);
  };
  const activate = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/local/activate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: key.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.license?.locked) throw new Error(d.message || 'That key is not valid or has expired');
      await refresh(); location.reload();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const backup = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/local/backup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || 'Could not save the backup');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await r.blob()); a.download = `pharmadesk-backup-${new Date().toISOString().slice(0, 10)}.pdbk`; a.click();
      setPin(''); toast('ok', 'Backup saved');
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="lock-screen" role="alert">
      <motion.div className="lock-card" initial={{ opacity: 0, scale: 0.92, y: 30 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 160, damping: 18 }}>
        <motion.div className="lock-icon" animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 2.4 }}><Icon name="warn" size={54} /></motion.div>
        <h1>{title}</h1>
        <p className="lock-why">{why}</p>
        {isServerPc ? (
          <>
            <label className="field">Enter a new licence key<input className="input" dir="ltr" autoFocus value={key} onChange={e => setKey(e.target.value)} placeholder="PD1.…" autoCapitalize="none" spellCheck={false} onKeyDown={e => { if (e.key === 'Enter' && key.trim()) void activate(); }} /></label>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn primary" disabled={busy || !key.trim()} onClick={activate}>Activate key</button>
              <button type="button" className="btn" disabled={busy} onClick={again}>Check again</button>
            </div>
            <details className="lock-backup"><summary>Save a backup of my data</summary>
              <label className="field">Owner PIN<input className="input" type="password" dir="ltr" value={pin} onChange={e => setPin(e.target.value)} autoComplete="off" /></label>
              <button type="button" className="btn" disabled={busy || !pin} onClick={backup}><Icon name="download" size={16} /> Save backup file</button>
            </details>
          </>
        ) : <p className="small muted">To enter a new key, open PharmaDesk on the shop server PC.</p>}
        {err && <p className="lock-err">{err}</p>}
        <p className="small muted" dir="ltr">{`${lock.vendor} · ${CONTACT}`}</p>
      </motion.div>
    </div>
  );
}

/** A release the developer marked as must-update. */
export function UpdateGate({ version, notes, onUpdate, busy, error }: { version: string; notes?: string; onUpdate: () => void; busy: boolean; error: string }) {
  return (
    <div className="lock-update" role="alert">
      <motion.div className="lock-card" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
        <motion.div className="lock-icon" animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 1.8 }}><Icon name="download" size={54} /></motion.div>
        <h1>Update required</h1>
        <p className="lock-why">Please update to version <strong dir="ltr">{version}</strong> to keep using PharmaDesk.</p>
        {notes && <p className="small muted" dir="ltr">{notes}</p>}
        <button type="button" className="btn primary" autoFocus disabled={busy} onClick={onUpdate}>{busy ? 'Updating…' : 'Update now'}</button>
        {error && <p className="lock-err">{error}</p>}
      </motion.div>
    </div>
  );
}
