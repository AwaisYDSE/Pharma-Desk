// Builds the app into dist/ (served by the shop server and by GitHub Pages).
import { build } from 'esbuild';
import fs from 'node:fs';
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist');
await build({
  entryPoints: { app: 'client/ui/main.tsx' }, bundle: true, minify: true, format: 'esm', target: ['es2020', 'safari15'],
  outdir: 'dist', sourcemap: false, define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none',
  banner: { js: '/* PharmaDesk — © Awais Amin · MIT */' }, splitting: true, chunkNames: 'chunks/[name]-[hash]', logLevel: 'warning',
});
fs.cpSync('public', 'dist', { recursive: true });
fs.writeFileSync('dist/.nojekyll', '');
// The offline cache gets every app file (all screens and all languages), versioned by content,
// so a phone that goes offline right after installing still has everything.
import crypto from 'node:crypto';
const chunks = fs.readdirSync('dist/chunks').map(f => `./chunks/${f}`);
const hash = crypto.createHash('sha1');
for (const f of ['app.js', 'app.css', ...chunks.map(c => c.slice(2))]) hash.update(fs.readFileSync(`dist/${f}`));
const sw = fs.readFileSync('dist/sw.js', 'utf8')
  .replace("'pharmadesk-v2'", `'pharmadesk-${hash.digest('hex').slice(0, 10)}'`)
  .replace("'./brand/logo-mark.png']", `'./brand/logo-mark.png', ${chunks.map(c => `'${c}'`).join(', ')}]`);
fs.writeFileSync('dist/sw.js', sw);
const kb = f => (fs.statSync(`dist/${f}`).size / 1024).toFixed(0) + ' KB';
console.log('built dist/: app.js', kb('app.js'), '· app.css', kb('app.css'));
