import { getMeta, setMeta, type PharmaDB } from './db.ts';

export interface Settings {
  storeName: string; address: string; phone: string; ntn: string; strn: string; drugLicense: string;
  logoDataUrl: string; currency: string; defaultGstPct: number; pricesIncludeGst: boolean;
  expiryWindows: number[]; blockExpired: boolean; lowStockDefault: number;
  receiptWidth: '58mm' | '80mm' | 'A4'; receiptFooter: string;
  language: string; theme: 'system' | 'light' | 'dark'; printer: 'browser' | 'serial'; autoPrint: boolean;
  interactionCheck: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  storeName: 'My Medical Store', address: '', phone: '', ntn: '', strn: '', drugLicense: '', logoDataUrl: '',
  currency: 'Rs', defaultGstPct: 0, pricesIncludeGst: true,
  expiryWindows: [30, 60, 90], blockExpired: true, lowStockDefault: 10,
  receiptWidth: '80mm', receiptFooter: 'Thank you! Medicines are returnable with this receipt within 7 days.',
  language: 'en', theme: 'system', printer: 'browser', autoPrint: true, interactionCheck: true,
};

export async function loadSettings(db: PharmaDB): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await getMeta<Partial<Settings>>(db, 'settings', {})) };
}
export async function saveSettings(db: PharmaDB, patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings(db)), ...patch };
  await setMeta(db, 'settings', next);
  return next;
}
