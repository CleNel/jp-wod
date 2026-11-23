const test = require('node:test');
const assert = require('node:assert/strict');
const { createReader, katakanaToHiragana } = require('../lib/reading');

test('katakanaToHiragana converts katakana and leaves everything else alone', () => {
  assert.equal(katakanaToHiragana('トモダチ'), 'ともだち');
  assert.equal(katakanaToHiragana('ラーメン'), 'らーめん'); // long vowel mark kept
  assert.equal(katakanaToHiragana('ひらがな漢字ABC、。'), 'ひらがな漢字ABC、。');
  assert.equal(katakanaToHiragana(''), '');
});

// The dictionary loads once (about a second) and is shared by the tests below.
let readerPromise;
const reader = () => (readerPromise ||= createReader());

test('reads kanji sentences as hiragana', async () => {
  const toReading = await reader();
  assert.equal(toReading('私は毎朝パンを食べます。'), 'わたしはまいあさぱんをたべます。');
  assert.equal(toReading('水を飲みます。'), 'みずをのみます。');
  assert.equal(toReading('友達と映画館に行きます。'), 'ともだちとえいがかんにいきます。');
});

test('the particle は is read as は, not わ', async () => {
  const toReading = await reader();
  assert.equal(toReading('今日は暑いです。'), 'きょうはあついです。');
});

test('katakana words become hiragana, spelled correctly', async () => {
  const toReading = await reader();
  assert.equal(toReading('レストランで食べます。'), 'れすとらんでたべます。');
  assert.equal(toReading('ラーメンを食べます。'), 'らーめんをたべます。');
});

test('keeps Japanese punctuation and never emits kanji', async () => {
  const toReading = await reader();
  const out = toReading('静かな部屋で、本を読みます。');
  assert.equal(out, 'しずかなへやで、ほんをよみます。');
  assert.equal(/[一-鿿]/.test(out), false);
});

test('removes spaces and tolerates empty or non-Japanese text', async () => {
  const toReading = await reader();
  assert.equal(toReading('水 を 飲みます'), 'みずをのみます');
  assert.equal(toReading(''), '');
  assert.equal(toReading('OK です。'), 'OKです。');
});
