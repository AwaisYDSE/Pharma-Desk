// Receipt printing with a queue: if the printer is off or unplugged, the job
// waits and retries automatically, and a PDF/HTML copy is always available.
// Supports USB thermal printers (ESC/POS over Web Serial, Chrome/Edge) and the
// normal system print dialog.
import { fmt } from '../../shared/money.ts';
import { escapeHtml } from '../../shared/util.ts';
import type { Invoice, InvoiceItem, Shop } from '../../shared/types.ts';
import { billing, type BillingOptions } from '../../shared/region.ts';
import { emit, type Ctx, type PrintJob } from './db.ts';
import type { Settings } from './settings.ts';

export interface PrinterDriver {
  name: string;
  isReady(): Promise<boolean>;
  print(receipt: ReceiptData): Promise<void>;
}

export interface ReceiptData { invoice: Invoice; items: InvoiceItem[]; settings: Settings; cashier: string; patient?: string | null; bill?: BillingOptions; shop?: Shop | null }

export async function receiptData(ctx: Ctx, invoiceId: string, settings: Settings): Promise<ReceiptData | null> {
  const invoice = await ctx.db.invoices.get(invoiceId);
  if (!invoice) return null;
  const items = await ctx.db.invoiceItems.where('invoiceId').equals(invoiceId).toArray();
  const cashier = (await ctx.db.users.get(invoice.cashierId))?.name || '';
  const patient = invoice.patientId ? (await ctx.db.patients.get(invoice.patientId))?.name : null;
  const shop = await ctx.db.shop.get('shop');
  // Shop details and bill options are the owner's (synced); printer and paper are this device's.
  const s2 = shop ? { ...settings, storeName: shop.name || settings.storeName, address: shop.address ?? settings.address, phone: shop.phone ?? settings.phone, ntn: shop.ntn ?? settings.ntn, strn: shop.strn ?? settings.strn, drugLicense: shop.drugLicense ?? settings.drugLicense, logoDataUrl: shop.logo || settings.logoDataUrl, receiptFooter: shop.receiptFooter === 'Thank you! Medicines are returnable with this receipt within 7 days.' ? settings.receiptFooter : (shop.receiptFooter ?? settings.receiptFooter) } : settings;
  return { invoice, items, settings: s2, cashier, patient, bill: billing(shop?.billing), shop };
}

/** Groups split batch lines back into one line per medicine for the paper receipt. */
function lines(r: ReceiptData) {
  const map = new Map<string, { name: string; generic: string; qty: number; total: number; batches: string[] }>();
  for (const it of r.items) {
    const k = it.medicineId + ':' + it.unitPrice;
    const cur = map.get(k) || { name: it.name || '', generic: (it as { generic?: string }).generic || '', qty: 0, total: 0, batches: [] };
    cur.qty += it.qty; cur.total += it.total;
    if (it.batchNo && !it.batchId.startsWith('pending-')) cur.batches.push(`${it.batchNo} exp ${String(it.expiryDate || '').slice(0, 7)}`);
    map.set(k, cur);
  }
  return [...map.values()];
}

export function receiptHtml(r: ReceiptData): string {
  const b = billing(r.bill), s = r.settings, c = b.currency || s.currency;
  const w = s.receiptWidth === 'A4' ? '190mm' : s.receiptWidth === '58mm' ? '54mm' : '76mm';
  const rows = lines(r).map(l => `<tr><td>${escapeHtml(l.name)}${l.generic && b.showGeneric ? `<div class="b"><i>${escapeHtml(l.generic)}</i></div>` : ''}${b.showBatch ? `<div class="b">${escapeHtml(l.batches.join(', '))}</div>` : ''}</td><td class="n">${l.qty}</td><td class="n">${escapeHtml(fmt(l.total, c))}</td></tr>`).join('');
  const inv = r.invoice;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(inv.number)}</title><style>
  @page{margin:4mm}body{font:12px/1.35 system-ui,sans-serif;width:${w};margin:0 auto;color:#000}
  h1{font-size:15px;margin:0;text-align:center}.c{text-align:center}.b{font-size:10px;color:#444}
  table{width:100%;border-collapse:collapse}td{padding:3px 0;vertical-align:top;border-bottom:1px dashed #bbb}.n{text-align:right;white-space:nowrap;padding-left:6px}
  .t td{border:0;padding:2px 0}.big{font-size:15px;font-weight:700}hr{border:0;border-top:1px dashed #000}
  </style></head><body>
  ${s.logoDataUrl && b.showLogo ? `<div class="c"><img src="${escapeHtml(s.logoDataUrl)}" style="max-height:48px"></div>` : ''}
  <h1>${escapeHtml(s.storeName)}</h1>${r.shop?.branchName ? `<div class="c">${escapeHtml(r.shop.branchName)}</div>` : ''}
  <div class="c">${escapeHtml(s.address)}${s.phone ? `<br>Tel ${escapeHtml(s.phone)}` : ''}${s.drugLicense ? `<br>DL ${escapeHtml(s.drugLicense)}` : ''}${s.ntn && b.showNtn ? ` · NTN ${escapeHtml(s.ntn)}` : ''}${s.strn && b.showNtn ? ` · STRN ${escapeHtml(s.strn)}` : ''}</div>${b.headerNote ? `<p class="c">${escapeHtml(b.headerNote).replace(/\n/g, '<br>')}</p>` : ''}
  <hr><div>Bill: <b>${escapeHtml(inv.number)}</b><br>${new Date(inv.createdAt).toLocaleString('en-PK')}${b.showCashier ? `<br>Served by: ${escapeHtml(r.cashier)}` : ''}${r.patient && b.showPatient ? `<br>Customer: ${escapeHtml(r.patient)}` : ''}${inv.fbrNumber ? `<br>FBR invoice: <b>${escapeHtml(inv.fbrNumber)}</b>` : ''}</div><hr>
  <table><tr><td><b>Item</b></td><td class="n"><b>Qty</b></td><td class="n"><b>Amount</b></td></tr>${rows}</table>
  <table class="t"><tr><td>Subtotal</td><td class="n">${fmt(inv.gross, c)}</td></tr>
  ${inv.discount ? `<tr><td>Discount</td><td class="n">- ${fmt(inv.discount, c)}</td></tr>` : ''}
  ${inv.tax ? `<tr><td>${escapeHtml(b.taxLabel)}${s.pricesIncludeGst ? ' (incl.)' : ''}</td><td class="n">${fmt(inv.tax, c)}</td></tr>` : ''}
  <tr class="big"><td>TOTAL</td><td class="n">${fmt(inv.total, c)}</td></tr>
  <tr><td>Paid (${escapeHtml(inv.accountName || inv.payMethod)}${inv.payRef ? ' · ' + escapeHtml(inv.payRef) : ''})</td><td class="n">${fmt(inv.paid, c)}</td></tr>
  ${inv.change ? `<tr><td>Change</td><td class="n">${fmt(inv.change, c)}</td></tr>` : ''}
  ${inv.status === 'credit' ? `<tr><td>Balance due</td><td class="n">${fmt(inv.total - inv.paid, c)}</td></tr>` : ''}</table>
  ${inv.refunded ? `<table class="t"><tr><td>Returned</td><td class="n">- ${fmt(inv.refunded, c)}</td></tr></table>` : ''}
  ${inv.status === 'void' ? '<p class="c big">*** CANCELLED ***</p>' : ''}
  ${s.receiptFooter ? `<hr><p class="c">${escapeHtml(s.receiptFooter).replace(/\n/g, '<br>')}</p>` : '<hr>'}<p class="c b">PharmaDesk · by Awais Amin</p></body></html>`;
}

/* ---------------- ESC/POS (USB thermal) ---------------- */
export function escPos(r: ReceiptData): Uint8Array {
  const width = r.settings.receiptWidth === '58mm' ? 32 : 42;
  const enc = new TextEncoder();
  const out: number[] = [];
  const push = (...b: number[]) => out.push(...b);
  const text = (s: string) => out.push(...enc.encode(s.normalize('NFKD').replace(/[^\x20-\x7E\n]/g, '')));
  const pad = (l: string, rr: string) => { const sp = Math.max(1, width - l.length - rr.length); return (l + ' '.repeat(sp) + rr).slice(0, Math.max(width, l.length + rr.length + 1)) + '\n'; };
  const c = billing(r.bill).currency || r.settings.currency, inv = r.invoice;
  push(0x1b, 0x40, 0x1b, 0x61, 1, 0x1b, 0x45, 1); text(r.settings.storeName + '\n'); push(0x1b, 0x45, 0);
  if (r.settings.address) text(r.settings.address + '\n');
  if (r.settings.phone) text('Tel ' + r.settings.phone + '\n');
  push(0x1b, 0x61, 0); text('-'.repeat(width) + '\n');
  text(`Bill ${inv.number}\n${new Date(inv.createdAt).toLocaleString('en-PK')}\n`);
  text('-'.repeat(width) + '\n');
  for (const l of lines(r)) { text(l.name.slice(0, width) + '\n'); text(pad(`  x${l.qty}`, fmt(l.total, c))); }
  text('-'.repeat(width) + '\n');
  if (inv.discount) text(pad('Discount', '-' + fmt(inv.discount, c)));
  push(0x1b, 0x45, 1); text(pad('TOTAL', fmt(inv.total, c))); push(0x1b, 0x45, 0);
  text(pad('Paid', fmt(inv.paid, c)));
  if (inv.change) text(pad('Change', fmt(inv.change, c)));
  push(0x1b, 0x61, 1); text('\n' + (r.settings.receiptFooter || '') + (r.invoice.fbrNumber ? '\nFBR ' + r.invoice.fbrNumber : '') + '\n\n\n'); push(0x1d, 0x56, 0x41, 0x03);
  return new Uint8Array(out);
}

interface SerialPortLike { open(o: { baudRate: number }): Promise<void>; close(): Promise<void>; writable: WritableStream<Uint8Array> | null }

export class SerialPrinter implements PrinterDriver {
  name = 'USB thermal printer';
  port: SerialPortLike | null = null;
  async choose() {
    const serial = (navigator as unknown as { serial?: { requestPort(): Promise<SerialPortLike> } }).serial;
    if (!serial) throw new Error('This browser cannot talk to USB printers. Use Chrome or Edge on Windows.');
    this.port = await serial.requestPort();
  }
  async reconnect() {
    const serial = (navigator as unknown as { serial?: { getPorts(): Promise<SerialPortLike[]> } }).serial;
    if (serial && !this.port) this.port = (await serial.getPorts())[0] || null;
  }
  async isReady() { await this.reconnect(); return !!this.port; }
  async print(r: ReceiptData) {
    await this.reconnect();
    if (!this.port) throw new Error('Printer not connected');
    try { await this.port.open({ baudRate: 9600 }); } catch { /* already open */ }
    const w = this.port.writable!.getWriter();
    try { await w.write(escPos(r)); } finally { w.releaseLock(); }
  }
}

export class BrowserPrinter implements PrinterDriver {
  name = 'System printer';
  async isReady() { return typeof window !== 'undefined'; }
  async print(r: ReceiptData) {
    // Printed from the main window: installed apps (Chrome/Edge app windows) can refuse to print
    // from a hidden frame ("this app does not support print preview").
    const html = receiptHtml(r);
    const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
    const body = (html.match(/<body>([\s\S]*)<\/body>/) || [])[1] || html;
    const copies = Math.min(5, Math.max(1, Number(billing(r.bill).copies) || 1));
    document.getElementById('pd-print')?.remove();
    const area = document.createElement('div');
    area.id = 'pd-print'; area.className = 'print-area';
    area.innerHTML = `<style>@media screen{#pd-print{display:none}}@media print{${style.replace(/\bbody\b/g, '#pd-print')} #pd-print .copy+.copy{page-break-before:always}}</style>` + Array.from({ length: copies }, () => `<div class="copy">${body}</div>`).join('');
    document.body.appendChild(area);
    await Promise.all([...area.querySelectorAll('img')].map(i => i.complete ? null : new Promise(res => { i.onload = i.onerror = res; })));
    await new Promise<void>(res => {
      const done = () => { window.removeEventListener('afterprint', done); res(); };
      window.addEventListener('afterprint', done);
      window.print();
      setTimeout(done, 60_000); // some browsers never fire afterprint
    });
    area.remove();
  }
}

/** Opens the receipt as a page the user can save as PDF / share on WhatsApp. */
export function downloadReceipt(r: ReceiptData) {
  const blob = new Blob([receiptHtml(r)], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${r.invoice.number}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/**
 * Print queue. Jobs are stored in IndexedDB, so they even survive closing the
 * app. Failed jobs retry every few seconds (backing off) until the printer is back.
 */
export class PrintQueue {
  ctx: Ctx;
  driver: PrinterDriver;
  getSettings: () => Promise<Settings>;
  timer: ReturnType<typeof setTimeout> | null = null;
  busy = false;
  maxAttempts = 50;
  baseDelay = 3000;

  constructor(ctx: Ctx, driver: PrinterDriver, getSettings: () => Promise<Settings>) {
    this.ctx = ctx;
    this.driver = driver;
    this.getSettings = getSettings;
  }

  async enqueue(invoiceId: string) {
    await this.ctx.db.printJobs.add({ invoiceId, status: 'queued', attempts: 0, createdAt: new Date().toISOString(), lastError: null });
    return this.process();
  }

  async pending(): Promise<PrintJob[]> {
    return this.ctx.db.printJobs.where('status').anyOf('queued', 'printing').toArray();
  }

  /** Try every queued job once. Returns how many printed. */
  async process(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    let printed = 0, failed = false;
    try {
      const jobs = await this.ctx.db.printJobs.where('status').anyOf('queued', 'printing').sortBy('seq');
      for (const job of jobs) {
        const settings = await this.getSettings();
        const data = await receiptData(this.ctx, job.invoiceId, settings);
        if (!data) { await this.ctx.db.printJobs.update(job.seq!, { status: 'failed', lastError: 'Invoice not found' }); continue; }
        try {
          if (!(await this.driver.isReady())) throw new Error('Printer is offline');
          await this.ctx.db.printJobs.update(job.seq!, { status: 'printing' });
          await this.driver.print(data);
          await this.ctx.db.printJobs.update(job.seq!, { status: 'done', lastError: null });
          printed++;
          emit(this.ctx, 'printed', job.invoiceId);
        } catch (e) {
          failed = true;
          const attempts = (job.attempts || 0) + 1;
          await this.ctx.db.printJobs.update(job.seq!, { status: attempts >= this.maxAttempts ? 'failed' : 'queued', attempts, lastError: (e as Error).message });
          emit(this.ctx, 'print-error', { invoiceId: job.invoiceId, error: (e as Error).message });
          break; // printer is down — keep order, retry later
        }
      }
    } finally { this.busy = false; }
    if (failed) this.schedule();
    return printed;
  }

  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.process(); }, this.baseDelay);
  }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
