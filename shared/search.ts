// Fast in-memory fuzzy search for the POS: tolerates typos ("panadool" → Panadol),
// matches brand or generic, and does exact barcode hits.
import type { Medicine } from './types.ts';

const norm = (s: unknown) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

function editDistanceWithin(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

interface Entry { m: Medicine; name: string; generic: string; words: string[] }

export class SearchIndex {
  items: Entry[] = [];
  byBarcode = new Map<string, Medicine>();

  build(medicines: Medicine[]): this {
    const live = medicines.filter(m => !m.deleted);
    this.items = live.map(m => ({
      m, name: norm(m.name), generic: norm(m.generic),
      words: norm(`${m.name} ${m.generic} ${m.strength || ''} ${m.manufacturer || ''}`).split(' ').filter(Boolean),
    }));
    this.byBarcode = new Map();
    for (const m of live) for (const code of [m.barcode, ...(m.altBarcodes || [])]) if (code) this.byBarcode.set(String(code).trim(), m);
    return this;
  }

  barcode(code: string): Medicine | null { return this.byBarcode.get(String(code).trim()) || null; }

  search(query: string, limit = 20): Medicine[] {
    const q = norm(query);
    if (!q) return [];
    const exact = this.barcode(query);
    if (exact) return [exact];
    const qWords = q.split(' ');
    const scored: [number, Medicine][] = [];
    for (const it of this.items) {
      let s = 0;
      if (it.name.startsWith(q)) s += 100; else if (it.name.includes(q)) s += 60;
      if (it.generic.startsWith(q)) s += 50; else if (it.generic.includes(q)) s += 30;
      let all = true, ws = 0;
      for (const w of qWords) {
        let best = 0;
        for (const tw of it.words) {
          if (tw.startsWith(w)) { best = 10; break; }
          if (w.length >= 4) {
            const d = editDistanceWithin(w, tw.slice(0, w.length + 1), 2);
            if (d <= (w.length >= 7 ? 2 : 1)) best = Math.max(best, 6 - d);
          }
        }
        if (!best) { all = false; break; }
        ws += best;
      }
      if (all) s += ws;
      if (s > 0) scored.push([s, it.m]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
    return scored.slice(0, limit).map(x => x[1]);
  }
}
