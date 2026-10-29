// Keyboard-first billing: F2 search · ↑↓ Enter add · F4 patient · F6 prescription reader (AI)
// F8 checkout · F9 reprint last · Esc clear search. USB barcode scanners work anywhere on this screen.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, useLive } from '../store.tsx';
import { MedThumb, MedName } from '../MedIcon.tsx';
import { takeIntent } from '../nav.ts';
import { Icon, Modal, PatientAvatar, Ecg, SupervisorPrompt, Empty, type Mood, confirmAsk } from '../components.tsx';
import { money } from '../i18n.ts';
import { SearchIndex } from '../../../shared/search.ts';
import { newCart, addToCart, setQty, setPrice, totals, checkout, overrideBatch, batchesFor, type Cart } from '../../core/pos.ts';
import { stockMap } from '../../core/inventory.ts';
import { checkInteractionsOffline, type InteractionWarning } from '../../../shared/interactions.ts';
import { parsePrescriptionOffline, type RxItem } from '../../../shared/rxparse.ts';
import { receiptData, downloadReceipt } from '../../core/print.ts';
import { can } from '../../../shared/permissions.ts';
import { toPaisa } from '../../../shared/money.ts';
import { isoDate, daysBetween } from '../../../shared/util.ts';
import type { Medicine, Patient, User } from '../../../shared/types.ts';

export function Pos() {
  const s = useStore();
  const { ctx, client, t, lang, toast, user, settings, printer } = s;
  const [cart, setCart] = useState<Cart>(() => newCart(settings.pricesIncludeGst));
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [mood, setMood] = useState<Mood>('idle');
  const [bubble, setBubble] = useState('');
  const [pay, setPay] = useState<'cash' | 'card' | 'credit'>('cash');
  const [received, setReceived] = useState('');
  const [discPct, setDiscPct] = useState('');
  const [warnings, setWarnings] = useState<InteractionWarning[]>([]);
  const [modal, setModal] = useState<null | 'patient' | 'rx' | 'batch' | { sup: string; then: (id: string) => void }>(null);
  const [batchLine, setBatchLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const scan = useRef({ buf: '', last: 0 });

  const meds = useLive(() => ctx.db.medicines.toArray(), [], [] as Medicine[]);
  const stock = useLive(() => stockMap(ctx), [], new Map<string, number>());
  const patients = useLive(() => ctx.db.patients.toArray(), [], [] as Patient[]);
  const index = useMemo(() => new SearchIndex().build(meds), [meds]);
  const results = useMemo(() => q.trim() ? index.search(q, 8) : [], [q, index]);
  const patient = patients.find(p => p.id === cart.patientId) || null;
  const tot = totals(cart);
  const refresh = () => setCart(c => ({ ...c, lines: [...c.lines] }));

  const say = (m: Mood, text: string) => { setMood(m); setBubble(text); };

  async function add(m: Medicine, qty = 1, allowNegative = false) {
    try {
      const w = await addToCart(ctx, cart, m, qty, { allowNegative });
      refresh(); setQ(''); setSel(0);
      if (m.rxRequired) toast('info', m.name, 'Prescription medicine — check the prescription.');
      const fefo = w.find(x => x.kind === 'fefo');
      if (fefo) { toast('warn', 'FEFO', t('fefoWarn', { b: fefo.batchNo!, n: fefo.days! })); say('worried', t('fefoWarn', { b: fefo.batchNo!, n: fefo.days! })); }
      else say('happy', `${m.name} — ${lang === 'ur' ? 'شامل ہو گئی!' : 'added!'}`);
    } catch (e) {
      const err = e as { code?: string; message: string; details?: { permission?: string } };
      if (err.code === 'OUT_OF_STOCK' && !allowNegative) {
        say('worried', err.message);
        if (await confirmAsk({ title: 'Stock not entered', message: `${err.message}\n\nSell anyway? This needs approval and is logged.`, danger: true, confirmText: 'Sell anyway' })) await add(m, qty, true);
      } else if (err.code === 'OVERRIDE_REQUIRED') {
        setModal({ sup: err.details!.permission!, then: async () => { const prev = ctx.user; ctx.user = { ...prev!, perms: [...prev!.perms, 'pos.negative_stock'] }; try { await add(m, qty, true); } finally { ctx.user = prev; } } });
      } else toast('bad', err.message);
    }
    search.current?.focus();
  }

  // Interaction check whenever the bill changes: AI on the server if reachable, built-in list otherwise.
  useEffect(() => {
    const drugs = [...new Map(cart.lines.map(l => [l.medicine.id, { name: l.medicine.name, generic: l.medicine.generic }])).values()];
    if (drugs.length < 2) { setWarnings([]); return; }
    setWarnings(checkInteractionsOffline(drugs));
    let on = true;
    if (s.online && ctx.sessionId) client.request<{ warnings: InteractionWarning[] }>('POST', '/api/ai/interactions', { drugs }).then(r => on && setWarnings(r.warnings)).catch(() => {});
    return () => { on = false; };
  }, [cart.lines.map(l => l.medicine.id).join()]); // eslint-disable-line

  useEffect(() => {
    if (warnings.some(w => w.severity !== 'moderate')) say('worried', `${warnings[0].a} + ${warnings[0].b}: ${warnings[0].effect}`);
  }, [warnings]);

  async function doCheckout(supervisorId?: string) {
    if (!cart.lines.length || busy) return;
    const pct = Number(discPct || 0);
    cart.billDiscount = pct > 0 ? Math.round(totals({ ...cart, billDiscount: 0 }).total * pct / 100) : 0;
    const total = totals(cart).total;
    const paid = pay === 'credit' ? 0 : (received ? toPaisa(received) : total);
    setBusy(true);
    try {
      const r = await checkout(ctx, cart, { method: pay, paid }, client, { supervisorId });
      setLastInvoice(r.invoice.id);
      say('party', lang === 'ur' ? 'شکریہ! آپ کا بل تیار ہے' : `Thank you! Change: ${money(r.invoice.change, lang)}`);
      toast('ok', `${t('saleDone')} · ${r.invoice.number}`, r.offline ? 'Saved on this device — will sync when the server is back.' : money(r.invoice.total, lang));
      if (settings.autoPrint) void printer.enqueue(r.invoice.id);
      setCart(newCart(settings.pricesIncludeGst)); setReceived(''); setDiscPct(''); setPay('cash');
      setTimeout(() => say('idle', ''), 2500);
    } catch (e) {
      const err = e as { code?: string; message: string; details?: { permission?: string } };
      if (err.code === 'OVERRIDE_REQUIRED') setModal({ sup: err.details!.permission!, then: id => void doCheckout(id) });
      else { say('worried', err.message); toast('bad', err.message); }
    } finally { setBusy(false); s.refresh(); }
  }

  // Keyboard shortcuts + barcode scanner (types very fast and ends with Enter).
  useEffect(() => {
    const k = async (e: KeyboardEvent) => {
      if (e.key === 'F8') { e.preventDefault(); void doCheckout(); return; }
      if (e.key === 'F4') { e.preventDefault(); setModal('patient'); return; }
      if (e.key === 'F6') { e.preventDefault(); setModal('rx'); return; }
      if (e.key === 'F9' && lastInvoice) { e.preventDefault(); void printer.enqueue(lastInvoice); return; }
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' && target.id !== 'pos-search') return;
      const now = performance.now();
      if (e.key.length === 1) { scan.current.buf = now - scan.current.last < 40 ? scan.current.buf + e.key : e.key; scan.current.last = now; }
      if (e.key === 'Enter' && scan.current.buf.length >= 6 && now - scan.current.last < 60) {
        const m = index.barcode(scan.current.buf);
        scan.current.buf = '';
        if (m) { e.preventDefault(); setQ(''); await add(m); }
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  useEffect(() => { search.current?.focus(); }, []);
  // Opened from another module: "Sell" on an item, "New bill" for a customer, "Sell refill"…
  const intentDone = useRef(false);
  useEffect(() => {
    if (intentDone.current || !meds.length) return;
    intentDone.current = true;
    const i = takeIntent('pos');
    if (!i || !('sell' in i)) return;
    if (i.sell.patientId) setCart(c => ({ ...c, patientId: i.sell.patientId! }));
    const m = i.sell.medicineId ? meds.find(x => x.id === i.sell.medicineId && !x.deleted) : undefined;
    if (m) void add(m, Math.max(1, i.sell.qty || 1));
  }, [meds.length]); // eslint-disable-line

  const today = isoDate();
  return (
    <div className="pos">
      <section className="col" aria-label="Bill" style={{ gap: 14, minWidth: 0 }}>
        <div className="searchbar">
          <Icon name="search" />
          <label htmlFor="pos-search" className="sr">{t('search')}</label>
          <input id="pos-search" ref={search} value={q} placeholder={t('search')} autoComplete="off"
            onChange={e => { setQ(e.target.value); setSel(0); }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel(i => Math.min(i + 1, results.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel(i => Math.max(i - 1, 0)); }
              if (e.key === 'Enter' && results[sel]) { e.preventDefault(); void add(results[sel]); }
              if (e.key === 'Escape') setQ('');
            }} />
          <span className="kbd hide-sm">F2</span>
          <CameraScan onCode={code => { const m = index.barcode(code); if (m) void add(m); else toast('warn', `Barcode ${code} not found`); }} />
          <button type="button" className="btn sm" onClick={() => setModal('rx')} title="F6"><Icon name="rx" size={16} /><span className="hide-sm">{t('readRx')}</span></button>
        </div>

        <AnimatePresence>
          {results.length > 0 && (
            <motion.div className="results" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {results.map((m, i) => {
                const st = stock.get(m.id) || 0;
                return (
                  <button type="button" key={m.id} className={`result ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => add(m)}>
                    <MedThumb med={m} />
                    <div className="col" style={{ gap: 0, flex: 1, minWidth: 0 }}>
                      <MedName med={m} sub={<span className="small faint" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[m.description, m.manufacturer, m.rackNo && `Rack ${m.rackNo}`].filter(Boolean).join(' · ')}</span>} />
                    </div>
                    {m.rxRequired && <span className="badge info">Rx</span>}
                    <span className={`badge ${st <= 0 ? 'bad' : st <= (m.reorderLevel ?? 10) ? 'warn' : ''}`}><span className="num">{st}</span> {t('inStock')}</span>
                    <strong className="num" style={{ color: 'var(--accent)' }}>{money(m.salePrice, lang)}</strong>
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {warnings.length > 0 && (
          <motion.div className="card" style={{ borderColor: 'var(--bad)', background: 'var(--badSoft)' }} initial={{ scale: .97 }} animate={{ scale: 1 }} role="alert">
            <div className="row"><Icon name="warn" /><strong>{t('interactions')}</strong><span className="spacer" /><span className="small muted">Pharmacist must confirm</span></div>
            {warnings.map((w, i) => (
              <div key={i} className="small" style={{ marginTop: 6 }}>
                <span className={`badge ${w.severity === 'moderate' ? 'warn' : 'bad'}`}>{w.severity}</span> <strong>{w.a} + {w.b}</strong>: {w.effect}. <span className="muted">{w.advice}</span> <span className="faint">({w.source === 'ai' ? 'AI' : 'built-in list'})</span>
              </div>
            ))}
          </motion.div>
        )}

        <div className="table-wrap">
          {cart.lines.length === 0 ? <Empty icon="cart" text={t('emptyBill')} /> : (
            <table className="t">
              <thead><tr><th>{t('name')}</th><th>{t('batch')} (FEFO)</th><th>{t('expiry')}</th><th>{t('qty')}</th><th>{t('price')}</th><th style={{ textAlign: 'end' }}>{t('amount')}</th><th /></tr></thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {cart.lines.map((l, i) => {
                    const days = l.batch.pending ? null : daysBetween(today, l.batch.expiryDate);
                    return (
                      <motion.tr key={l.key} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} layout>
                        <td><div className="row" style={{ flexWrap: 'nowrap', gap: 10 }}><MedThumb med={l.medicine} size={36} /><MedName med={l.medicine} /></div></td>
                        <td><button type="button" className="badge acc num" style={{ border: 0, cursor: 'pointer' }} onClick={() => { setBatchLine(l.key); setModal('batch'); }} title="Change batch">#{l.batch.batchNo}{l.overriddenBy ? ' ✎' : ''}</button></td>
                        <td className="num" style={{ color: days !== null && days <= 30 ? 'var(--warn)' : undefined }}>{l.batch.pending ? '—' : l.batch.expiryDate}</td>
                        <td><span className="qty"><button type="button" aria-label="Less" onClick={() => { setQty(cart, l.key, l.qty - 1); refresh(); }}>−</button>
                          <input className="num" aria-label={t('qty')} value={l.qty} onChange={e => { setQty(cart, l.key, Number(e.target.value) || 0); refresh(); }} />
                          <button type="button" aria-label="More" onClick={async () => { await add(l.medicine, 1); }}>+</button></span></td>
                        <td><PriceCell value={l.unitPrice} changed={l.listPrice != null && l.unitPrice !== l.listPrice} editable={can(user, 'pos.price')} onChange={v => { try { setPrice(cart, l.key, v); refresh(); } catch (e) { toast('bad', (e as Error).message); } }} /></td>
                        <td className="num" style={{ textAlign: 'end', fontWeight: 700 }}>{money(tot.lines[i]?.total || 0, lang)}</td>
                        <td><button type="button" className="btn icon ghost sm" aria-label={t('delete')} onClick={() => { setQty(cart, l.key, 0); refresh(); }}><Icon name="trash" size={16} /></button></td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          )}
        </div>
      </section>

      <aside className="col" aria-label="Checkout" style={{ gap: 14 }}>
        <div className="avatar-card">
          <PatientAvatar mood={mood} />
          <AnimatePresence mode="wait">
            {bubble && <motion.div key={bubble} className="bubble" initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}><strong className="small">{bubble}</strong></motion.div>}
          </AnimatePresence>
          <Ecg color={mood === 'worried' ? 'var(--warn)' : 'var(--accent2)'} />
        </div>

        <div className="card col" style={{ gap: 6 }}>
          <div className="row"><span className="small muted">{t('patient')}</span><span className="spacer" /><button type="button" className="btn sm ghost" onClick={() => setModal('patient')}>{patient ? t('edit') : t('add')} <span className="kbd">F4</span></button></div>
          {patient ? <><strong>{patient.name} {patient.phone && <span className="num muted small">{patient.phone}</span>}</strong>
            {patient.allergies && <span className="badge bad" style={{ alignSelf: 'flex-start' }}>Allergy: {patient.allergies}</span>}
            {patient.doctorName && <span className="small muted">Dr. {patient.doctorName}</span>}</> : <span className="small faint">Walk-in customer</span>}
        </div>

        <div className="card col" style={{ gap: 10 }}>
          <div className="total-line"><span className="muted">{t('subtotal')}</span><span className="num">{money(tot.gross, lang)}</span></div>
          {can(user, 'pos.discount') && (
            <div className="total-line"><label className="muted" htmlFor="disc">{t('discount')} %</label>
              <input id="disc" className="input num" style={{ width: 90, minHeight: 36 }} inputMode="decimal" value={discPct} onChange={e => setDiscPct(e.target.value.replace(/[^\d.]/g, ''))} /></div>
          )}
          <div className="total-line"><span className="muted">{t('gst')}{cart.inclusive ? ' (incl.)' : ''}</span><span className="num">{money(tot.tax, lang)}</span></div>
          <div style={{ height: 1, background: 'var(--line)' }} />
          <div className="total-line"><strong>{t('total')}</strong>
            <motion.strong key={tot.total} className="num big" initial={{ scale: 1.15, color: 'var(--accent)' }} animate={{ scale: 1, color: 'var(--text)' }}>
              {money(Math.round(tot.total * (1 - Number(discPct || 0) / 100)), lang)}</motion.strong></div>
          <div className="paygrid">
            {(['cash', 'card', 'credit'] as const).filter(m => m !== 'credit' || can(user, 'pos.credit_sale')).map(m => (
              <button type="button" key={m} className={`btn sm ${pay === m ? 'on' : ''}`} onClick={() => setPay(m)}>{t(m)}</button>
            ))}
          </div>
          {pay === 'cash' && <label className="field">{t('received')}<input className="input num" inputMode="decimal" value={received} onChange={e => setReceived(e.target.value.replace(/[^\d.]/g, ''))} placeholder={String(tot.total / 100)} /></label>}
          {pay === 'cash' && received && <div className="total-line"><span className="muted">{t('change')}</span><strong className="num" style={{ color: 'var(--ok)' }}>{money(Math.max(0, toPaisa(received) - Math.round(tot.total * (1 - Number(discPct || 0) / 100))), lang)}</strong></div>}
          <button type="button" className="btn primary" style={{ minHeight: 56, fontSize: 16 }} disabled={!cart.lines.length || busy} onClick={() => doCheckout()}>
            <Icon name="print" /> {t('checkout')} <span className="kbd" style={{ background: 'rgba(4,47,46,.15)' }}>F8</span>
          </button>
          <div className="row small faint hide-sm" style={{ gap: 6 }}><span>F2 {t('search')}</span>·<span>F4 {t('patient')}</span>·<span>F6 Rx (AI)</span>·<span>F9 {t('reprint')}</span></div>
          {lastInvoice && <button type="button" className="btn sm ghost" onClick={async () => { const d = await receiptData(ctx, lastInvoice, settings); if (d) downloadReceipt(d); }}><Icon name="download" size={16} /> Receipt PDF</button>}
        </div>
      </aside>

      <AnimatePresence>
        {modal === 'patient' && <PatientPicker patients={patients} onPick={id => { setCart(c => ({ ...c, patientId: id })); setModal(null); }} onClose={() => setModal(null)} />}
        {modal === 'rx' && <RxReader meds={meds} index={index} onAdd={async (m, n) => add(m, n)} onClose={() => setModal(null)} />}
        {modal === 'batch' && batchLine && <BatchPicker cart={cart} lineKey={batchLine} onDone={() => { refresh(); setModal(null); }} onNeedSup={(then) => setModal({ sup: 'pos.override_fefo', then })} onClose={() => setModal(null)} />}
        {modal && typeof modal === 'object' && <SupervisorPrompt perm={modal.sup} onApproved={id => { const f = modal.then; setModal(null); f(id); }} onClose={() => setModal(null)} />}
      </AnimatePresence>
    </div>
  );
}

/** Unit price on a bill line. Editable only for users allowed to change prices (pos.price). */
function PriceCell({ value, changed, editable, onChange }: { value: number; changed: boolean; editable: boolean; onChange: (paisa: number) => void }) {
  const { lang } = useStore();
  const [txt, setTxt] = useState((value / 100).toFixed(2));
  useEffect(() => { setTxt((value / 100).toFixed(2)); }, [value]);
  if (!editable) return <span className="num">{money(value, lang)}</span>;
  const commit = () => { const n = Number(txt.replace(/,/g, '')); if (Number.isFinite(n) && n >= 0) onChange(Math.round(n * 100)); else setTxt((value / 100).toFixed(2)); };
  return (
    <input className="input num price-in" inputMode="decimal" aria-label="Price" value={txt} title={changed ? 'Price changed' : undefined}
      style={{ width: 96, padding: '6px 8px', minHeight: 34, borderColor: changed ? 'var(--warn)' : undefined }}
      onChange={e => setTxt(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }} />
  );
}

function CameraScan({ onCode }: { onCode: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!open) return;
    let stop = () => {};
    (async () => {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const r = new BrowserMultiFormatReader();
      const c = await r.decodeFromVideoDevice(undefined, v.current!, res => { if (res) { onCode(res.getText()); setOpen(false); } });
      stop = () => c.stop();
    })().catch(() => setOpen(false));
    return () => stop();
  }, [open]); // eslint-disable-line
  return <>
    <button type="button" className="btn icon sm" aria-label="Scan with camera" onClick={() => setOpen(true)} style={{ background: 'var(--accentSoft)', color: 'var(--accent)', border: 0 }}><Icon name="scan" /></button>
    {open && <Modal title="Scan barcode" onClose={() => setOpen(false)}><video ref={v} muted playsInline style={{ width: '100%', borderRadius: 14, background: '#000' }} />
      <p className="small muted">No camera? Type the barcode in the search box — USB scanners also work.</p></Modal>}
  </>;
}

function PatientPicker({ patients, onPick, onClose }: { patients: Patient[]; onPick: (id: string | null) => void; onClose: () => void }) {
  const { t, ctx, user } = useStore();
  const [q, setQ] = useState(''), [name, setName] = useState(''), [phone, setPhone] = useState('');
  const list = patients.filter(p => !p.deleted && (`${p.name} ${p.phone}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 8);
  return (
    <Modal title={t('patient')} onClose={onClose}>
      <div className="col">
        <input className="input" autoFocus placeholder={`${t('name')} / ${t('phone')}`} value={q} onChange={e => setQ(e.target.value)} />
        {list.map(p => <button type="button" key={p.id} className="result" onClick={() => onPick(p.id)}><strong>{p.name}</strong><span className="num muted small">{p.phone}</span>{p.allergies && <span className="badge bad">{p.allergies}</span>}</button>)}
        <button type="button" className="btn ghost" onClick={() => onPick(null)}>Walk-in customer</button>
        <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input className="input" placeholder={t('name')} value={name} onChange={e => setName(e.target.value)} />
          <input className="input num" placeholder="03xx-xxxxxxx" value={phone} onChange={e => setPhone(e.target.value)} />
        </div>
        {!can(user, 'patients.create') ? <span className="small muted">You are not allowed to create customers.</span> :
        <button type="button" className="btn primary" disabled={!name} onClick={async () => {
          const { saveRecord } = await import('../../core/inventory.ts');
          const p = await saveRecord<Patient>(ctx, 'patients', { name, phone });
          onPick(p.id);
        }}>{t('add')}</button>}
      </div>
    </Modal>
  );
}

function BatchPicker({ cart, lineKey, onDone, onNeedSup, onClose }: { cart: Cart; lineKey: string; onDone: () => void; onNeedSup: (then: (id: string) => void) => void; onClose: () => void }) {
  const { ctx, t, toast } = useStore();
  const line = cart.lines.find(l => l.key === lineKey)!;
  const batches = useLive(() => batchesFor(ctx, line.medicine.id), [], []);
  const today = isoDate();
  const pick = async (id: string, sup?: User) => {
    try { await overrideBatch(ctx, cart, lineKey, id, sup); onDone(); }
    catch (e) {
      if ((e as { code?: string }).code === 'OVERRIDE_REQUIRED') onNeedSup(async supId => { const u = await ctx.db.users.get(supId); await pick(id, u); });
      else toast('bad', (e as Error).message);
    }
  };
  return (
    <Modal title={`${t('batch')} — ${line.medicine.name}`} onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>Nearest expiry is sold first (FEFO). Choosing a newer batch needs supervisor approval and is logged.</p>
      <div className="col" style={{ gap: 6 }}>
        {batches.filter(b => !b.pending).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)).map((b, i) => {
          const d = daysBetween(today, b.expiryDate);
          return <button type="button" key={b.id} className={`result ${b.id === line.batch.id ? 'sel' : ''}`} disabled={b.qty <= 0 || d <= 0} onClick={() => pick(b.id)}>
            <strong className="num">#{b.batchNo}</strong>{i === 0 && <span className="badge acc">FEFO</span>}
            <span className="spacer" /><span className={`badge ${d <= 0 ? 'bad' : d <= 30 ? 'warn' : ''}`}>{d <= 0 ? t('expired') : t('expiringIn', { n: d })}</span><span className="num">{b.qty}</span>
          </button>;
        })}
      </div>
    </Modal>
  );
}

function RxReader({ meds, index, onAdd, onClose }: { meds: Medicine[]; index: SearchIndex; onAdd: (m: Medicine, n: number) => Promise<void>; onClose: () => void }) {
  const { t, client, online, ctx, toast } = useStore();
  const [text, setText] = useState('');
  const [items, setItems] = useState<(RxItem & { match?: Medicine | null })[] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  void meds;
  const read = async (image?: { data: string; mime: string }) => {
    setBusy(true);
    let r: { items: RxItem[]; source: string; note?: string };
    try {
      if (!online || !ctx.sessionId) throw new Error('offline');
      r = await client.request('POST', '/api/ai/rx', image ? { imageBase64: image.data, mimeType: image.mime, text } : { text });
    } catch {
      r = { items: parsePrescriptionOffline(text), source: 'offline', note: image ? 'Photos need the server and AI — please type the prescription.' : 'Server not reachable — used the offline reader.' };
    }
    setNote(r.note || (r.source === 'ai' ? 'Read by AI — please check before adding.' : ''));
    setItems(r.items.map(i => ({ ...i, match: index.search(`${i.name} ${i.strength || ''}`.trim(), 1)[0] || index.search(i.name, 1)[0] || null })));
    setBusy(false);
  };
  const photo = (f: File) => {
    const fr = new FileReader();
    fr.onload = () => { const s = String(fr.result); void read({ data: s.split(',')[1], mime: f.type || 'image/jpeg' }); };
    fr.readAsDataURL(f);
  };
  return (
    <Modal title={t('readRx')} onClose={onClose} wide>
      <div className="col">
        <span className="small muted">{t('rxHelp')}</span>
        <textarea className="input" value={text} onChange={e => setText(e.target.value)} placeholder={'Tab. Augmentin 625mg 1+0+1 x 5 days\nCap Risek 20mg OD 14d'} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !text.trim()} onClick={() => read()}><Icon name="spark" /> {busy ? '…' : t('readRx')}</button>
          <label className="btn"><Icon name="camera" /> Photo<input type="file" accept="image/*" capture="environment" hidden onChange={e => e.target.files?.[0] && photo(e.target.files[0])} /></label>
          {busy && <div className="col" style={{ flex: 1, gap: 6 }}><div className="skel" style={{ height: 10 }} /><div className="skel" style={{ height: 10, width: '60%' }} /></div>}
        </div>
        {note && <span className="badge info" style={{ alignSelf: 'flex-start' }}>{note}</span>}
        {items && (items.length === 0 ? <Empty icon="rx" text="No medicines found" /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Prescription</th><th>Dose</th><th>{t('qty')}</th><th>Match in stock</th><th /></tr></thead><tbody>
            {items.map((it, i) => (
              <tr key={i}><td><strong>{it.name}</strong> <span className="muted">{it.strength}</span></td><td className="num">{it.dose}{it.days ? ` × ${it.days}d` : ''}</td>
                <td><input className="input num" style={{ width: 70, minHeight: 36 }} value={it.qty ?? 1} onChange={e => { const c = [...items]; c[i] = { ...it, qty: Number(e.target.value) || 1 }; setItems(c); }} /></td>
                <td>{it.match ? <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}><MedThumb med={it.match} size={32} /><MedName med={it.match} /></div> : <span className="badge warn">Not found</span>}</td>
                <td>{it.match && <button type="button" className="btn sm primary" onClick={async () => { await onAdd(it.match!, it.qty || 1); toast('ok', `${it.match!.name} ×${it.qty || 1}`); }}>{t('add')}</button>}</td></tr>
            ))}
          </tbody></table></div>
        ))}
      </div>
    </Modal>
  );
}
