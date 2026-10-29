// Device database (IndexedDB via Dexie). Every phone/PC keeps a FULL copy of the
// shop's data, so when the server PC is off, every screen still shows everything
// and billing continues. Changes made offline wait in the outbox and sync later.
// © Awais Amin
import Dexie, { type Table } from 'dexie';
import type { Op, Synced, SyncTable, User, Medicine, Batch, Supplier, Patient, Prescription, Invoice, InvoiceItem, Purchase, PurchaseItem, LedgerEntry, AuditEntry, Shop } from '../../shared/types.ts';
import { HLC, uuid } from '../../shared/util.ts';

export interface MetaRow { key: string; value: unknown }
export interface PrintJob { seq?: number; invoiceId: string; status: 'queued' | 'printing' | 'done' | 'failed'; attempts: number; createdAt: string; lastError?: string | null }
export interface SessionEvent { seq?: number; type: 'login' | 'logout'; localId: string; userId: string; at: string; reason?: string; sessionId?: string; sent: 0 | 1 }

export class PharmaDB extends Dexie {
  medicines!: Table<Medicine, string>;
  batches!: Table<Batch, string>;
  suppliers!: Table<Supplier, string>;
  patients!: Table<Patient, string>;
  prescriptions!: Table<Prescription, string>;
  invoices!: Table<Invoice & { rejected?: string }, string>;
  invoiceItems!: Table<InvoiceItem, string>;
  purchases!: Table<Purchase, string>;
  purchaseItems!: Table<PurchaseItem, string>;
  ledger!: Table<LedgerEntry, string>;
  users!: Table<User, string>;
  audit!: Table<AuditEntry, string>;
  shop!: Table<Shop, string>;
  outbox!: Table<Op, number>;
  printJobs!: Table<PrintJob, number>;
  sessionEvents!: Table<SessionEvent, number>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'pharmadesk') {
    super(name);
    this.version(1).stores({
      medicines: 'id, name, generic, barcode, *altBarcodes, hlc',
      batches: 'id, medicineId, [medicineId+expiryDate], expiryDate, hlc',
      suppliers: 'id, name, hlc',
      patients: 'id, name, phone, hlc',
      prescriptions: 'id, patientId, nextDue, hlc',
      invoices: 'id, number, createdAt, cashierId, status, hlc',
      invoiceItems: 'id, invoiceId, medicineId, batchId',
      purchases: 'id, number, supplierId, status, hlc',
      purchaseItems: 'id, purchaseId',
      ledger: 'id, [partyType+partyId], date',
      users: 'id, username, hlc',
      audit: 'id, at, userId, action',
      outbox: '++seq, &id, status',
      printJobs: '++seq, invoiceId, status',
      sessionEvents: '++seq, sent',
      meta: 'key',
    });
    this.version(2).stores({ shop: 'id', medicines: 'id, name, generic, barcode, *altBarcodes, hlc, source' });
  }
  tbl(name: SyncTable) { return this.table(name) as Table<Synced, string>; }
}

export async function getMeta<T>(db: PharmaDB, key: string, fallback: T): Promise<T> {
  const r = await db.meta.get(key);
  return r ? r.value as T : fallback;
}
export const setMeta = (db: PharmaDB, key: string, value: unknown) => db.meta.put({ key, value });

export interface Pairing { serverId: string; serverName: string; token: string; deviceId: string; beaconKey: string; urls: string[] }

/** Shared context for one running app instance. */
export interface Ctx {
  db: PharmaDB;
  hlc: HLC;
  deviceId: string;
  pairing: Pairing | null;
  /** "This device only" mode: the shop runs entirely on this device, no server PC. */
  standalone: boolean;
  user: User | null;
  sessionId: string | null;      // server session (null while offline)
  localSessionId: string | null; // always set while logged in
  online: boolean;
  listeners: Set<(event: string, data?: unknown) => void>;
  fetch: typeof fetch;
}

export async function openCtx(opts: { name?: string; fetch?: typeof fetch } = {}): Promise<Ctx> {
  const db = new PharmaDB(opts.name);
  await db.open();
  const pairing = await getMeta<Pairing | null>(db, 'pairing', null);
  let deviceId = pairing?.deviceId || await getMeta<string | null>(db, 'localDeviceId', null);
  if (!deviceId) { deviceId = uuid(); await setMeta(db, 'localDeviceId', deviceId); }
  const hlc = new HLC(deviceId.slice(0, 8));
  hlc.receive(await getMeta<string | null>(db, 'lastHlc', null));
  return {
    db, hlc, deviceId, pairing, standalone: !pairing && await getMeta<boolean>(db, 'standalone', false), user: null, sessionId: null, localSessionId: null, online: false,
    listeners: new Set(), fetch: opts.fetch || globalThis.fetch.bind(globalThis),
  };
}

export function emit(ctx: Ctx, event: string, data?: unknown) {
  for (const fn of ctx.listeners) { try { fn(event, data); } catch (e) { console.error(e); } }
}
export function stamp(ctx: Ctx) {
  const s = ctx.hlc.tick();
  setMeta(ctx.db, 'lastHlc', s);
  return s;
}

/** Queue an operation in the SAME transaction as the local write (crash-safe). */
export async function enqueue(ctx: Ctx, op: Omit<Op, 'id' | 'deviceId' | 'userId' | 'createdAt' | 'status' | 'attempts'> & { id?: string }) {
  const full: Op = {
    id: op.id || uuid(), deviceId: ctx.deviceId, userId: ctx.user?.id ?? null, createdAt: new Date().toISOString(),
    status: 'pending', attempts: 0, lastError: null, ...op,
  } as Op;
  if (!ctx.standalone) await ctx.db.outbox.add(full); // nothing to sync to in "this device only" mode
  return full;
}

export async function nextNumber(ctx: Ctx, prefix: string) {
  const key = `seq:${prefix}`;
  const n = (await getMeta<number>(ctx.db, key, 0)) + 1;
  await setMeta(ctx.db, key, n);
  return `${prefix}-${ctx.deviceId.slice(0, 4).toUpperCase()}-${String(n).padStart(5, '0')}`;
}
