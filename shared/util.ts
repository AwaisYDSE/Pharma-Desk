// PharmaDesk — shared helpers (used by the shop server and every device)
// © Awais Amin · MIT License

export const uuid = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/** Local calendar date as YYYY-MM-DD (expiry dates are stored this way). */
export const isoDate = (d: Date = new Date()): string => {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};

export const addDays = (dateStr: string, days: number): string => {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return isoDate(d);
};

export const daysBetween = (fromStr: string, toStr: string): number =>
  Math.round((new Date(toStr + 'T00:00:00').getTime() - new Date(fromStr + 'T00:00:00').getTime()) / 86400000);

/**
 * Hybrid Logical Clock — every write gets a monotonic stamp that stays ordered
 * even when device clocks disagree. Format "<ms 13>:<counter 4>:<deviceId>".
 * Comparing two stamps as plain strings gives Last-Write-Wins order.
 */
export class HLC {
  deviceId: string;
  now: () => number;
  ms = 0;
  counter = 0;
  constructor(deviceId: string, now: () => number = () => Date.now()) {
    this.deviceId = deviceId;
    this.now = now;
  }
  tick(): string {
    const t = this.now();
    if (t > this.ms) { this.ms = t; this.counter = 0; } else { this.counter++; }
    return this.format();
  }
  receive(stamp?: string | null): void {
    if (!stamp) return;
    const [ms, c] = stamp.split(':');
    const rms = Number(ms), rc = Number(c);
    if (!Number.isFinite(rms)) return;
    const t = this.now();
    const max = Math.max(t, this.ms, rms);
    if (max === this.ms && max === rms) this.counter = Math.max(this.counter, rc) + 1;
    else if (max === this.ms) this.counter++;
    else if (max === rms) this.counter = rc + 1;
    else this.counter = 0;
    this.ms = max;
  }
  format(): string {
    return `${String(this.ms).padStart(13, '0')}:${String(this.counter).padStart(4, '0')}:${this.deviceId}`;
  }
}

export const escapeHtml = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class AppError extends Error {
  code: string;
  details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
export class OutOfStockError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) { super('OUT_OF_STOCK', message, details); }
}
export class NetworkError extends AppError {
  constructor(message = 'Server is not reachable') { super('NETWORK', message); }
}
export class PermissionError extends AppError {
  constructor(message = 'You do not have permission for this action', details?: Record<string, unknown>) { super('FORBIDDEN', message, details); }
}
export class OverrideRequiredError extends AppError {
  constructor(permission: string, message: string, details?: Record<string, unknown>) { super('OVERRIDE_REQUIRED', message, { permission, ...details }); }
}

/** The exact message the spec asks for when a device talks to the wrong shop. */
export const PIN_MISMATCH_MESSAGE = "Server PIN Mismatch - Ensure you are scanning your own shop's server QR code.";
