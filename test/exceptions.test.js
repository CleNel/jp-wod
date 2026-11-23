const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadWords } = require('../lib/words');
const { createReader } = require('../lib/reading');
const {
  CATEGORIES,
  parseExceptions,
  loadExceptions,
  requiredCategories,
  findProblems,
} = require('../lib/exceptions');

const verb = (written, reading) => ({ written, reading, meaning: 'x', pos: 'verb' });
const iAdj = (written, reading) => ({ written, reading, meaning: 'x', pos: 'i-adjective' });
const naAdj = (written, reading) => ({ written, reading, meaning: 'x', pos: 'na-adjective' });
const noun = (written, reading) => ({ written, reading, meaning: 'x', pos: 'noun' });

// ---------- parsing the registry ----------

test('parseExceptions reads written|category|note and skips comments and blanks', () => {
  const rows = parseExceptions('# c\n\n帰る|godan|looks ichidan\n来る|irregular-verb|くる, きます');
  assert.deepEqual(rows, [
    { written: '帰る', category: 'godan', note: 'looks ichidan' },
    { written: '来る', category: 'irregular-verb', note: 'くる, きます' },
  ]);
});

test('parseExceptions rejects unknown categories and bad lines with the line number', () => {
  assert.throws(() => parseExceptions('帰る|nonsense|x'), /line 1.*category/i);
  assert.throws(() => parseExceptions('# c\n帰る|godan'), /line 2/);
  assert.throws(() => parseExceptions('帰る|godan|'), /line 1/);
});

// ---------- detection rules ----------

const names = (word) => requiredCategories(word).map((r) => r.category);

test('verbs ending in る must be tagged ichidan, godan, or irregular', () => {
  const [req] = requiredCategories(verb('帰る', 'かえる'));
  assert.equal(req.category, 'ru-verb');
  assert.deepEqual([...req.accepts].sort(), ['godan', 'ichidan', 'irregular-verb']);
});

test('verbs not ending in る need nothing (regular godan)', () => {
  assert.deepEqual(names(verb('飲む', 'のむ')), []);
  assert.deepEqual(names(verb('書く', 'かく')), []);
});

test('する, 来る, ある and suru-compounds are irregular verbs', () => {
  assert.ok(names(verb('する', 'する')).includes('irregular-verb'));
  assert.ok(names(verb('勉強する', 'べんきょうする')).includes('irregular-verb'));
  assert.ok(names(verb('来る', 'くる')).includes('irregular-verb'));
  assert.ok(names(verb('ある', 'ある')).includes('irregular-verb'));
});

test('行く has an irregular te-form (行って, not 行いて)', () => {
  assert.ok(names(verb('行く', 'いく')).includes('special-te-form'));
  assert.ok(names(verb('持って行く', 'もっていく')).includes('special-te-form'));
  assert.equal(names(verb('行う', 'おこなう')).includes('special-te-form'), false);
});

test('honorific verbs have ます forms in い (いらっしゃいます)', () => {
  for (const w of ['いらっしゃる', 'なさる', 'くださる', 'おっしゃる']) {
    assert.ok(names(verb(w, w)).includes('honorific-verb'), w);
  }
});

test('na-adjectives whose reading ends in い look like i-adjectives', () => {
  assert.ok(names(naAdj('綺麗', 'きれい')).includes('na-adj-ends-in-i'));
  assert.ok(names(naAdj('嫌い', 'きらい')).includes('na-adj-ends-in-i'));
  assert.deepEqual(names(naAdj('静か', 'しずか')), []);
});

test('いい / よい conjugate from よ- (よくない, よかった)', () => {
  assert.ok(names(iAdj('いい', 'いい')).includes('irregular-i-adjective'));
  assert.ok(names(iAdj('良い', 'よい')).includes('irregular-i-adjective'));
  assert.ok(names(iAdj('かっこいい', 'かっこいい')).includes('irregular-i-adjective'));
  assert.deepEqual(names(iAdj('新しい', 'あたらしい')), []);
});

test('大きい and 小さい have attributive な forms (大きな)', () => {
  assert.ok(names(iAdj('大きい', 'おおきい')).includes('attributive-na-form'));
  assert.ok(names(iAdj('小さい', 'ちいさい')).includes('attributive-na-form'));
});

test('nouns need nothing', () => {
  assert.deepEqual(names(noun('水', 'みず')), []);
});

// ---------- problem finding ----------

test('findProblems reports a word that needs a tag and has none', () => {
  const problems = findProblems([verb('帰る', 'かえる')], []);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /帰る/);
  assert.match(problems[0], /data\/exceptions\.txt/);
});

test('findProblems accepts any allowed tag and rejects wrong ones', () => {
  const words = [verb('帰る', 'かえる')];
  assert.deepEqual(findProblems(words, [{ written: '帰る', category: 'godan', note: 'n' }]), []);
  // special-te-form does not apply to 帰る: one problem for the missing tag, one for the bad one
  const wrong = findProblems(words, [{ written: '帰る', category: 'special-te-form', note: 'n' }]);
  assert.equal(wrong.length, 2);
});

test('findProblems reports stale registry entries for words not in the list', () => {
  const problems = findProblems([], [{ written: '消えた', category: 'godan', note: 'n' }]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /消えた/);
});

test('findProblems checks readings against the reader when one is given', () => {
  const reader = (text) => (text === '今日' ? 'こんにち' : text);
  const words = [noun('今日', 'きょう')];
  const problems = findProblems(words, [], reader);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /reading-differs/);
  const ok = findProblems(words, [{ written: '今日', category: 'reading-differs', note: 'n' }], reader);
  assert.deepEqual(ok, []);
});

test('every category has a description', () => {
  for (const [name, description] of Object.entries(CATEGORIES)) {
    assert.ok(description.length > 10, name);
  }
});

// ---------- the real word list ----------

test('data/words.txt: every irregular or exception word is registered in data/exceptions.txt', async () => {
  const words = loadWords(path.join(__dirname, '..', 'data', 'words.txt'));
  const registry = loadExceptions(path.join(__dirname, '..', 'data', 'exceptions.txt'));
  const reader = await createReader();
  const problems = findProblems(words, registry, reader);
  assert.deepEqual(
    problems,
    [],
    '\nNew or changed words need a review. For each problem below, check how the word ' +
      'behaves, then add or fix a line in data/exceptions.txt:\n  ' +
      problems.join('\n  ')
  );
});
