const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('../renderer/view-model');

const day = (over = {}) => ({
  date: '2026-05-10',
  written: '食べる',
  reading: 'たべる',
  meaning: 'to eat',
  pos: 'verb',
  done: false,
  missed: false,
  isToday: false,
  hasContent: false,
  generating: false,
  ...over,
});

// ---------- counts and tabs ----------

test('counts: learned is the number of checked-off days, missed the backlog size', () => {
  const days = [
    day({ date: '2026-05-10', isToday: true }),
    day({ date: '2026-05-09', done: true }),
    day({ date: '2026-05-08', missed: true }),
    day({ date: '2026-05-07', missed: true }),
    day({ date: '2026-05-06', done: true }),
  ];
  assert.deepEqual(vm.counts(days), { learned: 2, missed: 2 });
  assert.deepEqual(vm.counts([]), { learned: 0, missed: 0 });
});

test('filterDays: All keeps everything, Missed keeps only the backlog, order preserved', () => {
  const days = [
    day({ date: '2026-05-10', isToday: true }),
    day({ date: '2026-05-09', missed: true }),
    day({ date: '2026-05-08', done: true }),
    day({ date: '2026-05-07', missed: true }),
  ];
  assert.equal(vm.filterDays(days, 'all').length, 4);
  assert.deepEqual(vm.filterDays(days, 'missed').map((d) => d.date), ['2026-05-09', '2026-05-07']);
  assert.equal(vm.filterDays(days, 'anything else').length, 4);
});

// ---------- badges and labels ----------

test('badge: Today for today, Missed for the backlog, nothing otherwise', () => {
  assert.equal(vm.badge(day({ isToday: true })), 'Today');
  assert.equal(vm.badge(day({ missed: true })), 'Missed');
  assert.equal(vm.badge(day({ done: true })), null);
  assert.equal(vm.badge(day()), null);
});

test('posLabel capitalizes the part of speech for display', () => {
  assert.equal(vm.posLabel('verb'), 'Verb');
  assert.equal(vm.posLabel('noun'), 'Noun');
  assert.equal(vm.posLabel('i-adjective'), 'i-adjective');
  assert.equal(vm.posLabel('na-adjective'), 'na-adjective');
  assert.equal(vm.posLabel(''), '');
});

test('formatDate gives a short local weekday and date without shifting the day', () => {
  assert.equal(vm.formatDate('2026-11-22'), 'Sun, Nov 22');
  assert.equal(vm.formatDate('2026-03-08'), 'Sun, Mar 8'); // US DST change day
  assert.equal(vm.formatDate('2027-01-01'), 'Fri, Jan 1');
  assert.equal(vm.formatDate('garbage'), 'garbage');
});

// ---------- banner ----------

test('banner: hidden when ok, explains each problem otherwise', () => {
  assert.equal(vm.banner({ status: 'ok' }, 'gemma3:12b'), null);

  const down = vm.banner({ status: 'ollama-down' }, 'gemma3:12b');
  assert.match(down.text, /Ollama/);
  assert.match(down.text, /start/i);
  assert.equal(down.level, 'warning');

  const missing = vm.banner({ status: 'model-missing' }, 'gemma3:12b');
  assert.ok(missing.text.includes('gemma3:12b'));
  assert.ok(missing.text.includes('ollama pull gemma3:12b'));

  const err = vm.banner({ status: 'error', error: 'bad output' }, 'gemma3:12b');
  assert.match(err.text, /Regenerate/);
});

test('banner: does not mention the model for an empty name', () => {
  assert.doesNotMatch(vm.banner({ status: 'model-missing' }, '').text, /undefined/);
});

// ---------- example card state ----------

const content = { sentence: 's', reading: 'r', translation: 't', grammar: 'g', usage: 'u', review: [] };

test('exampleState: content wins, even while regenerating', () => {
  assert.equal(vm.exampleState(day({ hasContent: true }), { status: 'ok' }), 'content');
  assert.equal(vm.exampleState(day({ hasContent: true, generating: true }), { status: 'ok' }), 'content');
  assert.equal(vm.exampleState({ ...day(), content }, { status: 'ok' }), 'content');
});

test('exampleState: loading while a sentence is being written', () => {
  assert.equal(vm.exampleState(day({ generating: true }), { status: 'ok' }), 'loading');
});

test('exampleState: unavailable when Ollama or the model is not ready', () => {
  assert.equal(vm.exampleState(day(), { status: 'ollama-down' }), 'unavailable');
  assert.equal(vm.exampleState(day(), { status: 'model-missing' }), 'unavailable');
});

test('exampleState: error after a failed attempt', () => {
  assert.equal(vm.exampleState(day(), { status: 'error' }), 'error');
});

test('exampleState: queued for a pending day, none for a checked-off day without a sentence', () => {
  assert.equal(vm.exampleState(day(), { status: 'ok' }), 'queued');
  assert.equal(vm.exampleState(day({ done: true }), { status: 'ok' }), 'none');
});

test('exampleMessage has plain text for every placeholder state and none for content', () => {
  for (const state of ['loading', 'unavailable', 'error', 'queued', 'none']) {
    const text = vm.exampleMessage(state, { status: 'ollama-down' }, 'gemma3:12b');
    assert.equal(typeof text.title, 'string');
    assert.ok(text.title.length > 3, state);
  }
  assert.equal(vm.exampleMessage('content', { status: 'ok' }, 'm'), null);
  assert.match(vm.exampleMessage('loading', { status: 'ok' }, 'm').title, /Writing/);
  assert.match(vm.exampleMessage('loading', { status: 'ok' }, 'm').hint, /minute|first/i);
});

// ---------- learned toggle ----------

test('learnedButton: label and pressed state follow the day', () => {
  assert.deepEqual(vm.learnedButton(day()), { label: 'Mark as learned', pressed: false });
  assert.deepEqual(vm.learnedButton(day({ done: true })), { label: 'Learned', pressed: true });
});

// ---------- review line ----------

test('reviewLine lists the review words used, or nothing', () => {
  assert.equal(vm.reviewLine({ ...content, review: ['水', '飲む'] }), '水, 飲む');
  assert.equal(vm.reviewLine({ ...content, review: [] }), null);
  assert.equal(vm.reviewLine({ sentence: 's' }), null);
  assert.equal(vm.reviewLine(null), null);
});

// ---------- selection ----------

test('pickSelection keeps a valid choice, else falls back to today, else the first day', () => {
  const days = [day({ date: '2026-05-10', isToday: true }), day({ date: '2026-05-09' })];
  assert.equal(vm.pickSelection(days, '2026-05-09'), '2026-05-09');
  assert.equal(vm.pickSelection(days, '2031-01-01'), '2026-05-10');
  assert.equal(vm.pickSelection(days, null), '2026-05-10');
  assert.equal(vm.pickSelection([day({ date: '2026-05-09' })], null), '2026-05-09');
  assert.equal(vm.pickSelection([], '2026-05-09'), null);
});

test('pickSelection: a window left on the old today jumps to the new today after midnight', () => {
  const days = [
    day({ date: '2026-05-11', isToday: true }),
    day({ date: '2026-05-10', missed: true }), // was today yesterday
    day({ date: '2026-05-09', missed: true }),
  ];
  // The user was looking at yesterday's "today": follow the new today.
  assert.equal(vm.pickSelection(days, '2026-05-10', '2026-05-10'), '2026-05-11');
  // The user deliberately picked an older day: keep it.
  assert.equal(vm.pickSelection(days, '2026-05-09', '2026-05-10'), '2026-05-09');
  // Nothing changed: keep the choice.
  assert.equal(vm.pickSelection(days, '2026-05-11', '2026-05-11'), '2026-05-11');
  // No previous today known: keep the choice.
  assert.equal(vm.pickSelection(days, '2026-05-10', null), '2026-05-10');
});
