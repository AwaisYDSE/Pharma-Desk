// Bundles the shop server into one file so pharmacy owners only need Node.js — no npm install.
import { build } from 'esbuild';
import fs from 'node:fs';
const out = 'release/PharmaDesk';
fs.rmSync('release', { recursive: true, force: true });
fs.mkdirSync(`${out}/server`, { recursive: true });
await build({
  entryPoints: ['server/main.ts'], bundle: true, platform: 'node', target: 'node22', format: 'esm', outfile: `${out}/server/server.mjs`,
  external: ['node:sqlite'], legalComments: 'none', logLevel: 'warning',
  banner: { js: "/* PharmaDesk server — © Awais Amin · MIT */\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
fs.cpSync('dist', `${out}/dist`, { recursive: true });
for (const f of fs.readdirSync('windows')) fs.copyFileSync(`windows/${f}`, `${out}/${f}`);
fs.copyFileSync('LICENSE', `${out}/LICENSE.txt`);
console.log('release ready:', out);
