// Offline prescription parser — the fallback when Gemini is not available.
// Understands common Pakistani prescription shorthand:
//   "Tab. Augmentin 625mg 1+0+1 x 5 days", "Cap Risek 20 mg OD 14d", "Syp Calpol 5ml TDS"

export interface RxItem {
  name: string; strength?: string; form?: string; dose?: string; perDay?: number; days?: number; qty?: number; raw: string;
}

const FORMS: Record<string, string> = {
  tab: 'tablet', tabs: 'tablet', tablet: 'tablet', cap: 'capsule', caps: 'capsule', capsule: 'capsule',
  syp: 'syrup', syr: 'syrup', syrup: 'syrup', susp: 'suspension', inj: 'injection', drops: 'drops', drop: 'drops',
  oint: 'ointment', cream: 'cream', gel: 'gel', sachet: 'sachet', inh: 'inhaler', inhaler: 'inhaler',
};
const FREQ: Record<string, number> = {
  od: 1, qd: 1, hs: 1, daily: 1, bd: 2, bid: 2, tds: 3, tid: 3, qid: 4, qds: 4, sos: 0, prn: 0, stat: 1,
};

export function parsePrescriptionOffline(text: string): RxItem[] {
  const items: RxItem[] = [];
  const lines = String(text || '').split(/\n|;|(?=\b(?:tab|cap|syp|syr|inj|susp)\b\.?)/i).map(l => l.trim()).filter(Boolean);
  for (const raw of lines) {
    let line = raw.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '');
    if (/^(patient|name|age|sex|gender|date|dr\.?|doctor|diagnosis|address|phone|mr|mrs|ms)\b/i.test(line)) continue;
    let form: string | undefined;
    const fm = line.match(/^(tabs?|caps?|tablet|capsule|syp|syr|syrup|susp|inj|drops?|oint|cream|gel|sachet|inh(?:aler)?)\b\.?\s*/i);
    if (fm) { form = FORMS[fm[1].toLowerCase()]; line = line.slice(fm[0].length); }

    const strengthM = line.match(/(\d+(?:\.\d+)?\s?(?:mg|mcg|µg|g|ml|iu|%)(?:\s?\/\s?\d+(?:\.\d+)?\s?(?:mg|ml))?)/i);
    const strength = strengthM?.[1]?.replace(/\s+/g, '');

    let perDay: number | undefined, dose: string | undefined;
    const plus = line.match(/\b(\d(?:\.\d)?)\s*[+\-]\s*(\d(?:\.\d)?)\s*[+\-]\s*(\d(?:\.\d)?)\b/);
    if (plus) { perDay = Number(plus[1]) + Number(plus[2]) + Number(plus[3]); dose = plus[0].replace(/\s/g, ''); }
    else {
      const f = line.match(/\b(od|qd|bd|bid|tds|tid|qid|qds|hs|sos|prn|stat|daily)\b/i);
      if (f) { perDay = FREQ[f[1].toLowerCase()]; dose = f[1].toUpperCase(); }
      const times = line.match(/\b(\d)\s*(?:times|x)\s*(?:a|per)?\s*day\b/i);
      if (times) { perDay = Number(times[1]); dose = `${times[1]}x/day`; }
    }

    const daysM = line.match(/(?:x|for|×)?\s*(\d{1,3})\s*(?:days?|d)\b/i) || line.match(/\b(\d)\s*(?:weeks?|wk)\b/i);
    let days: number | undefined;
    if (daysM) days = /w/i.test(daysM[0]) ? Number(daysM[1]) * 7 : Number(daysM[1]);

    // Name = text before the strength or the dose pattern.
    const cut = [strengthM?.index, plus?.index, line.search(/\b(od|bd|tds|tid|qid|hs|sos|prn|daily)\b/i)]
      .filter((i): i is number => typeof i === 'number' && i > 0);
    const name = (cut.length ? line.slice(0, Math.min(...cut)) : line.split(/\s{2,}|,/)[0])
      .replace(/[^\p{L}\p{N} \-]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!name || name.length < 2 || /^(rx|dr|date|name|age|sig|diagnosis)$/i.test(name)) continue;
    if (!form && !strength && !dose) continue; // not a medicine line

    const countable = !form || form === 'tablet' || form === 'capsule';
    const qty = countable && perDay && days ? Math.ceil(perDay * days) : (form && !countable ? 1 : undefined);
    items.push({ name, strength, form, dose, perDay, days, qty, raw });
  }
  return items;
}
