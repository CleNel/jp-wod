// Hiragana readings computed in code with kuromoji (IPADIC), so the model never
// has to write them. LLMs get kanji and katakana conversion wrong too often.

const path = require('node:path');
const kuromoji = require('kuromoji');

// Katakana (U+30A1..U+30F6) -> hiragana (-0x60). Everything else, including
// the long vowel mark ー, is left as is.
function katakanaToHiragana(text) {
  return text.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// Loads the dictionary once and resolves to a synchronous function:
//   toReading('食べます。') -> 'たべます。'
function createReader({ dicPath } = {}) {
  const dir = dicPath || path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict');
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: dir }).build((err, tokenizer) => {
      if (err) return reject(err);
      resolve(function toReading(text) {
        // `reading` is the spelling reading (は stays ハ), not the pronunciation (ワ).
        const out = tokenizer
          .tokenize(text)
          .map((t) => (t.reading && t.reading !== '*' ? t.reading : t.surface_form))
          .join('');
        return katakanaToHiragana(out).replace(/\s+/g, '');
      });
    });
  });
}

module.exports = { createReader, katakanaToHiragana };
