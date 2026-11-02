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
export function formatBillNumber(b: BillingOptions | null | undefined, n: number, deviceCode = '', branchCode = ''): string {
  const o = billing(b);
  const num = o.invoiceDigits > 0 ? String(n).padStart(o.invoiceDigits, '0') : String(n);
  return `${o.invoicePrefix || ''}${branchCode ? branchCode + '-' : ''}${o.deviceCode && deviceCode ? deviceCode + '-' : ''}${num}`;
}

/** Banks and mobile wallets offered per region. The owner can also type any other name. */
export const PROVIDERS: Record<string, { banks: string[]; wallets: string[] }> = {
  pk: { banks: ['HBL', 'UBL', 'MCB', 'Allied Bank', 'Meezan Bank', 'Bank Alfalah', 'National Bank of Pakistan', 'Askari Bank', 'Faysal Bank', 'Bank of Punjab', 'Habib Metro', 'JS Bank', 'Standard Chartered'], wallets: ['JazzCash', 'Easypaisa', 'SadaPay', 'NayaPay', 'Upaisa'] },
  ae: { banks: ['Emirates NBD', 'First Abu Dhabi Bank', 'ADCB', 'Dubai Islamic Bank', 'Mashreq', 'RAKBANK', 'ADIB', 'Sharjah Islamic Bank'], wallets: ['e& money', 'Careem Pay', 'Apple Pay', 'Google Pay'] },
  sa: { banks: ['SNB', 'Al Rajhi Bank', 'Riyad Bank', 'SAB', 'Alinma Bank', 'Banque Saudi Fransi', 'Arab National Bank'], wallets: ['stc pay', 'urpay', 'Apple Pay', 'mada Pay'] },
  in: { banks: ['State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank', 'Punjab National Bank', 'Bank of Baroda'], wallets: ['UPI', 'PhonePe', 'Google Pay', 'Paytm', 'BHIM'] },
  bd: { banks: ['Dutch-Bangla Bank', 'BRAC Bank', 'Islami Bank Bangladesh', 'Sonali Bank', 'City Bank', 'Eastern Bank'], wallets: ['bKash', 'Nagad', 'Rocket', 'Upay'] },
  af: { banks: ['Afghanistan International Bank', 'Azizi Bank', 'Afghan United Bank', 'Ghazanfar Bank', 'Da Afghanistan Bank'], wallets: ['M-Paisa', 'HesabPay', 'Etisalat MyMoney'] },
  other: { banks: [], wallets: [] },
};
export const providersFor = (region?: string | null) => PROVIDERS[region || 'pk'] || PROVIDERS.other;
