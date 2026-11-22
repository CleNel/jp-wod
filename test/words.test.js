const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseWords, loadWords } = require('../lib/words');

test('parseWords reads the four pipe-separated fields', () => {
  const words = parseWords('食べる|たべる|to eat|verb');
  assert.deepEqual(words, [
    { written: '食べる', reading: 'たべる', meaning: 'to eat', pos: 'verb' },
  ]);
});

test('parseWords skips blank lines and # comments', () => {
  const text = [
    '# beginner verbs',
    '',
    '食べる|たべる|to eat|verb',
    '   ',
    '  # indented comment',
    '飲む|のむ|to drink|verb',
    '',
  ].join('\n');
  assert.deepEqual(
    parseWords(text).map((w) => w.written),
    ['食べる', '飲む']
  );
});

test('parseWords handles CRLF line endings and a BOM', () => {
  const text = '﻿# c\r\n食べる|たべる|to eat|verb\r\n水|みず|water|noun\r\n';
  assert.equal(parseWords(text).length, 2);
});

test('parseWords trims whitespace around fields', () => {
  const [w] = parseWords('  水 | みず | water | noun  ');
  assert.deepEqual(w, { written: '水', reading: 'みず', meaning: 'water', pos: 'noun' });
});

test('parseWords throws with the line number on malformed lines', () => {
  assert.throws(() => parseWords('水|みず|water'), /line 1/);
  assert.throws(() => parseWords('# c\n水|みず|water|noun|extra'), /line 2/);
  assert.throws(() => parseWords('水||water|noun'), /line 1/);
});

test('parseWords rejects duplicate written forms', () => {
  assert.throws(() => parseWords('水|みず|water|noun\n水|すい|water|noun'), /duplicate/i);
});

test('data/words.txt is a valid, large-enough, duplicate-free list', () => {
  const words = loadWords(path.join(__dirname, '..', 'data', 'words.txt'));
  assert.ok(words.length >= 100, `expected >= 100 words, got ${words.length}`);
  assert.equal(new Set(words.map((w) => w.written)).size, words.length);
});

test('data/words.txt readings are hiragana/katakana only', () => {
  const words = loadWords(path.join(__dirname, '..', 'data', 'words.txt'));
  for (const w of words) {
    assert.match(w.reading, /^[ぁ-ゟ゠-ヿー]+$/, `${w.written}: ${w.reading}`);
  }
});

test('data/words.txt covers verbs, nouns, i-adjectives, and na-adjectives', () => {
  const words = loadWords(path.join(__dirname, '..', 'data', 'words.txt'));
  const kinds = new Set(words.map((w) => w.pos));
  for (const k of ['verb', 'noun', 'i-adjective', 'na-adjective']) {
    assert.ok(kinds.has(k), `missing part of speech: ${k}`);
  }
});

test('the beginner list (first 117 words) is frozen: only append new words after it', () => {
  const crypto = require('node:crypto');
  const words = loadWords(path.join(__dirname, '..', 'data', 'words.txt'));
  const BEGINNER_COUNT = 117;
  assert.ok(words.length >= BEGINNER_COUNT, 'beginner words were removed');
  const hash = crypto
    .createHash('sha256')
    .update(words.slice(0, BEGINNER_COUNT).map((w) => w.written).join('\n'))
    .digest('hex');
  assert.equal(
    hash,
    'c7b20924c51812f1805133d4c923dd9c0ec7409897a35638e6ad30eb181893dd',
    'beginner words were reordered, removed, or changed; add new words at the end of data/words.txt'
  );
});
