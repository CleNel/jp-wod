const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, DEFAULT_SETTINGS } = require('../lib/store');
const { createApi } = require('../lib/api');

const makeWords = (n) =>
  Array.from({ length: n }, (_, i) => ({
    written: `語${i}`,
    reading: `ご${i}`,
    meaning: `meaning ${i}`,
    pos: 'noun',
  }));

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpwod-api-'));
  const store = new Store({ filePath: path.join(dir, 'state.json'), words: makeWords(20), seed: 3 });
  store.ensureEntries('2026-05-07', 0);
  const calls = { run: 0, regenerate: [], notify: 0 };
  const generating = new Set();
  const generator = {
    run: async () => {
      calls.run++;
    },
    regenerate: async (date) => {
      calls.regenerate.push(date);
      return { started: true, ok: true };
    },
    isGenerating: (d) => generating.has(d),
    getStatus: () => ({ status: 'ok', error: null, generating: [...generating] }),
  };
  const api = createApi({
    store,
    generator,
    today: () => '2026-05-10',
    notify: () => calls.notify++,
  });
  return { api, store, calls, generating };
}

test('overview ensures entries for today and lists days newest first', () => {
  const { api } = setup();
  const days = api.overview();
  assert.deepEqual(days.map((d) => d.date), ['2026-05-10', '2026-05-09', '2026-05-08', '2026-05-07']);
  assert.equal(days[0].isToday, true);
  assert.equal(days[1].missed, true);
});

test('overview items have no content payload but say whether content exists and is generating', () => {
  const { api, store, generating } = setup();
  api.overview(); // creates entries
  store.setContent('2026-05-09', { sentence: 's', reading: 'r', translation: 't', grammar: 'g', usage: 'u', review: [] });
  generating.add('2026-05-10');
  const days = api.overview();
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  assert.equal('content' in byDate['2026-05-09'], false);
  assert.equal(byDate['2026-05-09'].hasContent, true);
  assert.equal(byDate['2026-05-10'].generating, true);
  assert.equal(byDate['2026-05-08'].generating, false);
});

test('day returns the word and its content, or null for an unknown day', () => {
  const { api, store } = setup();
  api.overview();
  const content = { sentence: 's', reading: 'r', translation: 't', grammar: 'g', usage: 'u', review: [] };
  store.setContent('2026-05-09', content);
  const day = api.day('2026-05-09');
  assert.equal(day.date, '2026-05-09');
  assert.deepEqual(day.content, content);
  assert.equal(typeof day.written, 'string');
  assert.equal(day.generating, false);
  assert.equal(api.day('2031-01-01'), null);
});

test('day rejects malformed dates', () => {
  const { api } = setup();
  for (const bad of ['yesterday', '2026-5-1', '2026-02-30', '', null, undefined, 20260510, {}]) {
    assert.throws(() => api.day(bad), /date/i, String(bad));
  }
});

test('setDone checks off and un-checks a day, persists it, and notifies', () => {
  const { api, store, calls } = setup();
  api.overview();
  api.setDone('2026-05-08', true);
  assert.equal(store.getDay('2026-05-08').done, true);
  assert.equal(calls.notify, 1);
  api.setDone('2026-05-08', false);
  assert.equal(store.getDay('2026-05-08').done, false);
  assert.equal(calls.notify, 2);
});

test('setDone validates its arguments', () => {
  const { api } = setup();
  api.overview();
  assert.throws(() => api.setDone('nope', true), /date/i);
  assert.throws(() => api.setDone('2026-05-08', 'yes'), /boolean/i);
  assert.throws(() => api.setDone('2030-01-01', true), /No entry/);
});

test('regenerate validates the date and hands off to the generator', async () => {
  const { api, calls } = setup();
  api.overview();
  const r = await api.regenerate('2026-05-09');
  assert.equal(r.ok, true);
  assert.deepEqual(calls.regenerate, ['2026-05-09']);
  await assert.rejects(async () => api.regenerate('bad'), /date/i);
});

test('status reports the generator status', () => {
  const { api, generating } = setup();
  generating.add('2026-05-10');
  assert.deepEqual(api.status(), { status: 'ok', error: null, generating: ['2026-05-10'] });
});

test('getSettings returns the settings', () => {
  const { api } = setup();
  assert.deepEqual(api.getSettings(), DEFAULT_SETTINGS);
});

test('setSettings accepts valid values, persists them, and triggers a generation run', async () => {
  const { api, store, calls } = setup();
  const out = api.setSettings({ model: 'llama3.1:8b', host: 'http://127.0.0.1:11434', launchAtLogin: false });
  assert.equal(out.model, 'llama3.1:8b');
  assert.equal(store.getSettings().launchAtLogin, false);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.run, 1);
});

test('setSettings rejects bad values and changes nothing', () => {
  const { api, store } = setup();
  const before = store.getSettings();
  const bad = [
    { model: '' },
    { model: 5 },
    { model: 'x'.repeat(200) },
    { host: 'not a url' },
    { host: 'file:///etc/passwd' },
    { host: 'javascript:alert(1)' },
    { launchAtLogin: 'yes' },
    null,
    'text',
  ];
  for (const patch of bad) assert.throws(() => api.setSettings(patch), undefined, JSON.stringify(patch));
  assert.deepEqual(store.getSettings(), before);
});

test('setSettings ignores unknown keys', () => {
  const { api } = setup();
  const out = api.setSettings({ model: 'gemma3:4b', evil: 'x' });
  assert.equal('evil' in out, false);
});

test('setSettings applies none of a patch if any part is invalid', () => {
  const { api, store } = setup();
  const before = store.getSettings();
  assert.throws(() => api.setSettings({ model: 'gemma3:4b', host: 'nope' }));
  assert.deepEqual(store.getSettings(), before);
});

test('day knows whether it is today, missed, or done', () => {
  const { api } = setup();
  api.overview();
  api.setDone('2026-05-08', true);

  const today = api.day('2026-05-10');
  assert.equal(today.isToday, true);
  assert.equal(today.missed, false);

  const missed = api.day('2026-05-09');
  assert.equal(missed.isToday, false);
  assert.equal(missed.missed, true);

  const done = api.day('2026-05-08');
  assert.equal(done.isToday, false);
  assert.equal(done.missed, false);
  assert.equal(done.done, true);
});

test('day and overview agree on isToday and missed for every day', () => {
  const { api } = setup();
  for (const item of api.overview()) {
    const day = api.day(item.date);
    assert.equal(day.isToday, item.isToday, item.date);
    assert.equal(day.missed, item.missed, item.date);
  }
});
