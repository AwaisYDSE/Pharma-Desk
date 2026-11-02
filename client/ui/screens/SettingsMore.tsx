// Owner settings: bills & region, automatic purchase orders, email & SMS, FBR (Pakistan) and storage.
// © Awais Amin
import React, { useEffect, useState } from 'react';
import { useStore } from '../store.tsx';
import { Icon, Toggle, useAsync } from '../components.tsx';
import { saveRecord } from '../../core/inventory.ts';
import { can } from '../../../shared/permissions.ts';
import { REGIONS, regionOf, billing, formatBillNumber, providersFor, type BillingOptions } from '../../../shared/region.ts';
import { uuid } from '../../../shared/util.ts';
import { toPaisa } from '../../../shared/money.ts';
import type { PayAccount } from '../../../shared/types.ts';

/** Bill number style, what prints on bills, region / currency / tax name, branch. Synced to every device. */
/** The owner's bank and wallet accounts. Only accounts added here appear at checkout. */
export function PayAccountsCard() {
  const { ctx, shop, user, toast } = useStore();
  const allowed = can(user, 'settings.shop');
  const list = shop?.payAccounts || [];
  const prov = providersFor(billing(shop?.billing).region);
  const empty = { type: 'wallet' as 'bank' | 'wallet', provider: '', other: '', title: '', number: '', opening: '' };
  const [f, setF] = useState(empty);
  const write = (payAccounts: PayAccount[]) => saveRecord(ctx, 'shop', { ...(shop || {}), id: 'shop', payAccounts } as never);
  const options = f.type === 'bank' ? prov.banks : prov.wallets;
  const name = f.provider === 'other' ? f.other.trim() : f.provider;
  const add = useAsync(async () => {
    if (!name || !f.title.trim() || !f.number.trim()) throw new Error('Fill in the name, account title and number');
    await write([...list, { id: uuid(), type: f.type, provider: name, title: f.title.trim(), number: f.number.trim(), active: true, opening: f.opening ? toPaisa(f.opening) : 0 }]);
    setF(empty); toast('ok', 'Saved');
  });
  return (
    <section className="card col"><h2><Icon name="wallet" /> Banks and mobile wallets</h2>
      <span className="small muted">Add the accounts you take money in. Only these appear at checkout and in Accounts.</span>
      {list.map(a => <div className="row" key={a.id} style={{ gap: 8 }}><span className={`badge ${a.active ? 'ok' : ''}`}>{a.type === 'bank' ? 'Bank' : 'Mobile wallet'}</span><strong>{a.provider}</strong><span>{a.title}</span><span className="num" dir="ltr">{a.number}</span><span className="spacer" />
        {allowed && <Toggle on={a.active} label="Show at checkout" onChange={v => void write(list.map(x => x.id === a.id ? { ...x, active: v } : x))} />}</div>)}
      {allowed && <div className="row" style={{ gap: 10 }}>
        <label className="field" style={{ width: 130 }}>Type<select className="input" value={f.type} onChange={e => setF({ ...f, type: e.target.value as 'bank' | 'wallet', provider: '' })}><option value="wallet">Mobile wallet</option><option value="bank">Bank</option></select></label>
        <label className="field" style={{ minWidth: 170 }}>Name<select className="input" value={f.provider} onChange={e => setF({ ...f, provider: e.target.value })}><option value="">Choose</option>{options.map(o => <option key={o} value={o}>{o}</option>)}<option value="other">Other</option></select></label>
        {f.provider === 'other' && <label className="field" style={{ minWidth: 150 }}>Other<input className="input" value={f.other} onChange={e => setF({ ...f, other: e.target.value })} /></label>}
        <label className="field" style={{ minWidth: 160 }}>Account title<input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
        <label className="field" style={{ minWidth: 180 }}>Account or mobile number<input className="input" dir="ltr" value={f.number} onChange={e => setF({ ...f, number: e.target.value })} /></label>
        <label className="field" style={{ width: 130 }}>Starting balance (optional)<input className="input num" inputMode="decimal" value={f.opening} onChange={e => setF({ ...f, opening: e.target.value })} /></label>
        <button type="button" className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={add.busy} onClick={() => void add.run()}>Add</button>
      </div>}
      {add.err && <span className="err">{add.err}</span>}
    </section>
  );
}

export function BillsCard() {
  const { ctx, shop, user, toast, t } = useStore();
  const [b, setB] = useState<Required<BillingOptions>>(() => billing(shop?.billing) as Required<BillingOptions>);
  const [footer, setFooter] = useState(shop?.receiptFooter ?? '');
  const [branch, setBranch] = useState({ name: shop?.branchName || '', code: shop?.branchCode || '' });
  useEffect(() => { setB(billing(shop?.billing) as Required<BillingOptions>); setFooter(shop?.receiptFooter ?? ''); setBranch({ name: shop?.branchName || '', code: shop?.branchCode || '' }); }, [shop?.hlc]); // eslint-disable-line
  const allowed = can(user, 'settings.shop');
  const up = (p: Partial<BillingOptions>) => setB({ ...b, ...p } as Required<BillingOptions>);
  const tog = (k: keyof BillingOptions, label: string) => <label className="row"><Toggle on={!!b[k]} onChange={v => up({ [k]: v })} label={label} disabled={!allowed} /> {label}</label>;
  const save = useAsync(async () => {
    const start = Math.floor(Number(b.invoiceStart));
    if (!(start >= 1) || start > 999_999_999) throw new Error('Starting number must be 1 or more');
    await saveRecord(ctx, 'shop', { ...(shop || { name: 'My Pharmacy' }), id: 'shop', receiptFooter: footer, branchName: branch.name.trim(), branchCode: branch.code.trim().toUpperCase(),
      billing: { ...b, invoiceStart: start, invoiceDigits: Math.min(9, Math.max(0, Math.floor(Number(b.invoiceDigits) || 0))), copies: Math.min(5, Math.max(1, Math.floor(Number(b.copies) || 1))), invoicePrefix: String(b.invoicePrefix || '').slice(0, 12), currency: String(b.currency || '').slice(0, 6), taxLabel: String(b.taxLabel || '').slice(0, 12) } } as never);
    toast('ok', t('save'));
  });
  return (
    <section className="card col"><h2><Icon name="receipt" /> Bills, region & branch</h2>
      <fieldset disabled={!allowed} className="col" style={{ border: 0, padding: 0, margin: 0, gap: 12 }}>
        <div className="form-grid two">
          <label className="field">Country / region<select className="input" value={b.region} onChange={e => { const r = regionOf(e.target.value); up({ region: r.code, currency: r.currency, taxLabel: r.taxLabel }); }}>{REGIONS.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}</select></label>
          <label className="field">Currency sign<input className="input" maxLength={6} value={b.currency} onChange={e => up({ currency: e.target.value })} /></label>
          <label className="field">Tax name<input className="input" maxLength={12} value={b.taxLabel} onChange={e => up({ taxLabel: e.target.value })} /></label>
          <label className="field">Copies to print<input className="input num" inputMode="numeric" value={b.copies} onChange={e => up({ copies: Number(e.target.value.replace(/\D/g, '')) || 1 })} /></label>
          <label className="field">Bill number prefix<input className="input" maxLength={12} placeholder="INV-" value={b.invoicePrefix} onChange={e => up({ invoicePrefix: e.target.value })} /></label>
          <label className="field">Start bill numbers at<input className="input num" inputMode="numeric" value={b.invoiceStart} onChange={e => up({ invoiceStart: Number(e.target.value.replace(/\D/g, '')) || 1 })} /></label>
          <label className="field">Digits (0 = no zeros in front)<input className="input num" inputMode="numeric" value={b.invoiceDigits} onChange={e => up({ invoiceDigits: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></label>
          <div className="field">Example<strong className="num" style={{ padding: '10px 0' }}>{formatBillNumber(b, Math.max(1, Number(b.invoiceStart) || 1), ctx.deviceId.slice(0, 4).toUpperCase())}</strong></div>
        </div>
        {tog('deviceCode', 'Add a short code for each device to bill numbers')}
        {!b.deviceCode && <span className="small" style={{ color: 'var(--warn)' }}>Without the device code, two phones/PCs billing while the server is off can make the same bill number. Keep it on if more than one device makes bills.</span>}
        <label className="field">Note at the top of every bill<textarea className="input" maxLength={300} style={{ minHeight: 56 }} value={b.headerNote} onChange={e => up({ headerNote: e.target.value })} placeholder="e.g. Open 24 hours · Free home delivery" /></label>
        <label className="field">Message at the bottom of every bill<textarea className="input" maxLength={400} style={{ minHeight: 56 }} value={footer} onChange={e => setFooter(e.target.value)} placeholder="e.g. Thank you! Get well soon." /></label>
        <div className="grid g-auto" style={{ gap: 6 }}>
          {tog('showLogo', 'Logo')}{tog('showNtn', 'NTN / STRN')}{tog('showCashier', 'Who served')}{tog('showPatient', 'Customer name')}{tog('showBatch', 'Batch & expiry')}{tog('showGeneric', 'Formula')}
        </div>
        <div className="form-grid two">
          <label className="field">Branch name (optional)<input className="input" maxLength={60} placeholder="e.g. Gulberg branch" value={branch.name} onChange={e => setBranch({ ...branch, name: e.target.value })} /></label>
          <label className="field">Branch code (optional)<input className="input" maxLength={8} placeholder="e.g. GLB" value={branch.code} onChange={e => setBranch({ ...branch, code: e.target.value })} /></label>
        </div>
        {save.err && <span className="err">{save.err}</span>}
        <button type="button" className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={save.busy} onClick={() => save.run()}>{t('save')}</button>
      </fieldset>
    </section>
  );
}

/** Automatic purchase orders on/off (the low-stock watchdog on the server). */
export function AutomationCard() {
  const { client, online, ctx, toast, user } = useStore();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { if (online && ctx.sessionId) client.request<{ autoPo: boolean }>('GET', '/api/settings/automation').then(r => setOn(r.autoPo)).catch(() => {}); }, [online]); // eslint-disable-line
  if (on === null) return null;
  return (
    <section className="card col"><h2><Icon name="truck" /> Automatic purchase orders</h2>
      <p className="small muted" style={{ margin: 0 }}>When an item reaches its reorder point, PharmaDesk makes a draft purchase order for its supplier (the item's default supplier, or the one it was last bought from). Nothing is ordered until someone approves it in Purchases.</p>
      <label className="row"><Toggle on={on} disabled={!can(user, 'settings.shop')} label="Automatic purchase orders" onChange={async v => { try { const r = await client.request<{ autoPo: boolean }>('POST', '/api/settings/automation', { autoPo: v }); setOn(r.autoPo); toast('ok', r.autoPo ? 'Automatic orders ON' : 'Automatic orders OFF'); } catch (e) { toast('bad', (e as Error).message); } }} /> {on ? 'ON — drafts are made automatically' : 'OFF'}</label>
    </section>
  );
}

interface NotifyPublic {
  email: { provider: string; from: string; resendKeySet: boolean; smtp: { host: string; port: number; user: string; passSet: boolean } | null };
  sms: { provider: string; textbeeDevice: string; textbeeKeySet: boolean; twilioSid: string; twilioFrom: string; twilioTokenSet: boolean };
  ownerEmail: string; ownerPhone: string; auto: { lowStock: boolean; poToSupplier: boolean; receiptToCustomer: boolean };
}
interface MsgRow { id: string; created_at: string; channel: string; kind: string; recipient: string; status: string; error: string | null }

export function MessagesCard() {
  const { client, online, ctx, toast, t } = useStore();
  const [c, setC] = useState<NotifyPublic | null>(null);
  const [sec, setSec] = useState({ resendKey: '', smtpPass: '', textbeeKey: '', twilioToken: '' });
  const [log, setLog] = useState<MsgRow[]>([]);
  const [testTo, setTestTo] = useState('');
  const load = () => { client.request<NotifyPublic>('GET', '/api/settings/notify').then(setC).catch(() => {}); client.request<{ messages: MsgRow[] }>('GET', '/api/notify/log').then(r => setLog(r.messages)).catch(() => {}); };
  useEffect(() => { if (online && ctx.sessionId) load(); }, [online]); // eslint-disable-line
  const save = useAsync(async () => {
    const r = await client.request<NotifyPublic>('POST', '/api/settings/notify', {
      email: { provider: c!.email.provider, from: c!.email.from, resendKey: sec.resendKey, smtp: c!.email.smtp ? { ...c!.email.smtp, pass: sec.smtpPass } : undefined },
      sms: { provider: c!.sms.provider, textbeeKey: sec.textbeeKey, textbeeDevice: c!.sms.textbeeDevice, twilioSid: c!.sms.twilioSid, twilioToken: sec.twilioToken, twilioFrom: c!.sms.twilioFrom },
      ownerEmail: c!.ownerEmail, ownerPhone: c!.ownerPhone, auto: c!.auto,
    });
    setC(r); setSec({ resendKey: '', smtpPass: '', textbeeKey: '', twilioToken: '' }); toast('ok', t('save'));
  });
  const test = async (channel: 'email' | 'sms') => { try { await client.request('POST', '/api/notify/test', { channel, to: testTo }); toast('ok', channel === 'sms' ? 'Test SMS sent' : 'Test email sent'); } catch (e) { toast('bad', (e as Error).message); } };
  if (!c) return <section className="card col"><h2><Icon name="send" /> Email & SMS</h2><span className="small muted">Connect to the server to set up email and SMS.</span></section>;
  const E = c.email, S = c.sms;
  const setE = (p: Partial<NotifyPublic['email']>) => setC({ ...c, email: { ...E, ...p } });
  const setS = (p: Partial<NotifyPublic['sms']>) => setC({ ...c, sms: { ...S, ...p } });
  return (
    <section className="card col"><h2><Icon name="send" /> Email & SMS</h2>
      <p className="small muted" style={{ margin: 0 }}>Free options: email with <b>Resend</b> (free plan) or your own email account (SMTP, e.g. Gmail with an App Password); SMS with <b>TextBee</b> (free — sends from your own Android phone's SIM) or Twilio. Keys are kept only on the server PC, encrypted. Messages are queued and retried, so nothing is lost when the internet is down.</p>
      <div className="form-grid two">
        <label className="field">Email service<select className="input" value={E.provider} onChange={e => setE({ provider: e.target.value, smtp: e.target.value === 'smtp' ? (E.smtp || { host: 'smtp.gmail.com', port: 587, user: '', passSet: false }) : E.smtp })}><option value="none">Off</option><option value="resend">Resend</option><option value="smtp">My email account (SMTP)</option></select></label>
        <label className="field">{'From (name <email>)'}<input className="input" value={E.from} onChange={e => setE({ from: e.target.value })} placeholder={E.provider === 'resend' ? 'Pharmacy <onboarding@resend.dev>' : 'you@gmail.com'} /></label>
        {E.provider === 'resend' && <label className="field" style={{ gridColumn: '1 / -1' }}>Resend API key {E.resendKeySet && <span className="badge ok">saved</span>}<input className="input" type="password" autoComplete="off" value={sec.resendKey} onChange={e => setSec({ ...sec, resendKey: e.target.value })} placeholder={E.resendKeySet ? 'Leave empty to keep the saved key' : 're_…'} /></label>}
        {E.provider === 'smtp' && E.smtp && <>
          <label className="field">SMTP server<input className="input" value={E.smtp.host} onChange={e => setE({ smtp: { ...E.smtp!, host: e.target.value } })} /></label>
          <label className="field">Port<input className="input num" value={E.smtp.port} onChange={e => setE({ smtp: { ...E.smtp!, port: Number(e.target.value) || 587 } })} /></label>
          <label className="field">User<input className="input" value={E.smtp.user} onChange={e => setE({ smtp: { ...E.smtp!, user: e.target.value } })} /></label>
          <label className="field">Password / App Password {E.smtp.passSet && <span className="badge ok">saved</span>}<input className="input" type="password" autoComplete="off" value={sec.smtpPass} onChange={e => setSec({ ...sec, smtpPass: e.target.value })} /></label>
        </>}
        <label className="field">SMS service<select className="input" value={S.provider} onChange={e => setS({ provider: e.target.value })}><option value="none">Off</option><option value="textbee">TextBee (own Android phone)</option><option value="twilio">Twilio</option></select></label>
        <span />
        {S.provider === 'textbee' && <>
          <label className="field">TextBee API key {S.textbeeKeySet && <span className="badge ok">saved</span>}<input className="input" type="password" autoComplete="off" value={sec.textbeeKey} onChange={e => setSec({ ...sec, textbeeKey: e.target.value })} /></label>
          <label className="field">TextBee device ID<input className="input" value={S.textbeeDevice} onChange={e => setS({ textbeeDevice: e.target.value })} /></label>
        </>}
        {S.provider === 'twilio' && <>
          <label className="field">Account SID<input className="input" value={S.twilioSid} onChange={e => setS({ twilioSid: e.target.value })} /></label>
          <label className="field">Auth token {S.twilioTokenSet && <span className="badge ok">saved</span>}<input className="input" type="password" autoComplete="off" value={sec.twilioToken} onChange={e => setSec({ ...sec, twilioToken: e.target.value })} /></label>
          <label className="field">From number<input className="input num" value={S.twilioFrom} onChange={e => setS({ twilioFrom: e.target.value })} placeholder="+1…" /></label>
        </>}
        <label className="field">Owner email (alerts)<input className="input" type="email" value={c.ownerEmail} onChange={e => setC({ ...c, ownerEmail: e.target.value })} /></label>
        <label className="field">Owner mobile (alerts)<input className="input num" value={c.ownerPhone} onChange={e => setC({ ...c, ownerPhone: e.target.value })} placeholder="03xx xxxxxxx" /></label>
      </div>
      <label className="row"><Toggle on={c.auto.lowStock} onChange={v => setC({ ...c, auto: { ...c.auto, lowStock: v } })} label="Low stock" /> Tell the owner when stock is low (once a day)</label>
      <label className="row"><Toggle on={c.auto.poToSupplier} onChange={v => setC({ ...c, auto: { ...c.auto, poToSupplier: v } })} label="Orders to suppliers" /> Send approved purchase orders to the supplier</label>
      <label className="row"><Toggle on={c.auto.receiptToCustomer} onChange={v => setC({ ...c, auto: { ...c.auto, receiptToCustomer: v } })} label="Bills to customers" /> Send every bill to the customer (when the customer has an email or mobile)</label>
      {save.err && <span className="err">{save.err}</span>}
      <div className="row"><button type="button" className="btn primary" disabled={save.busy || !online} onClick={() => save.run()}>{t('save')}</button>
        <input className="input" style={{ maxWidth: 220 }} placeholder="Test: email or mobile" value={testTo} onChange={e => setTestTo(e.target.value)} />
        <button type="button" className="btn sm" disabled={!testTo} onClick={() => test(testTo.includes('@') ? 'email' : 'sms')}>Send test</button></div>
      {log.length > 0 && <details><summary className="small" style={{ cursor: 'pointer' }}>Recent messages ({log.length})</summary>
        <div className="table-wrap" style={{ marginTop: 8 }}><table className="t"><tbody>{log.map(m => <tr key={m.id}><td className="small num">{new Date(m.created_at).toLocaleString()}</td><td className="small">{m.channel} · {m.kind}</td><td className="small num">{m.recipient}</td>
          <td><span className={`badge ${m.status === 'sent' ? 'ok' : m.status === 'failed' ? 'bad' : 'warn'}`} title={m.error || ''}>{m.status}</span>{m.status === 'failed' && <button type="button" className="btn sm ghost" onClick={async () => { await client.request('POST', `/api/notify/retry/${m.id}`, {}); load(); }}>Retry</button>}</td></tr>)}</tbody></table></div></details>}
    </section>
  );
}

/** FBR POS integration — shown only for shops in Pakistan. Off by default. */
export function FbrCard() {
  const { client, online, ctx, toast, shop, t } = useStore();
  const [c, setC] = useState<{ enabled: boolean; sandbox: boolean; posId: string; tokenSet: boolean; pctCode: string } | null>(null);
  const [token, setToken] = useState('');
  useEffect(() => { if (online && ctx.sessionId) client.request<typeof c>('GET', '/api/settings/fbr').then(setC).catch(() => {}); }, [online]); // eslint-disable-line
  if (billing(shop?.billing).region !== 'pk' || !c) return null;
  const save = async (p: Partial<typeof c & { token: string }>) => {
    try { const r = await client.request<typeof c>('POST', '/api/settings/fbr', { ...c, ...p, token }); setC(r); setToken(''); toast('ok', r!.enabled ? 'FBR reporting is ON' : t('save')); }
    catch (e) { toast('bad', (e as Error).message); }
  };
  return (
    <section className="card col"><h2><Icon name="shield" /> FBR (Pakistan) — optional</h2>
      <p className="small muted" style={{ margin: 0 }}>Reports each bill to FBR's POS system; the FBR invoice number prints on the bill. You need a POS ID and token from FBR (IRIS → POS registration). Try test mode first. Bills made while the internet is down are reported automatically later.</p>
      <div className="form-grid two">
        <label className="field">POS ID<input className="input num" value={c.posId} onChange={e => setC({ ...c, posId: e.target.value.replace(/\D/g, '') })} /></label>
        <label className="field">Token {c.tokenSet && <span className="badge ok">saved</span>}<input className="input" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label>
        <label className="field">PCT code for medicines<input className="input num" value={c.pctCode} onChange={e => setC({ ...c, pctCode: e.target.value })} /></label>
        <label className="row" style={{ alignSelf: 'end' }}><Toggle on={c.sandbox} onChange={v => setC({ ...c, sandbox: v })} label="Test mode" /> Test mode (FBR sandbox)</label>
      </div>
      <div className="row"><button type="button" className="btn" onClick={() => save({})}>{t('save')}</button>
        <label className="row"><Toggle on={c.enabled} onChange={v => save({ enabled: v })} label="FBR reporting" /> {c.enabled ? 'FBR reporting is ON' : 'FBR reporting is OFF'}</label></div>
    </section>
  );
}

const fmtBytes = (b: number | null | undefined) => b == null ? '—' : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`;

/** How much is stored, how much room is left, and the device's protection against being cleared. */
export function StorageCard() {
  const { client, online, ctx } = useStore();
  const [srv, setSrv] = useState<{ dbBytes: number; freeBytes: number | null; bills: number; items: number; purchases: number } | null>(null);
  const [dev, setDev] = useState<{ used?: number; quota?: number; persisted?: boolean } | null>(null);
  useEffect(() => {
    if (online && ctx.sessionId && !ctx.standalone) client.request<typeof srv>('GET', '/api/storage').then(setSrv).catch(() => {});
    (async () => {
      const st = navigator.storage;
      if (!st) return setDev({});
      // Ask the browser to never clear this device's copy on its own (installed app → usually granted).
      const persisted = (await st.persisted?.()) || (await st.persist?.().catch(() => false));
      const e = await st.estimate?.().catch(() => ({} as StorageEstimate));
      setDev({ used: e?.usage, quota: e?.quota, persisted: !!persisted });
    })().catch(() => {});
  }, [online]); // eslint-disable-line
  return (
    <section className="card col"><h2><Icon name="server" /> Storage</h2>
      {srv && <span className="small">Server PC database: <strong className="num">{fmtBytes(srv.dbBytes)}</strong> · {srv.bills.toLocaleString()} bills · {srv.items.toLocaleString()} items · free disk <strong className="num">{fmtBytes(srv.freeBytes)}</strong></span>}
      {dev && <span className="small">This device: <strong className="num">{fmtBytes(dev.used)}</strong> used of <span className="num">{fmtBytes(dev.quota)}</span> · {dev.persisted ? <span className="badge ok">protected from automatic clearing</span> : <span className="badge warn">may be cleared by the browser — install PharmaDesk as an app</span>}</span>}
      <p className="small muted" style={{ margin: 0 }}>The server PC keeps all the shop's history, limited only by its disk — about 1 GB holds well over a million bills. A backup is saved automatically every 6 hours. Each phone or PC keeps a full copy so it works while the server is off.</p>
      {srv && srv.freeBytes != null && srv.freeBytes < 2e9 && <span className="err">The server PC's disk is almost full ({fmtBytes(srv.freeBytes)} free). Free up space so backups keep working.</span>}
    </section>
  );
}
