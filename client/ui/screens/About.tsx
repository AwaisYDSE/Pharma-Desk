// Credits: PharmaDesk was designed and developed by Awais Amin.
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon, FloatingPills } from '../components.tsx';
import { useStore } from '../store.tsx';
import { translate } from '../i18n.ts';

const LINE_UR = 'تیار کردہ: اویس امین';

function Typed({ text, speed = 45, delay = 0 }: { text: string; speed?: number; delay?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let i = 0, id: ReturnType<typeof setInterval> | undefined;
    setN(0);
    const start = setTimeout(() => {
      id = setInterval(() => { i++; setN(i); if (i >= text.length) clearInterval(id); }, speed);
    }, delay);
    return () => { clearTimeout(start); clearInterval(id); };
  }, [text, speed, delay]);
  // Typed in the chosen language; the page translator must not touch half-typed words.
  return <><span data-no-tr="">{[...text].slice(0, n).join('')}</span><motion.span animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: .8 }} aria-hidden="true">|</motion.span></>;
}

export function Heart({ size = 22 }: { size?: number }) {
  return (
    <motion.svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" animate={{ scale: [1, 1.25, 1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 1.4 }}>
      <path d="M12 21s-7.5-4.6-9.5-9.2C1 8.3 3.2 5 6.6 5c2 0 3.4 1.1 5.4 3.2C14 6.1 15.4 5 17.4 5 20.8 5 23 8.3 21.5 11.8 19.5 16.4 12 21 12 21z" fill="#F43F5E" />
    </motion.svg>
  );
}

/** Animated welcome shown for a moment when the app opens. */
export function Splash({ onDone }: { onDone: () => void }) {
  const { lang } = useStore();
  const line = translate(lang, 'credits');
  useEffect(() => { const t = setTimeout(onDone, 2600); return () => clearTimeout(t); }, [onDone]);
  return (
    <AnimatePresence>
      <motion.div className="auth" style={{ position: 'fixed', inset: 0, zIndex: 200, cursor: 'pointer' }} onClick={onDone} exit={{ opacity: 0 }} initial={{ opacity: 1 }}>
        <FloatingPills />
        <div className="col" style={{ alignItems: 'center', gap: 14, position: 'relative' }}>
          <motion.img src="./brand/logo-mark.png" alt="" style={{ width: 170 }} initial={{ scale: 0, rotate: -120 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 150, damping: 12 }} />
          <motion.div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-.02em', color: '#E2E8F0', textAlign: 'center', lineHeight: 1.1 }} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: .35 }}>
            Pharmacy <span style={{ display: 'block', fontSize: 16, letterSpacing: '.5em', fontWeight: 600, color: '#5EEAD4' }}>SOFTWARE</span>
          </motion.div>
          <motion.svg width="240" height="40" viewBox="0 0 240 40" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .5 }}>
            <motion.path d="M0 22h80l10-16 12 30 11-34 10 20h117" fill="none" stroke="#2DD4BF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, delay: .5 }} />
          </motion.svg>
          <motion.div className="row" style={{ fontSize: 15, color: '#CBD5E1', justifyContent: 'center' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .9 }}>
            <Typed text={line} delay={900} speed={35} /> <Heart size={18} />
          </motion.div>
          <motion.div dir="rtl" lang="ur" style={{ fontFamily: "'Noto Nastaliq Urdu', serif", fontSize: 16, color: '#99F6E4', lineHeight: 2.2 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.8 }}>
            تیار کردہ: اویس امین
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

export function About() {
  const { lang } = useStore();
  const line = translate(lang, 'credits');
  const facts = [
    ['Designed & coded by', 'Awais Amin'], ['Made for', 'Medical stores in Pakistan and beyond'],
    ['Licence', 'Commercial — one key per shop'], ['Contact / support', 'awaisdpw.co@gmail.com'],
  ];
  return (
    <>
      <motion.section className="card col" style={{ alignItems: 'center', textAlign: 'center', gap: 14, padding: '40px 20px', position: 'relative', overflow: 'hidden', background: 'radial-gradient(700px 300px at 50% -20%, var(--accentSoft), transparent), var(--panel)' }}
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <motion.img src="./brand/logo-full.png" alt="Pharmacy Software by Awais Amin" className="brand-logo" style={{ width: 'min(340px, 80%)' }} initial={{ scale: .9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} whileHover={{ scale: 1.03 }} />
        <div className="row" style={{ justifyContent: 'center', fontSize: 18, fontWeight: 700 }}><Typed text={line} speed={40} /><Heart /></div>
        {lang !== 'ur' && <p dir="rtl" lang="ur" style={{ margin: 0, fontFamily: "'Noto Nastaliq Urdu', serif", fontSize: 20, lineHeight: 2.4, color: 'var(--accent)' }}>{LINE_UR}</p>}
        <div className="col" style={{ maxWidth: 720, gap: 12, textAlign: 'start', lineHeight: 1.75 }}>
          <p style={{ margin: 0 }}>
            PharmaDesk was designed and developed by <strong>Awais Amin</strong>. He built it to give
            every medical store — from a small corner pharmacy to a busy chain counter — the same tools that large pharmacies pay for:
            fast billing, batch and expiry control, stock that stays correct across every counter and phone, and full oversight for the owner.
          </p>
          <p style={{ margin: 0 }} className="muted">
            Every part of PharmaDesk, from the shop server and offline sync to the Urdu screens and the AI prescription reader, was planned
            around how pharmacies in Pakistan actually work: unreliable power and internet, mixed staff, credit customers and strict expiry rules.
            It helps pharmacies serve patients safely and keep their business in their own hands.
          </p>
        </div>
      </motion.section>
      <div className="grid g-auto">
        {facts.map(([k, v], i) => (
          <motion.div key={k} className="card col" style={{ gap: 4 }} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1 + i * .07 }} whileHover={{ y: -4 }}>
            <span className="small muted">{k}</span><strong style={{ fontSize: 17 }}>{v}</strong>
          </motion.div>
        ))}
      </div>
      <p className="small faint" style={{ textAlign: 'center' }}>Buy, renew or get support by email. Free support for 1 month from purchase, then charges apply.<br /><a href="mailto:awaisdpw.co@gmail.com" style={{ color: '#5EEAD4' }} data-no-tr="">awaisdpw.co@gmail.com</a></p>
      <p className="small faint" style={{ textAlign: 'center' }}>© {new Date().getFullYear()} Awais Amin · Commercial licence, all rights reserved</p>
    </>
  );
}
