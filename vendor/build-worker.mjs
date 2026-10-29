// Puts the vendor app (admin.html) inside worker.js, so you paste ONE file into Cloudflare
// and opening the Worker address shows your dashboard. (Run by the developer, not by you.)
import fs from 'node:fs';
const here = new URL('.', import.meta.url);
const html = fs.readFileSync(new URL('admin.html', here), 'utf8');
const page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><script>window.PD_WORKER=true</script></head><body>' + html + '</body></html>';
const w = new URL('worker.js', here);
const src = fs.readFileSync(w, 'utf8').replace(/\n\/\/ ADMIN_PAGE[\s\S]*$/, '');
fs.writeFileSync(w, src.trimEnd() + '\n\n// ADMIN_PAGE — generated from admin.html by build-worker.mjs. Do not edit by hand.\nconst ADMIN_HTML = ' + JSON.stringify(page) + ';\n');
console.log('worker.js updated', (fs.statSync(w).size / 1024).toFixed(0), 'KB');
