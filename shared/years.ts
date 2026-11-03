// Financial years: the owner can choose to work one year at a time. The server PC keeps every year;
// devices keep only the year they have open, with balances brought forward from the years before it.
// © Awais Amin
import { dayOf } from './accounting.ts';

export interface YearWindow { from: string; to: string; label: string }
export interface YearCarry {
  parties: { partyType: 'patient' | 'supplier'; partyId: string; net: number }[];
  accounts: { code: string; name: string; net: number }[];
  /** Money before this year: cash, bank, wallet, acc:<id>, and loose:bank or loose:wallet for money with no named account. */
  money: Record<string, number>;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The financial year a day falls in. startMonth is 1 for January, 7 for July. */
export function yearOf(day: string, startMonth = 1): YearWindow {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  const start = m >= startMonth ? y : y - 1;
  const from = `${start}-${pad(startMonth)}-01`;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1, endYear = startMonth === 1 ? start : start + 1;
  const last = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return { from, to: `${endYear}-${pad(endMonth)}-${pad(last)}`, label: startMonth === 1 ? String(start) : `${start}-${String(start + 1).slice(2)}` };
}

/** Every year from the first record to today, newest first. */
export function yearsBetween(firstDay: string, today: string, startMonth = 1): YearWindow[] {
  const out: YearWindow[] = [];
  let y = yearOf(today, startMonth);
  const first = yearOf(firstDay && firstDay < today ? firstDay : today, startMonth);
  for (let guard = 0; guard < 200; guard++) {
    out.push(y);
    if (y.from <= first.from) break;
    y = yearOf(`${Number(y.from.slice(0, 4)) - 1}${y.from.slice(4)}`, startMonth);
  }
  return out;
}

/** Records that belong to a year. Medicines, stock, suppliers, customers, users and settings are always on every device. */
export const YEAR_TABLES = ['invoices', 'invoiceItems', 'refunds', 'purchases', 'purchaseItems', 'ledger', 'expenses', 'closings', 'moneyMoves', 'attachments', 'audit'] as const;

/** The day of a record, or null when it belongs to every year. Lines and pictures follow their document. */
export function dayOfRecord(tbl: string, row: Record<string, unknown>, parent: (tbl: string, id: string) => Record<string, unknown> | null): string | null {
  const s = (k: string) => row[k] as string | undefined;
  switch (tbl) {
    case 'invoices': return dayOf(s('createdAt'));
    case 'refunds': return dayOf(s('date') || s('createdAt'));
    case 'ledger': case 'expenses': case 'closings': case 'moneyMoves': return s('date') || null;
    case 'audit': return dayOf(s('at'));
    case 'purchases': // an order still waiting for stock stays open in every year
      if (!row.deleted && !['received', 'cancelled'].includes(s('status') || '')) return null;
      return dayOf(s('receivedAt') || s('date'));
    case 'invoiceItems': { const p = parent('invoices', s('invoiceId') || ''); return p ? dayOfRecord('invoices', p, parent) : null; }
    case 'purchaseItems': { const p = parent('purchases', s('purchaseId') || ''); return p ? dayOfRecord('purchases', p, parent) : null; }
    case 'attachments': { const t = s('docType') === 'expense' ? 'expenses' : 'purchases'; const p = parent(t, s('docId') || ''); return p ? dayOfRecord(t, p, parent) : null; }
    default: return null;
  }
}
