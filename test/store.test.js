const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, DEFAULT_SETTINGS, shuffle } = require('../lib/store');

function makeWords(n, start = 0) {
  return Array.from({ length: n }, (_, i) => ({
    written: `語${start + i}`,
    reading: `ご${start + i}`,
    meaning: `meaning ${start + i}`,
    pos: 'noun',
  }));
}

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpwod-store-'));
  return path.join(dir, 'state.json');
}

function open(file, words = makeWords(20), seed = 42) {
  return new Store({ filePath: file, words, seed });
}

const content = (n) => ({
  sentence: `文${n}`,
  reading: `ぶん${n}`,
  translation: `sentence ${n}`,
  note: `note ${n}`,
});

test('shuffle is deterministic for a seed and is a permutation', () => {
  const a = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 7);
  const b = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 7);
  const c = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 8);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual([...a].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('a fresh store has default settings and nothing on disk until saved', () => {
  const file = tmpFile();
  const store = open(file);
  assert.deepEqual(store.getSettings(), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.host, 'http://127.0.0.1:11434');
  assert.equal(typeof DEFAULT_SETTINGS.model, 'string');
  assert.equal(typeof DEFAULT_SETTINGS.launchAtLogin, 'boolean');
  assert.equal(fs.existsSync(file), false);
});

test('settings merge known keys only and persist', () => {
  const file = tmpFile();
  const store = open(file);
  store.setSettings({ model: 'llama3.1:8b', bogus: 1 });
  assert.equal(store.getSettings().model, 'llama3.1:8b');
  assert.equal('bogus' in store.getSettings(), false);
  assert.equal(open(file).getSettings().model, 'llama3.1:8b');
});

test('ensureEntries sets startDate and assigns today through today+ahead', () => {
  const store = open(tmpFile());
  store.ensureEntries('2026-05-10', 7);
  assert.equal(store.getStartDate(), '2026-05-10');
  const dates = Object.keys(store.getState().entries).sort();
  assert.equal(dates.length, 8);
  assert.equal(dates[0], '2026-05-10');
  assert.equal(dates[7], '2026-05-17');
});

test('order is a permutation of the word keys and the same seed gives the same order', () => {
  const words = makeWords(20);
  const a = open(tmpFile(), words, 1);
  const b = open(tmpFile(), words, 1);
  const c = open(tmpFile(), words, 2);
  for (const s of [a, b, c]) s.ensureEntries('2026-05-10', 0);
  const keys = words.map((w) => w.written).sort();
  assert.deepEqual([...a.getState().order].sort(), keys);
  assert.deepEqual(a.getState().order, b.getState().order);
  assert.notDeepEqual(a.getState().order, c.getState().order);
});

test('each day gets the word at its day index in the order, wrapping around', () => {
  const store = open(tmpFile(), makeWords(5));
  store.ensureEntries('2026-05-01', 0);
  store.ensureEntries('2026-05-07', 0);
  const { order, entries } = store.getState();
  assert.equal(entries['2026-05-01'].key, order[0]);
  assert.equal(entries['2026-05-05'].key, order[4]);
  assert.equal(entries['2026-05-06'].key, order[0]);
  assert.equal(entries['2026-05-07'].key, order[1]);
});

test('ensureEntries is idempotent and never changes an assigned day', () => {
  const store = open(tmpFile());
  store.ensureEntries('2026-05-10', 7);
  const before = JSON.stringify(store.getState().entries);
  store.ensureEntries('2026-05-10', 7);
  assert.equal(JSON.stringify(store.getState().entries), before);
});

test('days keep their words and state across restarts', () => {
  const file = tmpFile();
  const first = open(file);
  first.ensureEntries('2026-05-10', 7);
  first.setDone('2026-05-10', true);
  first.setContent('2026-05-10', content(1));
  const snapshot = JSON.stringify(first.getState());

  const second = open(file, makeWords(20), 999); // different seed must not matter
  second.ensureEntries('2026-05-10', 7);
  assert.equal(JSON.stringify(second.getState()), snapshot);
});

test('days keep their words when the word list grows; new words are appended', () => {
  const file = tmpFile();
  const first = open(file, makeWords(20));
  first.ensureEntries('2026-05-10', 7);
  const orderBefore = [...first.getState().order];
  const entriesBefore = JSON.stringify(first.getState().entries);

  const grown = open(file, makeWords(25));
  grown.ensureEntries('2026-05-10', 7);
  const { order, entries } = grown.getState();
  assert.equal(order.length, 25);
  assert.deepEqual(order.slice(0, 20), orderBefore);
  assert.deepEqual(
    [...order.slice(20)].sort(),
    makeWords(5, 20).map((w) => w.written).sort()
  );
  assert.equal(JSON.stringify(entries), entriesBefore);
});

test('a word removed from the list keeps its slot so other days do not shift', () => {
  const file = tmpFile();
  const first = open(file, makeWords(10));
  first.ensureEntries('2026-05-01', 0);
  const orderBefore = [...first.getState().order];

  const shrunk = open(file, makeWords(10).slice(1));
  shrunk.ensureEntries('2026-05-05', 0);
  assert.deepEqual(shrunk.getState().order, orderBefore);
  const days = shrunk.overview('2026-05-05');
  assert.equal(days.length, 5);
  for (const d of days) assert.equal(typeof d.written, 'string');
});

test('ensureEntries fills gaps if startDate is moved earlier, without touching existing days', () => {
  const file = tmpFile();
  const store = open(file);
  store.ensureEntries('2026-05-10', 0);
  const existing = { ...store.getState().entries['2026-05-10'] };
  store.setStartDate('2026-05-03');
  store.ensureEntries('2026-05-10', 0);
  assert.equal(Object.keys(store.getState().entries).length, 8);
  assert.deepEqual(store.getState().entries['2026-05-10'], existing);
});

test('the PC was off for four days: the backlog shows four missed days', () => {
  const file = tmpFile();
  const day1 = open(file);
  day1.ensureEntries('2026-05-01', 7);

  const day5 = open(file);
  day5.ensureEntries('2026-05-05', 7);
  const days = day5.overview('2026-05-05');
  const missed = days.filter((d) => d.missed);
  assert.deepEqual(
    missed.map((d) => d.date),
    ['2026-05-04', '2026-05-03', '2026-05-02', '2026-05-01']
  );
  assert.equal(days[0].date, '2026-05-05');
  assert.equal(days[0].missed, false);
  assert.equal(days[0].isToday, true);
});

test('overview is newest first, past and today only, and carries word fields', () => {
  const store = open(tmpFile());
  store.ensureEntries('2026-05-01', 7);
  store.ensureEntries('2026-05-03', 7);
  const days = store.overview('2026-05-03');
  assert.deepEqual(days.map((d) => d.date), ['2026-05-03', '2026-05-02', '2026-05-01']);
  assert.ok(days.every((d) => d.date <= '2026-05-03'));
  const d = days[0];
  for (const f of ['date', 'key', 'written', 'reading', 'meaning', 'pos', 'done', 'missed', 'isToday', 'hasContent']) {
    assert.ok(f in d, `missing field ${f}`);
  }
  assert.equal(d.hasContent, false);
});

test('future days are not shown in the overview', () => {
  const store = open(tmpFile());
  store.ensureEntries('2026-05-10', 7);
  assert.deepEqual(store.overview('2026-05-10').map((d) => d.date), ['2026-05-10']);
});

test('checking off a missed day removes it from the backlog; undoing restores it', () => {
  const file = tmpFile();
  const store = open(file);
  store.ensureEntries('2026-05-01', 0);
  store.ensureEntries('2026-05-04', 0);
  const missedDates = () => store.overview('2026-05-04').filter((d) => d.missed).map((d) => d.date);
  assert.deepEqual(missedDates(), ['2026-05-03', '2026-05-02', '2026-05-01']);

  store.setDone('2026-05-02', true);
  assert.deepEqual(missedDates(), ['2026-05-03', '2026-05-01']);
  assert.equal(open(file).overview('2026-05-04').find((d) => d.date === '2026-05-02').done, true);

  store.setDone('2026-05-02', false);
  assert.deepEqual(missedDates(), ['2026-05-03', '2026-05-02', '2026-05-01']);
});

test("today can be checked off and is never 'missed'", () => {
  const store = open(tmpFile());
  store.ensureEntries('2026-05-04', 0);
  store.setDone('2026-05-04', true);
  const [today] = store.overview('2026-05-04');
  assert.equal(today.done, true);
  assert.equal(today.missed, false);
});

test('setDone and setContent throw for a day with no entry', () => {
  const store = open(tmpFile());
  store.ensureEntries('2026-05-04', 0);
  assert.throws(() => store.setDone('2026-06-01', true));
  assert.throws(() => store.setContent('2026-06-01', content(1)));
});

test('setContent stores content, null clears it, and it persists', () => {
  const file = tmpFile();
  const store = open(file);
  store.ensureEntries('2026-05-04', 0);
  store.setContent('2026-05-04', content(1));
  assert.deepEqual(store.getDay('2026-05-04').content, content(1));
  assert.equal(open(file).getDay('2026-05-04').content.sentence, '文1');
  assert.equal(store.overview('2026-05-04')[0].hasContent, true);

  store.setContent('2026-05-04', null);
  assert.equal(store.getDay('2026-05-04').content, null);
});

test('getDay returns the word and entry for a date, or null', () => {
  const store = open(tmpFile());
  store.ensureEntries('2026-05-04', 0);
  const day = store.getDay('2026-05-04');
  assert.equal(day.date, '2026-05-04');
  assert.equal(typeof day.written, 'string');
  assert.equal(typeof day.reading, 'string');
  assert.equal(store.getDay('2030-01-01'), null);
});

test('pending generation order: today, missed newest first, then upcoming', () => {
  const store = open(tmpFile());
  store.ensureEntries('2026-05-01', 0);
  store.ensureEntries('2026-05-06', 3);
  store.setDone('2026-05-03', true); // done: not missed, not pending
  store.setContent('2026-05-04', content(4)); // already has content
  store.setContent('2026-05-08', content(8)); // upcoming with content

  assert.deepEqual(store.pendingContentDates('2026-05-06', 3), [
    '2026-05-06', // today
    '2026-05-05', // missed, newest first
    '2026-05-02',
    '2026-05-01',
    '2026-05-07', // upcoming, soonest first
    '2026-05-09',
  ]);
});

test('pending is empty when everything has content', () => {
  const store = open(tmpFile());
  store.ensureEntries('2026-05-02', 2);
  for (const d of ['2026-05-02', '2026-05-03', '2026-05-04']) store.setContent(d, content(1));
  assert.deepEqual(store.pendingContentDates('2026-05-02', 2), []);
});

test('pending only looks ahead as far as asked', () => {
  const store = open(tmpFile());
  store.ensureEntries('2026-05-02', 7);
  assert.deepEqual(store.pendingContentDates('2026-05-02', 2), [
    '2026-05-02',
    '2026-05-03',
    '2026-05-04',
  ]);
});

test('saves are atomic: valid JSON on disk and no .tmp left behind', () => {
  const file = tmpFile();
  const store = open(file);
  store.ensureEntries('2026-05-04', 3);
  store.setDone('2026-05-04', true);
  assert.equal(fs.existsSync(file + '.tmp'), false);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.startDate, '2026-05-04');
  assert.ok(Array.isArray(parsed.order));
  assert.equal(parsed.entries['2026-05-04'].done, true);
});

test('a corrupt state file is set aside and the store starts fresh', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ not json');
  const store = open(file);
  store.ensureEntries('2026-05-04', 0);
  assert.equal(store.overview('2026-05-04').length, 1);
  const leftovers = fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.corrupt'));
  assert.equal(leftovers.length, 1);
});

test('creates the data directory if it does not exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpwod-store-'));
  const file = path.join(dir, 'nested', 'deeper', 'state.json');
  const store = open(file);
  store.ensureEntries('2026-05-04', 0);
  assert.equal(fs.existsSync(file), true);
});
