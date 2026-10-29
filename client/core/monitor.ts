// Expiry & low-stock monitor. Runs at start, every 15 minutes, and after every
// stock change; turns results into alerts and reorder suggestions.
import { isoDate, daysBetween, addDays } from '../../shared/util.ts';
import type { Batch, Medicine, Prescription } from '../../shared/types.ts';
import type { Ctx } from './db.ts';
import { loadSettings } from './settings.ts';

export type AlertKind = 'expired' | 'expiring' | 'out' | 'low' | 'pending' | 'refill' | 'conflict';
export interface Alert {
  id: string; kind: AlertKind; level: 'critical' | 'warning' | 'info'; title: string; detail: string;
  medicineId?: string; batchId?: string; patientId?: string; days?: number; qty?: number; suggestQty?: number;
}

export async function scanAlerts(ctx: Ctx, today = isoDate()): Promise<Alert[]> {
  const db = ctx.db;
  const s = await loadSettings(db);
  const windows = [...s.expiryWindows].sort((a, b) => a - b);
  const maxWindow = windows[windows.length - 1] || 90;
  const meds = new Map((await db.medicines.toArray()).filter(m => !m.deleted).map(m => [m.id, m]));
  const batches = (await db.batches.toArray()).filter(b => !b.deleted);
  const alerts: Alert[] = [];
  const stock = new Map<string, number>();

  for (const b of batches) {
    stock.set(b.medicineId, (stock.get(b.medicineId) || 0) + b.qty);
    const m = meds.get(b.medicineId);
    if (!m) continue;
    if (b.pending && b.qty < 0) {
      alerts.push({ id: `pending-${b.id}`, kind: 'pending', level: 'warning', title: `${m.name}: ${-b.qty} sold before stock entry`, detail: 'Receive this stock so the count is correct', medicineId: m.id, qty: -b.qty });
      continue;
    }
    if (b.pending || b.qty <= 0) continue;
    const days = daysBetween(today, b.expiryDate);
    if (days <= 0) alerts.push({ id: `exp-${b.id}`, kind: 'expired', level: 'critical', title: `${m.name} batch ${b.batchNo} has EXPIRED`, detail: `${b.qty} units — remove from shelf`, medicineId: m.id, batchId: b.id, days, qty: b.qty });
    else if (days <= maxWindow) {
      const w = windows.find(x => days <= x) || maxWindow;
      alerts.push({ id: `soon-${b.id}`, kind: 'expiring', level: w <= windows[0] ? 'critical' : 'warning', title: `${m.name} batch ${b.batchNo} expires in ${days} days`, detail: `${b.qty} units · sell first (within ${w} days)`, medicineId: m.id, batchId: b.id, days, qty: b.qty });
    }
  }

  // Reorder suggestion = enough for 30 days at the last 30 days' pace, at least the reorder qty.
  const since = addDays(today, -30);
  const recent = new Set((await db.invoices.where('createdAt').aboveOrEqual(since).toArray()).filter(i => i.status !== 'void').map(i => i.id));
  const sold = new Map<string, number>();
  await db.invoiceItems.each(it => { if (recent.has(it.invoiceId)) sold.set(it.medicineId, (sold.get(it.medicineId) || 0) + it.qty); });

  for (const m of meds.values()) {
    const qty = Math.max(0, stock.get(m.id) || 0);
    const level = m.reorderLevel ?? s.lowStockDefault;
    if (qty > level) continue;
    if (!stock.has(m.id) && !sold.get(m.id)) continue; // never stocked
    const perDay = (sold.get(m.id) || 0) / 30;
    const suggestQty = Math.max(m.reorderQty || 0, Math.ceil(perDay * 30 - qty), level * 2 - qty);
    alerts.push({ id: `stock-${m.id}`, kind: qty === 0 ? 'out' : 'low', level: qty === 0 ? 'critical' : 'warning',
      title: qty === 0 ? `${m.name} is OUT of stock` : `${m.name} is low (${qty} left)`, detail: `Suggested reorder: ${suggestQty}`, medicineId: m.id, qty, suggestQty });
  }

  const refills = (await db.prescriptions.toArray()).filter((p: Prescription) => p.active && !p.deleted && p.nextDue <= addDays(today, 3));
  for (const p of refills) {
    const pt = await db.patients.get(p.patientId);
    const m = meds.get(p.medicineId);
    alerts.push({ id: `rx-${p.id}`, kind: 'refill', level: 'info', title: `Refill due: ${pt?.name || 'patient'} — ${m?.name || 'medicine'}`, detail: `Due ${p.nextDue}${pt?.phone ? ` · ${pt.phone}` : ''}`, patientId: p.patientId, medicineId: p.medicineId });
  }

  const conflicts = await db.invoices.filter(i => !!i.conflict && i.status !== 'void').toArray();
  for (const c of conflicts) alerts.push({ id: `conf-${c.id}`, kind: 'conflict', level: 'warning', title: `Bill ${c.number}: sold more than stock (offline)`, detail: 'Two devices sold the same items offline. Count the shelf.' });

  const rank = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.level] - rank[b.level] || (a.days ?? 999) - (b.days ?? 999));
}

/** FEFO hint for the POS toast ("Batch #402 expires in 12 days — sell this first!"). */
export function fefoHint(batch: Batch | undefined, medicine: Medicine, today = isoDate()): string | null {
  if (!batch || batch.pending) return null;
  const d = daysBetween(today, batch.expiryDate);
  return d <= 30 ? `${medicine.name}: batch ${batch.batchNo} expires in ${d} days — sold first automatically.` : null;
}

export class ExpiryMonitor {
  ctx: Ctx;
  timer: ReturnType<typeof setInterval> | null = null;
  last: Alert[] = [];
  onChange: (alerts: Alert[]) => void;
  constructor(ctx: Ctx, onChange: (alerts: Alert[]) => void) {
    this.ctx = ctx;
    this.onChange = onChange;
  }
  async run() {
    try { this.last = await scanAlerts(this.ctx); this.onChange(this.last); } catch (e) { console.error('monitor', e); }
    return this.last;
  }
  start(everyMs = 15 * 60_000) {
    void this.run();
    this.timer = setInterval(() => void this.run(), everyMs);
    const l = (e: string) => { if (e === 'stock-changed' || e === 'sale' || e === 'data-changed') void this.run(); };
    this.ctx.listeners.add(l);
  }
  stop() { if (this.timer) clearInterval(this.timer); }
}
