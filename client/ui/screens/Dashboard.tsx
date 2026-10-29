// Dashboard + Reports. All numbers are computed on this device from its full copy
// of the data, so they work even when the server PC is off.
import React, { useEffect, useMemo, useState } from 'react';
import { dateLocale } from '../phrases.ts';
import { motion } from 'framer-motion';
import { useStore, useLive } from '../store.tsx';
import { Icon, Skeleton, Empty, CountUp } from '../components.tsx';
import { money } from '../i18n.ts';
import { can } from '../../../shared/permissions.ts';
import { isoDate, addDays } from '../../../shared/util.ts';
import { offlineSummaryText } from './insights.ts';
import { navigate } from '../nav.ts';
import type { Invoice, InvoiceItem, Medicine } from '../../../shared/types.ts';

interface DayStat { date: string; revenue: number; profit: number; bills: number }

export async function loadSales(ctx: ReturnType<typeof useStore>['ctx'], days: number) {
  const since = addDays(isoDate(), -(days - 1));
  const inv = (await ctx.db.invoices.where('createdAt').aboveOrEqual(since).toArray()).filter(i => i.status !== 'void' && !i.rejected) as Invoice[];
  const ids = new Set(inv.map(i => i.id));
  const items = (await ctx.db.invoiceItems.toArray()).filter(i => ids.has(i.invoiceId)) as InvoiceItem[];
  const byDay = new Map<string, DayStat>();
  for (let i = 0; i < days; i++) { const d = addDays(since, i); byDay.set(d, { date: d, revenue: 0, profit: 0, bills: 0 }); }
  const invDay = new Map(inv.map(i => [i.id, isoDate(new Date(i.createdAt))]));
  for (const i of inv) { const s = byDay.get(isoDate(new Date(i.createdAt))); if (s) { s.revenue += i.total; s.bills++; } }
  for (const it of items) { const s = byDay.get(invDay.get(it.invoiceId)!); if (s) s.profit += (it.total - it.tax) - it.costPrice * it.qty; }
  const qty = new Map<string, number>();
  for (const it of items) qty.set(it.medicineId, (qty.get(it.medicineId) || 0) + it.qty);
  return { days: [...byDay.values()], items, inv, qty };
}

export function Dashboard() {
  const { ctx, t, lang, user, alerts, client, online, settings } = useStore();
  const data = useLive(() => loadSales(ctx, 7), [], null);
  const meds = useLive(() => ctx.db.medicines.toArray(), [], [] as Medicine[]);
  const [ai, setAi] = useState<{ text: string; source: string } | null>(null);
  const showProfit = can(user, 'reports.profit');
  const today = data?.days.at(-1);
  const lastWeek = data?.days[0];
  const pct = today && lastWeek?.revenue ? Math.round((today.revenue - lastWeek.revenue) / lastWeek.revenue * 100) : null;
  const top = useMemo(() => data ? [...data.qty].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, q]) => ({ id, name: meds.find(m => m.id === id)?.name || '?', qty: q })) : [], [data, meds]);
  const max = Math.max(1, ...(data?.days.map(d => d.revenue) || [1]));

  useEffect(() => {
    if (!data || !today) return;
    const local = offlineSummaryText(lang, today.revenue, showProfit ? today.profit : null, today.bills, pct, top, alerts);
    setAi({ text: local, source: 'offline' });
    if (online && ctx.sessionId && can(user, 'dashboard')) {
      client.request<{ text: string; source: string }>('GET', `/api/ai/insights?lang=${lang}`).then(setAi).catch(() => {});
    }
  }, [data, lang, online]); // eslint-disable-line

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <>
      <div className="row">
        <div className="col" style={{ gap: 2 }}>
          <span className="small muted">{new Date().toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
          <h1>{lang === 'ur' ? `خوش آمدید، ${user?.name}` : `${greet}, ${user?.name}`}</h1>
        </div>
        <span className="spacer" />
        <svg width="200" height="40" viewBox="0 0 200 40" aria-hidden="true" className="hide-sm"><path className="ecgline" d="M0 24h60l8-16 10 28 9-34 9 22h104" fill="none" stroke="var(--accent2)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ strokeDasharray: 300, animation: 'ecg 2.4s linear infinite' }} /></svg>
      </div>
      <div className="grid g-auto">
        {[
          { label: `${t('today')} — ${t('sales')}`, n: today?.revenue, f: (x: number) => money(x, lang), v: today ? money(today.revenue, lang) : null, sub: pct != null ? `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs last week` : '', good: (pct ?? 0) >= 0 },
          ...(showProfit ? [{ label: t('profit'), n: today?.profit, f: (x: number) => money(x, lang), v: today ? money(today.profit, lang) : null, sub: today?.revenue ? `${Math.round(today.profit / today.revenue * 100)}% margin` : '', good: true }] : []),
          { label: t('bills'), n: today?.bills, f: (x: number) => String(x), v: today ? String(today.bills) : null, sub: today?.bills ? `Avg ${money(Math.round(today.revenue / today.bills), lang)}` : '', good: true },
          { label: t('alerts'), v: String(alerts.filter(a => a.level !== 'info').length), sub: `${alerts.filter(a => a.kind === 'expiring').length} expiring · ${alerts.filter(a => a.kind === 'low' || a.kind === 'out').length} low`, good: false },
        ].map((k, i) => (
          <motion.div key={k.label} className="card kpi lift" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .06 }}>
            <span className="small muted">{k.label}</span>
            {k.v == null ? <Skeleton h={30} w="70%" /> : <span className="v num">{'n' in k && k.n != null ? <CountUp value={k.n} format={k.f!} /> : k.v}</span>}
            <span className="small" style={{ color: k.good ? 'var(--ok)' : 'var(--muted)', fontWeight: 600 }}>{k.sub}</span>
          </motion.div>
        ))}
      </div>
      <div className="grid g-2">
        <section className="card col" aria-label="Sales last 7 days">
          <h2>{t('sales')} — 7 days</h2>
          <div className="row" style={{ alignItems: 'flex-end', height: 200, gap: 10, flexWrap: 'nowrap', borderBottom: '1px solid var(--line)' }}>
            {(data?.days || Array.from({ length: 7 }, () => null)).map((d, i) => (
              <div key={i} className="col" style={{ flex: 1, alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                {d && <span className="small faint num">{Math.round(d.revenue / 100000)}k</span>}
                <motion.div title={d ? money(d.revenue, lang) : ''} style={{ width: '100%', maxWidth: 40, borderRadius: '8px 8px 3px 3px', background: i === 6 ? 'var(--accent)' : 'color-mix(in srgb, var(--accent2) 55%, transparent)', transformOrigin: 'bottom' }}
                  initial={{ height: 0 }} animate={{ height: d ? `${Math.max(3, d.revenue / max * 80)}%` : '30%' }} transition={{ delay: i * .05, type: 'spring' }} />
              </div>
            ))}
          </div>
          <div className="row small muted" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>{data?.days.map(d => <span key={d.date} className="num">{d.date.slice(8)}</span>)}</div>
        </section>
        <section className="card col" style={{ background: 'linear-gradient(160deg, var(--accentSoft), transparent)' }} aria-label={t('aiSummary')}>
          <div className="row"><span className="badge acc" style={{ padding: 8, borderRadius: 10 }}><Icon name="spark" /></span><h2 style={{ margin: 0 }}>{t('aiSummary')}</h2><span className="spacer" />
            {ai && <span className="badge">{ai.source === 'ai' ? 'Gemini AI' : 'offline'}</span>}</div>
          {ai ? <p style={{ margin: 0, lineHeight: 1.8 }}>{ai.text}</p> : <><Skeleton /><Skeleton w="80%" /><Skeleton w="60%" /></>}
          {!settings && <span />}
        </section>
      </div>
      <div className="grid g-2">
        <section className="card"><h2>{t('topSellers')}</h2>
          {top.length === 0 ? <Empty icon="chart" text="No sales yet today" /> : top.map((x, i) => (
            <div key={x.id} className="row click-row" role="button" tabIndex={0} title="Open item" onClick={() => can(user, 'inventory') && navigate('inventory', { open: 'medicine', id: x.id })} style={{ padding: '8px 4px', borderTop: i ? '1px solid var(--line)' : 0, flexWrap: 'nowrap', cursor: can(user, 'inventory') ? 'pointer' : 'default' }}>
              <span className="badge acc num">{i + 1}</span><strong style={{ flex: 1 }}>{x.name}</strong>
              <div style={{ width: 120, height: 8, borderRadius: 6, background: 'var(--panel2)' }}><motion.div style={{ height: 8, borderRadius: 6, background: 'var(--accent2)' }} initial={{ width: 0 }} animate={{ width: `${x.qty / top[0].qty * 100}%` }} /></div>
              <span className="num small muted" style={{ width: 50, textAlign: 'end' }}>{x.qty}</span>
            </div>
          ))}
        </section>
        <section className="card col"><h2>{t('needsAttention')}</h2>
          {alerts.length === 0 ? <Empty icon="check" text={t('noAlerts')} /> : alerts.slice(0, 5).map(a => (
            <div key={a.id} className="row" role="button" tabIndex={0} onClick={() => can(user, 'alerts') && navigate('alerts')} style={{ cursor: 'pointer', padding: '10px 12px', borderRadius: 12, background: a.level === 'critical' ? 'var(--badSoft)' : a.level === 'warning' ? 'var(--warnSoft)' : 'var(--accentSoft)', flexWrap: 'nowrap' }}>
              <Icon name={a.kind === 'refill' ? 'users' : 'warn'} /><div className="col" style={{ gap: 0, flex: 1 }}><strong className="small">{a.title}</strong><span className="small muted">{a.detail}</span></div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

export function Reports() {
  const { ctx, t, lang, user } = useStore();
  const [days, setDays] = useState(30);
  const data = useLive(() => loadSales(ctx, days), [days], null);
  const meds = useLive(() => ctx.db.medicines.toArray(), [], [] as Medicine[]);
  const users = useLive(() => ctx.db.users.toArray(), [], []);
  const showProfit = can(user, 'reports.profit');
  if (!data) return <Skeleton h={200} />;
  const sum = (k: 'revenue' | 'profit' | 'bills') => data.days.reduce((s, d) => s + d[k], 0);
  const byCashier = new Map<string, { n: number; total: number; disc: number }>();
  for (const i of data.inv) { const c = byCashier.get(i.cashierId) || { n: 0, total: 0, disc: 0 }; c.n++; c.total += i.total; c.disc += i.discount; byCashier.set(i.cashierId, c); }
  const csv = () => {
    const rows = [['Date', 'Bills', 'Revenue', ...(showProfit ? ['Profit'] : [])], ...data.days.map(d => [d.date, d.bills, (d.revenue / 100).toFixed(2), ...(showProfit ? [(d.profit / 100).toFixed(2)] : [])])];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
    a.download = `pharmadesk-sales-${isoDate()}.csv`; a.click();
  };
  return (
    <>
      <div className="row"><h1>{t('reports')}</h1><span className="spacer" />
        {[7, 30, 90].map(d => <button type="button" key={d} className={`btn sm ${days === d ? 'primary' : ''}`} onClick={() => setDays(d)}>{d} days</button>)}
        {can(user, 'reports.export') && <button type="button" className="btn sm" onClick={csv}><Icon name="download" size={16} /> CSV</button>}</div>
      <div className="grid g-auto">
        <div className="card kpi"><span className="small muted">{t('sales')}</span><span className="v num">{money(sum('revenue'), lang)}</span></div>
        {showProfit && <div className="card kpi"><span className="small muted">{t('profit')}</span><span className="v num">{money(sum('profit'), lang)}</span></div>}
        <div className="card kpi"><span className="small muted">{t('bills')}</span><span className="v num">{sum('bills')}</span></div>
      </div>
      <div className="grid g-2">
        <div className="table-wrap"><table className="t"><thead><tr><th>{t('topSellers')}</th><th>{t('qty')}</th></tr></thead><tbody>
          {[...data.qty].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([id, q]) => <tr key={id}><td>{meds.find(m => m.id === id)?.name}</td><td className="num">{q}</td></tr>)}
        </tbody></table></div>
        <div className="table-wrap"><table className="t"><thead><tr><th>Cashier</th><th>{t('bills')}</th><th>{t('sales')}</th><th>{t('discount')}</th></tr></thead><tbody>
          {[...byCashier].map(([id, c]) => <tr key={id}><td>{users.find(u => u.id === id)?.name || id.slice(0, 6)}</td><td className="num">{c.n}</td><td className="num">{money(c.total, lang)}</td><td className="num">{money(c.disc, lang)}</td></tr>)}
        </tbody></table></div>
      </div>
    </>
  );
}
