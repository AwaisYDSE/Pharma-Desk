// Data models shared by the shop server (SQLite) and every device (IndexedDB replica).
// Money = integer paisa · tax = basis points · dates = YYYY-MM-DD · hlc = Last-Write-Wins stamp.

export interface Synced { id: string; hlc?: string; deleted?: boolean; updatedAt?: string }

export interface Medicine extends Synced {
  name: string; generic: string; strength?: string; form?: string; manufacturer?: string; category?: string;
  barcode?: string; altBarcodes?: string[]; rackNo?: string;
  salePrice: number; gstBp?: number; reorderLevel?: number; reorderQty?: number; rxRequired?: boolean;
  /** What it is used for (from the built-in Pakistan catalog, or written by the shop). */
  description?: string;
  /** 'catalog' = came from the built-in list at first setup; 'own' = added by the shop. */
  source?: 'catalog' | 'own';
  /** Optional photo of the pack, taken by the shop (JPEG data URL, ~320px). */
  photo?: string | null;
}
export interface Batch extends Synced {
  medicineId: string; batchNo: string; mfgDate?: string | null; expiryDate: string; qty: number;
  costPrice: number; salePrice?: number | null; supplierId?: string | null; purchaseId?: string | null;
  receivedAt?: string; pending?: boolean;
}
export type InvoiceStatus = 'paid' | 'credit' | 'void';
export interface Invoice extends Synced {
  number: string; patientId?: string | null; cashierId: string; createdAt: string; status: InvoiceStatus;
  gross: number; discount: number; tax: number; total: number; paid: number; change: number;
  payMethod: 'cash' | 'card' | 'wallet' | 'credit'; deviceId: string; conflict?: boolean; note?: string;
}
export interface InvoiceItem extends Synced {
  invoiceId: string; medicineId: string; batchId: string; qty: number; unitPrice: number; costPrice: number;
  discount: number; taxBp: number; tax: number; total: number; name?: string; generic?: string; batchNo?: string; expiryDate?: string;
}
export interface Supplier extends Synced { name: string; phone?: string; email?: string; address?: string; ntn?: string; notes?: string }
export interface Patient extends Synced {
  name: string; phone?: string; cnic?: string; age?: number; gender?: string; doctorName?: string; doctorPhone?: string;
  allergies?: string; history?: string; notes?: string;
}
export interface Prescription extends Synced {
  patientId: string; medicineId: string; doctorName?: string; dose?: string; qty: number; everyDays: number; nextDue: string; active: boolean;
}
export interface Purchase extends Synced {
  number: string; supplierId: string; date: string; status: 'draft' | 'ordered' | 'received' | 'cancelled';
  total: number; paid: number; notes?: string; receivedAt?: string;
}
export interface PurchaseItem extends Synced {
  purchaseId: string; medicineId: string; qty: number; freeQty?: number; costPrice: number; salePrice?: number | null;
  batchNo: string; mfgDate?: string | null; expiryDate: string;
}
export interface LedgerEntry extends Synced {
  partyType: 'supplier' | 'patient'; partyId: string; date: string; debit: number; credit: number; ref: string; note?: string;
}
export interface User extends Synced {
  username: string; name: string; email?: string; role: string; perms: string[]; active: boolean;
  pinHash?: string; pinSalt?: string;
  /** The owner = the admin created on first start. Cannot be deleted, disabled or demoted. */
  owner?: boolean;
  /** Set by the owner to sign this user out of every device immediately. */
  forceLogoutAt?: string | null;
  createdAt?: string;
  /** Small profile photo (JPEG data URL, ~160px). */
  photo?: string | null;
}
/** One row (id "shop"): name, logo and details printed on receipts — the same on every device. */
export interface Shop extends Synced {
  name: string; logo?: string | null; address?: string; phone?: string; ntn?: string; strn?: string; drugLicense?: string;
  receiptFooter?: string; catalogChoice?: 'builtin' | 'own';
}
export interface AuditEntry extends Synced {
  at: string; userId: string | null; userName?: string | null; deviceId?: string; action: string;
  entity?: string | null; entityId?: string | null; details?: unknown;
}

/** All tables that sync between the server and devices. */
export const SYNC_TABLES = [
  'medicines', 'batches', 'suppliers', 'patients', 'prescriptions', 'invoices', 'invoiceItems',
  'purchases', 'purchaseItems', 'ledger', 'users', 'audit', 'shop',
] as const;
export type SyncTable = typeof SYNC_TABLES[number];

/* ---------------- sync protocol ---------------- */

export interface Delta {
  batchId: string;
  medicineId: string;
  delta: number;
  /** Batch row to create if the server doesn't have it yet (stock intake). */
  create?: Batch;
  /** For sales: which invoice item this deduction belongs to (lets the server re-allocate). */
  itemId?: string;
}
export interface OpRow { tbl: SyncTable; row: Synced }
export interface Op {
  id: string;
  kind: 'upsert' | 'sale' | 'stock' | 'void';
  /** Strict = made while online: the server refuses it if stock is short.
   *  Not strict = made offline: the sale already happened, so the server accepts it and flags a conflict. */
  strict: boolean;
  deviceId: string;
  userId: string | null;
  createdAt: string;
  rows: OpRow[];
  deltas: Delta[];
  status?: 'pending' | 'done' | 'error';
  attempts?: number;
  lastError?: string | null;
  seq?: number;
}
export interface OpResult {
  id: string;
  ok: boolean;
  code?: string;
  message?: string;
  reallocations?: { itemId: string; from: string; to: { batchId: string; qty: number }[] }[];
  conflicts?: { medicineId: string; shortBy: number }[];
}
export interface PullChange { tbl: SyncTable; id: string; data: Synced; hlc: string; rev: number }
export interface PullResponse { changes: PullChange[]; rev: number; more: boolean }
