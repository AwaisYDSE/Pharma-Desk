// Register Payment, the payment summary on every customer invoice and vendor bill,
// and the pictures of bills attached to purchases and expenses.
// © Awais Amin
import React, { useState } from 'react';
import { useStore, useLive } from '../store.tsx';
import { Icon, Modal, useAsync } from '../components.tsx';
import { money } from '../i18n.ts';
import { toPaisa } from '../../../shared/money.ts';
import { isoDate } from '../../../shared/util.ts';
import { can } from '../../../shared/permissions.ts';
import { recordPayment, addPicture, removePicture, type Attachment } from '../../core/inventory.ts';
import { PAY_STATE_LABEL, invoiceMatches, type DocMatch, type PayState } from '../../../shared/ledger.ts';
import type { Invoice, PayAccount } from '../../../shared/types.ts';

const CLS: Record<PayState, string> = { not_paid: 'warn', partial: 'info', paid: 'ok', reversed: 'bad' };

export function PayStateBadge({ state }: { state?: PayState | null }) {
  if (!state) return null;
  return <span className={`badge ${CLS[state]}`}>{PAY_STATE_LABEL[state]}</span>;
}

export function usePayAccounts() {
  const { ctx } = useStore();
  return useLive(async () => (await ctx.db.shop.get('shop'))?.payAccounts?.filter(a => a.active) || [], [], [] as PayAccount[]);
}

/** Payment status of these bills. Reads only the accounts of the customers on them. */
export function useInvoiceMatches(invoices: Invoice[]) {
  const { ctx } = useStore();
  const ids = [...new Set(invoices.map(i => i.patientId).filter(Boolean) as string[])];
  return useLive(async () => {
    const theirs = ids.length ? await ctx.db.invoices.where('patientId').anyOf(ids).toArray() : [];
    const all = [...theirs, ...invoices.filter(i => !i.patientId)];
    const refunds = theirs.length ? await ctx.db.refunds.where('invoiceId').anyOf(theirs.map(i => i.id)).toArray() : [];
    const ledger = ids.length ? await ctx.db.ledger.where('[partyType+partyId]').anyOf(ids.map(id => ['patient', id])).toArray() : [];
    return invoiceMatches(all, ledger, refunds);
  }, [invoices.map(i => i.id + (i.hlc || '')).join()], new Map<string, DocMatch>());
}

/** "cash", "bank" or "acc:<id>" as chosen in a Journal list, ready to save. */
export function journalChoice(v: string, accounts: PayAccount[]) {
  const a = v.startsWith('acc:') ? accounts.find(x => x.id === v.slice(4)) : undefined;
  return a ? { method: a.type as 'bank' | 'wallet', accountId: a.id, accountName: `${a.provider} · ${a.title}` } : { method: v as 'cash' | 'bank', accountId: null, accountName: null };
}

export function JournalOptions({ accounts }: { accounts: PayAccount[] }) {
  return <><option value="cash">Cash</option><option value="bank">Bank</option>{accounts.map(a => <option key={a.id} value={`acc:${a.id}`}>{`${a.provider} · ${a.title}`}</option>)}</>;
}

/** The lines under the total: what paid this document, what was returned against it, and the Amount Due. */
export function PaymentSummary({ doc }: { doc: DocMatch }) {
  const { lang } = useStore();
  return (
    <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
      {doc.lines.map((l, i) => <span key={l.rowId + i} className="small muted">
        {l.kind === 'payment' ? 'Paid on' : 'Reversed on'} <span className="num">{l.date}</span> {l.kind === 'credit_note' && <span className="num">{l.ref} </span>}<span className="num">{money(l.amount, lang)}</span>
      </span>)}
      <strong>Amount Due <span className="num">{money(Math.max(0, doc.residual), lang)}</span></strong>
    </div>
  );
}

export function RegisterPayment({ partyType, partyId, doc, onClose }: { partyType: 'supplier' | 'patient'; partyId: string; doc: DocMatch; onClose: () => void }) {
  const { ctx, lang, toast } = useStore();
  const accounts = usePayAccounts();
  const [f, setF] = useState({ journal: 'cash', amount: String(doc.residual / 100), date: isoDate(), memo: doc.number });
  const a = useAsync(async () => {
    const amount = toPaisa(f.amount || 0);
    if (!(amount > 0)) throw new Error('Enter an amount above 0');
    const j = journalChoice(f.journal, accounts);
    await recordPayment(ctx, partyType, partyId, amount, f.memo.trim(), j.method, j.accountId ? { id: j.accountId, name: j.accountName! } : null, { doc: doc.number, date: f.date });
    toast('ok', 'Payment saved'); onClose();
  });
  const diff = doc.residual - toPaisa(f.amount || 0);
  return (
    <Modal title="Register Payment" onClose={onClose}>
      <form className="col" onSubmit={e => { e.preventDefault(); void a.run(); }}>
        <div className="form-grid two">
          <label className="field">Journal<select className="input" value={f.journal} onChange={e => setF({ ...f, journal: e.target.value })}><JournalOptions accounts={accounts} /></select></label>
          <label className="field">Amount<input className="input num" autoFocus inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} /></label>
          <label className="field">Payment Date<input className="input" type="date" max={isoDate()} value={f.date} onChange={e => setF({ ...f, date: e.target.value || isoDate() })} /></label>
          <label className="field">Memo<input className="input" maxLength={80} value={f.memo} onChange={e => setF({ ...f, memo: e.target.value })} /></label>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn sm" onClick={() => setF({ ...f, amount: String(doc.residual / 100) })}>Full</button>
          <button type="button" className="btn sm" onClick={() => setF({ ...f, amount: String(Math.round(doc.residual / 2) / 100) })}>Half</button>
        </div>
        {diff > 0 && <span className="small muted">Payment Difference <span className="num">{money(diff, lang)}</span></span>}
        {diff < 0 && <span className="small muted">Outstanding credits <span className="num">{money(-diff, lang)}</span></span>}
        {a.err && <span className="err" role="alert">{a.err}</span>}
        <div className="form-actions"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>Discard</button><button className="btn primary" disabled={a.busy}>Create Payment</button></div>
      </form>
    </Modal>
  );
}

/**
 * Pictures of a purchase bill or expense receipt. On a document that exists they save straight away, so a bill
 * that arrives after the stock can still be added. On a new one they wait in `pending` until it is saved.
 */
export function Pictures({ docType, docId, pending, setPending }: { docType: Attachment['docType']; docId?: string | null; pending?: string[]; setPending?: (v: string[]) => void }) {
  const { ctx, toast, user } = useStore();
  const saved = useLive(async () => docId ? (await ctx.db.table('attachments').where('docId').equals(docId).toArray() as Attachment[]).filter(a => !a.deleted) : [], [docId], [] as Attachment[]);
  const [big, setBig] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const mod = docType === 'expense' ? 'accounts' : 'purchases';
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files || [])]; e.target.value = '';
    try {
      const { resizeImage } = await import('../image.ts');
      for (const f of files) {
        const data = await resizeImage(f, 1400, 'image/jpeg', 0.72);
        if (docId) await addPicture(ctx, docType, docId, data); else setPending?.([...(pending || []), data]);
      }
      setErr('');
    } catch (x) { setErr((x as Error).message); }
  };
  const box: React.CSSProperties = { width: 72, height: 72, objectFit: 'cover', borderRadius: 12, cursor: 'zoom-in', border: '1px solid var(--line)', display: 'block' };
  return (
    <div className="col" style={{ gap: 6 }}>
      <strong className="small">Pictures</strong>
      <div className="row" style={{ gap: 8 }}>
        {saved.map(a => <span key={a.id} className="col" style={{ gap: 2 }}><img src={a.data} alt="" style={box} onClick={() => setBig(a.data)} />
          {can(user, `${mod}.delete`) && <button type="button" className="btn sm ghost" onClick={async () => { try { await removePicture(ctx, a); } catch (x) { toast('bad', (x as Error).message); } }}>Remove</button>}</span>)}
        {(pending || []).map((d, i) => <span key={i} className="col" style={{ gap: 2 }}><img src={d} alt="" style={box} onClick={() => setBig(d)} />
          <button type="button" className="btn sm ghost" onClick={() => setPending?.((pending || []).filter((_, k) => k !== i))}>Remove</button></span>)}
        {can(user, `${mod}.create`) && <label className="btn sm" style={{ alignSelf: 'flex-start' }}><Icon name="camera" size={16} /> Add picture<input type="file" accept="image/*" multiple hidden onChange={pick} /></label>}
      </div>
      {err && <span className="err">{err}</span>}
      {big && <Modal title="Pictures" onClose={() => setBig(null)} wide><img src={big} alt="" style={{ width: '100%', borderRadius: 12 }} /></Modal>}
    </div>
  );
}
