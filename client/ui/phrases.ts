// Translates every piece of English text shown on screen into the chosen language.
// Two parts:
//  1. translateText(): looks up an English sentence (exact, or a pattern like "{0} is out of stock").
//  2. startTranslator(): watches the page and translates text, placeholders and tooltips as they appear,
//     so no screen, message or pop-up is ever left in English. Typed data (medicine names, inputs) is left alone.
import type { Tr } from './phrases-1.ts';

type Lang = 'en' | 'ur' | 'ar' | 'hi' | 'es';
const COL: Record<Exclude<Lang, 'en'>, number> = { ur: 0, ar: 1, hi: 2, es: 3 };
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const exact = new Map<string, Tr>();
const patterns: { re: RegExp; order: number[]; tr: Tr; fixed: number }[] = [];
let loaded: Promise<void> | null = null;

/** Loads the translation tables once (they are only needed for languages other than English). */
export function loadPhrases(): Promise<void> {
  return loaded ??= import('./phrases-data.ts').then(({ PHRASES }) => usePhrases(PHRASES)).catch(() => { loaded = null; });
}

/** Builds the lookup tables (also used directly by tests). */
export function usePhrases(table: Record<string, Tr>) {
  exact.clear(); patterns.length = 0; cache.clear();
  for (const [k, v] of Object.entries(table)) {
    if (/\{\d\}/.test(k)) {
      const order = [...k.matchAll(/\{(\d)\}/g)].map(m => Number(m[1]));
      const body = k.split(/\{\d\}/).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)');
      patterns.push({ re: new RegExp(`^${body}$`), order, tr: v, fixed: k.replace(/\{\d\}/g, '').length });
    } else exact.set(norm(k), v);
  }
  patterns.sort((a, b) => b.fixed - a.fixed); // most specific pattern wins
}

const MULTI = /[.!?]\s+\S/;
/** Translates one trimmed piece of text; null when nothing is known for it. */
function tr(core: string, col: number, depth = 0): string | null {
  if (depth > 4 || !/[A-Za-z]/.test(core)) return null;
  const ex = exact.get(core);
  if (ex) return ex[col];
  for (const p of patterns) {
    const m = p.re.exec(core);
    if (!m) continue;
    const caps = m.slice(1);
    if (caps.some(c => MULTI.test(c))) break; // several sentences: translate them one by one below
    return p.tr[col].replace(/\{(\d)\}/g, (_, i) => {
      const v = caps[p.order.indexOf(Number(i))] ?? '';
      const lead = v.match(/^\s*/)![0], trail = v.match(/\s*$/)![0];
      const t = tr(norm(v), col, depth + 1);
      return t == null ? v : lead + t + trail;
    });
  }
  const parts = core.split(/(?<=[.!?])\s+(?=["(A-Z])/);
  if (parts.length > 1) {
    const out = parts.map(x => tr(x, col, depth + 1));
    if (out.some(x => x != null)) return out.map((x, i) => x ?? parts[i]).join(' ');
  }
  return null;
}

const cache = new Map<string, string>();
export function translateText(lang: Lang, text: string): string {
  if (lang === 'en' || !text || !/[A-Za-z]/.test(text)) return text;
  const key = `${lang}\u0000${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const lead = text.match(/^\s*/)![0], trail = text.match(/\s*$/)![0];
  const out = tr(norm(text), COL[lang]);
  const res = out == null ? text : lead + out + trail;
  if (cache.size > 20000) cache.clear();
  cache.set(key, res);
  return res;
}

/** Locale for dates and times in the current language (Western digits everywhere, like the money). */
export function dateLocale(): string {
  return ({ en: 'en-GB', ur: 'ur-PK', ar: 'ar-u-nu-latn', hi: 'hi-IN-u-nu-latn', es: 'es-ES' } as Record<Lang, string>)[current];
}

// ── Live page translation ──
const ATTRS = ['placeholder', 'title', 'aria-label'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'NOSCRIPT']);
const textState = new WeakMap<Text, { src: string; shown: string }>();
const attrState = new WeakMap<Element, Record<string, { src: string; shown: string }>>();
let current: Lang = 'en';
let observer: MutationObserver | null = null;

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP.has(e.tagName) || e.getAttribute('translate') === 'no' || e.hasAttribute('data-no-tr') || (e as HTMLElement).isContentEditable) return true;
  }
  return false;
}

function doText(n: Text) {
  if (skipped(n.parentElement)) return;
  const v = n.nodeValue || '';
  const st = textState.get(n);
  const src = st && v === st.shown ? st.src : v;
  const out = translateText(current, src);
  textState.set(n, { src, shown: out });
  if (out !== v) n.nodeValue = out;
}

function doAttrs(el: Element) {
  if (SKIP.has(el.tagName) && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
  let rec = attrState.get(el);
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v == null) continue;
    if (!rec) { rec = {}; attrState.set(el, rec); }
    const st = rec[a];
    const src = st && v === st.shown ? st.src : v;
    const out = translateText(current, src);
    rec[a] = { src, shown: out };
    if (out !== v) el.setAttribute(a, out);
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { doText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) doAttrs(root as Element);
  const doc = root.ownerDocument || (root as Document);
  const tw = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text); else doAttrs(n as Element);
  }
}

/** Switches the whole page to `lang` now, and keeps new content translated. */
export function setPageLanguage(lang: Lang, doc: Document = document) {
  current = lang;
  if (lang !== 'en' && !exact.size) { void loadPhrases().then(() => { if (current === lang) setPageLanguage(lang, doc); }); }
  if (!doc.body || typeof MutationObserver === 'undefined') return;
  if (!observer) {
    observer = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'characterData') doText(m.target as Text);
        else if (m.type === 'attributes') doAttrs(m.target as Element);
        else m.addedNodes.forEach(walk);
      }
    });
    observer.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    // Pop-up questions and messages too.
    const w = doc.defaultView as (Window & typeof globalThis) | null;
    if (w) {
      const c = w.confirm.bind(w), a = w.alert.bind(w), p = w.prompt.bind(w);
      w.confirm = (msg?: string) => c(translateText(current, String(msg ?? '')));
      w.alert = (msg?: unknown) => a(translateText(current, String(msg ?? '')));
      w.prompt = (msg?: string, def?: string) => p(translateText(current, String(msg ?? '')), def);
    }
  }
  walk(doc.body);
}
