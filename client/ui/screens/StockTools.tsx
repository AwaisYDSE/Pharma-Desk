// Stock tools: count the shelf, return stock to a supplier, and see what is lost, stuck or earning.
// © Awais Amin
import React, { useMemo, useState } from 'react';
import { useStore, useLive } from '../store.tsx';
import { Empty, Icon, useAsync } from '../components.tsx';
import { money } from '../i18n.ts';
import { can } from '../../../shared/permissions.ts';
import { isoDate, addDays } from '../../../shared/util.ts';
import { presetRange } from '../../../shared/accounting.ts';
import { expiryLoss, deadStock, profitByMedicine } from '../../../shared/reports.ts';
import { adjustStock, returnToSupplier } from '../../core/inventory.ts';

function useStockData() {
  const { ctx } = useStore();
  return useLive(async () => ({
    meds: await ctx.db.medicines.toArray(), batches: await ctx.db.batches.toArray(), suppliers: await ctx.db.suppliers.toArray(),
    invoices: await ctx.db.invoices.toArray(), items: await ctx.db.invoiceItems.toArray(), refunds: await ctx.db.refunds.toArray(),
  }), [], null);
}
type Data = NonNullable<ReturnType<typeof useStockData>>;

function Count({ d }: { d: Data }) {
  const { ctx, toast, user } = useStore();
  const [q, setQ] = useState(''), [counts, setCounts] = useState<Record<string, string>>({});
  const names = useMemo(() => new Map(d.meds.map(m => [m.id, m.name])), [d.meds]);
  const rows = d.batches.filter(b => !b.deleted && !b.pending && (b.qty > 0 || counts[b.id] != null)).map(b => ({ ...b, med: names.get(b.medicineId) || '' }))
    .filter(b => `${b.med} ${b.batchNo}`.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => a.med.localeCompare(b.med)).slice(0, 200);
  const changed = rows.filter(b => counts[b.id] !== undefined && counts[b.id] !== '' && Number(counts[b.id]) !== b.qty);
  const save = useAsync(async () => {
    for (const b of changed) await adjustStock(ctx, b.id, Number(counts[b.id]) - b.qty, 'Stock count');
    setCounts({}); toast('ok', 'Stock count saved');
  });
  if (!can(user, 'inventory.adjust')) return <Empty icon="box" text="You do not have permission for this" />;
  return (
    <section className="card col">
      <div className="row"><input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Search medicine…" value={q} onChange={e => setQ(e.target.value)} />
        <button type="button" className="btn primary" disabled={!changed.length || save.busy} onClick={() => void save.run()}>Save count ({changed.length})</button></div>
      {save.err && <span className="err">{save.err}</span>}
      <div className="table-wrap"><table className="t"><thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th>In system</th><th>Counted</th><th>Difference</th></tr></thead>
        <tbody>{rows.map(b => { const c = counts[b.id], diff = c ? Number(c) - b.qty : 0; return <tr key={b.id}><td>{b.med}</td><td>{b.batchNo}</td><td className="num">{b.expiryDate}</td><td className="num">{b.qty}</td>
          <td><input className="input num" style={{ width: 90 }} inputMode="numeric" aria-label="Counted" value={c ?? ''} onChange={e => setCounts({ ...counts, [b.id]: e.target.value.replace(/\D/g, '') })} /></td>
          <td className="num" style={diff ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{diff || ''}</td></tr>; })}</tbody></table></div>
    </section>
  );
}

function Returns({ d }: { d: Data }) {
  const { ctx, toast, user, lang } = useStore();
  const [f, setF] = useState({ batchId: '', supplierId: '', qty: '', reason: '' });
  const names = useMemo(() => new Map(d.meds.map(m => [m.id, m.name])), [d.meds]);
  const batches = d.batches.filter(b => !b.deleted && !b.pending && b.qty > 0).map(b => ({ ...b, med: names.get(b.medicineId) || '' })).sort((a, b) => a.med.localeCompare(b.med));
  const picked = batches.find(b => b.id === f.batchId);
  const save = useAsync(async () => {
    await returnToSupplier(ctx, f.supplierId, f.batchId, Number(f.qty), f.reason);
    setF({ batchId: '', supplierId: '', qty: '', reason: '' }); toast('ok', 'Return saved');
  });
  if (!can(user, 'purchases.return')) return <Empty icon="box" text="You do not have permission for this" />;
  return (
    <section className="card col"><h2>Return stock to a supplier</h2>
      <div className="row" style={{ gap: 10 }}>
        <label className="field" style={{ minWidth: 260, flex: 1 }}>Medicine and batch<select className="input" value={f.batchId} onChange={e => { const b = batches.find(x => x.id === e.target.value); setF({ ...f, batchId: e.target.value, supplierId: b?.supplierId || f.supplierId }); }}><option value="">Choose</option>{batches.map(b => <option key={b.id} value={b.id}>{`${b.med} · ${b.batchNo} · ${b.expiryDate} · ${b.qty}`}</option>)}</select></label>
        <label className="field" style={{ minWidth: 180 }}>Supplier<select className="input" value={f.supplierId} onChange={e => setF({ ...f, supplierId: e.target.value })}><option value="">Choose</option>{d.suppliers.filter(s => !s.deleted).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="field" style={{ width: 100 }}>Quantity<input className="input num" inputMode="numeric" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value.replace(/\D/g, '') })} /></label>
        <label className="field" style={{ minWidth: 180, flex: 1 }}>Reason<input className="input" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></label>
      </div>
      {picked && Number(f.qty) > 0 && <span className="small muted">Comes off what we owe: <strong>{money(Number(f.qty) * (picked.costPrice || 0), lang)}</strong></span>}
      {save.err && <span className="err">{save.err}</span>}
      <div><button type="button" className="btn primary" disabled={save.busy || !f.batchId || !f.supplierId || !f.qty || !f.reason.trim()} onClick={() => void save.run()}><Icon name="check" size={16} /> Save return</button></div>
    </section>
  );
}

function Loss({ d }: { d: Data }) {
  const { lang, user } = useStore();
  const r = useMemo(() => expiryLoss(d.batches, d.meds, isoDate()), [d]);
  const showCost = can(user, 'reports.profit');
  return <section className="card col"><h2>Expired stock</h2>{showCost && <strong>{money(r.total, lang)}</strong>}
    {r.rows.length === 0 ? <Empty icon="box" text="No expired stock." /> : <div className="table-wrap"><table className="t"><thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th>Quantity</th>{showCost && <th>Loss at cost</th>}</tr></thead>
      <tbody>{r.rows.map(x => <tr key={x.id}><td>{x.name}</td><td>{x.batchNo}</td><td className="num">{x.expiryDate}</td><td className="num">{x.qty}</td>{showCost && <td className="num">{money(x.loss, lang)}</td>}</tr>)}</tbody></table></div>}</section>;
}

function Dead({ d }: { d: Data }) {
  const { lang, user } = useStore();
  const [days, setDays] = useState(90);
  const r = useMemo(() => deadStock(d.batches, d.meds, d.invoices, d.items, isoDate(), days), [d, days]);
  const showCost = can(user, 'reports.profit');
  return <section className="card col"><div className="row"><h2 style={{ margin: 0 }}>Not selling</h2><span className="spacer" />
    <label className="field" style={{ width: 150 }}>No sale in (days)<select className="input" value={days} onChange={e => setDays(Number(e.target.value))}>{[30, 60, 90, 180, 365].map(n => <option key={n} value={n}>{n}</option>)}</select></label></div>
    {showCost && <strong>{money(r.total, lang)}</strong>}
    {r.rows.length === 0 ? <Empty icon="box" text="Everything in stock has sold recently." /> : <div className="table-wrap"><table className="t"><thead><tr><th>Medicine</th><th>Quantity</th>{showCost && <th>Stock at cost</th>}</tr></thead>
      <tbody>{r.rows.map(x => <tr key={x.id}><td>{x.name}</td><td className="num">{x.qty}</td>{showCost && <td className="num">{money(x.value, lang)}</td>}</tr>)}</tbody></table></div>}</section>;
}

function Profit({ d }: { d: Data }) {
  const { lang, user } = useStore();
  const today = isoDate();
  const [range, setRange] = useState(() => { const r = presetRange('month', today); return { from: r.from, to: r.to }; });
  const r = useMemo(() => profitByMedicine(d.invoices, d.items, d.refunds, d.meds, range.from, range.to), [d, range]);
  if (!can(user, 'reports.profit')) return <Empty icon="chart" text="You do not have permission for this" />;
  return <section className="card col"><div className="row" style={{ gap: 10 }}>
      <label className="field" style={{ minWidth: 140 }}>From<input className="input" type="date" value={range.from} max={range.to} onChange={e => setRange({ ...range, from: e.target.value })} /></label>
      <label className="field" style={{ minWidth: 140 }}>To<input className="input" type="date" value={range.to} min={range.from} max={addDays(today, 1)} onChange={e => setRange({ ...range, to: e.target.value })} /></label>
      <span className="spacer" /><strong style={{ alignSelf: 'flex-end' }}>{money(r.total, lang)}</strong></div>
    {r.rows.length === 0 ? <Empty icon="chart" text="Nothing in these dates." /> : <div className="table-wrap"><table className="t"><thead><tr><th>Medicine</th><th>Quantity</th><th>Sales</th><th>Cost</th><th>Profit</th></tr></thead>
      <tbody>{r.rows.map(x => <tr key={x.id}><td>{x.name}</td><td className="num">{x.qty}</td><td className="num">{money(x.sales, lang)}</td><td className="num">{money(x.cost, lang)}</td><td className="num" style={x.profit < 0 ? { color: 'var(--bad)' } : undefined}><strong>{money(x.profit, lang)}</strong></td></tr>)}</tbody></table></div>}</section>;
}

export function StockTools() {
  const d = useStockData();
  const [tab, setTab] = useState('count');
  const tabs: [string, string][] = [['count', 'Stock count'], ['returns', 'Supplier returns'], ['loss', 'Expiry loss'], ['dead', 'Dead stock'], ['profit', 'Profit per medicine']];
  return (
    <>
      <div className="row"><h1>Stock tools</h1></div>
      <div className="books-tabs"><div className="tabs" role="tablist">{tabs.map(([k, l]) => <button type="button" key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div></div>
      {!d ? <div className="card"><Empty icon="box" text="Loading…" /></div> : tab === 'count' ? <Count d={d} /> : tab === 'returns' ? <Returns d={d} /> : tab === 'loss' ? <Loss d={d} /> : tab === 'dead' ? <Dead d={d} /> : <Profit d={d} />}
    </>
  );
}
