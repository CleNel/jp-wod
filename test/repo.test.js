const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_SETTINGS } = require('../lib/store');

const root = path.join(__dirname, '..');
// Windows checkouts may use CRLF; compare on LF.
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(read('package.json'));

// ---------- CI workflow ----------

test('workflow: runs the tests on push to main and on every pull request', () => {
  const wf = read('.github', 'workflows', 'test.yml');
  assert.match(wf, /^on:\n\s+push:\n\s+branches: \[main\]\n\s+pull_request:/m);
});

test('workflow: Windows runner, Node 24, npm ci, npm test', () => {
  const wf = read('.github', 'workflows', 'test.yml');
  assert.match(wf, /runs-on: windows-latest/);
  assert.match(wf, /node-version: 24/);
  assert.match(wf, /run: npm ci/);
  assert.match(wf, /run: npm test/);
  assert.match(wf, /cache: npm/);
});

test('workflow: skips the Electron download, is read-only, uses no secrets, has no audit step', () => {
  const wf = read('.github', 'workflows', 'test.yml');
  assert.match(wf, /ELECTRON_SKIP_BINARY_DOWNLOAD: '1'/);
  assert.match(wf, /permissions:\n\s+contents: read/);
  assert.doesNotMatch(wf, /secrets\./);
  assert.doesNotMatch(wf, /audit/);
});

test('workflow: the Node version satisfies package.json engines', () => {
  const wf = read('.github', 'workflows', 'test.yml');
  const ci = Number(/node-version: (\d+)/.exec(wf)[1]);
  const min = /^>=\s*(\d+)/.exec(pkg.engines.node);
  assert.ok(min, 'engines.node must be a ">=N" range');
  assert.ok(ci >= Number(min[1]));
});

test('engines: Node 22.2 or newer (zlib.crc32 and the built-in test glob)', () => {
  assert.match(pkg.engines.node, /^>=22\.2/);
});

// ---------- line endings ----------

test('.gitattributes: LF in every checkout, binaries left alone', () => {
  const attrs = read('.gitattributes');
  assert.match(attrs, /^\* text=auto eol=lf$/m);
  assert.match(attrs, /^\*\.png binary$/m);
  assert.match(attrs, /^\*\.ico binary$/m);
});

// ---------- README ----------

const readme = read('README.md');

test('README: has the sections a new user needs', () => {
  for (const heading of [
    'Requirements',
    'Quick start',
    'How it works',
    'Adding words',
    'Where your data is stored',
    'Development',
    'License',
  ]) {
    assert.match(readme, new RegExp(`^## ${heading}`, 'm'), heading);
  }
});

test('README: shows a screenshot that exists and is a PNG', () => {
  const m = /!\[[^\]]*\]\((docs\/[^)]+\.png)\)/.exec(readme);
  assert.ok(m, 'no screenshot image reference to docs/*.png');
  const buf = fs.readFileSync(path.join(root, m[1]));
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('README: the setup commands exist and use the real default model', () => {
  assert.ok(readme.includes(`ollama pull ${DEFAULT_SETTINGS.model}`), 'ollama pull <default model>');
  assert.ok(readme.includes('npm start'));
  assert.ok(readme.includes('npm install'));
  const scripts = [...readme.matchAll(/npm run ([a-z:-]+)/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0);
  for (const s of scripts) assert.ok(pkg.scripts[s], `README mentions "npm run ${s}" but package.json has no such script`);
});

test('README: documents the word format, the data location, and the host setting', () => {
  assert.ok(readme.includes('written|reading|meaning|part of speech'));
  assert.ok(readme.includes('data/words.txt'));
  assert.ok(readme.includes('%APPDATA%\\jp-wod'));
  assert.ok(readme.includes('state.json'));
  assert.ok(readme.includes(DEFAULT_SETTINGS.host));
});

test('README: relative links point at files that exist', () => {
  const links = [...readme.matchAll(/\]\(((?!https?:|#)[^)\s]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length > 0);
  for (const l of links) assert.ok(fs.existsSync(path.join(root, l.split('#')[0])), `broken link: ${l}`);
});

test('README: is honest about the limits', () => {
  assert.match(readme, /unsigned|SmartScreen/i);
  assert.match(readme, /wrong|mistake|check/i); // model output can be wrong
  assert.match(readme, /Windows/);
});

test('workflow: actions are on versions that run on Node 24, not the deprecated Node 20 (v5 or newer)', () => {
  const wf = read('.github', 'workflows', 'test.yml');
  const uses = [...wf.matchAll(/uses: (actions\/[a-z-]+)@v(\d+)/g)];
  assert.ok(uses.length >= 2, 'expected checkout and setup-node');
  for (const [, action, major] of uses) {
    assert.ok(Number(major) >= 5, `${action}@v${major} runs on the deprecated Node 20`);
  }
});
