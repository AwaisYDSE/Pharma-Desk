// Financial years on a device: which year is open, loading it, and its balances brought forward.
// © Awais Amin
import type { Ctx } from './db.ts';
import { emit, getMeta, setMeta } from './db.ts';
import { isoDate, AppError } from '../../shared/util.ts';
import { yearOf, YEAR_TABLES, type YearWindow, type YearCarry } from '../../shared/years.ts';
import type { LedgerEntry, Shop } from '../../shared/types.ts';
import { addDays } from '../../shared/util.ts';

export const yearsOn = (shop: Shop | null | undefined, ctx: Ctx) => !!shop?.years?.on && !ctx.standalone;

/** The year this device should hold: null when the owner has the option off. */
export async function wantedWindow(ctx: Ctx): Promise<YearWindow | null> {
  const shop = await ctx.db.shop.get('shop');
  if (!yearsOn(shop, ctx)) return null;
  const chosen = await getMeta<string | null>(ctx.db, 'yearView', null);
  return yearOf(chosen || isoDate(), shop!.years!.startMonth);
}

/** Empties a year's records before another year is loaded. Only ever called with nothing waiting to be sent. */
async function clearYear(ctx: Ctx) {
  const tables = YEAR_TABLES.map(t => ctx.db.table(t));
  await ctx.db.transaction('rw', [...tables, ctx.db.meta], async () => {
    for (const t of tables) await t.clear();
    await setMeta(ctx.db, 'rev', 0);
    await setMeta(ctx.db, 'carry', null);
  });
}

/**
 * Puts the device on the wanted year. Returns the window to ask the server for and whether it changed.
 * With changes still waiting to be sent it stays where it is, so nothing unsent can be lost.
 */
export async function applyWindow(ctx: Ctx): Promise<{ window: YearWindow | null; changed: boolean }> {
  const want = await wantedWindow(ctx);
  const key = want ? `${want.from}|${want.to}` : '';
  const have = await getMeta<string>(ctx.db, 'yearWindow', '');
  if (key === have) return { window: want, changed: false };
  const waiting = await ctx.db.outbox.where('status').equals('pending').count();
  if (waiting) return { window: have ? { from: have.split('|')[0], to: have.split('|')[1], label: '' } : null, changed: false };
  await clearYear(ctx);
  await setMeta(ctx.db, 'yearWindow', key);
  return { window: want, changed: true };
}

/** Saves the balances brought forward. They live only on this device and are never sent to the server. */
export async function saveCarry(ctx: Ctx, from: string, carry: YearCarry) {
  const day = addDays(from, -1);
  const rows: LedgerEntry[] = carry.parties.map(p => ({ id: `carry:${p.partyType}:${p.partyId}`, partyType: p.partyType, partyId: p.partyId, date: day, ref: 'OPENING', note: 'Balance brought forward', debit: Math.max(p.net, 0), credit: Math.max(-p.net, 0) }));
  await ctx.db.transaction('rw', [ctx.db.ledger, ctx.db.meta], async () => {
    await ctx.db.ledger.where('id').startsWith('carry:').delete();
    await ctx.db.ledger.bulkPut(rows);
    await setMeta(ctx.db, 'carry', { accounts: carry.accounts, money: carry.money });
  });
  emit(ctx, 'data-changed', { tbl: 'ledger' });
}

export const carryOf = (ctx: Ctx) => getMeta<Pick<YearCarry, 'accounts' | 'money'> | null>(ctx.db, 'carry', null);

/** Opens another year. Older years are for looking only. Passing null goes back to the current year. */
export async function chooseYear(ctx: Ctx, day: string | null) {
  await setMeta(ctx.db, 'yearView', day);
  ctx.olderYear = !!day;
  ctx.yearView = day;
}

export const OLDER_YEAR = 'You are looking at an older year. Switch to the current year to make changes.';
export function assertCurrentYear(ctx: Ctx) { if (ctx.olderYear) throw new AppError('OLDER_YEAR', OLDER_YEAR); }
