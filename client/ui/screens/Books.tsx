// The books inside Accounts: statements, cash book, who owes what, business position.
// Calculated on this device from its own copy, so it all works offline.
// © Awais Amin
import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore, useLive } from '../store.tsx';
import { Icon, Empty, CountUp, useAsync } from '../components.tsx';
import { toPaisa } from '../../../shared/money.ts';
import { saveRecord, setOpeningBalance } from '../../core/inventory.ts';
import type { CashClosing } from '../../../shared/types.ts';
import { money } from '../i18n.ts';
import { can } from '../../../shared/permissions.ts';
import { isoDate } from '../../../shared/util.ts';
import { presetRange } from '../../../shared/accounting.ts';
import { statement, moneyBook, agedBalances, businessPosition, type EntryKind, type Method, type BooksData } from '../../../shared/books.ts';

const KIND: Record<EntryKind, [string, string]> = {
  sale: ['Sale', 'ok'], sale_return: ['Return', 'warn'], purchase: ['Purchase', 'info'], purchase_return: ['Return to supplier', 'warn'], receipt: ['Payment received', 'ok'], payment: ['Payment made', 'bad'], expense: ['Expense', 'bad'],
};
const METHOD: Record<Method, string> = { cash: 'Cash', bank: 'Card / bank', credit: 'Credit' };

function downloadCsv(name: string, rows: (string | number)[][]) {
  const cell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv' }));
  a.download = name; a.click();
}
const r2 = (p: number) => (p / 100).toFixed(2);

function Kpi({ label, value, color, i = 0 }: { label: string; value: number; color?: string; i?: number }) {
  const { lang, t } = useStore();
  return (
    <motion.div className="card lift kpi" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
      <span className="small muted">{t(label)}</span>
      <strong className="kpi-v" style={color ? { color } : undefined}><CountUp value={value} format={n => money(Math.round(n), lang)} /></strong>
    </motion.div>
  );
}

function Dates({ from, to, set }: { from: string; to: string; set: (r: { from: string; to: string }) => void }) {
  return (
    <>
      <label className="field" style={{ minWidth: 140 }}>From<input className="input" type="date" value={from} max={to} onChange={e => set({ from: e.target.value, to })} /></label>
      <label className="field" style={{ minWidth: 140 }}>To<input className="input" type="date" value={to} min={from} onChange={e => set({ from, to: e.target.value })} /></label>
    </>
  );
}

function Statements({ data }: { data: BooksData }) {
  const { lang, t, user } = useStore();
  const today = isoDate();
  const [range, setRange] = useState(() => { const r = presetRange('month', today); return { from: r.from, to: r.to }; });
  const [side, setSide] = useState<'all' | 'sales' | 'purchases'>('all');
  const [method, setMethod] = useState<'all' | Method>('all');
  const [party, setParty] = useState('');
  const [partyType, partyId] = party ? party.split(':') as ['patient' | 'supplier', string] : [null, null];
  const { rows, totals } = useMemo(() => statement(data, { ...range, side, method, partyType, partyId }), [data, range, side, method, party]);
  const csv = () => downloadCsv(`pharmadesk-statement-${range.from}-to-${range.to}.csv`, [
    ['Date', 'Type', 'Document', 'Customer or supplier', 'Payment', 'Amount', 'Money in', 'Money out'],
    ...rows.map(e => [e.date, KIND[e.kind][0], e.doc, e.partyName, METHOD[e.method], r2(e.amount), r2(e.moneyIn), r2(e.moneyOut)]),
  ]);
  return (
    <>
      <div className="row"><h1>Statements</h1><span className="spacer" />
        {can(user, 'reports.export') && <button type="button" className="btn sm" onClick={csv}><Icon name="download" size={16} /> CSV</button>}
        <button type="button" className="btn sm" onClick={() => window.print()}>{t('Print')}</button></div>
      <div className="row" style={{ gap: 10 }}>
        <Dates from={range.from} to={range.to} set={setRange} />
        <label className="field" style={{ minWidth: 150 }}>Show<select className="input" value={side} onChange={e => setSide(e.target.value as typeof side)}><option value="all">Sales and purchases</option><option value="sales">Sales only</option><option value="purchases">Purchases only</option></select></label>
        <label className="field" style={{ minWidth: 130 }}>Payment<select className="input" value={method} onChange={e => setMethod(e.target.value as typeof method)}><option value="all">All</option><option value="cash">Cash</option><option value="bank">Card / bank</option><option value="credit">Credit</option></select></label>
        <label className="field" style={{ minWidth: 190 }}>Customer or supplier<select className="input" value={party} onChange={e => setParty(e.target.value)}><option value="">All</option>
          <optgroup label={t('Customers')}>{(data.patients || []).filter(p => !p.deleted).map(p => <option key={p.id} value={`patient:${p.id}`}>{p.name}</option>)}</optgroup>
          <optgroup label={t('Suppliers')}>{(data.suppliers || []).filter(s => !s.deleted).map(s => <option key={s.id} value={`supplier:${s.id}`}>{s.name}</option>)}</optgroup></select></label>
      </div>
      <div className="grid g-auto">
        <Kpi i={0} label="Sales" value={totals.sales - totals.returns} color="var(--ok)" /><Kpi i={1} label="Purchases" value={totals.purchases} color="var(--info)" />
        <Kpi i={2} label="Money in" value={totals.moneyIn} color="var(--ok)" /><Kpi i={3} label="Money out" value={totals.moneyOut} color="var(--bad)" />
      </div>
      <section className="card">
        {rows.length === 0 ? <Empty icon="chart" text="Nothing in these dates." /> :
          <div className="table-wrap"><table className="t"><thead><tr><th>{t('Date')}</th><th>{t('Type')}</th><th>{t('Document')}</th><th>{t('Customer or supplier')}</th><th>{t('Payment')}</th><th>{t('Amount')}</th><th>{t('Money in')}</th><th>{t('Money out')}</th></tr></thead>
            <tbody>{rows.map((e, i) => <motion.tr key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 20) * 0.015 }}>
              <td className="num">{e.date}</td><td><span className={`badge ${KIND[e.kind][1]}`}>{t(KIND[e.kind][0])}</span></td><td>{e.doc === 'PAYMENT' ? '' : e.doc}</td><td>{e.partyName}</td><td>{t(METHOD[e.method])}</td>
              <td className="num">{money(e.amount, lang)}</td><td className="num">{e.moneyIn ? money(e.moneyIn, lang) : ''}</td><td className="num">{e.moneyOut ? money(e.moneyOut, lang) : ''}</td></motion.tr>)}</tbody></table></div>}
      </section>
    </>
  );
}

/** End of day: count the drawer, compare with the cash book, keep the result. */
function CloseDay({ data }: { data: BooksData }) {
  const { ctx, lang, user, shop, toast } = useStore();
  const today = isoDate();
  const expected = moneyBook(data, 'cash', today, today, shop?.openingCash || 0).closing;
  const [counted, setCounted] = useState(''), [note, setNote] = useState('');
  const list = useLive(async () => (await ctx.db.table('closings').toArray() as CashClosing[]).filter(c => !c.deleted).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 14), [], [] as CashClosing[]);
  const save = useAsync(async () => {
    const c = toPaisa(counted);
    await saveRecord<CashClosing>(ctx, 'closings', { date: today, expected, counted: c, difference: c - expected, note, userId: user?.id || null, userName: user?.name || null, at: new Date().toISOString() });
    setCounted(''); setNote(''); toast('ok', 'Day closed');
  });
  const diff = counted ? toPaisa(counted) - expected : 0;
  return (
    <section className="card col"><h2>Close the day</h2>
      {can(user, 'accounts.create') && <>
        <div className="row" style={{ gap: 10 }}>
          <div className="col" style={{ gap: 2 }}><span className="small muted">Should be in the drawer</span><strong>{money(expected, lang)}</strong></div>
          <label className="field" style={{ width: 150 }}>Cash counted<input className="input num" inputMode="decimal" value={counted} onChange={e => setCounted(e.target.value)} /></label>
          <label className="field" style={{ flex: 1, minWidth: 180 }}>Note<input className="input" value={note} onChange={e => setNote(e.target.value)} /></label>
          {counted && <div className="col" style={{ gap: 2 }}><span className="small muted">Difference</span><strong style={{ color: diff ? 'var(--bad)' : 'var(--ok)' }}>{money(diff, lang)}</strong></div>}
          <button type="button" className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={!counted || save.busy} onClick={() => void save.run()}>Close the day</button>
        </div>
        {save.err && <span className="err">{save.err}</span>}</>}
      {list.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Date</th><th>Closed by</th><th>Should be in the drawer</th><th>Cash counted</th><th>Difference</th><th>Note</th></tr></thead>
        <tbody>{list.map(c => <tr key={c.id}><td className="num">{c.date}</td><td>{c.userName}</td><td className="num">{money(c.expected, lang)}</td><td className="num">{money(c.counted, lang)}</td><td className="num" style={c.difference ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{money(c.difference, lang)}</td><td>{c.note}</td></tr>)}</tbody></table></div>}
    </section>
  );
}

/** Optional. Nothing here is needed to use the software. */
function Opening({ data }: { data: BooksData }) {
  const { ctx, user, shop, toast } = useStore();
  const [cash, setCash] = useState(shop?.openingCash ? String(shop.openingCash / 100) : ''), [bank, setBank] = useState(shop?.openingBank ? String(shop.openingBank / 100) : '');
  const [party, setParty] = useState(''), [amt, setAmt] = useState('');
  const saveMoney = useAsync(async () => { await saveRecord(ctx, 'shop', { ...(shop || {}), id: 'shop', openingCash: toPaisa(cash), openingBank: toPaisa(bank) } as never); toast('ok', 'Saved'); });
  const saveParty = useAsync(async () => {
    const [type, id] = party.split(':') as ['patient' | 'supplier', string];
    await setOpeningBalance(ctx, type, id, toPaisa(amt), isoDate());
    setParty(''); setAmt(''); toast('ok', 'Saved');
  });
  if (!user?.owner) return null;
  return (
    <details className="card"><summary style={{ cursor: 'pointer', fontWeight: 700 }}>Starting balances (optional)</summary>
      <div className="col" style={{ marginTop: 12 }}>
        <span className="small muted">Only if you want the figures to include money from before PharmaDesk.</span>
        <div className="row" style={{ gap: 10 }}>
          <label className="field" style={{ width: 150 }}>Cash<input className="input num" inputMode="decimal" value={cash} onChange={e => setCash(e.target.value)} /></label>
          <label className="field" style={{ width: 150 }}>Card / bank<input className="input num" inputMode="decimal" value={bank} onChange={e => setBank(e.target.value)} /></label>
          <button type="button" className="btn" style={{ alignSelf: 'flex-end' }} disabled={saveMoney.busy} onClick={() => void saveMoney.run()}>Save</button>
        </div>
        {saveMoney.err && <span className="err">{saveMoney.err}</span>}
        <div className="row" style={{ gap: 10 }}>
          <label className="field" style={{ minWidth: 220 }}>Customer or supplier<select className="input" value={party} onChange={e => setParty(e.target.value)}><option value="">Choose</option>
            <optgroup label="Customers">{(data.patients || []).filter(p => !p.deleted).map(p => <option key={p.id} value={`patient:${p.id}`}>{p.name}</option>)}</optgroup>
            <optgroup label="Suppliers">{(data.suppliers || []).filter(s => !s.deleted).map(s => <option key={s.id} value={`supplier:${s.id}`}>{s.name}</option>)}</optgroup></select></label>
          <label className="field" style={{ width: 150 }}>Amount<input className="input num" inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} /></label>
          <button type="button" className="btn" style={{ alignSelf: 'flex-end' }} disabled={!party || !amt || saveParty.busy} onClick={() => void saveParty.run()}>Add balance</button>
        </div>
        {saveParty.err && <span className="err">{saveParty.err}</span>}
      </div>
    </details>
  );
}

function CashBook({ data }: { data: BooksData }) {
  const { lang, t, user, shop } = useStore();
  const today = isoDate();
  const [range, setRange] = useState(() => { const r = presetRange('month', today); return { from: r.from, to: r.to }; });
  const [book, setBook] = useState<'cash' | 'bank'>('cash');
  const start = book === 'cash' ? shop?.openingCash || 0 : shop?.openingBank || 0;
  const b = useMemo(() => moneyBook(data, book, range.from, range.to, start), [data, book, range, start]);
  const csv = () => downloadCsv(`pharmadesk-${book}-book-${range.from}-to-${range.to}.csv`, [
    ['Date', 'Type', 'Document', 'Customer or supplier', 'Money in', 'Money out', 'Balance'],
    ['', 'Opening balance', '', '', '', '', r2(b.opening)],
    ...b.rows.map(e => [e.date, KIND[e.kind][0], e.doc, e.partyName, r2(e.moneyIn), r2(e.moneyOut), r2(e.balance)]),
  ]);
  return (
    <>
      <div className="row"><h1>{book === 'cash' ? 'Cash book' : 'Card and bank book'}</h1><span className="spacer" />
        <div className="tabs" role="tablist">{([['cash', 'Cash'], ['bank', 'Card / bank']] as ['cash' | 'bank', string][]).map(([k, l]) => <button type="button" key={k} role="tab" aria-selected={book === k} className={book === k ? 'on' : ''} onClick={() => setBook(k)}>{l}</button>)}</div>
        {can(user, 'reports.export') && <button type="button" className="btn sm" onClick={csv}><Icon name="download" size={16} /> CSV</button>}</div>
      {book === 'cash' && <CloseDay data={data} />}
      <div className="row" style={{ gap: 10 }}><Dates from={range.from} to={range.to} set={setRange} /></div>
      <div className="grid g-auto">
        <Kpi i={0} label="Opening balance" value={b.opening} /><Kpi i={1} label="Money in" value={b.moneyIn} color="var(--ok)" />
        <Kpi i={2} label="Money out" value={b.moneyOut} color="var(--bad)" /><Kpi i={3} label="Closing balance" value={b.closing} color="var(--info)" />
      </div>
      <section className="card">
        {b.rows.length === 0 ? <Empty icon="chart" text="Nothing in these dates." /> :
          <div className="table-wrap"><table className="t"><thead><tr><th>{t('Date')}</th><th>{t('Type')}</th><th>{t('Document')}</th><th>{t('Customer or supplier')}</th><th>{t('Money in')}</th><th>{t('Money out')}</th><th>{t('Balance')}</th></tr></thead>
            <tbody>{b.rows.map(e => <tr key={e.id}><td className="num">{e.date}</td><td><span className={`badge ${KIND[e.kind][1]}`}>{t(KIND[e.kind][0])}</span></td><td>{e.doc === 'PAYMENT' ? '' : e.doc}</td><td>{e.partyName}</td>
              <td className="num">{e.moneyIn ? money(e.moneyIn, lang) : ''}</td><td className="num">{e.moneyOut ? money(e.moneyOut, lang) : ''}</td><td className="num"><strong>{money(e.balance, lang)}</strong></td></tr>)}</tbody></table></div>}
      </section>
    </>
  );
}

function Owes({ data }: { data: BooksData }) {
  const { lang, t } = useStore();
  const today = isoDate();
  const [who, setWho] = useState<'patient' | 'supplier'>('patient');
  const a = useMemo(() => agedBalances(data, who, today), [data, who, today]);
  return (
    <>
      <div className="row"><h1>Who owes what</h1><span className="spacer" />
        <div className="tabs" role="tablist">{([['patient', 'Customers owe us'], ['supplier', 'We owe suppliers']] as ['patient' | 'supplier', string][]).map(([k, l]) => <button type="button" key={k} role="tab" aria-selected={who === k} className={who === k ? 'on' : ''} onClick={() => setWho(k)}>{l}</button>)}</div></div>
      <div className="grid g-auto"><Kpi label={who === 'patient' ? 'Customers owe us' : 'We owe suppliers'} value={a.total} color={who === 'patient' ? 'var(--ok)' : 'var(--bad)'} /></div>
      <section className="card">
        {a.rows.length === 0 ? <Empty icon="chart" text="Nothing is owed." /> :
          <div className="table-wrap"><table className="t"><thead><tr><th>{t('Name')}</th><th>{t('Up to 30 days')}</th><th>{t('31 to 60 days')}</th><th>{t('61 to 90 days')}</th><th>{t('Over 90 days')}</th><th>{t('Balance')}</th></tr></thead>
            <tbody>{a.rows.map(r => <tr key={r.partyId}><td>{r.name}</td><td className="num">{money(r.current, lang)}</td><td className="num">{money(r.d31, lang)}</td><td className="num">{money(r.d61, lang)}</td><td className="num" style={r.d90 ? { color: 'var(--bad)' } : undefined}>{money(r.d90, lang)}</td><td className="num"><strong>{money(r.balance, lang)}</strong></td></tr>)}</tbody></table></div>}
      </section>
    </>
  );
}

function Position({ data }: { data: BooksData }) {
  const { shop } = useStore();
  const p = useMemo(() => businessPosition(data, isoDate(), shop?.openingCash || 0, shop?.openingBank || 0), [data, shop]);
  return (
    <>
      <div className="row"><h1>Business position</h1></div>
      <div className="grid g-auto">
        <Kpi i={0} label="Cash" value={p.cash} /><Kpi i={1} label="Card / bank" value={p.bank} /><Kpi i={2} label="Stock at cost" value={p.stock} /><Kpi i={3} label="Customers owe us" value={p.receivable} color="var(--ok)" />
        <Kpi i={4} label="We owe suppliers" value={p.payable} color="var(--bad)" /><Kpi i={5} label="Business worth" value={p.worth} color="var(--info)" />
      </div>
      <p className="small muted">Worked out from what is recorded in PharmaDesk. It does not include money the business had before it started using PharmaDesk, unless you add it under Starting balances.</p>
      <Opening data={data} />
    </>
  );
}

export function Books({ view }: { view: 'statement' | 'cash' | 'parties' | 'position' }) {
  const { ctx } = useStore();
  const data = useLive(async (): Promise<BooksData> => ({
    invoices: await ctx.db.invoices.toArray(), refunds: await ctx.db.refunds.toArray(), purchases: await ctx.db.purchases.toArray(), expenses: await ctx.db.expenses.toArray(),
    ledger: await ctx.db.ledger.toArray(), batches: await ctx.db.batches.toArray(), patients: await ctx.db.patients.toArray(), suppliers: await ctx.db.suppliers.toArray(),
  }), [], null);
  if (!data) return <div className="card"><Empty icon="chart" text="Loading…" /></div>;
  if (view === 'statement') return <Statements data={data} />;
  if (view === 'cash') return <CashBook data={data} />;
  if (view === 'parties') return <Owes data={data} />;
  return <Position data={data} />;
}
