// Purchase orders: the status flow, who may move an order to the next step, and the low-stock
// planner that writes draft orders automatically. Used by the server (watchdog) and devices.
// © Awais Amin
import type { Purchase, PurchaseStatus, Medicine, Batch, PurchaseItem, Supplier } from './types.ts';

/** Shown to people. 'received' is the last step — stock is in Inventory ("Restocked"). */
export const PO_STEPS: { key: PurchaseStatus; label: string }[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'pending_approval', label: 'Waiting for approval' },
  { key: 'sent', label: 'Sent to supplier' },
  { key: 'arrived', label: 'Received (checking)' },
  { key: 'received', label: 'Restocked' },
];

/** 'ordered' (older versions) is the same step as 'sent'. */
export const normStatus = (s: PurchaseStatus): PurchaseStatus => s === 'ordered' ? 'sent' : s;
export const isOpen = (p: Pick<Purchase, 'status' | 'deleted'>) => !p.deleted && !['received', 'cancelled'].includes(p.status);
export const stepIndex = (s: PurchaseStatus) => PO_STEPS.findIndex(x => x.key === normStatus(s));
export const statusLabel = (s: PurchaseStatus) => s === 'cancelled' ? 'Cancelled' : PO_STEPS[stepIndex(s)]?.label || s;

/** Allowed moves and the permission each needs. Restocking is done by receivePurchase. */
export const TRANSITIONS: Record<string, { to: PurchaseStatus; perm: string; label: string }[]> = {
  draft: [{ to: 'pending_approval', perm: 'purchases.edit', label: 'Send for approval' }, { to: 'sent', perm: 'purchases.approve', label: 'Approve & send to supplier' }],
  pending_approval: [{ to: 'sent', perm: 'purchases.approve', label: 'Approve & send to supplier' }, { to: 'draft', perm: 'purchases.approve', label: 'Send back to draft' }],
  sent: [{ to: 'arrived', perm: 'purchases.receive', label: 'Mark as received' }],
  arrived: [],
};

export function canMove(from: PurchaseStatus, to: PurchaseStatus): boolean {
  if (to === 'cancelled') return isOpen({ status: from });
  if (to === 'received') return ['draft', 'pending_approval', 'sent', 'arrived'].includes(normStatus(from));
  return (TRANSITIONS[normStatus(from)] || []).some(t => t.to === to);
}

export interface ReorderLine { medicineId: string; name: string; stock: number; reorderLevel: number; qty: number; costPrice: number; salePrice: number | null }
export interface ReorderPlan { supplierId: string | null; lines: ReorderLine[]; total: number }

/**
 * Items at or below their reorder point that are not already on an open order, grouped by supplier
 * (the item's default supplier, else the one it was last bought from).
 * Quantity: the item's reorder quantity, else enough to reach twice the reorder point.
 */
export function planReorders(input: { medicines: Medicine[]; batches: Batch[]; purchases: Purchase[]; purchaseItems: PurchaseItem[]; suppliers?: Supplier[] }): ReorderPlan[] {
  const stock = new Map<string, number>();
  for (const b of input.batches) if (!b.deleted) stock.set(b.medicineId, (stock.get(b.medicineId) || 0) + (b.qty || 0));
  const openIds = new Set(input.purchases.filter(isOpen).map(p => p.id));
  const onOrder = new Set(input.purchaseItems.filter(i => !i.deleted && openIds.has(i.purchaseId)).map(i => i.medicineId));
  const poById = new Map(input.purchases.map(p => [p.id, p]));
  const supplierOk = new Set((input.suppliers || []).filter(s => !s.deleted).map(s => s.id));
  // Last supplier + last cost price per medicine, from received purchases (newest first).
  const last = new Map<string, { supplierId: string; cost: number; sale: number | null }>();
  const recv = input.purchaseItems.filter(i => !i.deleted && poById.get(i.purchaseId)?.status === 'received')
    .sort((a, b) => String(poById.get(b.purchaseId)!.receivedAt || poById.get(b.purchaseId)!.date).localeCompare(String(poById.get(a.purchaseId)!.receivedAt || poById.get(a.purchaseId)!.date)));
  for (const i of recv) if (!last.has(i.medicineId)) last.set(i.medicineId, { supplierId: poById.get(i.purchaseId)!.supplierId, cost: i.costPrice, sale: i.salePrice ?? null });
  const lastBatchCost = new Map<string, number>();
  for (const b of input.batches) if (!b.pending && b.costPrice && !lastBatchCost.has(b.medicineId)) lastBatchCost.set(b.medicineId, b.costPrice);

  const groups = new Map<string, ReorderPlan>();
  for (const m of input.medicines) {
    if (m.deleted) continue;
    const level = m.reorderLevel ?? 10;
    if (level <= 0) continue;
    const have = stock.get(m.id) || 0;
    if (have > level || onOrder.has(m.id)) continue;
    const qty = m.reorderQty && m.reorderQty > 0 ? m.reorderQty : Math.max(1, level * 2 - have);
    const prev = last.get(m.id);
    let sup = m.defaultSupplierId || prev?.supplierId || null;
    if (sup && input.suppliers && !supplierOk.has(sup)) sup = null;
    const key = sup || '';
    const g = groups.get(key) || { supplierId: sup, lines: [], total: 0 };
    const cost = prev?.cost ?? lastBatchCost.get(m.id) ?? 0;
    g.lines.push({ medicineId: m.id, name: m.name, stock: have, reorderLevel: level, qty, costPrice: cost, salePrice: prev?.sale ?? (m.salePrice || null) });
    g.total += cost * qty;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => (a.supplierId ? 0 : 1) - (b.supplierId ? 0 : 1));
}
