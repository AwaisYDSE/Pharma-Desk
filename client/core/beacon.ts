// Finds the shop server's current internet address after it changed (e.g. the shop PC restarted
// and got a new Cloudflare address). The server posts its addresses, encrypted with this shop's
// key, to a free relay (ntfy.sh). Only paired devices hold the key, so only they can read it.
// © Awais Amin
import type { Pairing } from './db.ts';

export const BEACON_HOST = 'https://ntfy.sh';

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function beaconTopic(serverId: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pharmadesk-beacon|' + serverId));
  return 'pd-' + hex(d).slice(0, 32);
}

export interface BeaconInfo { at: number; urls: string[] }

/** Decrypts one beacon message (AES-256-GCM: 12-byte IV, then ciphertext + tag). */
export async function openBeacon(sealed: string, beaconKeyB64: string, serverId: string): Promise<BeaconInfo | null> {
  try {
    const raw = unb64(sealed.trim());
    const key = await crypto.subtle.importKey('raw', unb64(beaconKeyB64), 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
    const p = JSON.parse(new TextDecoder().decode(plain)) as { sid?: string; at?: number; tailscale?: string | null; cloudflare?: string | null; lan?: string[] };
    if (p.sid !== serverId) return null;
    const urls = [p.cloudflare, p.tailscale, ...(p.lan || [])].filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));
    return { at: Number(p.at) || 0, urls };
  } catch { return null; }
}

/** Newest addresses the shop server has announced in the last day, or null if none can be read. */
export async function readBeacon(pairing: Pairing, f: typeof fetch = fetch): Promise<BeaconInfo | null> {
  if (!pairing.beaconKey || typeof crypto === 'undefined' || !crypto.subtle) return null;
  try {
    const topic = await beaconTopic(pairing.serverId);
    const res = await f(`${BEACON_HOST}/${topic}/json?poll=1&since=24h`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    let best: BeaconInfo | null = null;
    for (const line of (await res.text()).split('\n')) {
      if (!line.trim()) continue;
      let m: { event?: string; message?: string };
      try { m = JSON.parse(line); } catch { continue; }
      if (m.event !== 'message' || !m.message) continue;
      const b = await openBeacon(m.message, pairing.beaconKey, pairing.serverId);
      if (b && b.urls.length && (!best || b.at > best.at)) best = b;
    }
    return best;
  } catch { return null; }
}

/** New address list: the announced addresses first, then the ones we already knew (no duplicates). */
export function mergeUrls(announced: string[], known: string[]): string[] {
  // Old trycloudflare addresses never come back once replaced — drop them.
  const keep = known.filter(u => !/\.trycloudflare\.com/i.test(u) || announced.includes(u));
  return [...new Set([...announced, ...keep])].slice(0, 12);
}
