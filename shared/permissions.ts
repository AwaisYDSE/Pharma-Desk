// Granular permissions. Every module can be switched on/off per user, and inside
// each module every single action (view, create, edit, delete, …) has its own switch.
// The same rules are enforced on the shop server, not only hidden in the screens.
import type { User } from './types.ts';

export interface PermAction { key: string; label: string }
export interface PermGroup { key: string; label: string; actions: PermAction[] }

/** Module key = permission to open that module. Actions are switched one by one. */
export const PERMISSION_GROUPS: PermGroup[] = [
  { key: 'dashboard', label: 'Dashboard', actions: [] },
  { key: 'pos', label: 'Point of Sale', actions: [
    { key: 'pos.discount', label: 'Give discounts' },
    { key: 'pos.credit_sale', label: 'Credit (udhaar) sales' },
    { key: 'pos.override_fefo', label: 'Sell a newer batch instead of nearest-expiry' },
    { key: 'pos.negative_stock', label: 'Sell items not yet in stock' },
  ] },
  { key: 'invoices', label: 'Invoices', actions: [
    { key: 'invoices.view_all', label: "See other users' bills" },
    { key: 'invoices.reprint', label: 'Reprint / download bills' },
    { key: 'invoices.void', label: 'Void / return bills' },
  ] },
  { key: 'inventory', label: 'Inventory (items)', actions: [
    { key: 'inventory.create', label: 'Create new items' },
    { key: 'inventory.edit', label: 'Modify items (name, formula, price, photo)' },
    { key: 'inventory.delete', label: 'Delete items' },
    { key: 'inventory.add_stock', label: 'Add opening stock without a purchase' },
    { key: 'inventory.adjust', label: 'Adjust stock quantities' },
  ] },
  { key: 'purchases', label: 'Purchases', actions: [
    { key: 'purchases.create', label: 'Create purchases' },
    { key: 'purchases.edit', label: 'Modify purchases (before receiving)' },
    { key: 'purchases.delete', label: 'Cancel purchases' },
    { key: 'purchases.receive', label: 'Receive stock into inventory' },
  ] },
  { key: 'suppliers', label: 'Suppliers', actions: [
    { key: 'suppliers.create', label: 'Create suppliers' },
    { key: 'suppliers.edit', label: 'Modify suppliers' },
    { key: 'suppliers.delete', label: 'Delete suppliers' },
    { key: 'suppliers.payment', label: 'Record payments to suppliers' },
  ] },
  { key: 'patients', label: 'Customers / patients', actions: [
    { key: 'patients.create', label: 'Create customers' },
    { key: 'patients.edit', label: 'Modify customers' },
    { key: 'patients.delete', label: 'Delete customers' },
    { key: 'patients.payment', label: 'Receive credit (udhaar) payments' },
    { key: 'patients.rx', label: 'Manage repeat prescriptions' },
  ] },
  { key: 'alerts', label: 'Alerts', actions: [] },
  { key: 'reports', label: 'Reports', actions: [
    { key: 'reports.profit', label: 'See cost prices & profit' },
    { key: 'reports.export', label: 'Export reports (CSV)' },
  ] },
  { key: 'ai', label: 'AI assistant', actions: [] },
  { key: 'users', label: 'Users & Access (see activity)', actions: [
    { key: 'users.create', label: 'Create users' },
    { key: 'users.edit', label: 'Modify users & their permissions' },
    { key: 'users.delete', label: 'Delete users' },
    { key: 'users.logout', label: 'Log users out / remove devices' },
  ] },
  { key: 'settings', label: 'Settings', actions: [
    { key: 'settings.shop', label: 'Change shop details & logo' },
    { key: 'settings.ai', label: 'Change AI (Gemini) key' },
    { key: 'data.backup', label: 'Export / restore backups' },
  ] },
];

export const MODULES = PERMISSION_GROUPS.map(g => ({ key: g.key, label: g.label }));
export const ACTIONS = PERMISSION_GROUPS.flatMap(g => g.actions);
export const ALL_PERMS: string[] = PERMISSION_GROUPS.flatMap(g => [g.key, ...g.actions.map(a => a.key)]);

const pick = (...keys: string[]) => keys;
export const ROLE_PRESETS: Record<string, { label: string; perms: string[] }> = {
  admin: { label: 'Admin (owner)', perms: ALL_PERMS },
  pharmacist: { label: 'Pharmacist / Supervisor', perms: pick(
    'dashboard', 'pos', 'invoices', 'inventory', 'purchases', 'suppliers', 'patients', 'alerts', 'reports', 'ai',
    'pos.discount', 'pos.credit_sale', 'pos.override_fefo', 'pos.negative_stock',
    'invoices.view_all', 'invoices.reprint', 'invoices.void',
    'inventory.create', 'inventory.edit', 'inventory.add_stock', 'inventory.adjust',
    'purchases.create', 'purchases.edit', 'purchases.receive',
    'suppliers.create', 'suppliers.edit', 'patients.create', 'patients.edit', 'patients.payment', 'patients.rx') },
  cashier: { label: 'Cashier', perms: pick('pos', 'invoices', 'invoices.reprint', 'patients', 'patients.create', 'alerts', 'ai') },
  storekeeper: { label: 'Store keeper', perms: pick('inventory', 'purchases', 'suppliers', 'alerts',
    'inventory.create', 'inventory.edit', 'purchases.create', 'purchases.edit', 'purchases.receive', 'suppliers.create', 'suppliers.edit') },
  viewer: { label: 'Viewer (read only)', perms: pick('dashboard', 'reports') },
};

export function can(user: Pick<User, 'role' | 'perms' | 'active'> | null | undefined, perm: string): boolean {
  if (!user || user.active === false) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.perms) && user.perms.includes(perm);
}

/** Which module a synced table belongs to, for create / edit / delete checks. */
export const TABLE_PERM: Record<string, string> = {
  medicines: 'inventory', suppliers: 'suppliers', patients: 'patients', purchases: 'purchases', purchaseItems: 'purchases', users: 'users',
};

/** create / edit / delete permission for saving a row, given what was there before. */
export function rowPerm(tbl: string, before: { deleted?: boolean } | null | undefined, after: { deleted?: boolean }): string | null {
  if (tbl === 'prescriptions') return 'patients.rx';
  if (tbl === 'shop') return 'settings.shop';
  if (tbl === 'batches') return 'inventory.edit';
  const mod = TABLE_PERM[tbl];
  if (!mod) return null;
  if (!before) return `${mod}.create`;
  if (after.deleted && !before.deleted) return mod === 'purchases' ? 'purchases.delete' : `${mod}.delete`;
  return `${mod}.edit`;
}
