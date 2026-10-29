// Cross-module navigation: any screen can open a record in another module
// (an item, a purchase, a supplier, a customer, a bill) or start an action there
// (sell this item, order this item, refill for this customer).
export type Intent =
  | { open: 'medicine'; id: string }
  | { open: 'purchase'; id: string }
  | { open: 'supplier'; id: string }
  | { open: 'patient'; id: string }
  | { open: 'invoice'; id: string }
  | { newPurchase: { medicineId?: string; qty?: number; supplierId?: string } }
  | { sell: { medicineId?: string; qty?: number; patientId?: string } }
  | { newMedicine: { name?: string } };

const pending = new Map<string, Intent>();

export function navigate(route: string, intent?: Intent) {
  if (intent) pending.set(route, intent);
  window.dispatchEvent(new CustomEvent('pd-nav', { detail: route }));
}

/** Called by a screen when it opens: returns (and clears) what it was asked to show. */
export function takeIntent(route: string): Intent | undefined {
  const i = pending.get(route);
  pending.delete(route);
  return i;
}
