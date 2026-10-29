// Applies device operations atomically and serves changes back to devices.
// This is where concurrent overselling is resolved:
//   • A sale that asks for more than its batch has left is automatically moved to
//     the next-earliest-expiring batch (FEFO), and a warning is logged.
//   • If the whole medicine is short: online (strict) sales are refused with
//     OUT_OF_STOCK; offline sales (already handed to the customer) are accepted,
//     recorded as negative "pending intake" stock, and flagged for review.
// © Awais Amin
import type { DB } from './db.ts';
import { getRow, allRows, putRow, upsertLWW, nextRev, tx, SQL_TABLE } from './db.ts';
import { HLC, uuid, OutOfStockError, AppError, isoDate } from '../shared/util.ts';
import { pendingBatchId, isSellable, fefoSort } from '../shared/fefo.ts';
import { can, rowPerm } from '../shared/permissions.ts';
import { SYNC_TABLES, type Op, type OpResult, type Batch, type InvoiceItem, type User, type PullResponse, type PullChange, type Synced, type SyncTable, type AuditEntry } from '../shared/types.ts';

export const serverClock = new HLC('server');

function audit(db: DB, action: string, details: unknown, entity: string | null = null, entityId: string | null = null, userId: string | null = null) {
  const row: AuditEntry = { id: uuid(), at: new Date().toISOString(), userId, deviceId: 'server', action, entity, entityId, details };
  putRow(db, 'audit', row, serverClock.tick());
}

function checkPermission(db: DB, op: Op) {
  const tables = op.rows.map(r => r.tbl);
  const userCount = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
  if (userCount === 0) {
    // Fresh shop: the only thing allowed is creating the first (admin) user.
    if (op.kind === 'upsert' && tables.every(t => t === 'users' || t === 'audit')) return;
    throw new AppError('FORBIDDEN', 'Create the admin user on the server PC first');
  }
  const user = op.userId ? getRow<User>(db, 'users', op.userId) : null;
  if (!user) throw new AppError('FORBIDDEN', 'Unknown user');
  // A sale made offline already happened at the counter — keep it even if the owner
  // disabled that worker in the meantime (it is still in the log under their name).
  const offlineSale = op.kind === 'sale' && !op.strict;
  if (user.active === false && !offlineSale) throw new AppError('FORBIDDEN', 'This user has been disabled');
  // Anyone may change their OWN photo or PIN — but nothing about their role or access.
  const selfOnly = op.kind === 'upsert' && op.rows.every(r => r.tbl === 'audit' || (r.tbl === 'users' && r.row.id === user.id && sameAccess(user, r.row as User)));
  if (!selfOnly && !offlineSale) {
    for (const need of neededPerms(db, op)) {
      if (!can(user, need)) throw new AppError('FORBIDDEN', `${user.name || user.username} is not allowed to do this (needs "${need}")`);
    }
  }
  // The owner account is protected: nobody else can change, disable or delete it,
  // and only the owner can create other admins.
  for (const r of op.rows) {
    // The built-in medicine list is offered only at first setup — it can't be re-imported later.
    if (r.tbl === 'medicines' && (r.row as { source?: string }).source === 'catalog' && !getRow(db, 'medicines', r.row.id)) {
      throw new AppError('FORBIDDEN', 'Built-in medicines can only be added when the shop is first set up');
    }
    if (r.tbl === 'purchaseItems' && !(r.row as { deleted?: boolean }).deleted) {
      const m = getRow<{ deleted?: boolean } & Synced>(db, 'medicines', (r.row as { medicineId?: string }).medicineId || '');
      const inSameOp = op.rows.some(x => x.tbl === 'medicines' && x.row.id === (r.row as { medicineId?: string }).medicineId);
      if ((!m || m.deleted) && !inSameOp) throw new AppError('NOT_IN_INVENTORY', 'Items must be created in Inventory before they can be purchased');
    }
    if (r.tbl !== 'users') continue;
    const target = getRow<User>(db, 'users', r.row.id);
    const incoming = r.row as User;
    if (target?.owner && user.id !== target.id) throw new AppError('FORBIDDEN', 'The owner account can only be changed by the owner');
    if (target?.owner && (incoming.deleted || incoming.active === false || incoming.role !== 'admin' || !incoming.owner)) throw new AppError('FORBIDDEN', 'The owner account cannot be disabled, deleted or demoted');
    if (!target?.owner && incoming.owner) throw new AppError('FORBIDDEN', 'There can only be one owner');
    if (incoming.role === 'admin' && target?.role !== 'admin' && !user.owner) throw new AppError('FORBIDDEN', 'Only the owner can create admins');
  }
}

/** Every permission an operation needs — create, edit and delete are checked separately per row. */
export function neededPerms(db: DB, op: Op): string[] {
  const need = new Set<string>();
  if (op.kind === 'sale') need.add('pos');
  if (op.kind === 'void') need.add('invoices.void');
  if (op.kind === 'stock') {
    if (op.rows.some(r => r.tbl === 'purchases')) need.add('purchases.receive');
    else if (op.deltas.some(d => d.create)) need.add('inventory.add_stock');
    else need.add('inventory.adjust');
  }
  if (op.kind === 'upsert') {
    for (const r of op.rows) {
      if (r.tbl === 'audit') continue;
      if (r.tbl === 'ledger') { need.add((r.row as { partyType?: string }).partyType === 'supplier' ? 'suppliers.payment' : 'patients.payment'); continue; }
      const before = getRow(db, r.tbl, r.row.id);
      if (r.tbl === 'users' && before && onlyLogoutChanged(before as User, r.row as User)) { need.add('users.logout'); continue; }
      const p = rowPerm(r.tbl, before, r.row);
      if (p) need.add(p);
      else if (r.tbl === 'invoices' || r.tbl === 'invoiceItems') need.add('pos');
    }
  }
  return [...need];
}

function onlyLogoutChanged(a: User, b: User) {
  const strip = (u: User) => { const { forceLogoutAt, hlc, updatedAt, ...rest } = u as User & { updatedAt?: string }; void forceLogoutAt; void hlc; void updatedAt; return JSON.stringify(rest, Object.keys(rest).sort()); };
  return strip(a) === strip(b) && a.forceLogoutAt !== b.forceLogoutAt;
}

function sameAccess(a: User, b: User) {
  return a.role === b.role && !!a.owner === !!b.owner && (a.active !== false) === (b.active !== false) && !!a.deleted === !!b.deleted &&
    a.username === b.username && JSON.stringify([...(a.perms || [])].sort()) === JSON.stringify([...(b.perms || [])].sort());
}

function validate(op: Op) {
  if (!op || typeof op.id !== 'string' || !Array.isArray(op.rows) || !Array.isArray(op.deltas)) throw new AppError('INVALID', 'Malformed operation');
  for (const r of op.rows) {
    if (!(SYNC_TABLES as readonly string[]).includes(r.tbl) || !r.row || typeof r.row.id !== 'string') throw new AppError('INVALID', `Bad row for table ${r.tbl}`);
  }
  for (const d of op.deltas) {
    if (typeof d.batchId !== 'string' || !Number.isInteger(d.delta) || typeof d.medicineId !== 'string') throw new AppError('INVALID', 'Bad stock delta');
  }
}

const saveBatch = (db: DB, b: Batch) => putRow(db, 'batches', b, serverClock.tick());

function ensurePendingBatch(db: DB, medicineId: string): Batch {
  const id = pendingBatchId(medicineId);
  return getRow<Batch>(db, 'batches', id) || {
    id, medicineId, batchNo: 'PENDING-INTAKE', expiryDate: '9999-12-31', qty: 0, costPrice: 0, pending: true, receivedAt: new Date().toISOString(),
  };
}

/** Rewrites an invoice item when the server moved its stock to other batches. */
function splitInvoiceItem(db: DB, itemId: string, allocs: { batch: Batch; qty: number }[]) {
  const item = getRow<InvoiceItem>(db, 'invoiceItems', itemId);
  if (!item || allocs.length === 0) return;
  const total = item.qty;
  let usedDisc = 0, usedTax = 0, usedTotal = 0;
  allocs.forEach((a, i) => {
    const last = i === allocs.length - 1;
    const part = (v: number) => Math.round((v * a.qty) / total);
    const discount = last ? item.discount - usedDisc : part(item.discount);
    const tax = last ? item.tax - usedTax : part(item.tax);
    const lineTotal = last ? item.total - usedTotal : part(item.total);
    usedDisc += discount; usedTax += tax; usedTotal += lineTotal;
    const row: InvoiceItem = {
      ...item, id: i === 0 ? item.id : `${item.id}~${i}`, batchId: a.batch.id, batchNo: a.batch.batchNo,
      expiryDate: a.batch.expiryDate, qty: a.qty, costPrice: a.batch.costPrice || item.costPrice, discount, tax, total: lineTotal,
    };
    putRow(db, 'invoiceItems', row, serverClock.tick());
  });
}

export function applyOp(db: DB, op: Op): OpResult {
  if (!op || typeof op !== 'object' || typeof op.id !== 'string' || !op.id) return { id: String((op as Op | null)?.id ?? ''), ok: false, code: 'INVALID', message: 'Malformed operation' };
  const done = db.prepare(`SELECT result FROM ops WHERE id = ?`).get(op?.id) as { result: string } | undefined;
  if (done) return JSON.parse(done.result) as OpResult; // idempotent: a retried op is never applied twice

  let result: OpResult;
  try {
    validate(op);
    checkPermission(db, op);
    result = tx(db, () => {
      const res: OpResult = { id: op.id, ok: true, reallocations: [], conflicts: [] };
      for (const r of op.rows) {
        if (r.tbl === 'users') {
          const cur = getRow<User>(db, 'users', r.row.id);
          const firstUser = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n === 0;
          const incoming = r.row as User;
          if (cur?.owner) {
            // The owner account is locked: nobody can delete, disable or demote it,
            // and only the owner can change its own name or PIN.
            if (op.userId !== cur.id) continue;
            r.row = { ...incoming, owner: true, role: 'admin', active: true, deleted: false } as User;
          } else if (firstUser) {
            r.row = { ...incoming, owner: true, role: 'admin', active: true } as User;
          } else if (incoming.owner) {
            r.row = { ...incoming, owner: false } as User; // only one owner, created at first start
          }
        }
        upsertLWW(db, r.tbl, r.row, serverClock);
      }

      const today = isoDate();
      for (const d of op.deltas) {
        let b = getRow<Batch>(db, 'batches', d.batchId);
        if (!b && d.create) { b = { ...d.create, qty: 0 }; }
        if (!b && d.batchId === pendingBatchId(d.medicineId)) b = ensurePendingBatch(db, d.medicineId);
        if (!b) throw new AppError('INVALID', `Unknown batch ${d.batchId}`);

        if (d.delta >= 0 || b.pending) {          // intake, returns, or pending-intake bookkeeping
          b.qty += d.delta;
          saveBatch(db, b);
          continue;
        }

        let need = -d.delta;
        const allocs: { batch: Batch; qty: number }[] = [];
        const take = Math.min(Math.max(0, b.qty), need);
        if (take > 0) { b.qty -= take; allocs.push({ batch: b, qty: take }); need -= take; }
        saveBatch(db, b);

        if (need > 0) {                            // batch ran out → move to next-earliest expiry (FEFO)
          const others = allRows<Batch>(db, 'batches', `WHERE medicine_id = ?`, d.medicineId)
            .filter(o => o.id !== b!.id && isSellable(o, today)).sort(fefoSort);
          for (const o of others) {
            if (need <= 0) break;
            const t = Math.min(o.qty, need);
            o.qty -= t; need -= t;
            saveBatch(db, o);
            allocs.push({ batch: o, qty: t });
          }
        }
        if (need > 0) {
          if (op.strict) throw new OutOfStockError('Out of stock', { medicineId: d.medicineId, shortBy: need });
          const p = ensurePendingBatch(db, d.medicineId);
          p.qty -= need;
          saveBatch(db, p);
          allocs.push({ batch: p, qty: need });
          res.conflicts!.push({ medicineId: d.medicineId, shortBy: need });
          audit(db, 'stock.conflict', { medicineId: d.medicineId, shortBy: need, opId: op.id, deviceId: op.deviceId,
            message: 'Sold offline on two devices at once — more was sold than in stock. Count the shelf and receive stock.' }, 'medicines', d.medicineId, op.userId);
        }
        const moved = allocs.length !== 1 || allocs[0].batch.id !== d.batchId;
        if (moved && d.itemId) {
          splitInvoiceItem(db, d.itemId, allocs);
          res.reallocations!.push({ itemId: d.itemId, from: d.batchId, to: allocs.map(a => ({ batchId: a.batch.id, qty: a.qty })) });
          audit(db, 'fefo.reallocated', {
            from: b.batchNo, to: allocs.map(a => `${a.batch.batchNo} × ${a.qty}`), opId: op.id,
            message: `Batch ${b.batchNo} had run out; the sale was moved to the next earliest-expiring batch.`,
          }, 'batches', d.batchId, op.userId);
        }
      }
      if (res.conflicts!.length) {
        const inv = op.rows.find(r => r.tbl === 'invoices');
        if (inv) {
          const cur = getRow(db, 'invoices', inv.row.id);
          if (cur) putRow(db, 'invoices', { ...cur, conflict: true } as typeof cur, serverClock.tick());
        }
      }
      db.prepare(`INSERT INTO ops(id, applied_at, device_id, user_id, kind, result) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(op.id, new Date().toISOString(), op.deviceId, op.userId, op.kind, JSON.stringify(res));
      return res;
    });
  } catch (e) {
    const err = e as AppError;
    result = { id: op?.id, ok: false, code: err.code || 'ERROR', message: err.message, ...(err.details ? { conflicts: [err.details as { medicineId: string; shortBy: number }] } : {}) };
    // Rejections are remembered too, so a retried op gets the same answer.
    if (op?.id && err.code !== 'INVALID') {
      db.prepare(`INSERT OR IGNORE INTO ops(id, applied_at, device_id, user_id, kind, result) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(op.id, new Date().toISOString(), op.deviceId ?? null, op.userId ?? null, op.kind ?? null, JSON.stringify(result));
    }
  }
  return result;
}

/** Everything that changed after revision `since`, across all tables, in revision order. */
export function pullChanges(db: DB, since: number, limit = 2000): PullResponse {
  const batch: PullChange[] = [];
  for (const tbl of SYNC_TABLES) {
    const rows = db.prepare(`SELECT id, data, hlc, rev FROM ${SQL_TABLE[tbl]} WHERE rev > ? ORDER BY rev LIMIT ?`).all(since, limit + 1) as
      { id: string; data: string; hlc: string; rev: number }[];
    for (const r of rows) batch.push({ tbl: tbl as SyncTable, id: r.id, data: JSON.parse(r.data), hlc: r.hlc, rev: r.rev });
  }
  batch.sort((a, b) => a.rev - b.rev);
  const changes = batch.slice(0, limit);
  const head = Number((db.prepare(`SELECT value FROM meta WHERE key = 'rev'`).get() as { value: string }).value);
  const rev = changes.length ? changes[changes.length - 1].rev : Math.max(since, changes.length ? 0 : head);
  return { changes, rev, more: batch.length > limit };
}

export { nextRev };
