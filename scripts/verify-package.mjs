import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const pkg = readJson(path.join(root, 'package.json'));
const lock = readJson(path.join(root, 'package-lock.json'));
assert.equal(pkg.name, 'bb-plugin-agent-board');
assert.equal(pkg.version, lock.version);
assert.equal(pkg.version, lock.packages[''].version);
assert.deepEqual(pkg.dependencies, lock.packages[''].dependencies);
assert.deepEqual(pkg.devDependencies, lock.packages[''].devDependencies);
assert.deepEqual(pkg.engines, lock.packages[''].engines);
assert.equal(pkg.bb.server, './server.ts');
assert.equal(pkg.bb.app, './app.tsx');

const temp = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'agent-board-pack-'));
assert(process.env.npm_execpath, 'Run through npm run verify:package');
const [pack] = JSON.parse(execFileSync(process.execPath,
  [process.env.npm_execpath, 'pack', '--json', '--ignore-scripts', '--pack-destination', temp],
  { cwd: root, encoding: 'utf8' }));
assert.equal(pack.name, pkg.name);
assert.equal(pack.version, pkg.version);
assert.deepEqual(pack.bundled, []);
const archive = path.join(temp, pack.filename);
const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/);
const modes = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/);
assert.equal(entries.length, pack.entryCount);
assert.equal(new Set(entries).size, entries.length);
assert(modes.every(line => line.startsWith('-')), 'Only regular files may be packed');
const allowed = new Set(pack.files.map(file => `package/${file.path}`));
for (const entry of entries) {
  assert(allowed.has(entry), `Unexpected archive member: ${entry}`);
  assert(entry.startsWith('package/') && !entry.includes('\\') && !entry.split('/').includes('..'));
  const name = entry.slice('package/'.length);
  assert(!/(^|\/)(?:\.git|\.github|\.ssh|\.aws|\.codex|\.agents|node_modules|tests|scripts|evidence|coverage|\.cache|\.vite)(\/|$)/.test(name), name);
  assert(!/(^|\/)(?:\.env(?:\..*)?|\.npmrc|auth\.json|auth-secret|PHASE1_[^/]*)(\/|$)/.test(name), name);
  assert(!/\.(?:sqlite\w*|db(?:-\w+)?|log|jpg|png|tgz)$/i.test(name), name);
}
const required = [
  'package.json', 'server.ts', 'app.tsx', 'app.css', 'contract/rpc.ts',
  'dist/server.js', 'dist/server.js.map', 'dist/server.meta.json',
  'dist/app.js', 'dist/app.css', 'dist/app.meta.json', 'dist/package.json',
  'README.md', 'LICENSE', 'RELEASE_NOTES.md', 'CHANGELOG.md',
  'PLUGIN_OVERVIEW.md', 'docs/upgrade-0.7.0.md',
];
for (const name of required) assert(allowed.has(`package/${name}`), `Missing runtime/document asset: ${name}`);

fs.mkdirSync(path.join(temp, 'extracted'));
execFileSync('tar', ['-xzf', archive, '-C', path.join(temp, 'extracted')]);
for (const file of pack.files) {
  const packed = fs.readFileSync(path.join(temp, 'extracted', 'package', file.path));
  assert(packed.equals(fs.readFileSync(path.join(root, file.path))), `Stale asset: ${file.path}`);
  assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/.test(packed.toString('utf8')), `Credential pattern: ${file.path}`);
}
for (const side of ['app', 'server']) {
  const meta = readJson(path.join(temp, 'extracted', 'package', 'dist', `${side}.meta.json`));
  assert.equal(meta.pluginId, 'agent-board');
  assert.equal(meta.pluginVersion, pkg.version);
  assert.equal(meta.artifactFormatVersion, 1);
  assert.equal(meta.builtWith.bbVersion, '0.46.0');
}
const sha256 = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
console.log(JSON.stringify({ pluginId: 'agent-board', version: pkg.version, files: entries.length, size: pack.size, sha256 }));
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Verified **agent-board ${pkg.version}**: ${entries.length} packed files; fresh frontend/backend assets; SHA-256 \`${sha256}\`.\n`);
}
