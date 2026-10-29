import type { Batch } from './types.ts';
import { isoDate } from './util.ts';

export const pendingBatchId = (medicineId: string) => `pending-${medicineId}`;

export const isSellable = (b: Batch, today: string) =>
  !b.pending && !b.deleted && b.qty > 0 && (!b.expiryDate || b.expiryDate > today);

/** FEFO order: soonest expiry first; same expiry → received first (FIFO). */
export const fefoSort = (a: Batch, b: Batch) =>
  (a.expiryDate || '9999').localeCompare(b.expiryDate || '9999') ||
  String(a.receivedAt || '').localeCompare(String(b.receivedAt || ''));

export interface Allocation { batch: Batch; qty: number }

/**
 * First Expiry, First Out. Takes from the batch that expires soonest and spills
 * into the next one when it runs out. Expired batches are never picked.
 */
export function allocateFEFO(batches: Batch[], qty: number, today: string = isoDate(), exclude: Set<string> = new Set()) {
  const sellable = batches.filter(b => isSellable(b, today) && !exclude.has(b.id)).sort(fefoSort);
  const allocations: Allocation[] = [];
  let left = qty;
  for (const b of sellable) {
    if (left <= 0) break;
    const take = Math.min(b.qty, left);
    allocations.push({ batch: b, qty: take });
    left -= take;
  }
  return { allocations, shortfall: Math.max(0, left), fefoFirst: sellable[0] || null };
}
