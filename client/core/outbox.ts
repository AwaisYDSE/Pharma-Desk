// Every change that must reach the shop server is queued here INSIDE the same
// IndexedDB transaction as the change itself — so a crash can never leave a sale
// saved on the device but missing from the sync queue (or the other way round).
import { uuid } from '../../shared/util.ts';
import { logAuditRow } from './audit.ts';
import type { Ctx } from './db.ts';
import type { Op, OpRow, Delta } from '../../shared/types.ts';

export function makeOp(ctx: Ctx, kind: Op['kind'], rows: OpRow[], deltas: Delta[] = [], strict = false): Op {
  return {
    id: uuid(), kind, strict, deviceId: ctx.deviceId, userId: ctx.user?.id ?? null,
    createdAt: new Date().toISOString(), rows, deltas, status: 'pending', attempts: 0, lastError: null,
  };
}

/** Queue an op (call inside a transaction that includes db.outbox). */
export async function enqueue(ctx: Ctx, op: Op) {
  if (ctx.standalone) return op; // "this device only": nothing to sync
  await ctx.db.outbox.add(op);
  return op;
}

export const pendingCount = (ctx: Ctx) => ctx.db.outbox.where('status').equals('pending').count();

/** Audit + sync in one: records an action and queues it for the server. */
export async function auditAndQueue(ctx: Ctx, action: string, opts: { entity?: string; entityId?: string; details?: unknown } = {}) {
  const row = await logAuditRow(ctx, action, opts);
  await enqueue(ctx, makeOp(ctx, 'upsert', [{ tbl: 'audit', row }]));
  return row;
}
