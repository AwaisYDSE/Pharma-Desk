// Partner Ledger, General Ledger and Trial Balance, in the wording of Odoo Accounting.
// Each reads only the records its filters need and shows long lists page by page, so big books stay quick.
// © Awais Amin
import React, { useMemo, useState } from 'react';
import { useStore, useLive } from '../store.tsx';
import { Icon, Empty } from '../components.tsx';
import { money } from '../i18n.ts';
import { can } from '../../../shared/permissions.ts';
import { isoDate, addDays } from '../../../shared/util.ts';
import { presetRange, dayOf } from '../../../shared/accounting.ts';
import { partnerLedger, journalItems, generalLedger, trialBalance, type PartnerData, type JournalData } from '../../../shared/ledger.ts';
import type { Invoice, Refund, MoneyMove } from '../../../shared/types.ts';

const PAGE = 200;
const r2 = (p: number) => (p / 100).toFixed(2);

function downloadCsv(name: string, rows: (string | number)[][]) {
  const cell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv' }));
  a.download = name; a.click();
}

function useRange() {
  return useState(() => { const r = presetRange('month', isoDate()); return { from: r.from, to: r.to }; });
}

function Dates({ range, set }: { range: { from: string; to: string }; set: (r: { from: string; to: string }) => void }) {
  return (
    <>
      <label className="field" style={{ minWidth: 140 }}>From<input className="input" type="date" value={range.from} max={range.to} onChange={e => set({ ...range, from: e.target.value || range.from })} /></label>
      <label className="field" style={{ minWidth: 140 }}>To<input className="input" type="date" value={range.to} min={range.from} onChange={e => set({ ...range, to: e.target.value || range.to })} /></label>
    </>
  );
}

function Head({ title, onCsv }: { title: string; onCsv: () => void }) {
  const { user } = useStore();
  return <div className="row"><h1>{title}</h1><span className="spacer" />
    {can(user, 'reports.export') && <button type="button" className="btn sm" onClick={onCsv}><Icon name="download" size={16} /> CSV</button>}
    <button type="button" className="btn sm" onClick={() => window.print()}>Print</button></div>;
}

function More({ left, onMore }: { left: number; onMore: () => void }) {
  if (left <= 0) return null;
  return <div className="row" style={{ justifyContent: 'center', padding: 10 }}><button type="button" className="btn sm" onClick={onMore}>{`Show ${Math.min(left, PAGE)} more of ${left}`}</button></div>;
}

const Amt = ({ v }: { v: number }) => { const { lang } = useStore(); return <td className="num">{v ? money(v, lang) : ''}</td>; };

export function PartnerLedgerView() {
  const { ctx, lang, t } = useStore();
  const [range, setRange] = useRange();
  const [who, setWho] = useState<'' | 'patient' | 'supplier'>('');
  const [party, setParty] = useState('');
  const [open, setOpen] = useState<Record<string, number>>({});
  const patients = useLive(() => ctx.db.patients.toArray(), [], []);
  const suppliers = useLive(() => ctx.db.suppliers.toArray(), [], []);
  const [pt, pid] = party ? party.split(':') as ['patient' | 'supplier', string] : [who || null, null];
  const data = useLive(async (): Promise<PartnerData> => {
    if (pid) { // one partner: only their own lines are read
      const invoices = pt === 'patient' ? await ctx.db.invoices.where('patientId').equals(pid).toArray() : [];
      const purchases = pt === 'supplier' ? await ctx.db.purchases.where('supplierId').equals(pid).toArray() : [];
      return { purchases, ledger: await ctx.db.ledger.where('[partyType+partyId]').equals([pt!, pid]).toArray(), invoices, refunds: invoices.length ? await ctx.db.refunds.where('invoiceId').anyOf(invoices.map(i => i.id)).toArray() : [] };
    }
    // Bills paid at the counter net to zero, so bills outside these dates cannot change a balance.
    const inRange = await ctx.db.invoices.where('createdAt').between(addDays(range.from, -1), addDays(range.to, 2)).toArray();
    const refunds = await ctx.db.refunds.where('date').between(range.from, addDays(range.to, 1)).toArray();
    const known = new Set(inRange.map(i => i.id));
    const extra = (await ctx.db.invoices.bulkGet([...new Set(refunds.map(r => r.invoiceId))].filter(id => !known.has(id)))).filter(Boolean) as Invoice[];
    return { purchases: await ctx.db.purchases.toArray(), ledger: await ctx.db.ledger.toArray(), invoices: [...inRange, ...extra], refunds };
  }, [range.from, range.to, party], null as unknown as PartnerData);
  const rep = useMemo(() => data ? partnerLedger({ ...data, patients, suppliers }, { ...range, partyType: pt, partyId: pid }) : null, [data, range, party, who, patients, suppliers]);
  const csv = () => rep && downloadCsv(`partner-ledger-${range.from}-to-${range.to}.csv`, [
    ['Partner', 'Journal', 'Account', 'Ref', 'Invoice Date', 'Due Date', 'Matching', 'Debit', 'Credit', 'Balance'],
    ...rep.partners.flatMap(p => [
      [p.name, '', '', 'Initial Balance', '', '', '', '', '', r2(p.initial)],
      ...p.lines.map(l => [p.name, l.journal, `${l.account.code} ${l.account.name}`, l.ref, l.date, l.dueDate, l.matching, r2(l.debit), r2(l.credit), r2(l.balance)]),
    ]),
    ['Total', '', '', '', '', '', '', r2(rep.debit), r2(rep.credit), r2(rep.balance)],
  ]);
  return (
    <>
      <Head title="Partner Ledger" onCsv={csv} />
      <div className="row" style={{ gap: 10 }}>
        <Dates range={range} set={setRange} />
        <label className="field" style={{ minWidth: 150 }}>Account<select className="input" value={who} onChange={e => { setWho(e.target.value as typeof who); setParty(''); }}><option value="">All</option><option value="patient">Receivable</option><option value="supplier">Payable</option></select></label>
        <label className="field" style={{ minWidth: 200 }}>Partners<select className="input" value={party} onChange={e => setParty(e.target.value)}><option value="">All</option>
          {who !== 'supplier' && <optgroup label={t('Customers')}>{patients.filter(p => !p.deleted).map(p => <option key={p.id} value={`patient:${p.id}`}>{p.name}</option>)}</optgroup>}
          {who !== 'patient' && <optgroup label={t('Suppliers')}>{suppliers.filter(s => !s.deleted).map(s => <option key={s.id} value={`supplier:${s.id}`}>{s.name}</option>)}</optgroup>}</select></label>
      </div>
      <section className="card">
        {!rep ? <Empty icon="chart" text="Loading…" /> : rep.partners.length === 0 ? <Empty icon="chart" text="Nothing in these dates." /> :
          <div className="table-wrap"><table className="t ledger">
            <thead><tr><th>Partner</th><th>Journal</th><th>Account</th><th>Invoice Date</th><th>Due Date</th><th>Matching</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
            <tbody>{rep.partners.map(p => { const key = `${p.partyType}:${p.partyId}`; const shown = open[key] ?? (pid ? PAGE : 0); return (
              <React.Fragment key={key}>
                <tr className="click ledger-group" onClick={() => setOpen({ ...open, [key]: shown ? 0 : PAGE })}><td colSpan={6}><strong>{shown ? '▾' : '▸'} {p.name || '—'}</strong>{p.outstanding > 0 && <span className="small muted"> · Outstanding credits <span className="num">{money(p.outstanding, lang)}</span></span>}</td><td className="num"><strong>{money(p.debit, lang)}</strong></td><td className="num"><strong>{money(p.credit, lang)}</strong></td><td className="num"><strong>{money(p.balance, lang)}</strong></td></tr>
                {shown > 0 && <tr><td colSpan={8} className="small muted">Initial Balance</td><td className="num">{money(p.initial, lang)}</td></tr>}
                {shown > 0 && p.lines.slice(0, shown).map(l => <tr key={l.id}><td>{l.ref}</td><td>{l.journal}</td><td className="small">{`${l.account.code} ${l.account.name}`}</td><td className="num">{l.date}</td><td className="num">{l.dueDate}</td><td className="num">{l.matching}</td><Amt v={l.debit} /><Amt v={l.credit} /><td className="num">{money(l.balance, lang)}</td></tr>)}
                {shown > 0 && p.lines.length > shown && <tr><td colSpan={9}><More left={p.lines.length - shown} onMore={() => setOpen({ ...open, [key]: shown + PAGE })} /></td></tr>}
              </React.Fragment>); })}
              <tr className="ledger-group"><td colSpan={6}><strong>Total</strong></td><td className="num"><strong>{money(rep.debit, lang)}</strong></td><td className="num"><strong>{money(rep.credit, lang)}</strong></td><td className="num"><strong>{money(rep.balance, lang)}</strong></td></tr>
            </tbody></table></div>}
      </section>
    </>
  );
}

/** General Ledger and Trial Balance look at every money document, so they read them all once and keep the journal items. */
function useJournal() {
  const { ctx, shop } = useStore();
  const raw = useLive(async (): Promise<JournalData> => ({
    invoices: await ctx.db.invoices.toArray(), invoiceItems: await ctx.db.invoiceItems.toArray(), refunds: await ctx.db.refunds.toArray() as Refund[], purchases: await ctx.db.purchases.toArray(),
    expenses: await ctx.db.expenses.toArray(), ledger: await ctx.db.ledger.toArray(), patients: await ctx.db.patients.toArray(), suppliers: await ctx.db.suppliers.toArray(), moneyMoves: await ctx.db.table('moneyMoves').toArray() as MoneyMove[],
  }), [], null as unknown as JournalData);
  return useMemo(() => raw ? journalItems({ ...raw, shop }) : null, [raw, shop]);
}

export function GeneralLedgerView() {
  const { lang } = useStore();
  const [range, setRange] = useRange();
  const items = useJournal();
  const [open, setOpen] = useState<Record<string, number>>({});
  const rep = useMemo(() => items ? generalLedger(items, range.from, range.to) : null, [items, range]);
  const csv = () => rep && downloadCsv(`general-ledger-${range.from}-to-${range.to}.csv`, [
    ['Account', 'Date', 'Communication', 'Partner', 'Journal', 'Debit', 'Credit', 'Balance'],
    ...rep.accounts.flatMap(a => [[`${a.account.code} ${a.account.name}`, '', 'Initial Balance', '', '', '', '', r2(a.initial)], ...a.lines.map(l => [`${a.account.code} ${a.account.name}`, l.date, l.label, l.partner, l.journal, r2(l.debit), r2(l.credit), r2(l.balance)])]),
    ['Total', '', '', '', '', r2(rep.debit), r2(rep.credit), r2(rep.balance)],
  ]);
  return (
    <>
      <Head title="General Ledger" onCsv={csv} />
      <div className="row" style={{ gap: 10 }}><Dates range={range} set={setRange} /></div>
      <section className="card">
        {!rep ? <Empty icon="chart" text="Loading…" /> : rep.accounts.length === 0 ? <Empty icon="chart" text="Nothing in these dates." /> :
          <div className="table-wrap"><table className="t ledger">
            <thead><tr><th>Account</th><th>Date</th><th>Communication</th><th>Partner</th><th>Journal</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
            <tbody>{rep.accounts.map(a => { const key = a.account.code + a.account.name, shown = open[key] || 0; return (
              <React.Fragment key={key}>
                <tr className="click ledger-group" onClick={() => setOpen({ ...open, [key]: shown ? 0 : PAGE })}><td colSpan={5}><strong>{shown ? '▾' : '▸'} {`${a.account.code} ${a.account.name}`}</strong></td><td className="num"><strong>{money(a.debit, lang)}</strong></td><td className="num"><strong>{money(a.credit, lang)}</strong></td><td className="num"><strong>{money(a.balance, lang)}</strong></td></tr>
                {shown > 0 && <tr><td colSpan={7} className="small muted">Initial Balance</td><td className="num">{money(a.initial, lang)}</td></tr>}
                {shown > 0 && a.lines.slice(0, shown).map(l => <tr key={l.id}><td /><td className="num">{l.date}</td><td>{l.label}</td><td>{l.partner}</td><td>{l.journal}</td><Amt v={l.debit} /><Amt v={l.credit} /><td className="num">{money(l.balance, lang)}</td></tr>)}
                {shown > 0 && a.lines.length > shown && <tr><td colSpan={8}><More left={a.lines.length - shown} onMore={() => setOpen({ ...open, [key]: shown + PAGE })} /></td></tr>}
              </React.Fragment>); })}
              <tr className="ledger-group"><td colSpan={5}><strong>Total</strong></td><td className="num"><strong>{money(rep.debit, lang)}</strong></td><td className="num"><strong>{money(rep.credit, lang)}</strong></td><td className="num"><strong>{money(rep.balance, lang)}</strong></td></tr>
            </tbody></table></div>}
      </section>
    </>
  );
}

export function TrialBalanceView() {
  const { lang } = useStore();
  const [range, setRange] = useRange();
  const items = useJournal();
  const rep = useMemo(() => items ? trialBalance(items, range.from, range.to) : null, [items, range]);
  const period = `${dayOf(range.from)} - ${dayOf(range.to)}`;
  const csv = () => rep && downloadCsv(`trial-balance-${range.from}-to-${range.to}.csv`, [
    ['Account', 'Initial Balance Debit', 'Initial Balance Credit', 'Debit', 'Credit', 'End Balance Debit', 'End Balance Credit'],
    ...rep.rows.map(r => [`${r.account.code} ${r.account.name}`, r2(r.initialDebit), r2(r.initialCredit), r2(r.debit), r2(r.credit), r2(r.endDebit), r2(r.endCredit)]),
    ['Total', r2(rep.total.initialDebit), r2(rep.total.initialCredit), r2(rep.total.debit), r2(rep.total.credit), r2(rep.total.endDebit), r2(rep.total.endCredit)],
  ]);
  return (
    <>
      <Head title="Trial Balance" onCsv={csv} />
      <div className="row" style={{ gap: 10 }}><Dates range={range} set={setRange} /></div>
      <section className="card">
        {!rep ? <Empty icon="chart" text="Loading…" /> : rep.rows.length === 0 ? <Empty icon="chart" text="Nothing in these dates." /> :
          <div className="table-wrap"><table className="t ledger">
            <thead><tr><th /><th colSpan={2}>Initial Balance</th><th colSpan={2} className="num">{period}</th><th colSpan={2}>End Balance</th></tr>
              <tr><th>Account</th><th>Debit</th><th>Credit</th><th>Debit</th><th>Credit</th><th>Debit</th><th>Credit</th></tr></thead>
            <tbody>{rep.rows.map(r => <tr key={r.account.code + r.account.name}><td>{`${r.account.code} ${r.account.name}`}</td><Amt v={r.initialDebit} /><Amt v={r.initialCredit} /><Amt v={r.debit} /><Amt v={r.credit} /><Amt v={r.endDebit} /><Amt v={r.endCredit} /></tr>)}
              <tr className="ledger-group"><td><strong>Total</strong></td>{(['initialDebit', 'initialCredit', 'debit', 'credit', 'endDebit', 'endCredit'] as const).map(k => <td key={k} className="num"><strong>{money(rep.total[k], lang)}</strong></td>)}</tr>
            </tbody></table></div>}
      </section>
    </>
  );
}
