// Country / region presets: currency sign, tax name and the usual tax rate. The owner can still
// change each one. © Awais Amin
export interface Region { code: string; name: string; currency: string; taxLabel: string; taxPct: number; fbr?: boolean }
export const REGIONS: Region[] = [
  { code: 'pk', name: 'Pakistan', currency: 'Rs', taxLabel: 'GST', taxPct: 0, fbr: true },
  { code: 'ae', name: 'United Arab Emirates', currency: 'AED', taxLabel: 'VAT', taxPct: 5 },
  { code: 'sa', name: 'Saudi Arabia', currency: 'SAR', taxLabel: 'VAT', taxPct: 15 },
  { code: 'in', name: 'India', currency: '₹', taxLabel: 'GST', taxPct: 12 },
  { code: 'bd', name: 'Bangladesh', currency: 'Tk', taxLabel: 'VAT', taxPct: 0 },
  { code: 'af', name: 'Afghanistan', currency: 'AFN', taxLabel: 'Tax', taxPct: 0 },
  { code: 'other', name: 'Other', currency: '$', taxLabel: 'Tax', taxPct: 0 },
];
export const regionOf = (code?: string | null) => REGIONS.find(r => r.code === code) || REGIONS[0];

/** Owner's choices for bills (synced to every device through the shop record). */
export interface BillingOptions {
  region?: string; currency?: string; taxLabel?: string;
  /** Bill numbers: prefix + number. e.g. prefix "INV-", start 1011, digits 0 → INV-1011 */
  invoicePrefix?: string; invoiceStart?: number; invoiceDigits?: number;
  /** Add a short code per device (needed so two counters never make the same number while offline). */
  deviceCode?: boolean;
  headerNote?: string;
  showLogo?: boolean; showNtn?: boolean; showCashier?: boolean; showPatient?: boolean; showBatch?: boolean; showGeneric?: boolean;
  copies?: number;
}
export const DEFAULT_BILLING: Required<Omit<BillingOptions, 'headerNote'>> & { headerNote: string } = {
  region: 'pk', currency: 'Rs', taxLabel: 'GST', invoicePrefix: 'INV-', invoiceStart: 1, invoiceDigits: 5, deviceCode: true, headerNote: '',
  showLogo: true, showNtn: true, showCashier: true, showPatient: true, showBatch: true, showGeneric: true, copies: 1,
};
export const billing = (b?: BillingOptions | null) => ({ ...DEFAULT_BILLING, ...(b || {}) });

/** Formats bill number n with the owner's style. */
export function formatBillNumber(b: BillingOptions | null | undefined, n: number, deviceCode = ''): string {
  const o = billing(b);
  const num = o.invoiceDigits > 0 ? String(n).padStart(o.invoiceDigits, '0') : String(n);
  return `${o.invoicePrefix || ''}${o.deviceCode && deviceCode ? deviceCode + '-' : ''}${num}`;
}
