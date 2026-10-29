# Selling PharmaDesk — licence keys

PharmaDesk ships **free to run**. To start selling it with keys, do this once on your own computer:

```
node license/make-key.mjs init
```

This makes your signing keys (kept only in `license/vendor-private.json` — **back it up, never share or commit it**) and prints your `publicKey`. Paste that into `shared/vendor.ts`, set `requireLicense: true`, then rebuild and republish.

From then on a shop can't set up without a key you issue:

```
node license/make-key.mjs issue --shop "Al-Shifa Pharmacy" --days 365
node license/make-key.mjs issue --shop "Trial Shop"       --days 14 --plan trial
```

Give the printed `PD1.…` key to that shop; they paste it on first run. A key can't be forged, edited or shared to another shop. When `--days` runs out, billing stops until you issue a renewal key. Keys without `--days` never expire.

Support: free for 1 month from purchase, then charged — contact awaisdpw.co@gmail.com.
