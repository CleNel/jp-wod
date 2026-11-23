const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const build = pkg.build || {};

test('scripts: start runs electron, dist builds the Windows installer', () => {
  assert.equal(pkg.scripts.start, 'electron .');
  assert.match(pkg.scripts.dist, /^electron-builder\b.*--win/);
  assert.ok(pkg.scripts.pack, 'a pack script (unpacked build) exists for quick checks');
});

test('dependencies: kuromoji ships with the app; electron and the builder are dev-only', () => {
  assert.ok(pkg.dependencies.kuromoji, 'kuromoji must be a runtime dependency or the installer leaves it out');
  assert.ok(pkg.devDependencies.electron);
  assert.ok(pkg.devDependencies['electron-builder']);
  assert.equal(pkg.dependencies.electron, undefined);
  assert.equal(pkg.dependencies['electron-builder'], undefined);
});

test('build: app id matches the one main.js sets, and the product name is JP WOD', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.equal(build.productName, 'JP WOD');
  assert.ok(main.includes(`setAppUserModelId('${build.appId}')`), 'appId and setAppUserModelId must match');
});

test('build: a per-user NSIS installer for 64-bit Windows with the multi-size icon', () => {
  const targets = build.win.target.map((t) => (typeof t === 'string' ? t : t.target));
  assert.deepEqual(targets, ['nsis']);
  assert.equal(build.win.icon, 'build/icon.ico');
  assert.ok(fs.existsSync(path.join(root, build.win.icon)));
  assert.equal(build.nsis.perMachine, false, 'no admin rights needed');
});

test('build: uninstalling never deletes the user data in %APPDATA%', () => {
  assert.equal(build.nsis.deleteAppDataOnUninstall, false);
});

test('build: only runtime files are packaged, and everything main.js needs is included', () => {
  const files = build.files;
  assert.ok(Array.isArray(files));
  for (const needed of ['main.js', 'preload.js', 'lib/', 'renderer/', 'assets/', 'data/']) {
    assert.ok(files.some((f) => f.startsWith(needed)), `missing ${needed}`);
  }
  for (const f of files) {
    if (f.startsWith('!')) continue;
    assert.ok(fs.existsSync(path.join(root, f.split('*')[0].replace(/\/$/, ''))), `${f} does not exist`);
    assert.doesNotMatch(f, /^(test|scripts|reference|dist|PLAN)/, `${f} is not a runtime file`);
  }
});

test('build: output goes to dist (which is git-ignored)', () => {
  assert.equal(build.directories.output, 'dist');
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(gitignore, /^dist\/?$/m);
});

test('every relative require in main.js resolves inside the packaged folders', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const required = [...main.matchAll(/require\('(\.\/[^']+)'\)/g)].map((m) => m[1]);
  assert.ok(required.length > 5);
  for (const r of required) {
    assert.ok(fs.existsSync(path.join(root, `${r}.js`)), r);
    assert.match(r, /^\.\/lib\//, `${r} must live in lib/ (packaged via lib/**)`);
  }
});
