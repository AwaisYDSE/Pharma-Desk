import type { Lang } from '../i18n.ts';
import { money } from '../i18n.ts';
import type { Alert } from '../../core/monitor.ts';

/** Summary shown instantly (and whenever Gemini is unavailable). */
export function offlineSummaryText(lang: Lang, revenue: number, profit: number | null, bills: number, pct: number | null, top: { name: string }[], alerts: Alert[]) {
  const low = alerts.filter(a => a.kind === 'low' || a.kind === 'out').slice(0, 3).map(a => a.title.split(':')[0]);
  const exp = alerts.filter(a => a.kind === 'expiring' || a.kind === 'expired').length;
  if (lang === 'ur') {
    return [
      `آج کی فروخت ${money(revenue, lang)}${profit != null ? `، منافع ${money(profit, lang)}` : ''}، ${bills} بل۔`,
      top.length ? `سب سے زیادہ بکنے والی: ${top.slice(0, 3).map(t => t.name).join('، ')}۔` : '',
      low.length ? `کم سٹاک: ${low.join('، ')} — دوبارہ آرڈر کریں۔` : '',
      exp ? `${exp} بیچ جلد ختم ہونے والے ہیں — انہیں پہلے بیچیں۔` : '',
    ].filter(Boolean).join(' ');
  }
  return [
    `Today's sales ${money(revenue, lang)}${profit != null ? `, profit ${money(profit, lang)}` : ''}, ${bills} bills${pct != null ? ` (${pct >= 0 ? 'up' : 'down'} ${Math.abs(pct)}% on last week)` : ''}.`,
    top.length ? `Best sellers: ${top.slice(0, 3).map(t => t.name).join(', ')}.` : '',
    low.length ? `Low stock: ${low.join(', ')} — reorder soon.` : '',
    exp ? `${exp} batch(es) expire soon — sell them first.` : '',
  ].filter(Boolean).join(' ');
}
