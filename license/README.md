# Selling PharmaDesk — licence keys

Use the **PharmaDesk Vendor app** — no terminal needed. It works in any browser on Mac, Windows or iPhone.

1. **Setup & backup → Create my signing key.** Copy the backup text and keep it somewhere safe (it can make keys — never share it).
2. Send the **public key** to your developer. They put it in `shared/vendor.ts` with `requireLicense: true` and publish a new build. From then on a pharmacy needs a key from you.
3. **Make a key:** type the pharmacy name, choose how long it is valid, tap **Make key**, and send the key to the pharmacy. To renew, make a new key — the shop pastes it under Settings.

## See and pause the pharmacies

The Vendor app's **Shops** tab lists every pharmacy using your keys: when it was last online, bills and sales for 7 days, expiry date, and support details when the owner has turned on support access. **Pause billing** stops billing at that shop at its next check-in (it can still view its data); **Resume** turns it back on.

This needs a free Cloudflare Worker — the setup steps are in the Vendor app (Setup & backup) and at the top of `vendor/worker.js`. After setup, open the Worker's address in any browser: the Vendor app opens there with your shops.

## Support access

Support access is a switch only the shop owner can turn on (Settings → Developer support). While it is on, every device in that shop shows a notice and the change is recorded in the activity log. Turning it off removes the support login immediately.

Contact: awaisdpw.co@gmail.com · Free support for 1 month from purchase, then charges apply.

---
Developer tool (optional): `node license/make-key.mjs init | issue …` does the same as the Vendor app from a terminal and uses the same key format.
