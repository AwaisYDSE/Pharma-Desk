// Email (responsive HTML) and SMS text for receipts, low-stock alerts and supplier orders.
// © Awais Amin
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const rs = (p: number) => 'Rs ' + (Math.round(p) / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface ShopInfo { name: string; phone?: string; address?: string; ntn?: string }

function layout(shop: ShopInfo, title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#EEF3F2;font-family:Segoe UI,Arial,sans-serif;color:#0E1B1A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF3F2;padding:16px 8px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0E8F7E;color:#ffffff;padding:18px 22px"><div style="font-size:19px;font-weight:700">${esc(shop.name)}</div>
<div style="font-size:13px;opacity:.9">${esc([shop.address, shop.phone].filter(Boolean).join(' · '))}</div></td></tr>
<tr><td style="padding:20px 22px"><h1 style="margin:0 0 12px;font-size:18px">${esc(title)}</h1>${body}</td></tr>
<tr><td style="padding:14px 22px;background:#F5F8F7;color:#5B6B69;font-size:12px">Sent by ${esc(shop.name)} with PharmaDesk${shop.ntn ? ' · NTN ' + esc(shop.ntn) : ''}</td></tr>
</table></td></tr></table></body></html>`;
}

const table = (head: string[], rows: string[][], alignRightFrom = 1) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
<tr>${head.map((h, i) => `<th style="text-align:${i >= alignRightFrom ? 'right' : 'left'};padding:8px 6px;border-bottom:2px solid #D8E2E0;color:#5B6B69;font-size:12px">${esc(h)}</th>`).join('')}</tr>
${rows.map(r => `<tr>${r.map((c, i) => `<td style="text-align:${i >= alignRightFrom ? 'right' : 'left'};padding:8px 6px;border-bottom:1px solid #EEF3F2">${c}</td>`).join('')}</tr>`).join('')}</table>`;

export interface InvoiceMsgData {
  number: string; date: string; customer?: string; items: { name: string; qty: number; price: number; total: number }[];
  gross: number; discount: number; tax: number; total: number; paid: number; status: string; refunded?: number;
}

export function invoiceMessage(shop: ShopInfo, d: InvoiceMsgData) {
  const statusText = ({ paid: 'Paid', credit: 'Unpaid (credit)', partial_refund: 'Partially refunded', refunded: 'Refunded', void: 'Cancelled' } as Record<string, string>)[d.status] || d.status;
  const body = `<p style="margin:0 0 12px;font-size:14px">${d.customer ? `Dear ${esc(d.customer)}, thank you` : 'Thank you'} for your purchase. Bill <b>${esc(d.number)}</b> · ${esc(d.date)} · <b>${esc(statusText)}</b></p>
${table(['Item', 'Qty', 'Price', 'Amount'], d.items.map(i => [esc(i.name), String(i.qty), rs(i.price), rs(i.total)]))}
<table role="presentation" width="100%" style="margin-top:12px;font-size:14px">
<tr><td style="color:#5B6B69">Subtotal</td><td align="right">${rs(d.gross)}</td></tr>
${d.discount ? `<tr><td style="color:#5B6B69">Discount</td><td align="right">-${rs(d.discount)}</td></tr>` : ''}
${d.tax ? `<tr><td style="color:#5B6B69">GST (included)</td><td align="right">${rs(d.tax)}</td></tr>` : ''}
<tr><td style="font-size:17px;font-weight:700;padding-top:6px">Total</td><td align="right" style="font-size:17px;font-weight:700;padding-top:6px">${rs(d.total)}</td></tr>
${d.refunded ? `<tr><td style="color:#B4232F">Refunded</td><td align="right" style="color:#B4232F">-${rs(d.refunded)}</td></tr>` : ''}
</table>`;
  const sms = `${shop.name}: Bill ${d.number} ${d.date}. ${d.items.slice(0, 4).map(i => `${i.name} x${i.qty}`).join(', ')}${d.items.length > 4 ? ` +${d.items.length - 4} more` : ''}. Total ${rs(d.total)} (${statusText}). Thank you!`;
  const text = `${shop.name}\nBill ${d.number} · ${d.date} · ${statusText}\n\n${d.items.map(i => `${i.name} x${i.qty}  ${rs(i.total)}`).join('\n')}\n\nTotal ${rs(d.total)}`;
  return { subject: `Your bill ${d.number} from ${shop.name}`, html: layout(shop, `Bill ${d.number}`, body), text, sms };
}

export function lowStockMessage(shop: ShopInfo, items: { name: string; qty: number; reorderLevel: number }[], drafts: { number: string; supplier: string; total: number }[]) {
  const body = `<p style="margin:0 0 12px;font-size:14px">${items.length} item(s) are at or below their reorder point.</p>
${table(['Item', 'In stock', 'Reorder at'], items.slice(0, 40).map(i => [esc(i.name), String(i.qty), String(i.reorderLevel)]))}
${drafts.length ? `<p style="margin:16px 0 8px;font-size:14px"><b>Draft purchase orders made for you</b> — open PharmaDesk → Purchases to approve them:</p>
${table(['Order', 'Supplier', 'Estimated'], drafts.map(d => [esc(d.number), esc(d.supplier), rs(d.total)]), 2)}` : ''}`;
  const sms = `${shop.name}: low stock — ${items.slice(0, 5).map(i => `${i.name} (${i.qty})`).join(', ')}${items.length > 5 ? ` +${items.length - 5} more` : ''}.${drafts.length ? ` ${drafts.length} draft order(s) ready to approve.` : ''}`;
  return { subject: `Low stock: ${items.length} item(s) — ${shop.name}`, html: layout(shop, 'Low stock alert', body), text: sms, sms };
}

export function poMessage(shop: ShopInfo, d: { number: string; date: string; supplier: string; items: { name: string; qty: number; cost: number }[]; total: number; notes?: string }) {
  const body = `<p style="margin:0 0 12px;font-size:14px">Dear ${esc(d.supplier)}, please supply the following items. Purchase order <b>${esc(d.number)}</b> · ${esc(d.date)}</p>
${table(['Item', 'Qty', 'Rate', 'Amount'], d.items.map(i => [esc(i.name), String(i.qty), i.cost ? rs(i.cost) : '—', i.cost ? rs(i.cost * i.qty) : '—']))}
<p style="margin:12px 0 0;font-size:15px;text-align:right"><b>Estimated total ${rs(d.total)}</b></p>
${d.notes ? `<p style="font-size:13px;color:#5B6B69">${esc(d.notes)}</p>` : ''}
<p style="font-size:13px;color:#5B6B69">Please reply to confirm or call ${esc(shop.phone || 'us')}.</p>`;
  const sms = `${shop.name} order ${d.number}: ${d.items.slice(0, 6).map(i => `${i.name} x${i.qty}`).join(', ')}${d.items.length > 6 ? ` +${d.items.length - 6} more` : ''}. Please confirm. ${shop.phone || ''}`.trim();
  const text = `Purchase order ${d.number} (${d.date}) from ${shop.name}\n\n${d.items.map(i => `${i.name} x${i.qty}`).join('\n')}\n\nEstimated total ${rs(d.total)}`;
  return { subject: `Purchase order ${d.number} from ${shop.name}`, html: layout(shop, `Purchase order ${d.number}`, body), text, sms };
}
