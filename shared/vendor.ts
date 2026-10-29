// Vendor settings for selling PharmaDesk. ALL OFF by default, so a plain build behaves
// exactly as before: no licence key needed, no phone-home, no remote access.
// To sell it: open the PharmaDesk Vendor app, create your signing key, paste its public key below,
// set requireLicense true, set vendorApi to your dashboard URL, then rebuild.
export const VENDOR: { name: string; publicKey: string; requireLicense: boolean; vendorApi: string; appUrl: string; checkinMinutes: number } = {
  // Your name/brand shown on the licence screen.
  name: 'Awais Amin',
  // Public half of your signing key (Vendor app → Setup). Empty = licensing off.
  publicKey: '',
  // When true, a shop cannot finish setup without a valid key you issued.
  requireLicense: false,
  // Your dashboard API base, e.g. 'https://pharmadesk-admin.YOURNAME.workers.dev'.
  // Empty = no phone-home, no remote suspend, no remote support. Offline licences still work.
  vendorApi: '',
  // The public web app (a fixed address, so phones keep their data). Phones open it from the QR.
  appUrl: 'https://awaisydse.github.io/Pharma-Desk/',
  // How often (minutes) a licensed shop checks in when it has internet.
  checkinMinutes: 360,
};

export function licensingOn(): boolean {
  return VENDOR.requireLicense && VENDOR.publicKey.length > 0;
}
