// Puts the vendor app (admin.html) inside worker.js, so you paste ONE file into Cloudflare
// and opening the Worker address shows your dashboard. (Run by the developer, not by you.)
import fs from 'node:fs';
const here = new URL('.', import.meta.url);
const html = fs.readFileSync(new URL('admin.html', here), 'utf8');
const page = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon-192.png"><link rel="apple-touch-icon" href="/icon-192.png">'
  + '<meta name="theme-color" content="#0E8F7E"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="PD Vendor">'
  + '<script>window.PD_WORKER=true;if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{})</script></head><body>' + html + '</body></html>';
// Install as an app (Chrome "Install", iPhone "Add to Home Screen").
const pub = new URL('../public/', here);
const ICONS = { '/icon-192.png': fs.readFileSync(new URL('icon-192.png', pub)).toString('base64'), '/icon-512.png': fs.readFileSync(new URL('icon-512.png', pub)).toString('base64') };
const MANIFEST = { name: 'PharmaDesk Vendor', short_name: 'PD Vendor', id: '/', start_url: '/', scope: '/', display: 'standalone', background_color: '#0A1413', theme_color: '#0E8F7E',
  icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }] };
// Network first (always fresh), so the app still opens from cache when offline.
const SW = "self.addEventListener('install',e=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/shops'))return;e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open('pdv').then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request)))});";
const w = new URL('worker.js', here);
const src = fs.readFileSync(w, 'utf8').replace(/\n\/\/ ADMIN_PAGE[\s\S]*$/, '');
fs.writeFileSync(w, src.trimEnd() + '\n\n// ADMIN_PAGE — generated from admin.html by build-worker.mjs. Do not edit by hand.\nconst ADMIN_HTML = ' + JSON.stringify(page) + ';\nconst ICONS = ' + JSON.stringify(ICONS) + ';\nconst MANIFEST = ' + JSON.stringify(JSON.stringify(MANIFEST)) + ';\nconst SW = ' + JSON.stringify(SW) + ';\n');
console.log('worker.js updated', (fs.statSync(w).size / 1024).toFixed(0), 'KB');
