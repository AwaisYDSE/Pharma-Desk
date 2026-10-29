// Medicine pictures. If the shop took/uploaded a photo of the pack, that is shown;
// otherwise an original drawing of the medicine type (tablet strip, capsule, syrup,
// inhaler, cream tube, injection, drops, sachet…) coloured by its category.
// (Real brand pack photos are not bundled: they belong to the manufacturers.)
import React from 'react';
import { motion } from 'framer-motion';
import type { Medicine } from '../../shared/types.ts';

const PALETTE = ['#14B8A6', '#3B82F6', '#F59E0B', '#EC4899', '#8B5CF6', '#10B981', '#EF4444', '#06B6D4', '#84CC16', '#F97316'];
function colorFor(key: string) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export type MedKind = 'tablet' | 'capsule' | 'syrup' | 'inhaler' | 'tube' | 'injection' | 'drops' | 'sachet' | 'lozenge' | 'effervescent';
export function kindOf(form = ''): MedKind {
  const f = form.toLowerCase();
  if (/caps/.test(f)) return 'capsule';
  if (/syr|susp|liquid|solution|elixir/.test(f)) return 'syrup';
  if (/inhal|puff/.test(f)) return 'inhaler';
  if (/cream|oint|gel|lotion/.test(f)) return 'tube';
  if (/inj|vial|amp/.test(f)) return 'injection';
  if (/drop/.test(f)) return 'drops';
  if (/sachet|powder/.test(f)) return 'sachet';
  if (/lozenge/.test(f)) return 'lozenge';
  if (/efferv/.test(f)) return 'effervescent';
  return 'tablet';
}

function Drawing({ kind, c }: { kind: MedKind; c: string }) {
  switch (kind) {
    case 'capsule': return <g transform="rotate(-35 32 32)"><rect x="12" y="24" width="40" height="16" rx="8" fill="#F8FAFC" /><path d="M32 24h12a8 8 0 0 1 0 16H32z" fill={c} /><rect x="16" y="27" width="10" height="3" rx="1.5" fill="#fff" opacity=".8" /></g>;
    case 'syrup': return <g><rect x="25" y="8" width="14" height="7" rx="2" fill="#334155" /><path d="M23 16h18v5l4 6v26a4 4 0 0 1-4 4H23a4 4 0 0 1-4-4V27l4-6z" fill={c} /><rect x="22" y="32" width="20" height="14" rx="2" fill="#fff" opacity=".9" /><path d="M26 37h12M26 41h8" stroke={c} strokeWidth="2" strokeLinecap="round" /></g>;
    case 'inhaler': return <g><path d="M24 8h14a3 3 0 0 1 3 3v26H21V11a3 3 0 0 1 3-3z" fill={c} /><path d="M21 37h20v6H48a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H25a4 4 0 0 1-4-4z" fill="#CBD5E1" /><rect x="25" y="14" width="12" height="8" rx="2" fill="#fff" opacity=".85" /></g>;
    case 'tube': return <g transform="rotate(-30 32 32)"><path d="M14 22h30l6 4v12l-6 4H14z" fill="#F8FAFC" /><rect x="14" y="22" width="22" height="20" fill={c} /><rect x="50" y="28" width="7" height="8" rx="1.5" fill="#334155" /><path d="M18 29h12M18 34h8" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></g>;
    case 'injection': return <g transform="rotate(-40 32 32)"><rect x="16" y="26" width="26" height="12" rx="2" fill="#E2E8F0" /><rect x="18" y="28" width="15" height="8" fill={c} /><rect x="42" y="30" width="6" height="4" fill="#94A3B8" /><path d="M48 32h10" stroke="#64748B" strokeWidth="1.6" /><rect x="8" y="24" width="4" height="16" rx="1" fill="#475569" /><rect x="12" y="30" width="5" height="4" fill="#475569" /></g>;
    case 'drops': return <g><path d="M29 6h6l1 10h-8z" fill="#E2E8F0" /><path d="M24 16h16v6l3 4v26a4 4 0 0 1-4 4H25a4 4 0 0 1-4-4V26l3-4z" fill={c} /><rect x="24" y="32" width="16" height="12" rx="2" fill="#fff" opacity=".9" /><path d="M48 30c3 4 4 6 4 8a4 4 0 0 1-8 0c0-2 1-4 4-8z" fill={c} opacity=".8" /></g>;
    case 'sachet': return <g><path d="M14 12h36v40H14z" fill={c} /><path d="M14 12l3 3 3-3 3 3 3-3 3 3 3-3 3 3 3-3 3 3 3-3 3 3 3-3" stroke="#fff" strokeWidth="1.5" fill="none" /><circle cx="32" cy="34" r="9" fill="#fff" opacity=".9" /><path d="M32 29v10M27 34h10" stroke={c} strokeWidth="2.6" strokeLinecap="round" /></g>;
    case 'lozenge': return <g><circle cx="26" cy="36" r="11" fill={c} /><circle cx="40" cy="26" r="11" fill={c} opacity=".75" /><circle cx="23" cy="33" r="3" fill="#fff" opacity=".6" /></g>;
    case 'effervescent': return <g><rect x="18" y="8" width="28" height="48" rx="5" fill="#E2E8F0" /><rect x="18" y="20" width="28" height="22" fill={c} /><circle cx="26" cy="50" r="2" fill="#fff" /><circle cx="34" cy="47" r="1.5" fill="#fff" /><circle cx="39" cy="51" r="2.2" fill="#fff" /></g>;
    default: return <g><rect x="10" y="14" width="44" height="36" rx="6" fill="#E2E8F0" />
      {[0, 1, 2].map(r => [0, 1].map(col => <g key={`${r}${col}`}><circle cx={20 + r * 12} cy={25 + col * 14} r="5" fill={c} /><circle cx={18.5 + r * 12} cy={23.5 + col * 14} r="1.6" fill="#fff" opacity=".7" /></g>))}</g>;
  }
}

export function MedThumb({ med, size = 44, animate = false }: { med: Pick<Medicine, 'name' | 'form' | 'category' | 'generic'> & { photo?: string | null }; size?: number; animate?: boolean }) {
  const r = Math.round(size * 0.28);
  if (med.photo) return <img src={med.photo} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: r, objectFit: 'cover', flexShrink: 0, background: '#fff', border: '1px solid var(--line)' }} />;
  const c = colorFor(med.category || med.generic || med.name);
  const svg = (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={med.form || 'medicine'} style={{ flexShrink: 0, borderRadius: r, background: `color-mix(in srgb, ${c} 14%, var(--panel2))` }}>
      <Drawing kind={kindOf(med.form)} c={c} />
    </svg>
  );
  return animate ? <motion.span style={{ display: 'inline-flex' }} whileHover={{ rotate: [0, -8, 8, 0], scale: 1.1 }}>{svg}</motion.span> : svg;
}

/** "Panadol 500mg" on top, the formula (generic) underneath — used everywhere a medicine is listed. */
export function MedName({ med, sub }: { med: Pick<Medicine, 'name' | 'strength' | 'generic' | 'form'>; sub?: React.ReactNode }) {
  return (
    <span className="col" style={{ gap: 0, minWidth: 0 }}>
      <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{med.name}{med.strength && !med.name.includes(med.strength) ? <span className="muted" style={{ fontWeight: 500 }}> {med.strength}</span> : null}</strong>
      <span className="small" style={{ color: 'var(--accent)', fontWeight: 600 }}>{med.generic || '—'}{med.form ? <span className="faint" style={{ fontWeight: 400 }}> · {med.form}</span> : null}</span>
      {sub}
    </span>
  );
}
