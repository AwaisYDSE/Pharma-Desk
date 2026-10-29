// Backup / restore of everything on this device (one JSON file).
// Essential in "this device only" mode; also useful as an extra copy on a server-paired device.
import type { Ctx } from './db.ts';
import { SYNC_TABLES } from '../../shared/types.ts';
import { can } from '../../shared/permissions.ts';
import { AppError, PermissionError } from '../../shared/util.ts';
import { logAuditRow } from './audit.ts';

export const BACKUP_FORMAT = 'pharmadesk-backup';

export async function exportBackup(ctx: Ctx): Promise<Blob> {
  if (!can(ctx.user, 'data.backup')) throw new PermissionError('You are not allowed to export backups');
  const tables: Record<string, unknown[]> = {};
  for (const t of SYNC_TABLES) tables[t] = await ctx.db.tbl(t).toArray();
  await logAuditRow(ctx, 'data.backup', { details: { rows: Object.values(tables).reduce((s, r) => s + r.length, 0) } });
  const data = { format: BACKUP_FORMAT, version: 1, createdAt: new Date().toISOString(), standalone: ctx.standalone, tables };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

/** Replaces everything on this device with the backup. Only in "this device only" mode (a paired device restores from its server). */
export async function importBackup(ctx: Ctx, text: string) {
  if (!can(ctx.user, 'data.backup')) throw new PermissionError('You are not allowed to restore backups');
  if (!ctx.standalone) throw new AppError('PAIRED', 'This device gets its data from the shop server — restore the backup on the server PC instead');
  let data: { format?: string; tables?: Record<string, unknown[]> };
  try { data = JSON.parse(text); } catch { throw new AppError('INVALID', 'This file is not a PharmaDesk backup'); }
  if (data.format !== BACKUP_FORMAT || !data.tables) throw new AppError('INVALID', 'This file is not a PharmaDesk backup');
  if (!(data.tables.users || []).some(u => (u as { owner?: boolean }).owner)) throw new AppError('INVALID', 'Backup has no owner account — refusing to restore');
  const tables = SYNC_TABLES.map(t => ctx.db.tbl(t));
  await ctx.db.transaction('rw', tables, async () => {
    for (const t of SYNC_TABLES) {
      const rows = data.tables![t];
      if (!Array.isArray(rows)) continue;
      await ctx.db.tbl(t).clear();
      await ctx.db.tbl(t).bulkPut(rows as never[]);
    }
  });
}
