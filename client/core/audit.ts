import { uuid } from '../../shared/util.ts';
import { stamp, type Ctx } from './db.ts';
import type { AuditEntry } from '../../shared/types.ts';

/** Append-only activity log entry (call inside the transaction of the change it records). */
export async function logAuditRow(ctx: Ctx, action: string, opts: { entity?: string | null; entityId?: string | null; details?: unknown; userId?: string | null } = {}): Promise<AuditEntry> {
  const row: AuditEntry = {
    id: uuid(), at: new Date().toISOString(), userId: opts.userId ?? ctx.user?.id ?? null, userName: ctx.user?.name ?? null,
    deviceId: ctx.deviceId, action, entity: opts.entity ?? null, entityId: opts.entityId ?? null, details: opts.details ?? null, hlc: stamp(ctx),
  };
  await ctx.db.audit.put(row);
  return row;
}
