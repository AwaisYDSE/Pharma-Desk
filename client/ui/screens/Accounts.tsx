// Accounts: money in, money out, profit and tax for any dates — daily, monthly or yearly —
// plus the shop's expenses. Calculated on this device from its own copy, so it works offline.
// © Awais Amin
import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore, useLive } from '../store.tsx';
import { Icon, Modal, Empty, useAsync, confirmAsk } from '../components.tsx';
import { money } from '../i18n.ts';
import { can } from '../../../shared/permissions.ts';
import { toPaisa } from '../../../shared/money.ts';
import { isoDate } from '../../../shared/util.ts';
import { summarize, presetRange, EXPENSE_CATEGORIES, type Group } from '../../../shared/accounting.ts';
import { billing } from '../../../shared/region.ts';
import { Books } from './Books.tsx';
import { saveExpense, deleteExpense } from '../../core/inventory.ts';
import type { Expense } from '../../../shared/types.ts';

/** The Accounts module: overview plus the books. */
export function Accounts() {
  const [tab, setTab] = useState<'overview' | 'statement' | 'cash' | 'parties' | 'position'>('overview');
  const tabs: [typeof tab, string][] = [['overview', 'Overview'], ['statement', 'Statements'], ['cash', 'Cash book'], ['parties', 'Who owes what'], ['position', 'Business position']];
  return (
    <>
      <div className="tabs books-tabs" role="tablist">{tabs.map(([k, l]) => <button type="button" key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'overview' ? <Overview /> : <Books view={tab} />}
    </>
  );
}

type Preset = 'today' | 'week' | 'month' | 'lastMonth' | 'year' | 'custom';

function Overview() {
  const { ctx, t, lang, user, toast, shop } = useStore();
  const today = isoDate();
  const [preset, setPreset] = useState<Preset>('month');
  const [range, setRange] = useState(() => presetRange('month', today));
  const [edit, setEdit] = useState<Partial<Expense> | null>(null);
  const taxLabel = billing(shop?.billing).taxLabel;
  const data = useLive(async () => ({
    invoices: await ctx.db.invoices.toArray(), invoiceItems: await ctx.db.invoiceItems.toArray(), refunds: await ctx.db.refunds.toArray(),
    purchases: await ctx.db.purchases.toArray(), expenses: await ctx.db.expenses.toArray(), ledger: await ctx.db.ledger.toArray(), medicines: await ctx.db.medicines.toArray(),
  }), [], null);
  const sum = useMemo(() => data ? summarize(data, range.from, range.to, range.group) : null, [data, range]);
  const expenses = useMemo(() => (data?.expenses || []).filter(e => !e.deleted && e.date >= range.from && e.date <= range.to).sort((a, b) => b.date.localeCompare(a.date)), [data, range]);
  const pick = (p: Preset) => { setPreset(p); if (p !== 'custom') setRange(presetRange(p, today)); };
  if (!sum) return <div className="card"><Empty icon="chart" text="Loading…" /></div>;
  const T = sum.totals;
  const max = Math.max(1, ...sum.periods.map(p => Math.max(p.cashIn, p.cashOut)));
  const label = (k: string) => range.group === 'year' ? k : range.group === 'month' ? new Date(k + '-15').toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) : k.slice(8);
  const csv = () => {
    const head = ['Period', 'Bills', 'Sales', 'Returns', 'Net sales', taxLabel, 'Cost of goods', 'Gross profit', 'Expenses', 'Net profit', 'Money in', 'Money out', 'Stock bought'];
    const row = (p: typeof T) => [p.key, p.bills, ...[p.sales, p.refunds, p.netSales, p.tax, p.cogs, p.grossProfit, p.expenses, p.netProfit, p.cashIn, p.cashOut, p.purchases].map(v => (v / 100).toFixed(2))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([[head, ...sum.periods.map(row), row(T)].map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
    a.download = `pharmadesk-accounts-${range.from}-to-${range.to}.csv`; a.click();
  };
  const kpis: [string, number, string][] = [
    ['Money in', T.cashIn, 'var(--ok)'], ['Money out', T.cashOut, 'var(--bad)'],
    ['Net profit', T.netProfit, T.netProfit >= 0 ? 'var(--ok)' : 'var(--bad)'], [`${taxLabel} collected`, T.tax, 'var(--info)'],
  ];
  return (
    <>
      <div className="row"><h1>Accounts</h1><span className="spacer" />
        <div className="tabs" role="tablist">{([['today', 'Today'], ['week', '7 days'], ['month', 'This month'], ['lastMonth', 'Last month'], ['year', 'This year'], ['custom', 'Custom']] as [Preset, string][]).map(([k, l]) =>
          <button type="button" key={k} role="tab" aria-selected={preset === k} className={preset === k ? 'on' : ''} onClick={() => pick(k)}>{l}</button>)}</div>
        {can(user, 'reports.export') && <button type="button" className="btn sm" onClick={csv}><Icon name="download" size={16} /> CSV</button>}
      </div>
      <div className="row" style={{ gap: 10 }}>
        <label className="field" style={{ minWidth: 150 }}>From<input className="input" type="date" value={range.from} max={range.to} onChange={e => { setPreset('custom'); setRange({ ...range, from: e.target.value || range.from }); }} /></label>
        <label className="field" style={{ minWidth: 150 }}>To<input className="input" type="date" value={range.to} min={range.from} onChange={e => { setPreset('custom'); setRange({ ...range, to: e.target.value || range.to }); }} /></label>
        <label className="field" style={{ minWidth: 150 }}>Show by<select className="input" value={range.group} onChange={e => setRange({ ...range, group: e.target.value as Group })}><option value="day">Day</option><option value="month">Month</option><option value="year">Year</option></select></label>
      </div>
      <div className="grid g-auto">{kpis.map(([l, v, c], i) => (
        <motion.div key={l} className="card kpi lift" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }}>
          <span className="small muted">{l}</span><span className="v num" style={{ color: c }}>{money(v, lang)}</span>
        </motion.div>))}
      </div>
      <section className="card col" aria-label="Money in and out">
        <div className="row"><h2>Money in & out</h2><span className="spacer" /><span className="small"><i className="dot" style={{ background: 'var(--ok)' }} /> In · <i className="dot" style={{ background: 'var(--bad)' }} /> Out</span></div>
        <div className="acc-chart">{sum.periods.slice(-60).map(p => (
          <div key={p.key} className="acc-col" title={`${p.key}: in ${money(p.cashIn, lang)} · out ${money(p.cashOut, lang)} · profit ${money(p.netProfit, lang)}`}>
            <div className="acc-bars">
              <motion.i style={{ background: 'var(--ok)' }} initial={{ height: 0 }} animate={{ height: `${p.cashIn / max * 100}%` }} />
              <motion.i style={{ background: 'var(--bad)' }} initial={{ height: 0 }} animate={{ height: `${p.cashOut / max * 100}%` }} />
            </div><span className="small faint num">{label(p.key)}</span></div>))}
        </div>
      </section>
      <div className="grid g-2" style={{ alignItems: 'start' }}>
        <section className="card col"><h2>Profit & loss</h2>
          <div className="col" style={{ gap: 0 }}>
            <Row l="Sales (bills)" v={T.sales} /><Row l="  of which prescription bills" v={T.salesRx} sub /><Row l="  of which over-the-counter bills" v={T.salesOtc} sub />
            <Row l="Returns (refunds)" v={-T.refunds} /><Row l="Net sales" v={T.netSales} strong />
            <Row l={`${taxLabel} in sales`} v={-T.tax} /><Row l="Cost of medicines sold" v={-T.cogs} /><Row l="Gross profit" v={T.grossProfit} strong />
            <Row l="Expenses" v={-T.expenses} /><Row l="Net profit" v={T.netProfit} strong color={T.netProfit >= 0 ? 'var(--ok)' : 'var(--bad)'} />
          </div>
        </section>
        <section className="card col"><h2>Cash flow</h2>
          <div className="col" style={{ gap: 0 }}>
            <Row l="Paid bills" v={T.cashIn - T.creditCollected} /><Row l="Credit collected" v={T.creditCollected} /><Row l="Money in" v={T.cashIn} strong color="var(--ok)" />
            <Row l="Paid to suppliers" v={-T.supplierPaid} /><Row l="Expenses" v={-T.expenses} /><Row l="Refunds paid back" v={-(T.cashOut - T.supplierPaid - T.expenses)} />
            <Row l="Money out" v={-T.cashOut} strong color="var(--bad)" />
            <Row l="Sold on credit (not paid yet)" v={T.creditSales} sub /><Row l="Stock received (supplier bills)" v={T.purchases} sub />
          </div>
        </section>
        <section className="card col"><h2>{taxLabel} by rate</h2>
          {sum.taxByRate.length === 0 ? <span className="small muted">No tax on sales in these dates.</span> :
            <table className="t"><thead><tr><th>Rate</th><th>Taxable</th><th>{taxLabel}</th></tr></thead><tbody>
              {sum.taxByRate.map(r => <tr key={r.rateBp}><td className="num">{r.rateBp / 100}%</td><td className="num">{money(r.taxable, lang)}</td><td className="num">{money(r.tax, lang)}</td></tr>)}
            </tbody></table>}
          <h2 style={{ marginTop: 8 }}>Bills by status</h2>
          <table className="t"><tbody>{Object.entries(sum.invoiceStatus).map(([k, v]) => <tr key={k}><td>{STATUS[k] || k}</td><td className="num">{v.count}</td><td className="num">{money(v.total, lang)}</td></tr>)}</tbody></table>
        </section>
        <section className="card col"><div className="row"><h2>Expenses</h2><span className="spacer" />
          {can(user, 'accounts.create') && <button type="button" className="btn sm primary" onClick={() => setEdit({ date: today, category: 'Rent', payMethod: 'cash' })}><Icon name="plus" size={16} /> Add expense</button>}</div>
          {expenses.length === 0 ? <span className="small muted">No expenses in these dates. Add rent, salaries, electricity and other costs to see your real profit.</span> :
            <table className="t"><tbody>{expenses.slice(0, 100).map(e => (
              <tr key={e.id} className={can(user, 'accounts.edit') ? 'click' : ''} onClick={() => can(user, 'accounts.edit') && setEdit(e)}>
                <td className="num small">{e.date}</td><td><strong>{e.category}</strong>{e.note && <div className="small muted">{e.note}</div>}</td><td className="num">{money(e.amount, lang)}</td></tr>))}</tbody></table>}
        </section>
      </div>
      <section className="table-wrap"><table className="t"><thead><tr><th>{range.group === 'day' ? 'Day' : range.group === 'month' ? 'Month' : 'Year'}</th><th>Bills</th><th>Net sales</th><th>{taxLabel}</th><th>Gross profit</th><th>Expenses</th><th>Net profit</th><th>Money in</th><th>Money out</th></tr></thead><tbody>
        {[...sum.periods].reverse().filter(p => p.bills || p.cashIn || p.cashOut || p.expenses).map(p => <tr key={p.key}><td className="num">{p.key}</td><td className="num">{p.bills}</td><td className="num">{money(p.netSales, lang)}</td><td className="num">{money(p.tax, lang)}</td><td className="num">{money(p.grossProfit, lang)}</td><td className="num">{money(p.expenses, lang)}</td><td className="num" style={{ color: p.netProfit >= 0 ? 'var(--ok)' : 'var(--bad)', fontWeight: 700 }}>{money(p.netProfit, lang)}</td><td className="num">{money(p.cashIn, lang)}</td><td className="num">{money(p.cashOut, lang)}</td></tr>)}
      </tbody></table></section>
      {edit && <ExpenseForm e={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); toast('ok', t('save')); }} />}
    </>
  );
}

const STATUS: Record<string, string> = { paid: 'Paid', credit: 'Unpaid (credit)', partial_refund: 'Partially refunded', refunded: 'Refunded', void: 'Cancelled' };

function Row({ l, v, strong, sub, color }: { l: string; v: number; strong?: boolean; sub?: boolean; color?: string }) {
  const { lang } = useStore();
  return <div className={`money-row${sub ? ' sub' : ''}${strong ? ' strong' : ''}`}><span>{l.trim()}</span><span className="num" style={{ color }}>{money(v, lang)}</span></div>;
}

function ExpenseForm({ e, onClose, onSaved }: { e: Partial<Expense>; onClose: () => void; onSaved: () => void }) {
  const { ctx, t, user } = useStore();
  const [f, setF] = useState({ date: e.date || isoDate(), category: e.category || 'Other', amount: e.amount ? String(e.amount / 100) : '', payMethod: e.payMethod || 'cash', paidTo: e.paidTo || '', note: e.note || '' });
  const a = useAsync(async () => {
    await saveExpense(ctx, { ...(e.id ? e : {}), date: f.date, category: f.category, amount: toPaisa(f.amount || 0), payMethod: f.payMethod as Expense['payMethod'], paidTo: f.paidTo.trim(), note: f.note.trim() } as never);
    onSaved();
  });
  return (
    <Modal title={e.id ? 'Modify expense' : 'Add expense'} onClose={onClose}>
      <form className="col" onSubmit={ev => { ev.preventDefault(); void a.run(); }}>
        <div className="form-grid two">
          <label className="field">Date<input className="input" type="date" required value={f.date} max={isoDate()} onChange={ev => setF({ ...f, date: ev.target.value })} /></label>
          <label className="field">Amount<input className="input num" required autoFocus inputMode="decimal" placeholder="0.00" value={f.amount} onChange={ev => setF({ ...f, amount: ev.target.value.replace(/[^\d.]/g, '') })} /></label>
          <label className="field">Category<input className="input" list="exp-cats" maxLength={40} value={f.category} onChange={ev => setF({ ...f, category: ev.target.value })} /><datalist id="exp-cats">{EXPENSE_CATEGORIES.map(c => <option key={c} value={c} />)}</datalist></label>
          <label className="field">Paid by<select className="input" value={f.payMethod} onChange={ev => setF({ ...f, payMethod: ev.target.value as Expense['payMethod'] })}><option value="cash">Cash</option><option value="bank">Bank</option><option value="card">Card</option><option value="wallet">JazzCash / Easypaisa</option></select></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>Paid to<input className="input" maxLength={80} value={f.paidTo} onChange={ev => setF({ ...f, paidTo: ev.target.value })} /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>Note<input className="input" maxLength={200} value={f.note} onChange={ev => setF({ ...f, note: ev.target.value })} /></label>
        </div>
        {a.err && <span className="err" role="alert">{a.err}</span>}
        <div className="form-actions">
          {e.id && can(user, 'accounts.delete') && <button type="button" className="btn danger" onClick={async () => { if (await confirmAsk({ message: 'Delete this expense?', danger: true, confirmText: t('delete') })) { await deleteExpense(ctx, e.id!); onSaved(); } }}>{t('delete')}</button>}
          <span className="spacer" /><button type="button" className="btn" onClick={onClose}>{t('cancel')}</button><button className="btn primary" disabled={a.busy}>{t('save')}</button>
        </div>
      </form>
    </Modal>
  );
}
