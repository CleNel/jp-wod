// Manual check against your real Ollama: generates for a few words and prints
// the sentences with timings. Read them yourself to judge model quality.
//
//   node scripts/try-ollama.js [model] [count] [--no-review | --one-review]
//
// Defaults: the store's default model and 3 words. Every word after the first
// is offered the earlier ones as review words, to exercise that path.

const path = require('node:path');
const { loadWords } = require('../lib/words');
const { DEFAULT_SETTINGS } = require('../lib/store');
const { checkServer, generate } = require('../lib/ollama');
const { createReader } = require('../lib/reading');

async function main() {
  const model = process.argv[2] || DEFAULT_SETTINGS.model;
  const count = Number(process.argv[3]) || 3;
  const host = DEFAULT_SETTINGS.host;
  const words = loadWords(path.join(__dirname, '..', 'data', 'words.txt'));
  const reader = await createReader();

  const server = await checkServer({ fetch, host, model });
  console.log(`server: ${server.status} (${host}, model ${model})`);
  if (server.status !== 'ok') {
    if (server.status === 'model-missing') console.log(`run: ollama pull ${model}`);
    process.exit(1);
  }

  // A spread of word types: verb, noun, i-adjective, na-adjective.
  const picks = ['食べる', '水', '楽しい', '静か', '行く', '大きい', '読む', '友達', '忙しい', '有名']
    .map((w) => words.find((x) => x.written === w))
    .slice(0, count);

  const noReview = process.argv.includes('--no-review');
  const oneReview = process.argv.includes('--one-review');

  for (let i = 0; i < picks.length; i++) {
    const word = picks[i];
    // --one-review: exactly one required review word, taken from another pick.
    const reviewWords = noReview
      ? []
      : oneReview
        ? [picks[(i + 3) % picks.length]]
        : picks.slice(0, i);
    const t0 = Date.now();
    const r = await generate({ fetch, host, model, word, reviewWords, reader });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`\n${word.written} (${word.reading}) ${word.meaning}  [${secs}s]`);
    if (reviewWords.length) console.log(`  offered: ${reviewWords.map((w) => w.written).join(' ')}`);
    if (!r.ok) {
      console.log(`  FAILED: ${r.status}: ${r.error}`);
      continue;
    }
    const c = r.content;
    console.log(`  ${c.sentence}`);
    console.log(`  ${c.reading}`);
    console.log(`  ${c.translation}`);
    console.log(`  grammar:  ${c.grammar}`);
    console.log(`  usage:    ${c.usage}`);
    console.log(`  review used: ${c.review.length ? c.review.join(' ') : '(none)'}`);
  }
}

main();
