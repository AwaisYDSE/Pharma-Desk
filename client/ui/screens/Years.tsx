// The financial year switcher, the owner's option, and the notice shown while an older year is open.
// © Awais Amin
import React, { useState } from 'react';
import { useStore, useLive } from '../store.tsx';
import { Icon, Modal, Toggle } from '../components.tsx';
import { saveRecord } from '../../core/inventory.ts';
import { chooseYear, yearsOn } from '../../core/years.ts';
import { isoDate } from '../../../shared/util.ts';
import { yearOf, yearsBetween } from '../../../shared/years.ts';

export function YearSwitcher() {
  const { ctx, client, shop, online, sync, toast, refresh } = useStore();
  const on = yearsOn(shop, ctx);
  const start = shop?.years?.startMonth || 1;
  const first = useLive(async () => on && online ? (await client.request<{ firstDay: string }>('GET', '/api/books/first', undefined, { session: false })).firstDay : '', [on, online], '');
  const chosen = ctx.yearView || null;
  const [busy, setBusy] = useState(false);
  if (!on) return null;
  const today = isoDate(), current = yearOf(today, start), open = yearOf(chosen || today, start);
  const years = yearsBetween(first || open.from, today, start);
  const change = async (from: string) => {
    if (!online) return toast('warn', 'Connect to the server to switch year');
    setBusy(true);
    try {
      await sync.syncNow();
      if (await ctx.db.outbox.where('status').equals('pending').count()) throw new Error('Some changes could not be sent yet. Try again in a moment.');
      await chooseYear(ctx, from === current.from ? null : from);
      await sync.syncNow();
      refresh();
    } catch (e) { toast('bad', (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <select className="input" style={{ width: 'auto', minHeight: 38 }} aria-label="Financial year" value={open.from} disabled={busy || !online} onChange={e => void change(e.target.value)}>
        {years.map(y => <option key={y.from} value={y.from}>{y.label}</option>)}
      </select>
      {busy && <Modal title="Financial year" onClose={() => {}}><div className="row"><Icon name="server" /> <span>Loading this year from the server…</span></div></Modal>}
    </>
  );
}

export function OlderYearNotice() {
  const { ctx, shop } = useStore();
  const chosen = ctx.yearView;
  if (!chosen || !yearsOn(shop, ctx)) return null;
  return <div className="plan-banner" role="status"><Icon name="warn" size={18} /><span><strong>{yearOf(chosen, shop?.years?.startMonth || 1).label}</strong> · You are looking at an older year. Switch to the current year to make changes.</span></div>;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Owner only, and off unless the owner chooses it. */
export function YearSettings() {
  const { ctx, shop, toast, sync } = useStore();
  if (ctx.standalone) return null;
  const y = shop?.years, month = y?.startMonth || (shop?.billing?.region === 'pk' || !shop?.billing?.region ? 7 : 1);
  const save = async (next: { on: boolean; startMonth: number }) => {
    try { await saveRecord(ctx, 'shop', { ...(shop || {}), id: 'shop', years: next } as never); await sync.syncNow(); await sync.syncNow(); }
    catch (e) { toast('bad', (e as Error).message); }
  };
  return (
    <section className="card col" style={{ marginTop: 4 }}>
      <label className="row"><Toggle on={!!y?.on} label="Work one financial year at a time" onChange={v => void save({ on: v, startMonth: month })} /> <strong>Work one financial year at a time</strong></label>
      <span className="small muted">Devices keep only the open year, so they stay fast. Every year stays on the server PC, and you switch year at the top of the screen. Older years need the server to be on and are for looking only.</span>
      {y?.on && <label className="field" style={{ maxWidth: 220 }}>Year starts in<select className="input" value={month} onChange={e => void save({ on: true, startMonth: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>}
    </section>
  );
}
