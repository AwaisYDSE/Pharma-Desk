// PharmaDesk app entry. © Awais Amin · MIT
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import { AppProvider, useStore } from './store.tsx';
import { Toasts , ConfirmHost} from './components.tsx';
import { OwnerSetup, PairScreen, LoginScreen, LicenseGate, type LicenseInfo } from './screens/Auth.tsx';
import { Shell, MoreMenu } from './screens/Shell.tsx';
import { Pos } from './screens/Pos.tsx';
import { Dashboard, Reports } from './screens/Dashboard.tsx';
import { Inventory, Purchases, Parties, Invoices, Alerts } from './screens/Stock.tsx';
import { Users } from './screens/Users.tsx';
import { Settings } from './screens/Settings.tsx';
import { About, Splash } from './screens/About.tsx';
import { can, NAV_MODULES as MODULES } from '../../shared/permissions.ts';
import './styles.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error('UI error', err); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="page"><div className="card col">
        <h2>Something went wrong on this screen</h2>
        <p className="muted">Your data is safe — every sale is saved before it is shown. Go back and try again.</p>
        <code className="small faint">{this.state.err.message}</code>
        <button type="button" className="btn primary" onClick={() => this.setState({ err: null })}>Go back</button>
      </div></div>
    );
  }
}

function App() {
  const { ctx, user, isServerPc } = useStore();
  const [needsOwner, setNeedsOwner] = useState<boolean | null>(null);
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [, setPaired] = useState(0);
  const [route, setRoute] = useState<string>(() => location.hash.replace('#/', '') || '');
  const [navKey, setNavKey] = useState(0);
  const [choosing, setChoosing] = useState<null | 'standalone'>(null);
  const [splash, setSplash] = useState(() => { try { return !sessionStorage.getItem('pd-splash'); } catch { return true; } });
  const endSplash = React.useCallback(() => { setSplash(false); try { sessionStorage.setItem('pd-splash', '1'); } catch { /* private mode */ } }, []);
  useEffect(() => {
    if (!isServerPc) { setNeedsOwner(false); return; }
    fetch('/local/status').then(r => r.json()).then(s => { setNeedsOwner(!!s.needsOwner); setLicense(s.license || null); }).catch(() => setNeedsOwner(false));
  }, [isServerPc]);
  const go = (r: string) => { setRoute(r); history.replaceState(null, '', `#/${r}`); };
  useEffect(() => {
    const h = (e: Event) => { go((e as CustomEvent<string>).detail); setNavKey(k => k + 1); };
    window.addEventListener('pd-nav', h);
    return () => window.removeEventListener('pd-nav', h);
  }, []);

  if (splash) return <Splash onDone={endSplash} />;
  if (needsOwner === null) return null;
  // Licensed build on the server PC: must have a valid key before anything else.
  // (A paused or ended plan does not block the app — it opens read-only, with billing off.)
  if (license?.on && license.needsKey) return <LicenseGate info={license} onActivated={() => location.reload()} />;
  if (needsOwner) return <OwnerSetup onDone={() => location.reload()} />;
  if (choosing === 'standalone' && !ctx.pairing && !ctx.standalone) return <OwnerSetup standalone onBack={() => setChoosing(null)} onDone={() => { setChoosing(null); setPaired(n => n + 1); }} />;
  if (!ctx.pairing && !ctx.standalone) return <PairScreen onPaired={() => setPaired(n => n + 1)} />;
  if (!user) return <LoginScreen />;

  const first = can(user, 'pos') ? 'pos' : MODULES.find(m => can(user, m.key))?.key || 'settings';
  const r = route === 'more' || route === 'about' || (MODULES.some(m => m.key === route) && can(user, route)) ? route : first;
  const screens: Record<string, React.ReactNode> = {
    dashboard: <Dashboard />, pos: <Pos />, invoices: <Invoices />, inventory: <Inventory />, purchases: <Purchases />,
    suppliers: <Parties kind="suppliers" />, patients: <Parties kind="patients" />, alerts: <Alerts />, reports: <Reports />,
    users: <Users />, settings: <Settings />, more: <MoreMenu go={go} />, about: <About />,
  };
  return <Shell route={r} go={go}><ErrorBoundary key={r + navKey}>{screens[r]}</ErrorBoundary></Shell>;
}

createRoot(document.getElementById('root')!).render(
  <MotionConfig reducedMotion="user">
    <AppProvider>{s => s ? <><App /><Toasts /><ConfirmHost /></> : null}</AppProvider>
  </MotionConfig>,
);

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
