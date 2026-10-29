// Code checks that catch whole classes of screen bugs.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'client', 'ui');
const files: string[] = [];
const walk = (d: string) => fs.readdirSync(d).forEach(f => { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.tsx')) files.push(p); });
walk(root);

// Banned words are stored encoded so they never appear in the code itself.
const BANNED = new RegExp(["YXdhaXNhbWluXHMqbGxj", "YXdhaXNhbWlubGxj", "c2hvdXE=", "ZnJlZSBmb3IgZXZlcnk="].map(w => Buffer.from(w, 'base64').toString()).join('|'), 'i');

describe('Screens', () => {
  it('every button with its own action is type="button", so it can never submit a form by accident', () => {
    const bad: string[] = [];
    for (const f of files) {
      const s = fs.readFileSync(f, 'utf8');
      for (const m of s.matchAll(/<(motion\.)?button\b/g)) {
        let j = m.index! + m[0].length, depth = 0;
        for (; j < s.length; j++) { const c = s[j]; if (c === '{') depth++; else if (c === '}') depth--; else if (c === '>' && depth === 0) break; }
        const tag = s.slice(m.index!, j);
        if (tag.includes('onClick') && !tag.includes('type=')) bad.push(`${path.basename(f)}:${s.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the forbidden company name and marketing words appear nowhere', () => {
    const all = [...files, ...fs.readdirSync(path.resolve(root, '..', '..', 'shared')).map(f => path.resolve(root, '..', '..', 'shared', f))];
    for (const f of all) {
      if (fs.statSync(f).isDirectory()) continue;
      expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(BANNED);
    }
  });
});
