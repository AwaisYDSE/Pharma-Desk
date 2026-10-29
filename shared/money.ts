// Money is integer paisa (Rs 1 = 100 paisa) so totals never drift.
// Tax rates are basis points (1700 = 17%).

export const toPaisa = (rupees: number | string): number => Math.round(Number(rupees || 0) * 100);
export const toRupees = (paisa: number): number => Number(paisa || 0) / 100;

export const fmt = (paisa: number, currency = 'Rs', locale = 'en-PK'): string => {
  const v = toRupees(paisa);
  return `${currency} ${v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const pctToBp = (pct: number | string): number => Math.round(Number(pct || 0) * 100);
export const bpToPct = (bp: number): number => Number(bp || 0) / 100;

const roundDiv = (num: number, den: number): number => {
  const q = num / den;
  return q >= 0 ? Math.floor(q + 0.5) : -Math.floor(-q + 0.5);
};

export interface LineInput {
  unitPrice: number;
  qty: number;
  discountBp?: number;
  discountFlat?: number;
  taxBp?: number;
}
export interface LineResult { gross: number; discount: number; taxable: number; tax: number; total: number }

/** One line. `inclusive` = shelf price already contains GST (normal for MRP medicines). */
export function lineTotals(l: LineInput, inclusive = false): LineResult {
  const gross = l.unitPrice * l.qty;
  const discount = Math.min(gross, roundDiv(gross * (l.discountBp || 0), 10000) + (l.discountFlat || 0));
  const after = gross - discount;
  const taxBp = l.taxBp || 0;
  let taxable: number, tax: number;
  if (inclusive) {
    taxable = roundDiv(after * 10000, 10000 + taxBp);
    tax = after - taxable;
  } else {
    taxable = after;
    tax = roundDiv(taxable * taxBp, 10000);
  }
  return { gross, discount, taxable, tax, total: taxable + tax };
}

export interface InvoiceTotals extends LineResult { lines: LineResult[] }

/** Whole bill. A bill-level discount is spread over lines by value (remainder on the last line). */
export function invoiceTotals(lines: LineInput[], opts: { billDiscount?: number; inclusive?: boolean } = {}): InvoiceTotals {
  const inclusive = !!opts.inclusive;
  const base = lines.map(l => lineTotals(l, inclusive));
  const pre = base.reduce((s, c) => s + c.gross - c.discount, 0);
  const billDisc = Math.min(Math.max(0, opts.billDiscount || 0), pre);
  let remaining = billDisc;
  const out = base.map((c, i) => {
    const share = i === base.length - 1 ? remaining : (pre ? roundDiv(billDisc * (c.gross - c.discount), pre) : 0);
    remaining -= share;
    return lineTotals({ ...lines[i], discountFlat: (lines[i].discountFlat || 0) + share }, inclusive);
  });
  const sum = (k: keyof LineResult) => out.reduce((s, c) => s + c[k], 0);
  return { lines: out, gross: sum('gross'), discount: sum('discount'), taxable: sum('taxable'), tax: sum('tax'), total: sum('total') };
}
