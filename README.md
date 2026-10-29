<div align="center">

# 💊 PharmaDesk

**Offline-first pharmacy & medical store management — Windows, Android and iPhone.**

### Developed by **Awais Amin**

**▶ Open the app: [awaisydse.github.io/Pharma-Desk](https://awaisydse.github.io/Pharma-Desk/)** · **[Download for Windows (shop server)](https://awaisydse.github.io/Pharma-Desk/PharmaDesk-Windows.zip)**

PharmaDesk was designed and developed by **Awais Amin**. He built it to give every medical store — from a small corner pharmacy to a busy chain counter — the same tools that large pharmacies pay for: fast billing, batch and expiry control, stock that stays correct across every counter and phone, and full oversight for the owner.

Every part of PharmaDesk, from the shop server and offline sync to the Urdu screens and the AI prescription reader, was planned around how pharmacies in Pakistan actually work: unreliable power and internet, mixed staff, credit customers and strict expiry rules. It helps pharmacies serve patients safely and keep their business in their own hands.

English · اردو · العربية · हिन्दी · Español

</div>

---

PharmaDesk runs on **one shop PC (the server)** and any number of **phones and counter PCs**.
Every device keeps a **full copy** of the shop's data, so if the server PC is switched off,
phones still show everything and keep billing — it all syncs back when the server returns.

No cloud account and no SMS charges are needed. Each pharmacy's data
stays on its own PC.

## Features

| | |
|---|---|
| **Point of Sale** | Keyboard-first billing (`F2` search, `F8` checkout, `F4` patient, `F6` prescription reader, `F9` reprint), typo-tolerant search ("panadool" → Panadol), USB barcode scanners and phone-camera scanning, GST (inclusive or exclusive), discounts, cash / card / JazzCash / credit (udhaar). Animated patient avatar that reacts to the bill. |
| **Built-in medicine list** | At first setup the owner chooses: start with ~150 common medicines sold in Pakistan (brand, formula, strength, company, what it's for) **or** start empty and write their own. This choice is offered only once — the list can't be imported later. Afterwards, anyone with permission can edit, describe or delete each medicine. |
| **Photos & logo** | Upload a shop logo (shown on every device and on receipts) and a photo for each user. |
| **Batches & FEFO** | Every sale takes the batch that expires first, splits across batches automatically, never sells expired stock. Choosing a newer batch needs a supervisor PIN and is logged. |
| **Expiry & stock alerts** | 30/60/90-day expiry warnings, expired stock, low/out of stock with reorder suggestions based on recent sales, refill reminders. |
| **Purchases & suppliers** | Purchase orders, stock intake with batch + expiry, free units, supplier ledger and payments. |
| **Patients** | History, allergies (shown on the bill), doctor, repeat-prescription reminders, credit balance. |
| **Owner supervision** | The owner account is created on first start and can never be deleted. The owner adds/deletes users and switches **each module on or off per user**, sees who is working now, and can log anyone out or disable them instantly. Every login, logout, failed PIN, discount, void, stock change and **server PC on/off (including power cuts)** is recorded in the activity log. |
| **AI (Gemini key)** | Reads typed or photographed prescriptions, warns about drug interactions on the bill, writes a daily summary in English or Urdu. When AI is unavailable (no key, no internet, free limit reached) it falls back to a built-in reader and interaction list — billing never stops. |
| **Languages** | English, Urdu (full right-to-left, Nastaliq font), Arabic, Hindi, Spanish — switch instantly. |
| **Reports** | Sales, profit (permission-controlled), top sellers, per-cashier totals, CSV export. |
| **Receipts** | 80mm/58mm thermal (USB ESC/POS in Chrome/Edge) or any printer; if the printer is off the receipt waits in a queue and prints when it's back; PDF copy always available. |

## Install

### Which device is the server?
**Only a Windows PC can be the shop server.** It keeps the master copy of all the shop's data, lets phones and other counters sync with each other, takes automatic backups every 6 hours, and records when it was switched on or off. The server PC also works as a normal billing counter.

Phones, tablets and other PCs **connect** to it by scanning its QR code. On a PC, the first screen of the web app offers **"Use this PC as the server"** with the download and steps; phones only see "Scan QR".

### On the main shop PC (Windows)
1. Download **PharmaDesk-Windows.zip** from [Releases](../../releases) and unzip it.
2. Double-click **Start PharmaDesk Server**. (It installs the free Node.js the first time if needed.)
3. Create the owner account, add your shop logo and photo, and choose the built-in medicine list or your own. Optional: double-click **Start automatically with Windows**.
4. Recommended: install **[Tailscale](https://tailscale.com)** (free) on the server PC and the phones for a fixed private address that works from anywhere. The server also opens a free Cloudflare tunnel automatically.

### On phones and other PCs
1. Open the app link shown in **Settings** on the server PC (or the [web app](https://awaisydse.github.io/Pharma-Desk/)), then **Install / Add to Home Screen**.
2. Tap **Scan QR**, scan the QR in **Settings** on the server PC, and type the **6-digit Server PIN**.

## How it's built

```
 Phone / counter PC (PWA)                         Main shop PC
 ┌──────────────────────────┐   HTTPS / Wi-Fi   ┌──────────────────────────────┐
 │ React + Framer Motion UI │ ◄──────────────►  │ Node.js + Express            │
 │ IndexedDB: FULL replica  │   Bearer token    │ SQLite (WAL) + snapshots     │
 │ Outbox (offline queue)   │   signed by THIS  │ Pairing: UUID + PIN + secret │
 │ FEFO, GST, POS engine    │   server only     │ Ops: atomic, idempotent      │
 └──────────────────────────┘                   │ Gemini (key encrypted here)  │
                                                │ Tailscale / Cloudflare tunnel│
                                                └──────────────────────────────┘
```

- **shared/** — money in integer paisa, GST, FEFO allocation, fuzzy search, permissions, offline prescription parser and interaction list (used by server and devices).
- **server/** — SQLite schema (`server_identity`, `paired_devices`, medicines, batches, invoices, invoice_items, suppliers, patients, `ai_logs`, `server_settings`, sessions, server runs), pairing & device tokens, sync API, supervision, Gemini service, tunnel manager.
- **client/core/** — device database, sync engine, POS, inventory, users/login, alerts monitor, print queue.
- **client/ui/** — screens, animations, translations.

### Security: one shop can never see another shop's data
- First start creates a **Server UUID**, a **6-digit PIN** and a **secret signing key** for that PC.
- The QR holds the server ID and addresses (not the PIN). Pairing needs the QR **and** the PIN.
- The device receives a token signed with that server's secret. Every request needs it; a token from another shop fails with **401** — *"Server PIN Mismatch - Ensure you are scanning your own shop's server QR code."*
- Wrong PINs lock pairing after 5 tries. Devices can be removed at any time. The PIN/QR screen can only be opened on the server PC itself, never through a tunnel.
- User PINs are hashed (PBKDF2, 210,000 rounds). The Gemini key is stored only on the server PC, AES-256-GCM encrypted, and is never sent to phones. Patient names, phones and CNICs are removed before any text is sent to AI.

## What can go wrong — and what happens

| Failure | Root cause | Impact | Automatic fallback |
|---|---|---|---|
| Server PC off / internet down / tunnel drops | Power cut, Wi-Fi, ISP | Phones can't reach the server | Phones keep a full copy: login, search, billing, reports all continue. Sales go into an outbox written in the same transaction as the sale. When the server is back the outbox syncs in order; each operation is applied exactly once. |
| Two counters sell the last units **online** | Race | Overselling | The server checks and deducts stock inside one locked transaction: one sale succeeds, the other gets "Out of stock" and saves nothing. |
| Two phones sell the last units of a batch **offline** | No server to coordinate | Batch would go negative | On sync the server moves the extra quantity to the next earliest-expiring batch (FEFO), rewrites the invoice line to the real batch and logs a warning. If the medicine is fully sold out the sale is kept (it already happened), stock shows as "sold before stock entry" and the bill is flagged for the owner. |
| Edits to the same record on two devices | Offline edits | Conflicting data | Last-write-wins using hybrid logical clocks (ordered even when device clocks are wrong). Stock quantities are never overwritten — only changed by +/− amounts, so no sale is ever lost. |
| Wrong shop's QR / stranger finds the tunnel URL | Mistake or attack | Data leak | 401 on everything without that shop's token; PIN brute force locked. |
| Gemini 429 / bad key / no internet | Free limit, typo | No AI answer | 15-second timeout, then the built-in prescription reader, interaction list and summary template. Logged in `ai_logs`. AI interaction results never remove a known danger from the built-in list. |
| Thermal printer unplugged mid-bill | USB/Bluetooth | No receipt | Receipt joins a stored print queue and prints automatically when the printer is back; PDF/HTML copy available at once. |
| Barcode scanner drops keys | Hardware | Wrong item | Exact barcode match only; otherwise fuzzy search + phone-camera scanner. |
| Selling before stock is entered / FEFO override | Workflow | Negative stock, expired stock left on shelf | Needs a supervisor PIN; recorded in the activity log; reconciled automatically when the purchase is received. |
| App crash during payment | Bug | Half-saved sale | Sale, stock change and sync queue are one IndexedDB transaction — all or nothing. Screens are wrapped in error boundaries. |
| Power cut corrupts the database | Disk | Server can't start | SQLite WAL mode; integrity check on every start; if damaged, the latest snapshot (every 6 h + on shutdown) is restored automatically and devices re-sync anything newer. |
| Stock received on a phone and sold a second later | Received stock still waiting to sync | Server would not know the batch | Before every online sale the device first sends all its pending changes, in order. |
| Buying an item that is not in Inventory | Workflow / tampered device | Stock with no item | Refused on the device and again on the server: the item must be created in Inventory first. |
| Bad quantity (0, negative, 1.5, huge), less cash than the total, credit sale with no customer | Typing mistake | Wrong bill or stock | Refused before anything is saved. |
| Expired batch is the only stock | Shelf not cleared | Selling expired medicine | Expired batches are never sold. |
| Malformed / tampered sync data, huge uploads | Bug or attack | Server crash | Rejected with a clear error (413 for oversize); stock untouched. |
| Medicine/shop names containing HTML | Typing or attack | Script on the receipt | All printed text is escaped. |
| A user without permission tries to create, modify or delete | Tampered phone | Unauthorised change | Each switch is checked on the device and again on the server. |
| Server started twice (double-click again) | User | Database opened twice, false "power cut" in the log | The second start sees the running server, opens it in the browser and stops without touching the data. |
| Another program uses port 4317 | Other software | Server can't start | Clear message; nothing is written. |
| Browser opened before the server was ready | Slow PC | "Can't connect" page | The server opens the browser itself only once it is ready. |
| Language button pressed on a form | Bug (fixed) | Form submitted, false "pairing code not valid" | Every button with its own action is a plain button; a test checks all of them. |
| A screen or message left in English | Missing translation | Mixed languages | Every sentence has Urdu, Arabic, Hindi and Spanish; a test fails if one is missing, and a browser test opens every screen in every language. |
| Server PC turned off without shutdown | Power cut | Owner needs to know | A heartbeat every 30 s; on next start the outage is logged as "Server PC went OFF unexpectedly" with the time. |

## Tests

```
npm install
npm run build
npm test
```

71 automated tests, including:
- **Linked modules** — supplier → purchase → receive → inventory → sale on credit → customer balance → payment → bill returned → stock back, and the shop server matches exactly.
- **Granular permissions** — create, modify, delete and payments switched separately for items, customers and suppliers; enforced on the device and on the server.
- **Languages** — every sentence in the code has all four translations; a real browser opens every screen and form in Urdu, Arabic, Hindi and Spanish and fails on any English left; Urdu/Arabic switch right-to-left.
- **Server option** — offered on PCs only, never on phones.
- **Bad input and attacks** — bad quantities, underpayment, expired stock, retried sales applied once, malformed ops, script injection, oversized uploads.
- **Medicine list** — loaded only at first setup, can't be re-imported later, editable/deletable only with permission.
- **Multi-tenant security** — Shop A's token on Shop B → 401; Shop A's QR + PIN on Shop B → rejected; forged tokens, removed devices, brute-force lock.
- **Offline cashier** — server off → 10 bills → server back → all 10 sync, **zero stock drift**.
- **Offline-to-server sync** — 5 offline bills on each of two phones selling the same batch → 0 drift on server and both phones, overflow moved to the next batch.
- **Concurrent stock** — 2 simultaneous online sales of 1 remaining item → 1 succeeds, 1 "Out of stock".
- **FEFO reallocation** — Batch #101 oversold offline → moved to #102 with a warning.
- **Gemini** — 429, invalid key, timeout → offline fallbacks; patient details stripped; key encrypted.
- **Urdu / RTL** — real browser: layout flips right-to-left, POS search keeps keyboard focus, F2/Enter still work.
- **Printer offline recovery**, **expiry monitor**, **crash recovery**, **owner supervision** (owner can't be deleted, login/logout log, power-cut detection, force logout).

## Honest limits
- iPhones use the installable web app (Apple charges $99/year for the App Store). Android and Windows can install it from the browser too.
- SMS login codes are not included because every SMS gateway charges per message.
- On Google's free Gemini tier, Google may use what is sent to improve its products; PharmaDesk removes patient details first. AI interaction warnings are a second check for the pharmacist, not a replacement.
- A phone opening the app over plain `http://` on shop Wi-Fi can't install it for offline start; use the Tailscale or Cloudflare `https://` address for installing.

## License & credit
MIT © 2026 **Awais Amin**. Please keep the credit line *"Developed by Awais Amin"*.

The built-in medicine list is a starting point only — always check strength, maker and price against the pack and DRAP.
