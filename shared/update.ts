// Update rules, used by every device. The developer publishes version.json with each release:
//   mandatory: true  → nobody can use the app until they update
//   minVersion       → anything older than this must update, even if this release is optional
export interface LatestRelease { version: string; mandatory?: boolean; minVersion?: string; notes?: string; sha256?: { windows?: string; mac?: string } }
export type UpdateNeed = 'none' | 'optional' | 'mandatory';

const parts = (v: string) => String(v || '0').split('.').map(n => parseInt(n, 10) || 0);
export function compareVersions(a: string, b: string): number {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
export function updateNeed(current: string, latest: LatestRelease | null | undefined): UpdateNeed {
  if (!latest?.version || compareVersions(latest.version, current) <= 0) return 'none';
  if (latest.mandatory || (latest.minVersion && compareVersions(current, latest.minVersion) < 0)) return 'mandatory';
  return 'optional';
}
