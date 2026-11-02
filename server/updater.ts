// Updates the shop server: fetches the new installer, checks it is the published file, then opens it.
// © Awais Amin
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { VENDOR } from '../shared/vendor.ts';
import { AppError } from '../shared/util.ts';
import { compareVersions, type LatestRelease } from '../shared/update.ts';
import { APP_VERSION } from '../shared/version.ts';

export interface UpdateDeps { fetch?: typeof fetch; platform?: string; open?: (file: string, platform: string) => void; dir?: string }

const openInstaller = (file: string, platform: string) => {
  const c = platform === 'win32' ? spawn(file, [], { detached: true, stdio: 'ignore', shell: false }) : spawn('open', [file], { detached: true, stdio: 'ignore' });
  c.unref();
};

export async function installUpdate(deps: UpdateDeps = {}): Promise<{ version: string }> {
  const f = deps.fetch || fetch, platform = deps.platform || process.platform;
  const kind = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'mac' : null;
  if (!kind) throw new AppError('UNSUPPORTED', 'Automatic update works on Windows and Mac only');
  const base = VENDOR.appUrl.replace(/\/?$/, '/');
  const res = await f(`${base}version.json?t=${Date.now()}`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res?.ok) throw new AppError('NO_INTERNET', 'Could not check for updates. Please check the internet.');
  const latest = await res.json() as LatestRelease;
  if (compareVersions(latest.version, APP_VERSION) <= 0) throw new AppError('UP_TO_DATE', 'PharmaDesk is already up to date');
  const want = latest.sha256?.[kind];
  if (!want) throw new AppError('UPDATE_BAD', 'This update could not be checked, so it was not installed');
  const name = kind === 'windows' ? 'PharmaDesk-Setup.exe' : 'PharmaDesk-Mac.pkg';
  const dl = await f(base + name, { signal: AbortSignal.timeout(15 * 60_000) }).catch(() => null);
  if (!dl?.ok) throw new AppError('NO_INTERNET', 'Could not download the update. Please check the internet.');
  const bytes = Buffer.from(await dl.arrayBuffer());
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== want) throw new AppError('UPDATE_BAD', 'The downloaded update was damaged, so it was not installed');
  const file = path.join(deps.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'pharmadesk-')), name);
  fs.writeFileSync(file, bytes, { mode: 0o755 });
  (deps.open || openInstaller)(file, platform);
  return { version: latest.version };
}
