// Settings: shop details (printed on receipts), language & theme, printer, Gemini key
// (stored only on the server PC, encrypted), backups, and — on the server PC — the
// pairing QR + Server PIN for adding phones and other PCs.
import React, { useEffect, useState } from 'react';
import { useStore } from '../store.tsx';
import { Icon, Toggle, useAsync, PhotoPicker } from '../components.tsx';
import { saveRecord } from '../../core/inventory.ts';
import { LANGS } from '../i18n.ts';
import { can } from '../../../shared/permissions.ts';
import type { Settings as S } from '../../core/settings.ts';

export function Settings() {
  const { t, settings, setSettings, lang, setLang, user, isServerPc, client, online, ctx, toast, shop } = useStore();
  const [f, setF] = useState<S>(settings);
  const [logo, setLogo] = useState<string | null>(settings.logoDataUrl || null);
  const [key, setKey] = useState('');
  const [aiState, setAiState] = useState<{ hasKey: boolean } | null>(null);
  useEffect(() => { if (online && ctx.sessionId) client.request<{ hasKey: boolean }>('GET', '/api/settings/ai').then(setAiState).catch(() => {}); }, [online]); // eslint-disable-line
  const saveAi = useAsync(async () => {
    const r = await client.request<{ hasKey: boolean; test: { ok: boolean; message: string } | null }>('POST', '/api/settings/ai', { key });
    setAiState(r); setKey('');
    toast(r.test?.ok ? 'ok' : 'warn', r.test?.message || (r.hasKey ? 'Saved' : 'AI turned off'));
  });
  const fld = (k: keyof S, label: string) => <label className="field">{label}<input className="input" value={String(f[k] ?? '')} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <>
      <h1>{t('settings')}</h1>
      {isServerPc && <ServerPanel />}
      <div className="grid g-2" style={{ alignItems: 'start' }}>
        <section className="card col"><h2>{t('shopDetails')}</h2>
          <PhotoPicker label="Shop logo (shown on every device and on receipts)" shape="square" png value={logo} onChange={setLogo} />
          {fld('storeName', t('shopName'))}{fld('address', 'Address')}{fld('phone', t('phone'))}
          <div className="grid g-auto" style={{ gap: 10 }}>{fld('ntn', 'NTN')}{fld('strn', 'STRN')}{fld('drugLicense', 'Drug licence no.')}</div>
          {fld('receiptFooter', 'Receipt footer')}
          <label className="row"><Toggle on={f.pricesIncludeGst} onChange={v => setF({ ...f, pricesIncludeGst: v })} label="Prices include GST" /> Shelf prices already include GST</label>
          <label className="field">Receipt paper<select className="input" value={f.receiptWidth} onChange={e => setF({ ...f, receiptWidth: e.target.value as S['receiptWidth'] })}><option>80mm</option><option>58mm</option><option>A4</option></select></label>
          <label className="field">Printer<select className="input" value={f.printer} onChange={e => setF({ ...f, printer: e.target.value as S['printer'] })}><option value="browser">Normal printer (print dialog)</option><option value="serial">USB thermal printer (Chrome/Edge)</option></select></label>
          <label className="row"><Toggle on={f.autoPrint} onChange={v => setF({ ...f, autoPrint: v })} label="Print automatically" /> Print receipt automatically after checkout</label>
          <label className="field">Expiry alerts (days)<input className="input num" value={f.expiryWindows.join(', ')} onChange={e => setF({ ...f, expiryWindows: e.target.value.split(',').map(x => Number(x.trim())).filter(Boolean) })} /></label>
          <button type="button" className="btn primary" disabled={!can(user, 'settings.shop')} title={can(user, 'settings.shop') ? '' : 'Not allowed to change shop details'} onClick={async () => {
            try {
              await setSettings(f);
              await saveRecord(ctx, 'shop', { ...(shop || {}), id: 'shop', name: f.storeName, logo, address: f.address, phone: f.phone, ntn: f.ntn, strn: f.strn, drugLicense: f.drugLicense, receiptFooter: f.receiptFooter } as never);
              toast('ok', t('save'));
            } catch (e) { toast('bad', (e as Error).message); }
          }}>{t('save')}</button>
        </section>
        <div className="col" style={{ gap: 16 }}>
          <section className="card col"><h2>{t('language')} & {t('theme')}</h2>
            <div className="row">{LANGS.map(l => <button type="button" key={l.code} className={`btn sm ${lang === l.code ? 'primary' : ''}`} onClick={() => setLang(l.code)}>{l.label}</button>)}</div>
            <div className="row">{(['system', 'light', 'dark'] as const).map(m => <button type="button" key={m} className={`btn sm ${settings.theme === m ? 'primary' : ''}`} onClick={() => setSettings({ theme: m })}><Icon name={m === 'dark' ? 'moon' : 'sun'} size={16} /> {t(m)}</button>)}</div>
          </section>
          {can(user, 'settings.ai') && <section className="card col"><h2><Icon name="spark" /> {t('geminiKey')}</h2>
            <p className="small muted" style={{ margin: 0 }}>Get a free key at aistudio.google.com → "Get API key". It is saved only on your server PC, encrypted, and never sent to phones. Patient names and phone numbers are removed before anything goes to Google. Note: on Google's free tier, Google may use what is sent to improve its products.</p>
            <span className={`badge ${aiState?.hasKey ? 'ok' : ''}`} style={{ alignSelf: 'flex-start' }}>{aiState == null ? 'Connect to the server to manage AI' : aiState.hasKey ? 'AI is ON' : 'AI is OFF — the offline reader is used'}</span>
            <form className="row" onSubmit={e => { e.preventDefault(); void saveAi.run(); }}>
              <input className="input" style={{ flex: 1 }} type="password" placeholder="AIza…" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" />
              <button className="btn primary" disabled={saveAi.busy || !online}>{t('save')}</button>
              {aiState?.hasKey && <button type="button" className="btn danger" onClick={async () => { setAiState(await client.request('POST', '/api/settings/ai', { key: '' })); }}>Remove</button>}
            </form>{saveAi.err && <span className="err">{saveAi.err}</span>}
          </section>}
          <section className="card col"><h2>This device</h2>
            {ctx.standalone
              ? <span className="small muted"><strong>This device only.</strong> All data is saved on this device. Make a backup regularly and keep it safe (e.g. on a USB stick or in your email).</span>
              : <span className="small muted">Connected to <strong>{ctx.pairing?.serverName}</strong>. This device keeps a full copy of the shop's data, so it keeps working when the server PC is off.</span>}
            {can(user, 'data.backup') && <div className="row">
              <button type="button" className="btn" onClick={async () => { try { const { exportBackup } = await import('../../core/backup.ts'); const blob = await exportBackup(ctx); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pharmadesk-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); toast('ok', 'Backup downloaded'); } catch (e) { toast('bad', (e as Error).message); } }}><Icon name="download" size={16} /> Download backup</button>
              {ctx.standalone && <label className="btn"><Icon name="plus" size={16} /> Restore backup<input type="file" accept="application/json,.json" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; if (!confirm('Restore this backup? Everything on this device will be replaced by the backup.')) return; try { const { importBackup } = await import('../../core/backup.ts'); await importBackup(ctx, await f.text()); toast('ok', 'Backup restored'); setTimeout(() => location.reload(), 800); } catch (x) { toast('bad', (x as Error).message); } }} /></label>}
            </div>}
            <button type="button" className="btn danger" onClick={async () => { if (confirm(ctx.standalone ? 'Erase everything on this device? This cannot be undone — download a backup first.' : 'Disconnect this device from the shop and delete its copy of the data? Unsynced sales will be lost.')) { await ctx.db.delete(); location.reload(); } }}>{ctx.standalone ? 'Erase this device' : 'Disconnect this device'}</button>
          </section>
        </div>
      </div>
    </>
  );
}

function ServerPanel() {
  const { toast } = useStore();
  const [st, setSt] = useState<{ name: string; pin: string; qrSvg: string; qrText: string; endpoints: { lan: string[]; tailscale: string | null; cloudflare: string | null }; blockedToday: number } | null>(null);
  const [show, setShow] = useState(false);
  const load = () => fetch('/local/status').then(r => r.json()).then(setSt).catch(() => {});
  useEffect(() => { load(); const id = setInterval(load, 10000); return () => clearInterval(id); }, []);
  if (!st) return null;
  return (
    <section className="card row" style={{ alignItems: 'flex-start', gap: 24 }} aria-label="Pair a device">
      <div style={{ width: 220, padding: 10, background: '#fff', borderRadius: 18 }} dangerouslySetInnerHTML={{ __html: st.qrSvg }} />
      <div className="col" style={{ flex: 1, minWidth: 260 }}>
        <span className="small" style={{ color: 'var(--accent)', fontWeight: 800, letterSpacing: '.08em' }}>MAIN SERVER PC</span>
        <h2 style={{ margin: 0, fontSize: 22 }}>Pair a phone or another PC</h2>
        <span className="muted small">On the phone open the PharmaDesk app, tap "Scan QR", then type this PIN. Devices without this shop's PIN can never see this shop's data.</span>
        <div className="row"><div className="pin-boxes num">{(show ? st.pin : '••••••').split('').map((c, i) => <span key={i}>{c}</span>)}</div>
          <button type="button" className="btn sm" onClick={() => setShow(s => !s)}>{show ? 'Hide' : 'Show'} PIN</button>
          <button type="button" className="btn sm" onClick={async () => { await fetch('/local/pin/rotate', { method: 'POST' }); load(); toast('ok', 'New PIN made. Paired devices stay connected.'); }}>New PIN</button></div>
        <div className="col small" style={{ gap: 4 }}>
          {st.endpoints.lan.map(u => <span key={u} className="num">Shop Wi-Fi: {u}</span>)}
          <span className="num">Tailscale: {st.endpoints.tailscale || 'not set up (optional, free)'}</span>
          <span className="num">Cloudflare: {st.endpoints.cloudflare || 'starting / not installed'}</span>
        </div>
        <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => { navigator.clipboard.writeText(st.qrText); toast('ok', 'Pairing code copied'); }}>Copy pairing code</button>
        {st.blockedToday > 0 && <span className="badge bad" style={{ alignSelf: 'flex-start' }}>Blocked today: {st.blockedToday} wrong-PIN attempt(s)</span>}
      </div>
    </section>
  );
}

export function AiPage() {
  const { t } = useStore();
  return (
    <>
      <h1>{t('ai')}</h1>
      <div className="card col"><p className="muted" style={{ margin: 0 }}>Open <strong>Point of Sale</strong> and press <span className="kbd">F6</span> (or the "{t('readRx')}" button) to read a prescription into the bill. Drug interaction warnings appear automatically on every bill. The daily summary is on the Dashboard.</p>
        <p className="small muted" style={{ margin: 0 }}>Without a Gemini key, or when the free limit is used up, PharmaDesk uses its built-in offline reader and interaction list — billing never stops.</p></div>
    </>
  );
}
