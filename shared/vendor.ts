// Vendor settings for selling PharmaDesk. ALL OFF by default, so a plain build behaves
// exactly as before: no licence key needed, no phone-home, no remote access.
// To sell it: run `node license/make-key.mjs init`, paste the printed publicKey below,
// set requireLicense true, set vendorApi to your dashboard URL, then rebuild.
export const VENDOR = {
  // Your name/brand shown on the licence screen.
  name: 'Awais Amin',
  // Public half of your signing key (from `make-key.mjs init`). Empty = licensing off.
  publicKey: '',
  // When true, a shop cannot finish setup without a valid key you issued.
  requireLicense: false,
  // Your dashboard API base, e.g. 'https://pharmadesk-admin.YOURNAME.workers.dev'.
  // Empty = no phone-home, no remote suspend, no remote support. Offline licences still work.
  vendorApi: '',
  // How often (minutes) a licensed shop checks in when it has internet.
  checkinMinutes: 180,
} as const;

export function licensingOn(): boolean {
  return VENDOR.requireLicense && VENDOR.publicKey.length > 0;
}
