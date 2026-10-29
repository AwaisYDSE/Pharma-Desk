// The shipped build has licensing ON. Most tests check shop features, so they run with it
// OFF; the licence and vendor tests switch it on themselves.
import { VENDOR } from '../shared/vendor.ts';
export const SHIPPED = { ...VENDOR };
Object.assign(VENDOR, { requireLicense: false, vendorApi: '' });
