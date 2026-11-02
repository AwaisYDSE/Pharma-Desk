// Branches: connect them, see every branch's results, find stock anywhere, and move stock between them.
// © Awais Amin
import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore, useLive } from '../store.tsx';
import { Empty, Icon, Toggle } from '../components.tsx';
import { money } from '../i18n.ts';
import { can } from '../../../shared/permissions.ts';
import { isoDate } from '../../../shared/util.ts';
import { presetRange } from '../../../shared/accounting.ts';
import { ServerClient } from '../../core/sync.ts';

interface Status { role: 'none' | 'head' | 'branch'; me: string; share: boolean; lastSync: string | null; headName: string | null; branches: { id: string; name: string; last_sync: string | null }[]; code?: string; pin?: string }
interface StockRow { id: string; name: string; stock: Record<string, number> }
interface Transfer { id: string; from: string; to: string; fromName: string; toName: string; status: 'sent' | 'received'; at: string; lines: { name: string; batchNo: string; qty: number }[] }
interface Report { rows: { id: string; name: string; lastSync: string | null; bills: number; netSales: number; purchases: number; expenses: number; netProfit: number; cashIn: number; cashOut: number; stockValue: number }[]; total: Record<string, number> }

const localPost = async <T,>(path: string, body: unknown = {}): Promise<T> => {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || 'Something went wrong');
  return d as T;
};
const when = (s: string | null) => s ? new Date(s).toLocaleString() : '—';

function Connect() {
  const { toast } = useStore();
  const [st, setSt] = useState<Status | null>(null);
  const [f, setF] = useState({ code: '', pin: '', name: '', branchCode: '' }), [share, setShare] = useState(false), [busy, setBusy] = useState(false);
  const load = () => fetch('/local/branch').then(r => r.json()).then(setSt).catch(() => {});
  useEffect(() => { void load(); }, []);
  const run = (fn: () => Promise<unknown>, done: string) => async () => {
    setBusy(true);
    try { await fn(); await load(); toast('ok', done); } catch (e) { toast('bad', (e as Error).message); }
    setBusy(false);
  };
  if (!st) return <div className="card"><Empty icon="server" text="Loading…" /></div>;
  if (st.role === 'head') return (
    <section className="card col"><h2>This PC is the head office</h2>
      <span className="small muted">On each branch PC, open Branches and connect with this code and Server PIN.</span>
      <label className="field">Head office code<textarea className="input" dir="ltr" readOnly rows={3} value={st.code} onFocus={e => e.target.select()} /></label>
      <label className="field">Server PIN<input className="input" dir="ltr" readOnly value={st.pin} /></label>
      <Toggle on={st.share} label="Share customers and their accounts across branches" onChange={v => void run(() => localPost('/local/branch/head', { share: v }), 'Saved')()} />
      <h2>Connected branches</h2>
      {st.branches.length === 0 ? <Empty icon="server" text="No branch has connected yet." /> :
        <table className="t"><thead><tr><th>Name</th><th>Last seen</th></tr></thead><tbody>{st.branches.map(b => <tr key={b.id}><td>{b.name}</td><td className="num">{when(b.last_sync)}</td></tr>)}</tbody></table>}
    </section>
  );
  if (st.role === 'branch') return (
    <section className="card col"><h2>Connected to head office</h2>
      <strong>{st.headName}</strong><span className="small muted">Last synced</span><span className="num">{when(st.lastSync)}</span>
      <div className="row"><button type="button" className="btn primary" disabled={busy} onClick={run(() => localPost('/local/branch/sync'), 'Synced')}>Sync now</button>
        <button type="button" className="btn" disabled={busy} onClick={run(() => localPost('/local/branch/leave'), 'Disconnected')}>Disconnect</button></div>
    </section>
  );
  return (
    <div className="grid g-auto">
      <section className="card col"><h2>Make this PC the head office</h2>
        <span className="small muted">Choose one PC for this. The other branches connect to it.</span>
        <Toggle on={share} label="Share customers and their accounts across branches" onChange={setShare} />
        <button type="button" className="btn primary" disabled={busy} onClick={run(() => localPost('/local/branch/head', { share }), 'Saved')}>Make head office</button>
      </section>
      <section className="card col"><h2>Connect to a head office</h2>
        <label className="field">Head office code<textarea className="input" dir="ltr" rows={3} value={f.code} onChange={e => setF({ ...f, code: e.target.value })} /></label>
        <label className="field">Server PIN<input className="input" dir="ltr" value={f.pin} onChange={e => setF({ ...f, pin: e.target.value })} autoComplete="off" /></label>
        <label className="field">Branch name<input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <button type="button" className="btn primary" disabled={busy || !f.code || !f.pin} onClick={run(() => localPost('/local/branch/join', f), 'Connected')}>Connect</button>
      </section>
    </div>
  );
}

function ReportView() {
  const { client, lang, toast } = useStore();
  const today = isoDate();
  const [range, setRange] = useState(() => { const r = presetRange('month', today); return { from: r.from, to: r.to }; });
  const [rep, setRep] = useState<Report | null>(null), [err, setErr] = useState('');
  useEffect(() => { (client as ServerClient).request<Report>('GET', `/api/branch/report?from=${range.from}&to=${range.to}`).then(r => { setRep(r); setErr(''); }).catch(e => { setRep(null); setErr((e as Error).message); }); }, [range]);
  void toast;
  const cols: [keyof Report['rows'][number], string][] = [['netSales', 'Sales'], ['purchases', 'Purchases'], ['expenses', 'Expenses'], ['netProfit', 'Net profit'], ['cashIn', 'Money in'], ['cashOut', 'Money out'], ['stockValue', 'Stock at cost']];
  return (
    <>
      <div className="row" style={{ gap: 10 }}>
        <label className="field" style={{ minWidth: 140 }}>From<input className="input" type="date" value={range.from} max={range.to} onChange={e => setRange({ ...range, from: e.target.value })} /></label>
        <label className="field" style={{ minWidth: 140 }}>To<input className="input" type="date" value={range.to} min={range.from} onChange={e => setRange({ ...range, to: e.target.value })} /></label>
      </div>
      <section className="card">
        {!rep ? <Empty icon="chart" text={err || 'Loading…'} /> :
          <div className="table-wrap"><table className="t"><thead><tr><th>Branch</th><th>Last seen</th><th>Bills</th>{cols.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
            <tbody>{rep.rows.map(r => <motion.tr key={r.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}><td><strong>{r.name}</strong></td><td className="num small">{when(r.lastSync)}</td><td className="num">{r.bills}</td>{cols.map(([k]) => <td className="num" key={k}>{money(r[k] as number, lang)}</td>)}</motion.tr>)}
              <tr><td><strong>Total</strong></td><td /><td className="num"><strong>{rep.total.bills}</strong></td>{cols.map(([k]) => <td className="num" key={k}><strong>{money(rep.total[k] || 0, lang)}</strong></td>)}</tr></tbody></table></div>}
      </section>
    </>
  );
}

function StockView() {
  const { client, ctx } = useStore();
  const [list, setList] = useState<StockRow[]>([]), [q, setQ] = useState('');
  useEffect(() => { (client as ServerClient).request<{ branches: StockRow[] }>('GET', '/api/branch/stock').then(r => setList(r.branches)).catch(() => {}); }, []);
  const meds = useLive(() => ctx.db.medicines.filter(m => !m.deleted).toArray(), [], []);
  const hits = useMemo(() => meds.filter(m => `${m.name} ${m.generic}`.toLowerCase().includes(q.trim().toLowerCase())).filter(m => list.some(b => b.stock[m.id])).slice(0, 60), [meds, q, list]);
  return (
    <section className="card col">
      <input className="input" placeholder="Search medicine…" value={q} onChange={e => setQ(e.target.value)} />
      {list.length === 0 ? <Empty icon="box" text="Connect the branches first." /> :
        <div className="table-wrap"><table className="t"><thead><tr><th>Medicine</th>{list.map(b => <th key={b.id}>{b.name}</th>)}</tr></thead>
          <tbody>{hits.map(m => <tr key={m.id}><td>{m.name}</td>{list.map(b => <td className="num" key={b.id}>{b.stock[m.id] || 0}</td>)}</tr>)}</tbody></table></div>}
    </section>
  );
}

function Transfers() {
  const { client, ctx, user, toast } = useStore();
  const c = client as ServerClient;
  const [data, setData] = useState<{ transfers: Transfer[]; me: string }>({ transfers: [], me: '' }), [branches, setBranches] = useState<StockRow[]>([]);
  const [to, setTo] = useState(''), [batchId, setBatchId] = useState(''), [qty, setQty] = useState('');
  const load = () => { c.request<typeof data>('GET', '/api/branch/transfers').then(setData).catch(() => {}); c.request<{ branches: StockRow[] }>('GET', '/api/branch/stock').then(r => setBranches(r.branches)).catch(() => {}); };
  useEffect(load, []);
  const batches = useLive(async () => {
    const meds = new Map((await ctx.db.medicines.toArray()).map(m => [m.id, m.name]));
    return (await ctx.db.batches.toArray()).filter(b => !b.deleted && !b.pending && b.qty > 0 && (!b.expiryDate || b.expiryDate > isoDate())).map(b => ({ ...b, med: meds.get(b.medicineId) || '' })).sort((a, b) => a.med.localeCompare(b.med));
  }, [], []);
  const send = async () => {
    try { await c.request('POST', '/api/branch/transfers', { to, lines: [{ batchId, qty: Number(qty) }] }); setQty(''); setBatchId(''); toast('ok', 'Stock sent'); load(); } catch (e) { toast('bad', (e as Error).message); }
  };
  const receive = async (id: string) => {
    try { await c.request('POST', `/api/branch/transfers/${id}/receive`, {}); toast('ok', 'Stock received'); load(); } catch (e) { toast('bad', (e as Error).message); }
  };
  return (
    <>
      {can(user, 'branches.transfer') && <section className="card col"><h2>Send stock</h2>
        <div className="row" style={{ gap: 10 }}>
          <label className="field" style={{ minWidth: 170 }}>To branch<select className="input" value={to} onChange={e => setTo(e.target.value)}><option value="">Choose</option>{branches.filter(b => b.id !== data.me).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className="field" style={{ minWidth: 240, flex: 1 }}>Medicine and batch<select className="input" value={batchId} onChange={e => setBatchId(e.target.value)}><option value="">Choose</option>{batches.map(b => <option key={b.id} value={b.id}>{`${b.med} · ${b.batchNo} · ${b.expiryDate} · ${b.qty}`}</option>)}</select></label>
          <label className="field" style={{ width: 100 }}>Quantity<input className="input" type="number" min={1} value={qty} onChange={e => setQty(e.target.value)} /></label>
          <button type="button" className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={!to || !batchId || !(Number(qty) > 0)} onClick={send}>Send</button>
        </div></section>}
      <section className="card">
        {data.transfers.length === 0 ? <Empty icon="box" text="No transfers yet." /> :
          <div className="table-wrap"><table className="t"><thead><tr><th>Date</th><th>From</th><th>To</th><th>Items</th><th>Status</th><th /></tr></thead>
            <tbody>{data.transfers.map(t => <tr key={t.id}><td className="num small">{when(t.at)}</td><td>{t.fromName}</td><td>{t.toName}</td><td>{t.lines.map(l => `${l.name} × ${l.qty}`).join(' · ')}</td>
              <td><span className={`badge ${t.status === 'received' ? 'ok' : 'warn'}`}>{t.status === 'received' ? 'Received' : 'On the way'}</span></td>
              <td>{t.status === 'sent' && t.to === data.me && can(user, 'branches.receive') && <button type="button" className="btn sm primary" onClick={() => receive(t.id)}><Icon name="check" size={14} /> Receive</button>}</td></tr>)}</tbody></table></div>}
      </section>
    </>
  );
}

export function Branches() {
  const { isServerPc, user } = useStore();
  const tabs = ([...(isServerPc && user?.owner ? [['connect', 'Connection']] : []), ['report', 'All branches'], ['stock', 'Stock everywhere'], ['transfers', 'Transfers']]) as [string, string][];
  const [tab, setTab] = useState(tabs[0][0]);
  return (
    <>
      <div className="row"><h1>Branches</h1><span className="spacer" />
        <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button type="button" key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div></div>
      {tab === 'connect' && <Connect />}
      {tab === 'report' && <ReportView />}
      {tab === 'stock' && <StockView />}
      {tab === 'transfers' && <Transfers />}
    </>
  );
}
