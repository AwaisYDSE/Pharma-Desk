// Start the shop server:  node server/main.ts   (or the Windows installer's shortcut)
// © Awais Amin
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { openWithRecovery, snapshot } from './db.ts';
import { ensureIdentity, getIdentity } from './identity.ts';
import { createApp } from './app.ts';
import { serverStarted, serverHeartbeat, serverStopped, openSessionTable, logEvent } from './supervision.ts';
import { lanUrls, startTailscale, CloudflareTunnel, publishBeacon, pairingPayload, pairingQr, type Endpoints } from './tunnel.ts';

const PORT = Number(process.env.PORT || 4317);
const DATA = process.env.PHARMADESK_DATA || path.join(os.homedir(), 'PharmaDesk');
const DB_FILE = path.join(DATA, 'pharmadesk.db');
const BACKUPS = path.join(DATA, 'backups');
const log = (m: string) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`);

/** Opens PharmaDesk in the PC's browser (only after the server is ready, so the page never fails to load). */
function openBrowser(url: string) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

// Already running (e.g. "Start PharmaDesk Server" double-clicked twice)? Don't open the database a
// second time — that would log a false "power cut". Just show the running one and stop.
{
  const running = await fetch(`http://127.0.0.1:${PORT}/api/hello`, { signal: AbortSignal.timeout(1500) })
    .then(r => r.json()).then(d => (d as { app?: string })?.app === 'pharmadesk').catch(() => null);
  if (running) {
    log(`PharmaDesk server is already running on this PC. Opening it: http://localhost:${PORT}`);
    if (process.env.PHARMADESK_OPEN === '1') openBrowser(`http://localhost:${PORT}`);
    process.exit(0);
  }
}

const { db, restored } = openWithRecovery(DB_FILE, BACKUPS, log);
const id = ensureIdentity(db, process.env.PHARMACY_NAME || 'My Pharmacy');
openSessionTable(db);
const runId = serverStarted(db);
if (restored) logEvent(db, 'server.restored', { snapshot: restored });

const endpoints: Endpoints = { lan: lanUrls(PORT), tailscale: null, cloudflare: null };
const app = createApp(db, { endpoints: () => endpoints, staticDir: process.env.PHARMADESK_APP || path.resolve(import.meta.dirname, '..', 'dist') });

const server = app.listen(PORT, '0.0.0.0', async () => {
  log(`PharmaDesk server "${id.name}" running on port ${PORT}`);
  log(`Open on this PC: http://localhost:${PORT}`);
  if (process.env.PHARMADESK_OPEN === '1') openBrowser(`http://localhost:${PORT}`);
  for (const u of endpoints.lan) log(`Shop Wi-Fi:      ${u}`);
  if (process.env.NO_TUNNEL !== '1') {
    endpoints.tailscale = await startTailscale(PORT, log);
    const cf = new CloudflareTunnel(PORT, {
      log,
      onUrl: url => { endpoints.cloudflare = url; publishBeacon(id.serverId, id.beaconKey, endpoints, log); },
    });
    cf.start();
    process.on('exit', () => cf.stop());
  }
  const qr = await pairingQr(pairingPayload(id.serverId, getIdentity(db)!.name, endpoints));
  console.log(qr.terminal);
  log(`Server PIN: ${getIdentity(db)!.pin}   (scan the QR above, then type this PIN)`);
});

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') log(`Port ${PORT} is used by another program. Close it, or start PharmaDesk with a different PORT.`);
  else log(`Server could not start: ${e.message}`);
  try { serverStopped(db, runId); db.close(); } catch { /* best effort */ }
  process.exit(1);
});

const beat = setInterval(() => serverHeartbeat(db, runId), 30_000);
const snap = () => { try { log(`Backup saved: ${path.basename(snapshot(db, BACKUPS))}`); } catch (e) { log(`Backup failed: ${(e as Error).message}`); } };
setTimeout(snap, 60_000);
const snapTimer = setInterval(snap, 6 * 3600_000);

let stopping = false;
function shutdown(sig: string) {
  if (stopping) return;
  stopping = true;
  log(`Stopping (${sig})…`);
  clearInterval(beat); clearInterval(snapTimer);
  try { serverStopped(db, runId); snapshot(db, BACKUPS); } catch { /* best effort */ }
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
}
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(s, () => shutdown(s));
process.on('uncaughtException', e => { log(`Unexpected error (server keeps running): ${e.stack || e}`); });
