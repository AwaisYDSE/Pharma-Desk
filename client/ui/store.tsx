// App state: device database, sync, alerts, printing, language, theme, toasts.
// © Awais Amin
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { openCtx, getMeta, setMeta, type Ctx } from '../core/db.ts';
import { ServerClient, SyncEngine } from '../core/sync.ts';
import { ExpiryMonitor, type Alert } from '../core/monitor.ts';
import { PrintQueue, BrowserPrinter, SerialPrinter } from '../core/print.ts';
import { loadSettings, saveSettings, type Settings } from '../core/settings.ts';
import { restoreSession, enforceSession, logout as doLogout } from '../core/auth.ts';
import { pendingCount } from '../core/outbox.ts';
import { applyLang, translate, type Lang } from './i18n.ts';
import type { User, Shop } from '../../shared/types.ts';

export interface Toast { id: number; kind: 'ok' | 'warn' | 'bad' | 'info'; title: string; body?: string }

export interface Store {
  ctx: Ctx; client: ServerClient; sync: SyncEngine; monitor: ExpiryMonitor; printer: PrintQueue;
  settings: Settings; shop: Shop | null; setSettings: (p: Partial<Settings>) => Promise<void>;
  user: User | null; setUser: (u: User | null) => void;
  online: boolean; pending: number; alerts: Alert[]; version: number;
  lang: Lang; setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  toast: (kind: Toast['kind'], title: string, body?: string) => void;
  toasts: Toast[]; dismiss: (id: number) => void;
  isServerPc: boolean; refresh: () => void;
  logout: (reason?: string) => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

export function useLive<T>(fn: () => Promise<T>, deps: unknown[], initial: T): T {
  const { version } = useStore();
  const [v, setV] = useState<T>(initial);
  useEffect(() => { let on = true; fn().then(r => on && setV(r)).catch(console.error); return () => { on = false; }; }, [version, ...deps]); // eslint-disable-line
  return v;
}

export function AppProvider({ children, onReady }: { children: (s: Store | null) => React.ReactNode; onReady?: () => void }) {
  const [store, setStore] = useState<Store | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [online, setOnline] = useState(false);
  const [pending, setPending] = useState(0);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [version, setVersion] = useState(0);
  const [lang, setLangState] = useState<Lang>('en');
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isServerPc, setIsServerPc] = useState(false);
  const [shop, setShop] = useState<Shop | null>(null);
  const base = useRef<{ ctx: Ctx; client: ServerClient; sync: SyncEngine; monitor: ExpiryMonitor; printer: PrintQueue } | null>(null);
  const tid = useRef(0);

  const toast = useCallback((kind: Toast['kind'], title: string, body?: string) => {
    const id = ++tid.current;
    setToasts(ts => [...ts.slice(-3), { id, kind, title, body }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), kind === 'bad' ? 9000 : 5000);
  }, []);

  useEffect(() => {
    (async () => {
      const ctx = await openCtx();
      const client = new ServerClient(ctx);
      const sync = new SyncEngine(ctx, client);
      const monitor = new ExpiryMonitor(ctx, setAlerts);
      const s = await loadSettings(ctx.db);
      const driver = s.printer === 'serial' && 'serial' in navigator ? new SerialPrinter() : new BrowserPrinter();
      const printer = new PrintQueue(ctx, driver, async () => {
        const s0 = await loadSettings(ctx.db), sh = await ctx.db.shop.get('shop');
        return sh ? { ...s0, storeName: sh.name || s0.storeName, logoDataUrl: sh.logo || '', address: sh.address ?? s0.address, phone: sh.phone ?? s0.phone, ntn: sh.ntn ?? s0.ntn, strn: sh.strn ?? s0.strn, drugLicense: sh.drugLicense ?? s0.drugLicense, receiptFooter: sh.receiptFooter || s0.receiptFooter } : s0;
      });
      base.current = { ctx, client, sync, monitor, printer };
      const l = ((await getMeta<Lang | null>(ctx.db, 'lang', null)) || (s.language as Lang) || 'en') as Lang;
      setLangState(l); applyLang(l);
      document.documentElement.dataset.theme = s.theme === 'system' ? '' : s.theme;
      setSettingsState(s);
      // Is this the server PC itself? (served from localhost by the shop server)
      try {
        const r = await fetch('/local/status');
        if (r.ok) {
          setIsServerPc(true);
          if (!ctx.pairing) {
            const st = await r.json();
            if (!st.needsOwner) {
              const p = await (await fetch('/local/self-pair', { method: 'POST' })).json();
              if (p.token) {
                const pairing = { serverId: p.serverId, serverName: p.serverName, token: p.token, deviceId: p.deviceId, beaconKey: p.beaconKey, urls: [location.origin] };
                await setMeta(ctx.db, 'pairing', pairing); ctx.pairing = pairing; ctx.deviceId = p.deviceId;
              }
            }
          }
        }
      } catch { /* opened from GitHub Pages or a phone */ }
      ctx.listeners.add((ev, data) => {
        if (ev === 'online') setOnline(!!data);
        if (['data-changed', 'sale', 'stock-changed', 'users-changed', 'printed', 'auth-changed'].includes(ev)) setVersion(v => v + 1);
        if (ev === 'fefo-reallocated') toast('warn', 'FEFO', 'A batch had run out on another counter; the sale was moved to the next earliest-expiring batch.');
        if (ev === 'stock-conflict') toast('warn', 'Stock mismatch', 'More was sold offline than was in stock. Please count the shelf and receive stock.');
        if (ev === 'op-rejected') toast('bad', 'Not saved on server', String((data as { message?: string })?.message || ''));
        if (ev === 'print-error') toast('warn', 'Printer offline', 'The receipt is queued and will print when the printer is back. You can also download it.');
        if (ev === 'unpaired') toast('bad', 'Disconnected', String(data));
        if (ev === 'session-ended') { void doLogout(ctx, null, String(data || '')).then(() => setUser(null)); toast('warn', 'Signed out', String(data || '')); }
      });
      const u = await restoreSession(ctx);
      setUser(u);
      if (ctx.pairing) sync.start(5000);
      monitor.start();
      setInterval(async () => {
        setPending(await pendingCount(ctx));
        const why = await enforceSession(ctx, client);
        if (why) { setUser(null); toast('warn', 'Signed out', why); }
      }, 4000);
      void printer.process();
      setVersion(1);
      onReady?.();
    })().catch(e => { console.error(e); document.body.innerHTML = `<pre style="padding:20px;color:#b91c1c">PharmaDesk could not start: ${String(e?.message || e)}</pre>`; });
  }, []); // eslint-disable-line

  useEffect(() => { if (base.current) base.current.ctx.db.shop.get('shop').then(s => setShop(s || null)).catch(() => {}); }, [version]);

  const value = useMemo<Store | null>(() => {
    if (!base.current || !settings) return null;
    const b = base.current;
    // Shop name, logo and receipt details come from the synced shop profile (same on every device).
    const merged: Settings = shop ? { ...settings, storeName: shop.name || settings.storeName, logoDataUrl: shop.logo || '', address: shop.address ?? settings.address, phone: shop.phone ?? settings.phone, ntn: shop.ntn ?? settings.ntn, strn: shop.strn ?? settings.strn, drugLicense: shop.drugLicense ?? settings.drugLicense, receiptFooter: shop.receiptFooter || settings.receiptFooter } : settings;
    return {
      ...b, settings: merged, shop, user, setUser, online, pending, alerts, version, lang, isServerPc, toasts,
      setSettings: async p => { setSettingsState(await saveSettings(b.ctx.db, p)); if (p.theme) document.documentElement.dataset.theme = p.theme === 'system' ? '' : p.theme; },
      setLang: l => { setLangState(l); applyLang(l); void setMeta(b.ctx.db, 'lang', l); },
      t: (k, v) => translate(lang, k, v),
      toast, dismiss: id => setToasts(ts => ts.filter(x => x.id !== id)),
      refresh: () => setVersion(v => v + 1),
      logout: async reason => { await doLogout(b.ctx, b.client, reason); setUser(null); },
    };
  }, [settings, shop, user, online, pending, alerts, version, lang, isServerPc, toasts, toast]);

  return <Ctx.Provider value={value}>{children(value)}</Ctx.Provider>;
}
