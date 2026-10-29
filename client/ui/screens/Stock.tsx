// Inventory, purchases, suppliers, customers, bills and alerts — all linked:
// every item, purchase, supplier, customer and bill opens its related records,
// with one-tap actions (Sell, Order more, Receive, Pay, Refill) across modules.
import React, { useEffect, useMemo, useState } from 'react';
import { dateLocale } from '../phrases.ts';
import { AnimatePresence } from 'framer-motion';
import { useStore, useLive } from '../store.tsx';
import { Icon, Modal, Empty, Toggle, SupervisorPrompt, useAsync, PhotoPicker } from '../components.tsx';
import { money } from '../i18n.ts';
import { can } from '../../../shared/permissions.ts';
import { toPaisa, pctToBp } from '../../../shared/money.ts';
import { isoDate, daysBetween, addDays } from '../../../shared/util.ts';
import { SearchIndex } from '../../../shared/search.ts';
import {
  saveMedicine, deleteMedicine, saveRecord, addOpeningStock, adjustStock, stockMap, savePurchase, receivePurchase,
  cancelPurchase, recordPayment, partyBalance,
} from '../../core/inventory.ts';
import { voidInvoice } from '../../core/pos.ts';
import { MedThumb, MedName } from '../MedIcon.tsx';
import { receiptData, downloadReceipt } from '../../core/print.ts';
import { navigate, takeIntent } from '../nav.ts';
import type { Medicine, Batch, Supplier, Patient, Purchase, PurchaseItem, Invoice, InvoiceItem, Prescription } from '../../../shared/types.ts';

const rs = (v: string) => toPaisa(v || 0);
const fmtDate = (s: string) => new Date(s).toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short', year: 'numeric' });

/** Small clickable chip that jumps to a record in another module. */
function Link({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  return <button type="button" className="linkchip" title={title} onClick={e => { e.stopPropagation(); onClick(); }}>{children}</button>;
}

function Tabs({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) {
  return <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button type="button" key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}

/* ======================= INVENTORY ======================= */
export function Inventory() {
  const { ctx, t, lang, user, toast } = useStore();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<Medicine> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const meds = useLive(() => ctx.db.medicines.filter(m => !m.deleted).toArray(), [], [] as Medicine[]);
  const stock = useLive(() => stockMap(ctx), [], new Map<string, number>());
  const index = useMemo(() => new SearchIndex().build(meds), [meds]);
  const list = q ? index.search(q, 300) : [...meds].sort((a, b) => a.name.localeCompare(b.name));
  useEffect(() => {
    const i = takeIntent('inventory');
    if (i && 'open' in i && i.open === 'medicine') setOpenId(i.id);
    if (i && 'newMedicine' in i && can(user, 'inventory.create')) setEdit({ name: i.newMedicine.name || '', generic: '', salePrice: 0, reorderLevel: 10 });
  }, []); // eslint-disable-line
  const open = meds.find(m => m.id === openId) || null;
  return (
    <>
      <div className="row"><h1>{t('inventory')}</h1><span className="badge num">{meds.length} items</span><span className="spacer" />
        <input className="input" style={{ maxWidth: 320 }} placeholder={t('search')} value={q} onChange={e => setQ(e.target.value)} />
        {can(user, 'inventory.create') && <button type="button" className="btn primary" onClick={() => setEdit({ name: q, generic: '', salePrice: 0, reorderLevel: 10 })}><Icon name="plus" /> {t('newMedicine')}</button>}
      </div>
      <div className="table-wrap">
        {list.length === 0 ? <Empty text={q ? `"${q}" is not in inventory${can(user, 'inventory.create') ? ' — use "New medicine" to create it' : ''}` : 'No medicines yet'} /> :
          <table className="t"><thead><tr><th>{t('name')} · Formula</th><th>Category</th><th>{t('company')}</th><th>{t('salePrice')}</th><th>{t('stock')}</th><th /></tr></thead><tbody>
            {list.map(m => { const s = stock.get(m.id) || 0; return (
              <tr key={m.id} className="click" onClick={() => setOpenId(m.id)}>
                <td><div className="row" style={{ flexWrap: 'nowrap', gap: 12 }}><MedThumb med={m} animate />
                  <MedName med={m} sub={m.description ? <span className="small faint" style={{ maxWidth: 380, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.description}</span> : null} />
                  {m.rxRequired && <span className="badge info">Rx</span>}</div></td>
                <td className="muted small">{m.category}</td><td className="muted">{m.manufacturer}</td><td className="num">{money(m.salePrice, lang)}</td>
                <td><span className={`badge ${s <= 0 ? 'bad' : s <= (m.reorderLevel ?? 10) ? 'warn' : 'ok'} num`}>{s}</span></td>
                <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  {can(user, 'pos') && s > 0 && <Link onClick={() => navigate('pos', { sell: { medicineId: m.id } })} title="Sell"><Icon name="cart" size={14} /> Sell</Link>}
                  {can(user, 'purchases.create') && <Link onClick={() => navigate('purchases', { newPurchase: { medicineId: m.id } })} title="Order more"><Icon name="truck" size={14} /> Order</Link>}
                </td>
              </tr>); })}
          </tbody></table>}
      </div>
      <AnimatePresence>
        {edit && <MedicineForm med={edit} onClose={() => setEdit(null)} onSaved={m => { setEdit(null); toast('ok', `${m.name} saved`); setOpenId(m.id); }} />}
        {open && <MedicineDetail med={open} onEdit={() => { setEdit(open); setOpenId(null); }} onClose={() => setOpenId(null)} />}
      </AnimatePresence>
    </>
  );
}

export function MedicineForm({ med, onClose, onSaved }: { med: Partial<Medicine>; onClose: () => void; onSaved: (m: Medicine) => void }) {
  const { ctx, t } = useStore();
  const [f, setF] = useState({ ...med, price: med.salePrice ? String(med.salePrice / 100) : '', gst: med.gstBp ? String(med.gstBp / 100) : '0' });
  const a = useAsync(async () => {
    const name = String(f.name || '').trim();
    if (!name) throw new Error('Name is required');
    if (!String(f.generic || '').trim()) throw new Error('Formula (generic name) is required');
    const price = Number(f.price);
    if (!(price >= 0) || price > 10_000_000) throw new Error('Enter a valid sale price');
    const dup = (await ctx.db.medicines.toArray()).find(m => !m.deleted && m.id !== med.id && m.name.trim().toLowerCase() === name.toLowerCase() && (m.strength || '') === (f.strength || ''));
    if (dup) throw new Error(`${dup.name} ${dup.strength || ''} already exists in inventory`);
    const { price: _p, gst: _g, ...rest } = f; void _p; void _g;
    const saved = await saveMedicine(ctx, { ...rest, name, generic: String(f.generic).trim(), salePrice: rs(f.price), gstBp: pctToBp(f.gst), reorderLevel: Math.max(0, Number(f.reorderLevel) || 0), reorderQty: Math.max(0, Number(f.reorderQty) || 0) });
    onSaved(saved);
  });
  const fld = (k: keyof Medicine, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) =>
    <label className="field">{label}<input className="input" value={String(f[k] ?? '')} onChange={e => setF({ ...f, [k]: e.target.value })} {...props} /></label>;
  return (
    <Modal title={med.id ? t('edit') : t('newMedicine')} onClose={onClose} wide>
      <form className="col" onSubmit={e => { e.preventDefault(); void a.run(); }}>
        <div className="grid g-2" style={{ gap: 10 }}>
          {fld('name', t('name'), { required: true, autoFocus: true, maxLength: 80 })}{fld('generic', 'Formula (generic)', { required: true, maxLength: 120 })}
          {fld('strength', t('strength'), { placeholder: '500mg', maxLength: 30 })}{fld('form', 'Form', { placeholder: 'Tablet / Syrup', maxLength: 30 })}
          {fld('manufacturer', t('company'), { maxLength: 60 })}{fld('barcode', t('barcode'), { inputMode: 'numeric', maxLength: 40 })}
          <label className="field">{t('salePrice')} (Rs)<input className="input num" inputMode="decimal" required value={f.price} onChange={e => setF({ ...f, price: e.target.value.replace(/[^\d.]/g, '') })} /></label>
          <label className="field">{t('gst')} %<input className="input num" inputMode="decimal" value={f.gst} onChange={e => setF({ ...f, gst: e.target.value.replace(/[^\d.]/g, '') })} /></label>
          {fld('reorderLevel', t('reorderLevel'), { inputMode: 'numeric' })}{fld('rackNo', 'Rack / shelf', { maxLength: 20 })}
          {fld('category', 'Category', { placeholder: 'Antibiotic, Pain & fever…', maxLength: 40 })}
        </div>
        <PhotoPicker label="Photo of the pack (optional — take it with the phone camera)" shape="square" max={320} value={(f as { photo?: string | null }).photo} onChange={v => setF({ ...f, photo: v })} />
        <label className="field">Description — what it is used for<textarea className="input" style={{ minHeight: 80 }} maxLength={400} value={String(f.description ?? '')} onChange={e => setF({ ...f, description: e.target.value })} placeholder="e.g. Fever and mild pain" /></label>
        <label className="row"><Toggle on={!!f.rxRequired} onChange={v => setF({ ...f, rxRequired: v })} label="Prescription required" /> Prescription required</label>
        {a.err && <span className="err" role="alert">{a.err}</span>}
        <div className="row"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>{t('cancel')}</button><button className="btn primary" disabled={a.busy}>{t('save')}</button></div>
      </form>
    </Modal>
  );
}

interface ItemHistory { purchases: (PurchaseItem & { po?: Purchase; supplier?: Supplier })[]; sales: (InvoiceItem & { inv?: Invoice; patient?: Patient })[] }

function MedicineDetail({ med, onEdit, onClose }: { med: Medicine; onEdit: () => void; onClose: () => void }) {
  const { ctx, t, user, toast, lang } = useStore();
  const [tab, setTab] = useState('stock');
  const batches = useLive(() => ctx.db.batches.where('medicineId').equals(med.id).toArray(), [], [] as Batch[]);
  const hist = useLive<ItemHistory>(async () => {
    const pis = (await ctx.db.purchaseItems.where('medicineId').equals(med.id).toArray()).filter(i => !i.deleted);
    const pos = new Map((await ctx.db.purchases.bulkGet([...new Set(pis.map(i => i.purchaseId))])).filter(Boolean).map(p => [p!.id, p!]));
    const sups = new Map((await ctx.db.suppliers.toArray()).map(s => [s.id, s]));
    const iis = await ctx.db.invoiceItems.where('medicineId').equals(med.id).toArray();
    const invs = new Map((await ctx.db.invoices.bulkGet([...new Set(iis.map(i => i.invoiceId))])).filter(Boolean).map(v => [v!.id, v!]));
    const pts = new Map((await ctx.db.patients.toArray()).map(p => [p.id, p]));
    return {
      purchases: pis.map(i => ({ ...i, po: pos.get(i.purchaseId), supplier: sups.get(pos.get(i.purchaseId)?.supplierId || '') })).filter(i => i.po && !i.po.deleted).sort((a, b) => b.po!.date.localeCompare(a.po!.date)),
      sales: iis.map(i => ({ ...i, inv: invs.get(i.invoiceId), patient: pts.get(invs.get(i.invoiceId)?.patientId || '') })).filter(i => i.inv).sort((a, b) => b.inv!.createdAt.localeCompare(a.inv!.createdAt)),
    };
  }, [med.id], { purchases: [], sales: [] });
  const [add, setAdd] = useState(false);
  const [b, setB] = useState({ batchNo: '', expiryDate: addDays(isoDate(), 365), qty: '', cost: '' });
  const [adj, setAdj] = useState<{ id: string; delta: string; reason: string } | null>(null);
  const today = isoDate();
  const inStock = batches.reduce((s, x) => s + x.qty, 0);
  const sold30 = hist.sales.filter(s => s.inv!.status !== 'void' && s.inv!.createdAt >= addDays(today, -30)).reduce((s, x) => s + x.qty, 0);
  const lastBuy = hist.purchases[0];
  const doAdd = useAsync(async () => {
    const qty = Number(b.qty);
    if (!b.batchNo.trim()) throw new Error('Batch number is required');
    if (!Number.isInteger(qty) || qty <= 0) throw new Error('Quantity must be a whole number above 0');
    if (b.expiryDate <= today) throw new Error('This batch is already expired');
    await addOpeningStock(ctx, med.id, { batchNo: b.batchNo.trim(), expiryDate: b.expiryDate, qty, costPrice: rs(b.cost) });
    toast('ok', t('stockAdded')); setAdd(false); setB({ ...b, batchNo: '', qty: '' });
  });
  const doAdj = useAsync(async () => {
    const d = Number(adj!.delta);
    if (!Number.isInteger(d) || d === 0) throw new Error('Enter a whole number like -5 or 5');
    await adjustStock(ctx, adj!.id, d, adj!.reason); setAdj(null); toast('ok', t('save'));
  });
  return (
    <Modal title={`${med.name} ${med.strength || ''}`} onClose={onClose} wide>
      <div className="col">
        <div className="row" style={{ flexWrap: 'nowrap', gap: 16, alignItems: 'flex-start' }}><MedThumb med={med} size={88} animate />
          <div className="col" style={{ gap: 2, flex: 1 }}><span className="small muted">Formula</span><strong style={{ fontSize: 18, color: 'var(--accent)' }}>{med.generic}</strong>
            <span className="small muted">{[med.strength, med.form, med.manufacturer].filter(Boolean).map((x, i) => <React.Fragment key={i}>{i > 0 && ' · '}{x}</React.Fragment>)}</span>
            <span><span className={`badge ${med.source === 'catalog' ? 'acc' : ''}`}>{med.source === 'catalog' ? 'Built-in list' : 'Added by shop'}</span> {med.rxRequired && <span className="badge info">Prescription</span>}</span></div>
          <div className="col" style={{ gap: 6, alignItems: 'flex-end' }}>
            {can(user, 'pos') && inStock > 0 && <button type="button" className="btn sm primary" onClick={() => { onClose(); navigate('pos', { sell: { medicineId: med.id } }); }}><Icon name="cart" size={16} /> Sell</button>}
            {can(user, 'purchases.create') && <button type="button" className="btn sm" onClick={() => { onClose(); navigate('purchases', { newPurchase: { medicineId: med.id, supplierId: lastBuy?.po?.supplierId } }); }}><Icon name="truck" size={16} /> Order more</button>}
          </div>
        </div>
        <div className="grid g-auto" style={{ gap: 10 }}>
          <div className="card kpi" style={{ padding: 12 }}><span className="small muted">In stock</span><span className="v num" style={{ fontSize: 22 }}>{inStock}</span></div>
          <div className="card kpi" style={{ padding: 12 }}><span className="small muted">Sold (30 days)</span><span className="v num" style={{ fontSize: 22 }}>{sold30}</span></div>
          <div className="card kpi" style={{ padding: 12 }}><span className="small muted">{t('salePrice')}</span><span className="v num" style={{ fontSize: 22 }}>{money(med.salePrice, lang)}</span></div>
          <div className="card kpi" style={{ padding: 12 }}><span className="small muted">Last supplier</span><span className="v" style={{ fontSize: 15 }}>{lastBuy?.supplier ? <Link onClick={() => { onClose(); navigate('suppliers', { open: 'supplier', id: lastBuy.supplier!.id }); }}>{lastBuy.supplier.name}</Link> : '—'}</span></div>
        </div>
        {med.description && <div className="card" style={{ padding: 12, background: 'var(--accentSoft)', border: 0 }}><span className="small muted">{med.category}</span><div>{med.description}</div></div>}
        <div className="row" style={{ gap: 6 }}>
          <Tabs value={tab} onChange={setTab} tabs={[['stock', `Stock (${batches.filter(x => x.qty !== 0).length})`], ['purchases', `Purchases (${hist.purchases.length})`], ['sales', `Sales (${hist.sales.length})`]]} />
          <span className="spacer" />
          {can(user, 'inventory.edit') && <button type="button" className="btn sm" onClick={onEdit}>{t('edit')}</button>}
          {can(user, 'inventory.delete') && <button type="button" className="btn sm danger" onClick={async () => { if (confirm(`Delete ${med.name}? Its past sales and purchases stay in history.${med.source === 'catalog' ? ' Built-in medicines cannot be re-imported later.' : ''}`)) { try { await deleteMedicine(ctx, med); toast('ok', `${med.name} deleted`); onClose(); } catch (e) { toast('bad', (e as Error).message); } } }}><Icon name="trash" size={14} /> {t('delete')}</button>}
        </div>
        {tab === 'stock' && <>
          <div className="row"><span className="spacer" />{can(user, 'inventory.add_stock') && <button type="button" className="btn sm" onClick={() => setAdd(v => !v)}><Icon name="plus" size={16} /> Opening stock</button>}</div>
          {add && <form className="card grid g-auto" style={{ gap: 10 }} onSubmit={e => { e.preventDefault(); void doAdd.run(); }}>
            <label className="field">{t('batch')}<input className="input" required maxLength={30} value={b.batchNo} onChange={e => setB({ ...b, batchNo: e.target.value })} /></label>
            <label className="field">{t('expiry')}<input className="input" type="date" required min={addDays(today, 1)} value={b.expiryDate} onChange={e => setB({ ...b, expiryDate: e.target.value })} /></label>
            <label className="field">{t('qty')}<input className="input num" inputMode="numeric" required value={b.qty} onChange={e => setB({ ...b, qty: e.target.value.replace(/\D/g, '') })} /></label>
            <label className="field">{t('costPrice')} (Rs)<input className="input num" inputMode="decimal" value={b.cost} onChange={e => setB({ ...b, cost: e.target.value.replace(/[^\d.]/g, '') })} /></label>
            {doAdd.err && <span className="err">{doAdd.err}</span>}<button className="btn primary" disabled={doAdd.busy}>{t('save')}</button>
          </form>}
          <div className="table-wrap"><table className="t"><thead><tr><th>{t('batch')}</th><th>{t('expiry')}</th><th>{t('qty')}</th>{can(user, 'reports.profit') && <th>{t('costPrice')}</th>}<th>From</th><th /></tr></thead><tbody>
            {[...batches].sort((x, y) => x.expiryDate.localeCompare(y.expiryDate)).map((x, i) => { const d = x.pending ? null : daysBetween(today, x.expiryDate); const po = hist.purchases.find(p => p.purchaseId === x.purchaseId)?.po; return (
              <tr key={x.id}><td className="num"><strong>#{x.batchNo}</strong> {i === 0 && !x.pending && <span className="badge acc">FEFO</span>}</td>
                <td>{d === null ? '—' : <span className={`badge ${d <= 0 ? 'bad' : d <= 90 ? 'warn' : ''} num`}>{x.expiryDate}</span>}</td>
                <td className="num">{x.qty}</td>{can(user, 'reports.profit') && <td className="num">{money(x.costPrice, lang)}</td>}
                <td>{po ? <Link onClick={() => { onClose(); navigate('purchases', { open: 'purchase', id: po.id }); }}>{po.number}</Link> : <span className="small faint">{x.pending ? 'sold before stock entry' : 'opening stock'}</span>}</td>
                <td>{can(user, 'inventory.adjust') && <button type="button" className="btn sm ghost" onClick={() => setAdj({ id: x.id, delta: '', reason: '' })}>Adjust</button>}</td></tr>); })}
          </tbody></table></div>
          {adj && <form className="card row" onSubmit={e => { e.preventDefault(); void doAdj.run(); }}>
            <input className="input num" style={{ width: 120 }} placeholder="-5 or 5" value={adj.delta} onChange={e => setAdj({ ...adj, delta: e.target.value.replace(/[^\d-]/g, '') })} />
            <input className="input" style={{ flex: 1 }} maxLength={120} placeholder="Reason (damaged, count fix…)" value={adj.reason} onChange={e => setAdj({ ...adj, reason: e.target.value })} />
            <button className="btn primary" disabled={doAdj.busy}>{t('save')}</button>{doAdj.err && <span className="err">{doAdj.err}</span>}
          </form>}
        </>}
        {tab === 'purchases' && (hist.purchases.length === 0 ? <Empty icon="truck" text="Never purchased yet" /> :
          <div className="table-wrap"><table className="t"><thead><tr><th>Purchase</th><th>Date</th><th>{t('suppliers')}</th><th>{t('qty')}</th>{can(user, 'reports.profit') && <th>{t('costPrice')}</th>}<th>Status</th></tr></thead><tbody>
            {hist.purchases.map(p => <tr key={p.id}><td><Link onClick={() => { onClose(); navigate('purchases', { open: 'purchase', id: p.purchaseId }); }}>{p.po!.number}</Link></td><td className="num">{p.po!.date}</td>
              <td>{p.supplier ? <Link onClick={() => { onClose(); navigate('suppliers', { open: 'supplier', id: p.supplier!.id }); }}>{p.supplier.name}</Link> : '—'}</td>
              <td className="num">{p.qty}{p.freeQty ? ` + ${p.freeQty} free` : ''}</td>{can(user, 'reports.profit') && <td className="num">{money(p.costPrice, lang)}</td>}
              <td><span className={`badge ${p.po!.status === 'received' ? 'ok' : 'warn'}`}>{p.po!.status}</span></td></tr>)}
          </tbody></table></div>)}
        {tab === 'sales' && (hist.sales.length === 0 ? <Empty icon="cart" text="Not sold yet" /> :
          <div className="table-wrap"><table className="t"><thead><tr><th>Bill</th><th>Date</th><th>{t('patient')}</th><th>{t('qty')}</th><th>{t('amount')}</th></tr></thead><tbody>
            {hist.sales.slice(0, 200).map(s => <tr key={s.id}><td>{can(user, 'invoices') ? <Link onClick={() => { onClose(); navigate('invoices', { open: 'invoice', id: s.invoiceId }); }}>{s.inv!.number}</Link> : s.inv!.number}{s.inv!.status === 'void' && <span className="badge bad"> void</span>}</td>
              <td className="num">{fmtDate(s.inv!.createdAt)}</td><td>{s.patient ? (can(user, 'patients') ? <Link onClick={() => { onClose(); navigate('patients', { open: 'patient', id: s.patient!.id }); }}>{s.patient.name}</Link> : s.patient.name) : <span className="faint small">Walk-in</span>}</td>
              <td className="num">{s.qty}</td><td className="num">{money(s.total, lang)}</td></tr>)}
          </tbody></table></div>)}
      </div>
    </Modal>
  );
}

/* ======================= PURCHASES ======================= */
interface Line { medicineId: string; qty: string; free: string; cost: string; sale: string; batchNo: string; expiryDate: string }

/** Search box that only offers items that already exist in Inventory. */
function ItemPicker({ meds, value, onPick, onCreate }: { meds: Medicine[]; value: string; onPick: (id: string) => void; onCreate: (name: string) => void }) {
  const { user } = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const index = useMemo(() => new SearchIndex().build(meds), [meds]);
  const cur = meds.find(m => m.id === value);
  const res = q ? index.search(q, 8) : [];
  if (cur && !open) return <button type="button" className="row picked" onClick={() => { setOpen(true); setQ(''); }} style={{ flexWrap: 'nowrap', gap: 8 }}><MedThumb med={cur} size={30} /><MedName med={cur} /></button>;
  return (
    <div style={{ position: 'relative', minWidth: 220 }}>
      <input className="input" autoFocus={open} placeholder="Type item name…" value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onBlur={() => setTimeout(() => setOpen(false), 200)} />
      {open && q && <div className="results" style={{ position: 'absolute', zIndex: 5, insetInline: 0, top: '100%', marginTop: 4, boxShadow: 'var(--shadow)' }}>
        {res.map(m => <button type="button" key={m.id} className="result" onMouseDown={() => { onPick(m.id); setOpen(false); setQ(''); }}><MedThumb med={m} size={30} /><MedName med={m} /></button>)}
        <div className="result" style={{ cursor: 'default', background: 'var(--panel2)', flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <span className="small muted">{res.length ? 'Not the right one?' : `"${q}" is not in Inventory.`} Items must be created in Inventory before they can be purchased.</span>
          {can(user, 'inventory.create') ? <button type="button" className="btn sm" onMouseDown={() => onCreate(q)}><Icon name="plus" size={14} /> {`Create "${q}" in Inventory`}</button> : <span className="small err">Ask someone who is allowed to create items.</span>}
        </div>
      </div>}
    </div>
  );
}

export function Purchases() {
  const { ctx, t, lang, user, toast } = useStore();
  const pos = useLive(() => ctx.db.purchases.filter(p => !p.deleted).toArray(), [], [] as Purchase[]);
  const sups = useLive(() => ctx.db.suppliers.filter(s => !s.deleted).toArray(), [], [] as Supplier[]);
  const meds = useLive(() => ctx.db.medicines.filter(m => !m.deleted).toArray(), [], [] as Medicine[]);
  const [form, setForm] = useState<{ id?: string; supplierId: string; lines: Line[] } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newMed, setNewMed] = useState<{ name: string; line: number } | null>(null);
  const [newSup, setNewSup] = useState(false);
  const [filter, setFilter] = useState<'all' | 'ordered' | 'received'>('all');
  const blank = (p: Partial<Line> = {}): Line => ({ medicineId: '', qty: '', free: '0', cost: '', sale: '', batchNo: '', expiryDate: addDays(isoDate(), 540), ...p });
  useEffect(() => {
    const i = takeIntent('purchases');
    if (!i) return;
    if ('open' in i && i.open === 'purchase') setOpenId(i.id);
    if ('newPurchase' in i && can(user, 'purchases.create')) {
      const m = i.newPurchase.medicineId ? meds.find(x => x.id === i.newPurchase.medicineId) : undefined;
      setForm({ supplierId: i.newPurchase.supplierId || '', lines: [blank({ medicineId: i.newPurchase.medicineId || '', qty: i.newPurchase.qty ? String(i.newPurchase.qty) : '', sale: m?.salePrice ? String(m.salePrice / 100) : '' }), blank()] });
    }
  }, [meds.length > 0]); // eslint-disable-line
  const save = useAsync(async () => {
    if (!form!.supplierId) throw new Error('Choose the supplier');
    const today = isoDate();
    const used = form!.lines.filter(l => l.medicineId || l.qty);
    if (!used.length) throw new Error('Add at least one item');
    const items = used.map((l, n) => {
      const m = meds.find(x => x.id === l.medicineId);
      if (!m) throw new Error(`Line ${n + 1}: choose an item from Inventory`);
      const qty = Number(l.qty), free = Number(l.free || 0);
      if (!Number.isInteger(qty) || qty <= 0) throw new Error(`${m.name}: quantity must be a whole number above 0`);
      if (!Number.isInteger(free) || free < 0) throw new Error(`${m.name}: free units must be 0 or more`);
      if (!l.batchNo.trim()) throw new Error(`${m.name}: batch number is required`);
      if (!l.expiryDate || l.expiryDate <= today) throw new Error(`${m.name}: expiry date must be in the future`);
      if (!(Number(l.cost) >= 0)) throw new Error(`${m.name}: enter a valid cost price`);
      return { medicineId: m.id, qty, freeQty: free, costPrice: rs(l.cost), salePrice: l.sale ? rs(l.sale) : null, batchNo: l.batchNo.trim(), mfgDate: null, expiryDate: l.expiryDate };
    });
    const p = await savePurchase(ctx, { ...(form!.id ? { id: form!.id } : {}), supplierId: form!.supplierId, date: today, status: 'ordered' }, items);
    setForm(null); setOpenId(p.id);
    toast('ok', `${p.number} saved`, can(user, 'purchases.receive') ? 'Press "Receive" when the stock arrives — it then goes into Inventory and can be sold.' : undefined);
  });
  const open = pos.find(p => p.id === openId) || null;
  const list = [...pos].filter(p => filter === 'all' || (filter === 'received' ? p.status === 'received' : p.status !== 'received')).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  return (
    <>
      <div className="row"><h1>{t('purchases')}</h1><span className="spacer" />
        <Tabs value={filter} onChange={v => setFilter(v as never)} tabs={[['all', 'All'], ['ordered', 'Waiting'], ['received', 'Received']]} />
        {can(user, 'purchases.create') && <button type="button" className="btn primary" onClick={() => setForm({ supplierId: '', lines: [blank()] })}><Icon name="plus" /> New purchase</button>}</div>
      <div className="table-wrap">{list.length === 0 ? <Empty icon="truck" text="No purchases yet" /> :
        <table className="t"><thead><tr><th>#</th><th>{t('suppliers')}</th><th>Date</th><th>{t('total')}</th><th>Status</th><th /></tr></thead><tbody>
          {list.map(p => { const s = sups.find(x => x.id === p.supplierId); return (
            <tr key={p.id} className="click" onClick={() => setOpenId(p.id)}><td className="num"><strong>{p.number}</strong></td>
              <td>{s ? <Link onClick={() => navigate('suppliers', { open: 'supplier', id: s.id })}>{s.name}</Link> : '—'}</td><td className="num">{p.date}</td><td className="num">{money(p.total, lang)}</td>
              <td><span className={`badge ${p.status === 'received' ? 'ok' : 'warn'}`}>{p.status === 'received' ? 'in stock' : 'waiting'}</span></td>
              <td>{p.status !== 'received' && can(user, 'purchases.receive') && <button type="button" className="btn sm primary" onClick={async e => { e.stopPropagation(); try { await receivePurchase(ctx, p.id); toast('ok', t('stockAdded'), 'Now in Inventory and ready to sell in Point of Sale.'); } catch (x) { toast('bad', (x as Error).message); } }}>{t('receive')}</button>}</td></tr>); })}
        </tbody></table>}</div>

      {form && <Modal title={form.id ? 'Modify purchase' : 'New purchase'} onClose={() => setForm(null)} wide>
        <form className="col" onSubmit={e => { e.preventDefault(); void save.run(); }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: 1 }}>{t('suppliers')}<select className="input" value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })}><option value="">Choose supplier…</option>{sups.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            {can(user, 'suppliers.create') && <button type="button" className="btn" onClick={() => setNewSup(true)}><Icon name="plus" size={16} /> New supplier</button>}
          </div>
          <span className="small muted">Only items that exist in Inventory can be purchased. Received stock goes straight into Inventory and is sold first-expiry-first in Point of Sale.</span>
          <div className="table-wrap" style={{ overflow: 'visible' }}><table className="t"><thead><tr><th>Item</th><th>{t('qty')}</th><th>Free</th><th>{t('costPrice')}</th><th>{t('salePrice')}</th><th>{t('batch')}</th><th>{t('expiry')}</th><th /></tr></thead><tbody>
            {form.lines.map((l, i) => { const up = (p: Partial<Line>) => { const c = [...form.lines]; c[i] = { ...l, ...p }; if (i === c.length - 1 && p.medicineId) c.push(blank()); setForm({ ...form, lines: c }); }; return (
              <tr key={i}><td><ItemPicker meds={meds} value={l.medicineId} onPick={id => { const m = meds.find(x => x.id === id); up({ medicineId: id, sale: l.sale || (m?.salePrice ? String(m.salePrice / 100) : '') }); }} onCreate={name => setNewMed({ name, line: i })} /></td>
                <td><input className="input num" style={{ width: 70 }} inputMode="numeric" value={l.qty} onChange={e => up({ qty: e.target.value.replace(/\D/g, '') })} /></td>
                <td><input className="input num" style={{ width: 60 }} inputMode="numeric" value={l.free} onChange={e => up({ free: e.target.value.replace(/\D/g, '') })} /></td>
                <td><input className="input num" style={{ width: 90 }} inputMode="decimal" value={l.cost} onChange={e => up({ cost: e.target.value.replace(/[^\d.]/g, '') })} /></td>
                <td><input className="input num" style={{ width: 90 }} inputMode="decimal" value={l.sale} onChange={e => up({ sale: e.target.value.replace(/[^\d.]/g, '') })} /></td>
                <td><input className="input" style={{ width: 100 }} maxLength={30} value={l.batchNo} onChange={e => up({ batchNo: e.target.value })} /></td>
                <td><input className="input" type="date" min={addDays(isoDate(), 1)} value={l.expiryDate} onChange={e => up({ expiryDate: e.target.value })} /></td>
                <td>{form.lines.length > 1 && <button type="button" className="btn icon ghost sm" aria-label="Remove line" onClick={() => setForm({ ...form, lines: form.lines.filter((_, k) => k !== i) })}><Icon name="x" size={14} /></button>}</td></tr>); })}
          </tbody></table></div>
          <div className="row"><strong>Total: <span className="num">{money(form.lines.reduce((s, l) => s + rs(l.cost) * (Number(l.qty) || 0), 0), lang)}</span></strong></div>
          {save.err && <span className="err" role="alert">{save.err}</span>}
          <div className="row"><span className="spacer" /><button type="button" className="btn" onClick={() => setForm(null)}>{t('cancel')}</button><button className="btn primary" disabled={save.busy}>{t('save')}</button></div>
        </form></Modal>}

      {newMed && <MedicineForm med={{ name: newMed.name, generic: '', salePrice: 0, reorderLevel: 10 }} onClose={() => setNewMed(null)} onSaved={m => {
        if (form) { const c = [...form.lines]; c[newMed.line] = { ...c[newMed.line], medicineId: m.id, sale: m.salePrice ? String(m.salePrice / 100) : '' }; if (newMed.line === c.length - 1) c.push(blank()); setForm({ ...form, lines: c }); }
        setNewMed(null); toast('ok', `${m.name} created in Inventory`);
      }} />}
      {newSup && <PartyForm kind="suppliers" initial={{ name: '' }} onClose={() => setNewSup(false)} onSaved={s => { setNewSup(false); if (form) setForm({ ...form, supplierId: s.id }); }} />}
      {open && <PurchaseDetail p={open} sups={sups} meds={meds} onEdit={async () => {
        const items = (await ctx.db.purchaseItems.where('purchaseId').equals(open.id).toArray()).filter(x => !x.deleted);
        setForm({ id: open.id, supplierId: open.supplierId, lines: [...items.map(x => blank({ medicineId: x.medicineId, qty: String(x.qty), free: String(x.freeQty || 0), cost: String(x.costPrice / 100), sale: x.salePrice ? String(x.salePrice / 100) : '', batchNo: x.batchNo, expiryDate: x.expiryDate })), blank()] });
        setOpenId(null);
      }} onClose={() => setOpenId(null)} />}
    </>
  );
}

function PurchaseDetail({ p, sups, meds, onEdit, onClose }: { p: Purchase; sups: Supplier[]; meds: Medicine[]; onEdit: () => void; onClose: () => void }) {
  const { ctx, t, lang, user, toast } = useStore();
  const items = useLive(() => ctx.db.purchaseItems.where('purchaseId').equals(p.id).toArray().then(x => x.filter(i => !i.deleted)), [p.id], [] as PurchaseItem[]);
  const s = sups.find(x => x.id === p.supplierId);
  const received = p.status === 'received';
  return (
    <Modal title={`Purchase ${p.number}`} onClose={onClose} wide>
      <div className="col">
        <div className="row"><span className={`badge ${received ? 'ok' : 'warn'}`}>{received ? 'Received — in stock' : 'Waiting for stock'}</span>
          <span className="muted">{p.date}</span>{s && <Link onClick={() => { onClose(); navigate('suppliers', { open: 'supplier', id: s.id }); }}><Icon name="factory" size={14} /> {s.name}</Link>}<span className="spacer" />
          {!received && can(user, 'purchases.edit') && <button type="button" className="btn sm" onClick={onEdit}>{t('edit')}</button>}
          {!received && can(user, 'purchases.delete') && <button type="button" className="btn sm danger" onClick={async () => { if (confirm(`Cancel purchase ${p.number}?`)) { try { await cancelPurchase(ctx, p.id); toast('ok', `${p.number} cancelled`); onClose(); } catch (e) { toast('bad', (e as Error).message); } } }}>Cancel purchase</button>}
          {!received && can(user, 'purchases.receive') && <button type="button" className="btn sm primary" onClick={async () => { try { await receivePurchase(ctx, p.id); toast('ok', t('stockAdded'), 'Now in Inventory and ready to sell in Point of Sale.'); } catch (e) { toast('bad', (e as Error).message); } }}>{t('receive')}</button>}
        </div>
        <div className="table-wrap"><table className="t"><thead><tr><th>Item</th><th>{t('batch')}</th><th>{t('expiry')}</th><th>{t('qty')}</th><th>{t('costPrice')}</th><th>{t('amount')}</th></tr></thead><tbody>
          {items.map(i => { const m = meds.find(x => x.id === i.medicineId); return (
            <tr key={i.id}><td>{m ? <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}><MedThumb med={m} size={30} /><Link onClick={() => { onClose(); navigate('inventory', { open: 'medicine', id: m.id }); }}>{m.name} {m.strength}</Link></div> : 'Deleted item'}</td>
              <td className="num">{i.batchNo}</td><td className="num">{i.expiryDate}</td><td className="num">{i.qty}{i.freeQty ? ` + ${i.freeQty}` : ''}</td><td className="num">{money(i.costPrice, lang)}</td><td className="num">{money(i.costPrice * i.qty, lang)}</td></tr>); })}
        </tbody></table></div>
        <div className="row"><span className="spacer" /><strong>{t('total')}: <span className="num">{money(p.total, lang)}</span></strong></div>
      </div>
    </Modal>
  );
}

/* ======================= SUPPLIERS & CUSTOMERS ======================= */
const FIELDS = { suppliers: ['name', 'phone', 'email', 'address', 'ntn'], patients: ['name', 'phone', 'cnic', 'age', 'doctorName', 'allergies', 'history'] };
const LABEL: Record<string, string> = { doctorName: 'Doctor', cnic: 'CNIC', ntn: 'NTN', email: 'Email', address: 'Address', age: 'Age', allergies: 'Allergies', history: 'Medical history' };

function PartyForm({ kind, initial, onClose, onSaved }: { kind: 'suppliers' | 'patients'; initial: Record<string, unknown>; onClose: () => void; onSaved: (r: Supplier | Patient) => void }) {
  const { ctx, t } = useStore();
  const [f, setF] = useState<Record<string, unknown>>(initial);
  const a = useAsync(async () => {
    const name = String(f.name || '').trim();
    if (!name) throw new Error('Name is required');
    const phone = String(f.phone || '').trim();
    if (phone && !/^[+\d][\d\s-]{6,16}$/.test(phone)) throw new Error('Phone number looks wrong');
    const all = await (kind === 'suppliers' ? ctx.db.suppliers : ctx.db.patients).toArray();
    const dup = all.find(r => !r.deleted && r.id !== f.id && r.name.trim().toLowerCase() === name.toLowerCase() && (r.phone || '') === phone);
    if (dup) throw new Error(`${dup.name} already exists`);
    onSaved(await saveRecord(ctx, kind, { ...f, name, phone, ...(f.age ? { age: Number(f.age) || undefined } : {}) } as never));
  });
  return (
    <Modal title={kind === 'suppliers' ? (f.id ? 'Edit supplier' : 'Add supplier') : (f.id ? 'Edit customer' : 'Add customer')} onClose={onClose}>
      <form className="col" onSubmit={e => { e.preventDefault(); void a.run(); }}>
        {FIELDS[kind].map(k => <label key={k} className="field">{LABEL[k] || t(k)}
          <input className="input" required={k === 'name'} autoFocus={k === 'name'} maxLength={k === 'history' ? 300 : 80} inputMode={k === 'phone' || k === 'age' ? 'tel' : undefined} value={String(f[k] ?? '')} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>)}
        {a.err && <span className="err" role="alert">{a.err}</span>}<button className="btn primary" disabled={a.busy}>{t('save')}</button>
      </form>
    </Modal>
  );
}

export function Parties({ kind }: { kind: 'suppliers' | 'patients' }) {
  const { ctx, t, lang, toast, user } = useStore();
  const rows = useLive(() => (kind === 'suppliers' ? ctx.db.suppliers : ctx.db.patients).filter(r => !r.deleted).toArray(), [kind], [] as (Supplier | Patient)[]);
  const balances = useLive(async () => {
    const m = new Map<string, number>();
    for (const l of await ctx.db.ledger.filter(x => x.partyType === (kind === 'suppliers' ? 'supplier' : 'patient')).toArray()) {
      m.set(l.partyId, (m.get(l.partyId) || 0) + (kind === 'suppliers' ? l.credit - l.debit : l.debit - l.credit));
    }
    return m;
  }, [kind], new Map<string, number>());
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { const i = takeIntent(kind); if (i && 'open' in i) setOpenId(i.id); }, []); // eslint-disable-line
  const list = rows.filter(r => `${r.name} ${r.phone || ''}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const open = rows.find(r => r.id === openId) || null;
  const label = kind === 'suppliers' ? 'supplier' : 'customer';
  return (
    <>
      <div className="row"><h1>{kind === 'patients' ? 'Customers / patients' : t(kind)}</h1><span className="badge num">{rows.length}</span><span className="spacer" />
        <input className="input" style={{ maxWidth: 280 }} placeholder={`${t('name')} / ${t('phone')}`} value={q} onChange={e => setQ(e.target.value)} />
        {can(user, `${kind}.create`) && <button type="button" className="btn primary" onClick={() => setEdit({ name: q })}><Icon name="plus" /> {kind === 'suppliers' ? 'New supplier' : 'New customer'}</button>}</div>
      <div className="table-wrap">{list.length === 0 ? <Empty icon="users" text="Nothing here yet" /> :
        <table className="t"><thead><tr><th>{t('name')}</th><th>{t('phone')}</th><th>{kind === 'patients' ? 'Doctor' : 'NTN'}</th><th>{kind === 'suppliers' ? 'We owe' : 'Udhaar'}</th></tr></thead><tbody>
          {list.map(r => { const bal = balances.get(r.id) || 0; return <tr key={r.id} className="click" onClick={() => setOpenId(r.id)}><td><strong>{r.name}</strong>{'allergies' in r && r.allergies && <span className="badge bad" style={{ marginInlineStart: 8 }}>{r.allergies}</span>}</td><td className="num">{r.phone}</td><td className="muted">{'doctorName' in r ? r.doctorName : (r as Supplier).ntn}</td>
            <td className="num">{bal ? <span className={`badge ${bal > 0 ? 'warn' : 'ok'}`}>{money(bal, lang)}</span> : <span className="faint">—</span>}</td></tr>; })}
        </tbody></table>}</div>
      {edit && <PartyForm kind={kind} initial={edit} onClose={() => setEdit(null)} onSaved={r => { setEdit(null); toast('ok', `${r.name} saved`); setOpenId(r.id); }} />}
      {open && <PartyDetail kind={kind} party={open} onEdit={() => { setEdit(open as never); setOpenId(null); }} onClose={() => setOpenId(null)} />}
    </>
  );
}

function PartyDetail({ kind, party, onEdit, onClose }: { kind: 'suppliers' | 'patients'; party: Supplier | Patient; onEdit: () => void; onClose: () => void }) {
  const { ctx, t, toast, lang, user } = useStore();
  const pType = kind === 'suppliers' ? 'supplier' : 'patient';
  const [tab, setTab] = useState(kind === 'suppliers' ? 'purchases' : 'bills');
  const bal = useLive(() => partyBalance(ctx, pType, party.id), [], 0);
  const ledger = useLive(() => ctx.db.ledger.where('[partyType+partyId]').equals([pType, party.id]).toArray(), [], []);
  const rx = useLive(() => kind === 'patients' ? ctx.db.prescriptions.where('patientId').equals(party.id).toArray().then(x => x.filter(p => !p.deleted)) : Promise.resolve([] as Prescription[]), [], [] as Prescription[]);
  const purchases = useLive(() => kind === 'suppliers' ? ctx.db.purchases.filter(p => p.supplierId === party.id && !p.deleted).toArray() : Promise.resolve([] as Purchase[]), [], [] as Purchase[]);
  const bills = useLive(() => kind === 'patients' ? ctx.db.invoices.filter(i => i.patientId === party.id).toArray() : Promise.resolve([] as Invoice[]), [], [] as Invoice[]);
  const items = useLive(async () => {
    if (kind !== 'suppliers') return [] as Medicine[];
    const ids = new Set((await ctx.db.purchaseItems.toArray()).filter(i => purchases.some(p => p.id === i.purchaseId)).map(i => i.medicineId));
    return (await ctx.db.medicines.bulkGet([...ids])).filter((m): m is Medicine => !!m && !m.deleted);
  }, [purchases.length], [] as Medicine[]);
  const meds = useLive(() => ctx.db.medicines.filter(m => !m.deleted).toArray(), [], [] as Medicine[]);
  const [amt, setAmt] = useState('');
  const [newRx, setNewRx] = useState({ medicineId: '', everyDays: '30', qty: '30' });
  const canPay = can(user, kind === 'suppliers' ? 'suppliers.payment' : 'patients.payment');
  const pay = useAsync(async () => {
    const v = rs(amt);
    if (!(v > 0)) throw new Error('Enter an amount above 0');
    await recordPayment(ctx, pType, party.id, v, kind === 'suppliers' ? 'Paid to supplier' : 'Received from customer');
    setAmt(''); toast('ok', 'Payment saved');
  });
  const tabs: [string, string][] = kind === 'suppliers'
    ? [['purchases', `Purchases (${purchases.length})`], ['items', `Items supplied (${items.length})`], ['ledger', `Account (${ledger.length})`]]
    : [['bills', `Bills (${bills.length})`], ['rx', `Repeat prescriptions (${rx.length})`], ['ledger', `Udhaar account (${ledger.length})`]];
  return (
    <Modal title={party.name} onClose={onClose} wide>
      <div className="col">
        <div className="row"><span className="muted num">{party.phone}</span>{'allergies' in party && party.allergies && <span className="badge bad">Allergy: {party.allergies}</span>}<span className="spacer" />
          {kind === 'patients' && can(user, 'pos') && <button type="button" className="btn sm primary" onClick={() => { onClose(); navigate('pos', { sell: { patientId: party.id } }); }}><Icon name="cart" size={16} /> New bill</button>}
          {kind === 'suppliers' && can(user, 'purchases.create') && <button type="button" className="btn sm primary" onClick={() => { onClose(); navigate('purchases', { newPurchase: { supplierId: party.id } }); }}><Icon name="truck" size={16} /> New purchase</button>}
          {can(user, `${kind}.edit`) && <button type="button" className="btn sm" onClick={onEdit}>{t('edit')}</button>}
          {can(user, `${kind}.delete`) && <button type="button" className="btn sm danger" onClick={async () => { if (bal !== 0 && !confirm(`${party.name} still has a balance of ${money(bal, lang as never)}. Delete anyway?`)) return; if (confirm(`Delete ${party.name}? Their bills and purchases stay in history.`)) { try { await saveRecord(ctx, kind, { ...party, deleted: true } as never); toast('ok', `${party.name} deleted`); onClose(); } catch (e) { toast('bad', (e as Error).message); } } }}><Icon name="trash" size={14} /> {t('delete')}</button>}
        </div>
        <div className="card row"><div className="col" style={{ gap: 0 }}><span className="small muted">{kind === 'suppliers' ? 'We owe this supplier' : 'Udhaar — customer owes'}</span><span className="big num">{money(bal, lang as never)}</span></div><span className="spacer" />
          {canPay && <form className="row" onSubmit={e => { e.preventDefault(); void pay.run(); }}><input className="input num" style={{ width: 130 }} inputMode="decimal" placeholder="Rs" value={amt} onChange={e => setAmt(e.target.value.replace(/[^\d.]/g, ''))} />
            <button className="btn primary" disabled={!amt || pay.busy}>{kind === 'suppliers' ? 'Pay' : 'Receive payment'}</button>{pay.err && <span className="err">{pay.err}</span>}</form>}</div>
        <Tabs value={tab} onChange={setTab} tabs={tabs} />
        {tab === 'purchases' && (purchases.length === 0 ? <Empty icon="truck" text="No purchases from this supplier yet" /> : <div className="table-wrap"><table className="t"><thead><tr><th>#</th><th>Date</th><th>{t('total')}</th><th>Status</th></tr></thead><tbody>
          {[...purchases].sort((a, b) => b.date.localeCompare(a.date)).map(p => <tr key={p.id}><td><Link onClick={() => { onClose(); navigate('purchases', { open: 'purchase', id: p.id }); }}>{p.number}</Link></td><td className="num">{p.date}</td><td className="num">{money(p.total, lang as never)}</td><td><span className={`badge ${p.status === 'received' ? 'ok' : 'warn'}`}>{p.status === 'received' ? 'in stock' : 'waiting'}</span></td></tr>)}
        </tbody></table></div>)}
        {tab === 'items' && (items.length === 0 ? <Empty text="No items yet" /> : <div className="col" style={{ gap: 4 }}>{items.map(m => <button type="button" key={m.id} className="result" style={{ borderRadius: 12 }} onClick={() => { onClose(); navigate('inventory', { open: 'medicine', id: m.id }); }}><MedThumb med={m} size={32} /><MedName med={m} /></button>)}</div>)}
        {tab === 'bills' && (bills.length === 0 ? <Empty icon="receipt" text="No bills yet" /> : <div className="table-wrap"><table className="t"><thead><tr><th>Bill</th><th>Date</th><th>{t('total')}</th><th>Status</th></tr></thead><tbody>
          {[...bills].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(b => <tr key={b.id}><td>{can(user, 'invoices') ? <Link onClick={() => { onClose(); navigate('invoices', { open: 'invoice', id: b.id }); }}>{b.number}</Link> : b.number}</td><td className="num">{fmtDate(b.createdAt)}</td><td className="num">{money(b.total, lang as never)}</td><td><span className={`badge ${b.status === 'void' ? 'bad' : b.status === 'credit' ? 'warn' : 'ok'}`}>{b.status}</span></td></tr>)}
        </tbody></table></div>)}
        {tab === 'ledger' && (ledger.length === 0 ? <Empty icon="receipt" text="No entries yet" /> : <div className="table-wrap"><table className="t"><thead><tr><th>Date</th><th>Ref</th><th>Debit</th><th>Credit</th></tr></thead><tbody>
          {[...ledger].sort((a, b) => b.date.localeCompare(a.date)).map(l => <tr key={l.id}><td className="num">{l.date}</td><td>{l.ref} <span className="muted small">{l.note}</span></td><td className="num">{l.debit ? money(l.debit, lang as never) : ''}</td><td className="num">{l.credit ? money(l.credit, lang as never) : ''}</td></tr>)}
        </tbody></table></div>)}
        {tab === 'rx' && <>
          {rx.length === 0 && <Empty icon="rx" text="No repeat prescriptions" />}
          {rx.map(p => { const m = meds.find(x => x.id === p.medicineId); const due = p.nextDue <= addDays(isoDate(), 3); return (
            <div key={p.id} className="row" style={{ padding: '8px 10px', borderRadius: 12, background: 'var(--panel2)' }}>
              {m && <MedThumb med={m} size={30} />}<strong>{m ? `${m.name} ${m.strength || ''}` : 'Deleted item'}</strong><span className="small muted">every {p.everyDays} days · next <span className={`num ${due ? 'badge warn' : ''}`}>{p.nextDue}</span></span>
              <span className="spacer" />
              {m && can(user, 'pos') && <button type="button" className="btn sm" onClick={() => { onClose(); navigate('pos', { sell: { medicineId: m.id, qty: p.qty, patientId: party.id } }); }}><Icon name="cart" size={14} /> Sell refill</button>}
              {can(user, 'patients.rx') && <Toggle on={p.active} onChange={v => saveRecord(ctx, 'prescriptions', { ...p, active: v } as never)} label="Active" />}
            </div>); })}
          {can(user, 'patients.rx') && <div className="row"><select className="input" style={{ flex: 2 }} value={newRx.medicineId} onChange={e => setNewRx({ ...newRx, medicineId: e.target.value })}><option value="">Medicine…</option>{meds.map(m => <option key={m.id} value={m.id}>{m.name} {m.strength}</option>)}</select>
            <label className="row small">every<input className="input num" style={{ width: 70 }} inputMode="numeric" value={newRx.everyDays} onChange={e => setNewRx({ ...newRx, everyDays: e.target.value.replace(/\D/g, '') })} />days</label>
            <label className="row small">qty<input className="input num" style={{ width: 70 }} inputMode="numeric" value={newRx.qty} onChange={e => setNewRx({ ...newRx, qty: e.target.value.replace(/\D/g, '') })} /></label>
            <button type="button" className="btn" disabled={!newRx.medicineId || !(Number(newRx.everyDays) > 0)} onClick={async () => { try { await saveRecord(ctx, 'prescriptions', { patientId: party.id, medicineId: newRx.medicineId, everyDays: Number(newRx.everyDays), qty: Math.max(1, Number(newRx.qty) || 1), nextDue: addDays(isoDate(), Number(newRx.everyDays)), active: true, doctorName: (party as Patient).doctorName }); setNewRx({ ...newRx, medicineId: '' }); } catch (e) { toast('bad', (e as Error).message); } }}>{t('add')}</button></div>}
        </>}
      </div>
    </Modal>
  );
}

/* ======================= BILLS / INVOICES ======================= */
export function Invoices() {
  const { ctx, t, lang, user } = useStore();
  const [day, setDay] = useState(isoDate());
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { const i = takeIntent('invoices'); if (i && 'open' in i) setOpenId(i.id); }, []);
  const all = useLive(() => ctx.db.invoices.where('createdAt').between(day, addDays(day, 1)).reverse().toArray(), [day], [] as (Invoice & { rejected?: string })[]);
  const inv = can(user, 'invoices.view_all') ? all : all.filter(i => i.cashierId === user?.id);
  const users = useLive(() => ctx.db.users.toArray(), [], []);
  const patients = useLive(() => ctx.db.patients.toArray(), [], [] as Patient[]);
  const openInv = useLive(() => openId ? ctx.db.invoices.get(openId) : Promise.resolve(undefined), [openId], undefined as Invoice | undefined);
  const total = inv.filter(i => i.status !== 'void').reduce((s, i) => s + i.total, 0);
  return (
    <>
      <div className="row"><h1>{t('invoices')}</h1><span className="badge num">{inv.length} · {money(total, lang)}</span><span className="spacer" />
        {!can(user, 'invoices.view_all') && <span className="small muted">Showing your own bills</span>}
        <input className="input" type="date" style={{ width: 'auto' }} value={day} max={isoDate()} onChange={e => setDay(e.target.value || isoDate())} /></div>
      <div className="table-wrap">{inv.length === 0 ? <Empty icon="receipt" text="No bills on this day" /> :
        <table className="t"><thead><tr><th>#</th><th>Time</th><th>{t('patient')}</th><th>Cashier</th><th>{t('total')}</th><th>Status</th></tr></thead><tbody>
          {inv.map(i => { const p = patients.find(x => x.id === i.patientId); return <tr key={i.id} className="click" onClick={() => setOpenId(i.id)}><td className="num"><strong>{i.number}</strong></td><td className="num">{new Date(i.createdAt).toLocaleTimeString(dateLocale())}</td>
            <td>{p ? <Link onClick={() => navigate('patients', { open: 'patient', id: p.id })}>{p.name}</Link> : <span className="faint small">Walk-in</span>}</td>
            <td>{users.find(u => u.id === i.cashierId)?.name}</td><td className="num">{money(i.total, lang)}</td>
            <td><span className={`badge ${i.status === 'void' || i.rejected ? 'bad' : i.status === 'credit' ? 'warn' : 'ok'}`}>{i.rejected ? 'not saved' : i.status}</span>{i.conflict && <span className="badge warn" style={{ marginInlineStart: 6 }}>check stock</span>}</td></tr>; })}
        </tbody></table>}</div>
      {openInv && (can(user, 'invoices.view_all') || openInv.cashierId === user?.id) && <InvoiceDetail inv={openInv} onClose={() => setOpenId(null)} />}
    </>
  );
}

function InvoiceDetail({ inv, onClose }: { inv: Invoice & { rejected?: string }; onClose: () => void }) {
  const { ctx, t, lang, settings, printer, user, toast } = useStore();
  const items = useLive(() => ctx.db.invoiceItems.where('invoiceId').equals(inv.id).toArray(), [inv.id], [] as InvoiceItem[]);
  const meds = useLive(() => ctx.db.medicines.toArray(), [], [] as Medicine[]);
  const patient = useLive(() => inv.patientId ? ctx.db.patients.get(inv.patientId) : Promise.resolve(undefined), [], undefined as Patient | undefined);
  const cashier = useLive(() => ctx.db.users.get(inv.cashierId), [], undefined);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [sup, setSup] = useState(false);
  const doVoid = async (supId?: string) => {
    try { await voidInvoice(ctx, inv.id, reason, supId ? await ctx.db.users.get(supId) : undefined); toast('ok', `${inv.number} void — stock returned to Inventory`); setVoiding(false); onClose(); }
    catch (e) { if ((e as { code?: string }).code === 'OVERRIDE_REQUIRED') setSup(true); else toast('bad', (e as Error).message); }
  };
  return (
    <Modal title={`Bill ${inv.number}`} onClose={onClose} wide>
      <div className="col">
        <div className="row"><span className={`badge ${inv.status === 'void' ? 'bad' : inv.status === 'credit' ? 'warn' : 'ok'}`}>{inv.status}</span><span className="muted num">{new Date(inv.createdAt).toLocaleString(dateLocale())}</span>
          <span className="small muted">by {cashier?.name || '—'}</span>
          {patient && <Link onClick={() => { onClose(); navigate('patients', { open: 'patient', id: patient.id }); }}><Icon name="users" size={14} /> {patient.name}</Link>}<span className="spacer" />
          {can(user, 'invoices.reprint') && <><button type="button" className="btn sm" onClick={() => printer.enqueue(inv.id)}><Icon name="print" size={16} /> {t('reprint')}</button>
            <button type="button" className="btn sm" onClick={async () => { const d = await receiptData(ctx, inv.id, settings); if (d) downloadReceipt(d); }}><Icon name="download" size={16} /> PDF</button></>}
          {inv.status !== 'void' && !inv.rejected && <button type="button" className="btn sm danger" onClick={() => setVoiding(true)}>{t('void')} / return</button>}
        </div>
        {inv.rejected && <span className="err">This bill was not accepted by the server: {inv.rejected}</span>}
        <div className="table-wrap"><table className="t"><thead><tr><th>Item</th><th>{t('batch')}</th><th>{t('qty')}</th><th>{t('price')}</th><th>{t('amount')}</th></tr></thead><tbody>
          {items.map(i => { const m = meds.find(x => x.id === i.medicineId); return (
            <tr key={i.id}><td>{m ? <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}><MedThumb med={m} size={30} />{can(user, 'inventory') ? <Link onClick={() => { onClose(); navigate('inventory', { open: 'medicine', id: m.id }); }}>{m.name} {m.strength}</Link> : <span>{m.name}</span>}</div> : i.name}</td>
              <td className="num">{i.batchNo}</td><td className="num">{i.qty}</td><td className="num">{money(i.unitPrice, lang)}</td><td className="num">{money(i.total, lang)}</td></tr>); })}
        </tbody></table></div>
        <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
          <span className="small muted">{t('subtotal')} <span className="num">{money(inv.gross, lang)}</span>{inv.discount ? <> · {t('discount')} <span className="num">-{money(inv.discount, lang)}</span></> : null}{inv.tax ? <> · {t('gst')} <span className="num">{money(inv.tax, lang)}</span></> : null}</span>
          <strong className="big num">{money(inv.total, lang)}</strong><span className="small muted">{`Paid (${inv.payMethod})`} <span className="num">{money(inv.paid, lang)}</span>{inv.change ? <> · change <span className="num">{money(inv.change, lang)}</span></> : null}</span>
          {inv.note && <span className="small faint">{inv.note}</span>}
        </div>
        {voiding && <div className="card col"><span className="muted small">All items go back into Inventory (to the same batches). Recorded in the activity log.</span>
          <input className="input" autoFocus maxLength={120} placeholder="Reason" value={reason} onChange={e => setReason(e.target.value)} />
          <div className="row"><button type="button" className="btn" onClick={() => setVoiding(false)}>{t('cancel')}</button><button type="button" className="btn danger" disabled={!reason.trim()} onClick={() => doVoid()}>{t('void')}</button></div></div>}
      </div>
      {sup && <SupervisorPrompt perm="invoices.void" onApproved={id => { setSup(false); void doVoid(id); }} onClose={() => setSup(false)} />}
    </Modal>
  );
}

/* ======================= ALERTS ======================= */
export function Alerts() {
  const { alerts, t, user } = useStore();
  const groups: [string, string[]][] = [['Expired & expiring', ['expired', 'expiring']], ['Stock', ['out', 'low', 'pending', 'conflict']], ['Refills due', ['refill']]];
  return (
    <>
      <div className="row"><h1>{t('alerts')}</h1><span className="spacer" />{can(user, 'purchases.create') && <button type="button" className="btn" onClick={() => navigate('purchases', { newPurchase: {} })}><Icon name="truck" /> Create purchase</button>}</div>
      {alerts.length === 0 ? <div className="card"><Empty icon="check" text={t('noAlerts')} /></div> : groups.map(([title, kinds]) => {
        const list = alerts.filter(a => kinds.includes(a.kind));
        return list.length ? <section key={title} className="card col" style={{ gap: 8 }}><h2>{title} <span className="badge">{list.length}</span></h2>
          {list.map(a => <div key={a.id} className="row" style={{ padding: '10px 12px', borderRadius: 12, flexWrap: 'nowrap', background: a.level === 'critical' ? 'var(--badSoft)' : a.level === 'warning' ? 'var(--warnSoft)' : 'var(--accentSoft)' }}>
            <Icon name={a.kind === 'refill' ? 'users' : 'warn'} /><div className="col" style={{ gap: 0, flex: 1 }}><strong>{a.title}</strong><span className="small muted">{a.detail}</span></div>
            {a.medicineId && can(user, 'inventory') && a.kind !== 'refill' && <Link onClick={() => navigate('inventory', { open: 'medicine', id: a.medicineId! })}>View item</Link>}
            {(a.kind === 'low' || a.kind === 'out' || a.kind === 'pending') && a.medicineId && can(user, 'purchases.create') && <Link onClick={() => navigate('purchases', { newPurchase: { medicineId: a.medicineId, qty: a.suggestQty || a.qty } })}><Icon name="truck" size={14} /> Order{a.suggestQty ? ` ${a.suggestQty}` : ''}</Link>}
            {a.kind === 'refill' && can(user, 'pos') && <Link onClick={() => navigate('pos', { sell: { medicineId: a.medicineId, patientId: a.patientId } })}><Icon name="cart" size={14} /> Sell refill</Link>}
            {a.kind === 'conflict' && a.id.startsWith('conf-') && can(user, 'invoices') && <Link onClick={() => navigate('invoices', { open: 'invoice', id: a.id.slice(5) })}>Open bill</Link>}
          </div>)}</section> : null;
      })}
    </>
  );
}
