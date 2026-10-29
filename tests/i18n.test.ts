// Every language is complete: no word on any screen falls back to English.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { EN_DICT, DICTS, LANGS, type Lang } from '../client/ui/i18n.ts';
import { PHRASES } from '../client/ui/phrases-data.ts';
import { usePhrases, translateText } from '../client/ui/phrases.ts';

usePhrases(PHRASES);
const OTHER: Lang[] = ['ur', 'ar', 'hi', 'es'];
const root = path.resolve(import.meta.dirname, '..');

/** Every English sentence written in the app's screens and messages. */
function sourceSentences(): string[] {
  const files: string[] = [];
  const walk = (d: string) => fs.readdirSync(d).forEach(f => { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !/phrases|i18n|\.d\.ts/.test(f)) files.push(p); });
  walk(path.join(root, 'client'));
  files.push(path.join(root, 'shared/permissions.ts'), path.join(root, 'shared/util.ts'));
  const out = new Set<string>();
  const add = (s: string) => { s = s.replace(/\s+/g, ' ').trim(); if (s) out.add(s); };
  const looksText = (s: string) => /[A-Za-z]{2}/.test(s) && !/^[a-z0-9_.\-/:#@]+$/.test(s) && !/^(rgba?|var|linear-gradient|calc|url|rotate|color-mix)\(/.test(s) && !/[{};<>]|=>|^\.|px\b|^\d/.test(s) && !/^[A-Z_]+$/.test(s) && !/^https?:/.test(s) && !/^[a-z]+([A-Z][a-z]+)+$/.test(s);
  for (const f of files) {
    if (f.includes(`${path.sep}core${path.sep}print.ts`)) continue; // receipts are printed in English
    const src = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n: ts.Node) => {
      if (ts.isJsxText(n)) { if (/[A-Za-z]{2}/.test(n.text)) add(n.text); }
      else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !ts.isImportDeclaration(n.parent) && looksText(n.text) && (n.text.includes(' ') || /^[A-Z][a-z]/.test(n.text))) add(n.text);
      else if (ts.isTemplateExpression(n)) {
        let s = n.head.text; n.templateSpans.forEach((sp, i) => { s += `{${i}}` + sp.literal.text; });
        if (/[A-Za-z]{3} /.test(s.replace(/\{\d\}/g, '')) && looksText(s.replace(/\{\d\}/g, 'x'))) add(s);
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  return [...out];
}

// Brand names, units and technical words that stay as they are in every language.
const KEEP = /^(PharmaDesk|PharmaDesk-Mac\.pkg|PharmaDesk-Setup\.exe|Rs|\(Rs\)|PDF|CSV|A4|58mm|80mm|FEFO|\(FEFO\)|SOFTWARE|Tailscale:|Cloudflare:|My Medical Store|Pharmacy Software by Awais Amin|awaisdpw\.co@gmail\.com|Gemini|NTN|STRN|CNIC|· NTN \{0\}|\{0\} "\{1\}" for \{2\}|Today's sales \{0\}\{1\}, \{2\} bills\{3\}\.|ArrowUp|ArrowDown|Enter|Escape|F\d|F6 Rx \(AI\)|k|items|Tab\. Augmentin .*|Dr\.|Bearer \{0\}|Delete \{0\}\? Its past sales and purchases stay in history\.\{1\})$/;
const CODEY = /^(btn|badge|card|row|col|grid|small|muted|num|input|kbd|faint|big|v num|pin-boxes|nav-item|modal|toast|side|result|id,|\+\+seq|M\d|ecg|'Noto|\(prefers)/;

describe('Languages are complete', () => {
  it('Urdu, Arabic, Hindi and Spanish have every built-in word', () => {
    for (const l of OTHER) {
      const missing = Object.keys(EN_DICT).filter(k => !Object.hasOwn(DICTS[l], k) || !DICTS[l][k].trim());
      expect(missing, l).toEqual([]);
    }
  });

  it('every sentence in the app has all four translations', () => {
    const missing: string[] = [];
    for (const s of sourceSentences()) {
      if (KEEP.test(s) || CODEY.test(s) || /^[a-z]+(-[a-z]+)*$/.test(s)) continue;
      if (PHRASES[s]) continue;
      const sample = s.replace(/\{\d\}/g, 'Panadol');
      if (translateText('ar', sample) === sample) missing.push(s);
    }
    expect(missing).toEqual([]);
  });

  it('every translation has 4 non-empty entries, and keeps the {0} {1} slots', () => {
    for (const [k, v] of Object.entries(PHRASES)) {
      expect(v.length, k).toBe(4);
      const slots = (k.match(/\{\d\}/g) || []).sort().join();
      for (const x of v) { expect(x.trim(), k).not.toBe(''); expect((x.match(/\{\d\}/g) || []).sort().join(), `${k} → ${x}`).toBe(slots); }
    }
  });

  it('fills names and numbers, and translates whole messages made of several sentences', () => {
    expect(translateText('ur', 'Panadol is out of stock')).toBe('Panadol کا سٹاک ختم ہے');
    expect(translateText('es', 'Thank you! Change: Rs 30.00')).toBe('¡Gracias! Cambio: Rs 30.00');
    expect(translateText('ar', "Today's sales Rs 100.00, profit Rs 20.00, 3 bills. Low stock: Panadol — reorder soon."))
      .toBe('مبيعات اليوم Rs 100.00، الربح Rs 20.00، 3 فاتورة. مخزون منخفض: Panadol — اطلب قريبًا.');
    expect(translateText('hi', 'Medicine name nobody wrote')).toBe('Medicine name nobody wrote'); // unknown text is left alone
    expect(translateText('en', 'Settings')).toBe('Settings');
  });

  it('Urdu and Arabic are right-to-left, the others left-to-right', () => {
    expect(LANGS.filter(l => l.rtl).map(l => l.code).sort()).toEqual(['ar', 'ur']);
  });
});
