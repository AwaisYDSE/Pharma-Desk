// Optional FBR (Pakistan) POS integration — OFF unless the owner switches it on in Settings.
// Each bill is reported to FBR's POS API; the FBR invoice number comes back and prints on the bill.
// Bills that could not be reported (no internet) are retried automatically. Billing never waits
// for FBR for more than a few seconds and never stops because of it.
// © Awais Amin
import { allRows, getRow, putRow, getSetting, setSetting, type DB } from './db.ts';
import { getIdentity, encryptSecret, decryptSecret } from './identity.ts';
import { serverClock } from './ops.ts';
import type { Invoice, InvoiceItem, Patient, Shop } from '../shared/types.ts';

export interface FbrConfig { enabled: boolean; sandbox: boolean; posId: string; token: string; pctCode: string; since?: string }
const DEF: FbrConfig = { enabled: false, sandbox: true, posId: '', token: '', pctCode: '3004.9099' };
export const FBR_URL = { live: 'https://gw.fbr.gov.pk/imsp/v1/api/Live/PostData', sandbox: 'https://esp.fbr.gov.pk:8244/FBR/v1/api/Live/PostData' };

export function getFbr(db: DB): FbrConfig {
  const raw = getSetting(db, 'fbr_config');
  if (!raw) return { ...DEF };
  try { return { ...DEF, ...JSON.parse(decryptSecret(raw, getIdentity(db)!.jwtSecret) || '{}') }; } catch { return { ...DEF }; }
}

export function saveFbr(db: DB, inp: Partial<FbrConfig>): FbrConfig {
  const cur = getFbr(db);
  const next: FbrConfig = {
    enabled: inp.enabled ?? cur.enabled, sandbox: inp.sandbox ?? cur.sandbox,
    posId: typeof inp.posId === 'string' ? inp.posId.replace(/\D/g, '').slice(0, 12) : cur.posId,
    token: typeof inp.token === 'string' && inp.token.trim() ? inp.token.trim().slice(0, 600) : cur.token,
    pctCode: typeof inp.pctCode === 'string' && inp.pctCode.trim() ? inp.pctCode.trim().slice(0, 20) : cur.pctCode,
    since: (inp.enabled ?? cur.enabled) ? (cur.enabled ? cur.since : new Date().toISOString()) : undefined,
  };
  const region = (getRow<Shop>(db, 'shop', 'shop')?.billing?.region) || 'pk';
  if (next.enabled && region !== 'pk') throw Object.assign(new Error('FBR reporting is only for shops in Pakistan (Settings → Bills → Region)'), { code: 'INVALID' });
  if (next.enabled && (!next.posId || !next.token)) throw Object.assign(new Error('Enter your FBR POS ID and token first'), { code: 'INVALID' });
  setSetting(db, 'fbr_config', encryptSecret(JSON.stringify(next), getIdentity(db)!.jwtSecret));
  // Every device learns that FBR is on (to wait briefly for the FBR number before printing).
  const shop = getRow<Shop>(db, 'shop', 'shop');
  if (shop && !!shop.fbrOn !== next.enabled) putRow(db, 'shop', { ...shop, fbrOn: next.enabled } as Shop, serverClock.tick());
  return next;
}

export const publicFbr = (c: FbrConfig) => ({ enabled: c.enabled, sandbox: c.sandbox, posId: c.posId, tokenSet: !!c.token, pctCode: c.pctCode });

const r2 = (paisa: number) => Math.round(paisa) / 100;
const fbrDate = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };

/** The FBR POS request body for one bill. */
export function fbrPayload(c: FbrConfig, inv: Invoice, items: InvoiceItem[], buyer?: Patient | null) {
  return {
    InvoiceNumber: '', POSID: Number(c.posId), USIN: inv.number, DateTime: fbrDate(inv.createdAt),
    BuyerNTN: '', BuyerCNIC: buyer?.cnic || '', BuyerName: buyer?.name || '', BuyerPhoneNumber: buyer?.phone || '',
    TotalBillAmount: r2(inv.total), TotalQuantity: items.reduce((s, i) => s + i.qty, 0),
    TotalSaleValue: r2(inv.total - inv.tax), TotalTaxCharged: r2(inv.tax), Discount: r2(inv.discount), FurtherTax: 0,
    PaymentMode: inv.payMethod === 'card' ? 2 : 1, RefUSIN: null, InvoiceType: 1,
    Items: items.map(i => ({
      ItemCode: i.medicineId.slice(0, 20), ItemName: (i.name || 'Medicine').slice(0, 100), Quantity: i.qty, PCTCode: c.pctCode,
      TaxRate: (i.taxBp || 0) / 100, SaleValue: r2(i.total - i.tax), TotalAmount: r2(i.total), TaxCharged: r2(i.tax), Discount: r2(i.discount), FurtherTax: 0, InvoiceType: 1, RefUSIN: null,
    })),
  };
}

/** Report one bill. Returns the FBR number (also saved on the bill), or throws with FBR's reason. */
export async function reportInvoice(db: DB, invoiceId: string, f: typeof fetch = fetch, timeoutMs = 15_000): Promise<string> {
  const c = getFbr(db);
  if (!c.enabled) throw new Error('FBR reporting is off');
  const inv = getRow<Invoice>(db, 'invoices', invoiceId);
  if (!inv) throw new Error('Bill not found on the server yet');
  if (inv.fbrNumber) return inv.fbrNumber;
  if (inv.status === 'void') throw new Error('Cancelled bills are not reported');
  const items = allRows<InvoiceItem>(db, 'invoiceItems', 'WHERE invoice_id = ?', inv.id);
  const buyer = inv.patientId ? getRow<Patient>(db, 'patients', inv.patientId) : null;
  const res = await f(c.sandbox ? FBR_URL.sandbox : FBR_URL.live, {
    method: 'POST', headers: { authorization: `Bearer ${c.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(fbrPayload(c, inv, items, buyer)), signal: AbortSignal.timeout(timeoutMs),
  });
  const d = await res.json().catch(() => ({})) as { InvoiceNumber?: string; Code?: string; Response?: string; Errors?: unknown };
  if (!res.ok || !d.InvoiceNumber || (d.Code && String(d.Code) !== '100')) {
    const why = String(d.Response || d.Errors || `FBR answered ${res.status}`).slice(0, 200);
    const cur = getRow<Invoice>(db, 'invoices', invoiceId);
    if (cur) putRow(db, 'invoices', { ...cur, fbrError: why } as Invoice, serverClock.tick());
    throw new Error(why);
  }
  const cur = getRow<Invoice>(db, 'invoices', invoiceId)!;
  putRow(db, 'invoices', { ...cur, fbrNumber: d.InvoiceNumber, fbrError: null } as Invoice, serverClock.tick());
  return d.InvoiceNumber;
}

/** Retries bills made since FBR was switched on that have no FBR number yet. */
export async function retryPending(db: DB, f: typeof fetch = fetch, limit = 20) {
  const c = getFbr(db);
  if (!c.enabled || !c.since) return 0;
  const list = allRows<Invoice>(db, 'invoices', `WHERE created_at >= ? AND status != 'void'`, c.since).filter(i => !i.fbrNumber).slice(0, limit);
  let ok = 0;
  for (const i of list) { try { await reportInvoice(db, i.id, f); ok++; } catch { /* next round */ } }
  return ok;
}
