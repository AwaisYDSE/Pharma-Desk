// Data models shared by the shop server (SQLite) and every device (IndexedDB replica).
// Money = integer paisa · tax = basis points · dates = YYYY-MM-DD · hlc = Last-Write-Wins stamp.

export interface Synced { id: string; hlc?: string; deleted?: boolean; updatedAt?: string }

export interface Medicine extends Synced {
  name: string; generic: string; strength?: string; form?: string; manufacturer?: string; category?: string;
  barcode?: string; altBarcodes?: string[]; rackNo?: string;
  salePrice: number; gstBp?: number; reorderLevel?: number; reorderQty?: number; rxRequired?: boolean;
  /** Supplier used for automatic purchase orders (else the last supplier it was bought from). */
  defaultSupplierId?: string | null;
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
/** paid · credit = unpaid (credit) · partial_refund / refunded = some / all items returned · void = cancelled. */
export type InvoiceStatus = 'paid' | 'credit' | 'partial_refund' | 'refunded' | 'void';
export interface Invoice extends Synced {
  number: string; patientId?: string | null; cashierId: string; createdAt: string; status: InvoiceStatus;
  gross: number; discount: number; tax: number; total: number; paid: number; change: number;
  payMethod: 'cash' | 'card' | 'bank' | 'wallet' | 'credit'; deviceId: string;
  /** Which of the owner's bank or wallet accounts took the money, and its reference number. */
  accountId?: string | null; accountName?: string | null; payRef?: string | null; conflict?: boolean; note?: string;
  /** FBR (Pakistan) invoice number once the bill was reported. */
  fbrNumber?: string | null; fbrError?: string | null;
  /** Total money given back for returned items (paisa). */
  refunded?: number;
  /** Status before any return: 'paid' or 'credit'. */
  baseStatus?: 'paid' | 'credit';
}
export interface InvoiceItem extends Synced {
  invoiceId: string; medicineId: string; batchId: string; qty: number; unitPrice: number; costPrice: number;
  discount: number; taxBp: number; tax: number; total: number; name?: string; generic?: string; batchNo?: string; expiryDate?: string;
}
export interface Supplier extends Synced { name: string; phone?: string; email?: string; address?: string; ntn?: string; notes?: string }
export interface Patient extends Synced {
  name: string; phone?: string; email?: string; cnic?: string; age?: number; gender?: string; doctorName?: string; doctorPhone?: string;
  allergies?: string; history?: string; notes?: string;
}
export interface Prescription extends Synced {
  patientId: string; medicineId: string; doctorName?: string; dose?: string; qty: number; everyDays: number; nextDue: string; active: boolean;
}
/**
 * Purchase order flow:  draft → pending_approval → sent → arrived → received (= restocked)
 * 'ordered' is the older name for 'sent'. 'received' means the stock is in Inventory and the
 * supplier bill is in the accounts (it is the last step, shown as "Restocked").
 */
export type PurchaseStatus = 'draft' | 'pending_approval' | 'sent' | 'ordered' | 'arrived' | 'received' | 'cancelled';
export interface Purchase extends Synced {
  number: string; supplierId: string; date: string; status: PurchaseStatus;
  total: number; paid: number; notes?: string; receivedAt?: string;
  /** Made by the low-stock watchdog. */
  auto?: boolean;
  submittedBy?: string | null; approvedBy?: string | null; sentAt?: string | null; arrivedAt?: string | null;
}
export interface PurchaseItem extends Synced {
  purchaseId: string; medicineId: string; qty: number; freeQty?: number; costPrice: number; salePrice?: number | null;
  batchNo: string; mfgDate?: string | null; expiryDate: string;
}
/** Money going out that is not a supplier bill: rent, salaries, electricity… */
export interface Expense extends Synced {
  date: string; category: string; amount: number; payMethod: 'cash' | 'card' | 'bank' | 'wallet';
  accountId?: string | null; accountName?: string | null;
  note?: string; paidTo?: string; userId?: string | null;
  /** Tax paid inside this expense (paisa), if any. */
  tax?: number;
}
/** Items returned from a bill (a partial or full refund). Stock goes back to the same batches. */
export interface Refund extends Synced {
  invoiceId: string; number: string; date: string; createdAt: string; userId: string | null; approvedBy?: string | null;
  reason: string; method: 'cash' | 'card' | 'credit';
  accountId?: string | null; accountName?: string | null;
  items: { itemId: string; medicineId: string; batchId: string; qty: number; amount: number; tax: number; cost: number; name?: string }[];
  total: number; tax: number;
}
/** End of day: cash counted in the drawer against what the cash book says. */
export interface CashClosing extends Synced { date: string; expected: number; counted: number; difference: number; note?: string; userId?: string | null; userName?: string | null; at: string }
export interface LedgerEntry extends Synced {
  partyType: 'supplier' | 'patient'; partyId: string; date: string; debit: number; credit: number; ref: string; note?: string;
  /** Made at another branch (customers shared): counts in the balance, not in this branch's cash. */
  foreign?: boolean; originBranch?: string;
  /** How a payment moved. Older entries have none and count as cash. */
  method?: 'cash' | 'bank' | 'wallet';
  accountId?: string | null; accountName?: string | null;
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
/** A bank or mobile wallet account the shop takes money in. */
export interface PayAccount { id: string; type: 'bank' | 'wallet'; provider: string; title: string; number: string; active: boolean; opening?: number }
/** Money moved between the shop's own accounts, such as cash deposited in the bank. */
export interface MoneyMove extends Synced { date: string; from: string; to: string; fromName: string; toName: string; amount: number; note?: string; userName?: string | null; at: string }
export interface Shop extends Synced {
  name: string; logo?: string | null; address?: string; phone?: string; ntn?: string; strn?: string; drugLicense?: string;
  receiptFooter?: string; catalogChoice?: 'builtin' | 'own';
  /** The owner switched on support access for the vendor — shown on every device. */
  supportAccess?: boolean;
  /** Set by the server when the plan is paused or has ended: billing is off on every device. */
  planLock?: { status: string; message?: string | null; vendor: string } | null;
  /** Owner's bill options: number style, what prints, region / currency / tax name. */
  billing?: import('./region.ts').BillingOptions;
  /** Branch of a pharmacy chain (optional). */
  branchName?: string; branchCode?: string;
  /** The owner's choice: this pharmacy has several branches. Off = the Branches screen does not appear. */
  branchesOn?: boolean;
  /** Optional: money the business had before it started using PharmaDesk (paisa). */
  openingCash?: number; openingBank?: number;
  /** The owner's bank and wallet accounts. Only these appear at checkout. */
  payAccounts?: PayAccount[];
  /** Set by the server when the licence ends within 7 days. */
  planWarn?: { daysLeft: number; vendor: string } | null;
  /** FBR reporting is on (Pakistan only) — devices wait briefly for the FBR number before printing. */
  fbrOn?: boolean;
}
export interface AuditEntry extends Synced {
  at: string; userId: string | null; userName?: string | null; deviceId?: string; action: string;
  entity?: string | null; entityId?: string | null; details?: unknown;
}

/** All tables that sync between the server and devices. */
export const SYNC_TABLES = [
  'medicines', 'batches', 'suppliers', 'patients', 'prescriptions', 'invoices', 'invoiceItems',
  'purchases', 'purchaseItems', 'ledger', 'users', 'audit', 'shop', 'expenses', 'refunds', 'closings', 'moneyMoves',
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
  kind: 'upsert' | 'sale' | 'stock' | 'void' | 'refund';
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
