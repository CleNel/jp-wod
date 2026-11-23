// Irregular and exception words.
//
// Some words behave differently from what their spelling suggests (帰る looks
// like an ichidan verb but is godan; 綺麗 looks like an i-adjective but is a
// na-adjective). This module detects words that need a human check and
// enforces that each one is registered in data/exceptions.txt, so adding words
// to data/words.txt cannot silently introduce one. The registry is also the
// source of truth for verb groups when conjugation is computed in code.
//
// Registry format: written|category|note   (# comments and blank lines skipped)

const fs = require('node:fs');

const CATEGORIES = {
  ichidan: 'Ichidan (ru-verb): drop る and add endings (食べる -> 食べます, 食べない).',
  godan:
    'Godan (u-verb) that ends in る: conjugates by changing the final kana (帰る -> 帰ります, 帰った).',
  'irregular-verb':
    'Irregular: する, 来る (reading changes: きます, こない, きた), ある (negative ない), and compounds of する.',
  'special-te-form': '行く: the te and ta forms are 行って and 行った, not 行いて and 行いた.',
  'honorific-verb': 'Honorific verb whose ます form ends in い (いらっしゃいます, くださいます).',
  'na-adj-ends-in-i':
    'Na-adjective whose reading ends in い (きれい, きらい): never conjugate it as an i-adjective.',
  'irregular-i-adjective': 'いい / よい conjugate from よ- (よくない, よかった), also in compounds like かっこいい.',
  'attributive-na-form': '大きい and 小さい also have attributive forms 大きな and 小さな.',
  'reading-differs':
    'The word has more than one reading and the dictionary (kuromoji) picks a different one than the list, so computed sentence readings may differ for this word.',
};

function parseExceptions(text) {
  const rows = [];
  text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const lineNo = i + 1;
      const parts = line.split('|').map((p) => p.trim());
      if (parts.length !== 3 || parts.some((p) => !p)) {
        throw new Error(`exceptions: line ${lineNo} must be written|category|note: ${line}`);
      }
      const [written, category, note] = parts;
      if (!(category in CATEGORIES)) {
        throw new Error(`exceptions: line ${lineNo} has an unknown category "${category}"`);
      }
      rows.push({ written, category, note });
    });
  return rows;
}

function loadExceptions(filePath) {
  return parseExceptions(fs.readFileSync(filePath, 'utf8'));
}

const HONORIFIC = ['いらっしゃる', 'なさる', 'くださる', 'おっしゃる'];
const IRREGULAR_VERBS = ['来る', 'ある', '有る'];
const ATTRIBUTIVE_NA = ['大きい', '小さい'];

// Which registry categories does this word need? Each result is
// { category, accepts }: the word is covered if the registry tags it with any
// category in `accepts`.
function requiredCategories(word) {
  const { written, reading, pos } = word;
  const out = [];
  const need = (category, accepts = [category]) => out.push({ category, accepts });

  if (pos === 'verb') {
    if (IRREGULAR_VERBS.includes(written) || written.endsWith('する')) need('irregular-verb');
    if (HONORIFIC.includes(written)) need('honorific-verb');
    // A verb ending in る cannot be classified from its spelling.
    if (written.endsWith('る') && !written.endsWith('する')) {
      need('ru-verb', ['ichidan', 'godan', 'irregular-verb']);
    }
    if (written.endsWith('行く') && reading.endsWith('いく')) need('special-te-form');
  }
  if (pos === 'i-adjective') {
    if (reading === 'よい' || reading.endsWith('いい')) need('irregular-i-adjective');
    if (ATTRIBUTIVE_NA.includes(written)) need('attributive-na-form');
  }
  if (pos === 'na-adjective' && reading.endsWith('い')) need('na-adj-ends-in-i');
  return out;
}

const toHiragana = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// Everything wrong with the registry relative to the word list, as readable
// messages (empty when all is well). `reader` is optional: given a function
// that returns the hiragana reading of text (lib/reading.js), it also checks
// that each word's listed reading matches what the dictionary says.
function findProblems(words, registry, reader) {
  const problems = [];
  const tagsFor = new Map();
  for (const { written, category } of registry) {
    if (!tagsFor.has(written)) tagsFor.set(written, new Set());
    tagsFor.get(written).add(category);
  }
  const known = new Set(words.map((w) => w.written));

  for (const word of words) {
    const tags = tagsFor.get(word.written) || new Set();
    const requirements = requiredCategories(word);
    if (reader && toHiragana(reader(word.written)) !== toHiragana(word.reading)) {
      requirements.push({ category: 'reading-differs', accepts: ['reading-differs'] });
    }

    for (const { category, accepts } of requirements) {
      if (!accepts.some((a) => tags.has(a))) {
        const options = accepts.length > 1 ? ` (one of: ${accepts.join(', ')})` : '';
        const why = category === 'ru-verb' ? 'ends in る, so its verb group must be recorded' : CATEGORIES[category];
        problems.push(
          `${word.written} (${word.pos}): needs a "${category}" line in data/exceptions.txt${options}. ${why}`
        );
      }
    }

    const allowed = new Set(requirements.flatMap((r) => r.accepts));
    for (const tag of tags) {
      if (!allowed.has(tag)) {
        problems.push(
          `${word.written}: data/exceptions.txt tags it "${tag}", but that category does not apply to this word`
        );
      }
    }
  }

  for (const written of tagsFor.keys()) {
    if (!known.has(written)) {
      problems.push(`${written}: listed in data/exceptions.txt but not in data/words.txt (stale entry)`);
    }
  }
  return problems;
}

module.exports = { CATEGORIES, parseExceptions, loadExceptions, requiredCategories, findProblems };
