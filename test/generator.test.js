const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../lib/store');
const { createGenerator } = require('../lib/generator');

const makeWords = (n) =>
  Array.from({ length: n }, (_, i) => ({
    written: `語${i}`,
    reading: `ご${i}`,
    meaning: `meaning ${i}`,
    pos: 'noun',
  }));

function newStore(words = makeWords(20)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpwod-gen-'));
  return new Store({ filePath: path.join(dir, 'state.json'), words, seed: 5 });
}

const okResult = (word, reviewWords = []) => ({
  ok: true,
  content: {
    sentence: `文 ${word.written}`,
    reading: 'よみ',
    translation: 't',
    grammar: 'g',
    usage: 'u',
    review: reviewWords.map((w) => w.written),
  },
});

// Store with entries 2026-05-07 .. 2026-05-10; today is 2026-05-10.
function setup(overrides = {}) {
  const store = newStore();
  store.ensureEntries('2026-05-07', 0);
  store.ensureEntries('2026-05-10', 0);
  const calls = [];
  const checks = [];
  let changes = 0;
  const gen = createGenerator({
    store,
    today: () => '2026-05-10',
    onChange: () => changes++,
    checkServer:
      overrides.checkServer ||
      (async (opts) => {
        checks.push(opts);
        return { status: 'ok' };
      }),
    generate:
      overrides.generate ||
      (async (opts) => {
        calls.push(opts);
        return okResult(opts.word, opts.reviewWords);
      }),
  });
  const dateOf = (written) =>
    Object.entries(store.getState().entries).find(([, e]) => e.key === written)[0];
  return { store, gen, calls, checks, dateOf, changes: () => changes };
}

test('run: ollama-down sets the status and generates nothing', async () => {
  const { gen, calls, store } = setup({ checkServer: async () => ({ status: 'ollama-down' }) });
  await gen.run();
  assert.equal(gen.getStatus().status, 'ollama-down');
  assert.equal(calls.length, 0);
  assert.equal(store.getDay('2026-05-10').content, null);
});

test('run: model-missing sets the status and generates nothing', async () => {
  const { gen, calls } = setup({ checkServer: async () => ({ status: 'model-missing' }) });
  await gen.run();
  assert.equal(gen.getStatus().status, 'model-missing');
  assert.equal(calls.length, 0);
});

test('run: generates today first, then missed days newest first; skips done days', async () => {
  const { gen, calls, store, dateOf } = setup();
  store.setDone('2026-05-08', true);
  await gen.run();
  assert.deepEqual(calls.map((c) => dateOf(c.word.written)), ['2026-05-10', '2026-05-09', '2026-05-07']);
  assert.ok(store.getDay('2026-05-10').content);
  assert.ok(store.getDay('2026-05-09').content);
  assert.equal(store.getDay('2026-05-08').content, null); // done: not generated
  assert.equal(gen.getStatus().status, 'ok');
});

test('run: never generates ahead of today', async () => {
  const { gen, calls, store } = setup();
  store.ensureEntries('2026-05-10', 5); // future entries exist
  await gen.run();
  assert.equal(calls.length, 4);
  assert.equal(store.getDay('2026-05-12').content, null);
});

test('run: passes the host, model, word, and review candidates from the store', async () => {
  const { gen, calls, store } = setup();
  store.setSettings({ host: 'http://127.0.0.1:9999', model: 'test-model' });
  store.setDone('2026-05-07', true);
  await gen.run();
  const today = calls.find((c) => c.word.written === store.getDay('2026-05-10').written);
  assert.equal(today.host, 'http://127.0.0.1:9999');
  assert.equal(today.model, 'test-model');
  assert.deepEqual(
    today.reviewWords.map((w) => w.written),
    store.reviewCandidates('2026-05-10').map((w) => w.written)
  );
  assert.equal(today.reviewWords.length, 1);
  assert.equal(today.reviewWords[0].written, store.getDay('2026-05-07').written);
});

test('run: checks the server once per run, not once per day', async () => {
  const { gen, checks } = setup();
  await gen.run();
  assert.equal(checks.length, 1);
});

test('run: does nothing, and does not touch the server, when nothing is pending', async () => {
  const { gen, checks, calls } = setup();
  await gen.run();
  const callsAfterFirst = calls.length;
  await gen.run();
  assert.equal(checks.length, 1);
  assert.equal(calls.length, callsAfterFirst);
});

test('a generation error on one day does not block the others', async () => {
  let n = 0;
  const { gen, store } = setup({
    generate: async ({ word, reviewWords }) => {
      n++;
      return n === 2
        ? { ok: false, status: 'error', error: 'bad output' }
        : okResult(word, reviewWords);
    },
  });
  await gen.run();
  assert.ok(store.getDay('2026-05-10').content); // 1st ok
  assert.equal(store.getDay('2026-05-09').content, null); // 2nd failed
  assert.ok(store.getDay('2026-05-08').content); // 3rd ok
  assert.ok(store.getDay('2026-05-07').content);
});

test('ollama-down in the middle of a run stops it', async () => {
  let n = 0;
  const { gen, store } = setup({
    generate: async ({ word, reviewWords }) => {
      n++;
      return n === 2
        ? { ok: false, status: 'ollama-down', error: 'gone' }
        : okResult(word, reviewWords);
    },
  });
  await gen.run();
  assert.equal(n, 2);
  assert.equal(gen.getStatus().status, 'ollama-down');
  assert.ok(store.getDay('2026-05-10').content);
  assert.equal(store.getDay('2026-05-09').content, null);
});

test('the status recovers to ok on the next successful run', async () => {
  let down = true;
  const { gen, store } = setup({
    checkServer: async () => ({ status: down ? 'ollama-down' : 'ok' }),
    generate: async ({ word, reviewWords }) => okResult(word, reviewWords),
  });
  await gen.run();
  assert.equal(gen.getStatus().status, 'ollama-down');
  down = false;
  await gen.run();
  assert.equal(gen.getStatus().status, 'ok');
  assert.ok(store.getDay('2026-05-10').content);
});

test('a thrown error is caught and reported as an error status', async () => {
  const { gen } = setup({
    generate: async () => {
      throw new Error('kaboom');
    },
  });
  await gen.run();
  assert.equal(gen.getStatus().status, 'error');
  assert.match(gen.getStatus().error, /kaboom/);
});

test('concurrent runs never generate the same day twice', async () => {
  const calls = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const { gen } = setup({
    generate: async ({ word, reviewWords }) => {
      calls.push(word.written);
      await gate;
      return okResult(word, reviewWords);
    },
  });
  const p1 = gen.run();
  const p2 = gen.run();
  await new Promise((r) => setTimeout(r, 10));
  release();
  await Promise.all([p1, p2]);
  assert.equal(calls.length, 4);
  assert.equal(new Set(calls).size, 4);
});

test('getStatus lists days being generated, and isGenerating tracks them', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { gen } = setup({
    generate: async ({ word, reviewWords }) => {
      await gate;
      return okResult(word, reviewWords);
    },
  });
  const p = gen.run();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(gen.getStatus().generating, ['2026-05-10']);
  assert.equal(gen.isGenerating('2026-05-10'), true);
  assert.equal(gen.isGenerating('2026-05-09'), false);
  release();
  await p;
  assert.deepEqual(gen.getStatus().generating, []);
});

test('onChange fires when a day starts and finishes generating', async () => {
  const { gen, changes } = setup();
  await gen.run();
  assert.ok(changes() >= 8, `expected at least 8 change events, got ${changes()}`); // 2 per day x 4
});

test('regenerate replaces content on success', async () => {
  const { gen, store } = setup();
  await gen.run();
  const before = store.getDay('2026-05-10').content;
  let i = 0;
  const gen2 = createGenerator({
    store,
    today: () => '2026-05-10',
    checkServer: async () => ({ status: 'ok' }),
    generate: async ({ word }) => ({ ok: true, content: { ...before, sentence: `new ${++i} ${word.written}`, review: [] } }),
  });
  const r = await gen2.regenerate('2026-05-10');
  assert.equal(r.ok, true);
  assert.match(store.getDay('2026-05-10').content.sentence, /^new 1/);
});

test('regenerate keeps the old content when generation fails', async () => {
  const { gen, store } = setup();
  await gen.run();
  const before = store.getDay('2026-05-10').content;
  const gen2 = createGenerator({
    store,
    today: () => '2026-05-10',
    checkServer: async () => ({ status: 'ok' }),
    generate: async () => ({ ok: false, status: 'error', error: 'nope' }),
  });
  const r = await gen2.regenerate('2026-05-10');
  assert.equal(r.ok, false);
  assert.deepEqual(store.getDay('2026-05-10').content, before);
  assert.equal(gen2.getStatus().status, 'error');
});

test('regenerate returns started:false for a day already being generated', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { gen } = setup({
    generate: async ({ word, reviewWords }) => {
      await gate;
      return okResult(word, reviewWords);
    },
  });
  const p = gen.run();
  await new Promise((r) => setTimeout(r, 10));
  const r = await gen.regenerate('2026-05-10');
  assert.equal(r.started, false);
  release();
  await p;
});

test('regenerate throws for a day that has no entry', async () => {
  const { gen } = setup();
  await assert.rejects(() => gen.regenerate('2030-01-01'), /No entry/);
});

test('a new local date is picked up on the next run', async () => {
  const store = newStore();
  let day = '2026-05-10';
  const calls = [];
  const gen = createGenerator({
    store,
    today: () => day,
    checkServer: async () => ({ status: 'ok' }),
    generate: async (opts) => {
      calls.push(opts.word.written);
      return okResult(opts.word, opts.reviewWords);
    },
  });
  await gen.run();
  assert.equal(calls.length, 1);
  day = '2026-05-11';
  await gen.run();
  assert.equal(calls.length, 2);
  assert.ok(store.getDay('2026-05-11').content);
});

test('days whose word was removed from the list are skipped, not retried forever', async () => {
  const words = makeWords(20);
  const store = newStore(words);
  store.ensureEntries('2026-05-10', 0);
  const key = store.getState().entries['2026-05-10'].key;
  const dir = path.dirname(store.filePath);
  const shrunk = new Store({
    filePath: path.join(dir, 'state.json'),
    words: words.filter((w) => w.written !== key),
    seed: 5,
  });
  const calls = [];
  const checks = [];
  const gen = createGenerator({
    store: shrunk,
    today: () => '2026-05-10',
    checkServer: async () => {
      checks.push(1);
      return { status: 'ok' };
    },
    generate: async (opts) => {
      calls.push(opts);
      return okResult(opts.word, opts.reviewWords);
    },
  });
  await gen.run();
  assert.equal(calls.length, 0);
  assert.equal(checks.length, 0);
});
