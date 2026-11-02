// Used by the "Publish an update" button. Raises the version by one and records must or optional.
import fs from 'node:fs';
const kind = process.env.KIND === 'must' ? 'must' : 'optional';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const [a, b, c] = pkg.version.split('.').map(Number);
const version = `${a}.${b}.${(c || 0) + 1}`;
pkg.version = version;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
lock.version = version; if (lock.packages?.['']) lock.packages[''].version = version;
fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
const rel = JSON.parse(fs.readFileSync('release.json', 'utf8'));
fs.writeFileSync('release.json', JSON.stringify({ ...rel, version, mandatory: kind === 'must', notes: process.env.NOTES || '' }, null, 2) + '\n');
fs.writeFileSync('shared/version.ts', fs.readFileSync('shared/version.ts', 'utf8').replace(/APP_VERSION = '[^']*'/, `APP_VERSION = '${version}'`));
console.log(`Version ${version} (${kind})`);
