const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SCHEMA,
  checkServer,
  buildMessages,
  containsWord,
  validate,
  generate,
} = require('../lib/ollama');

const HOST = 'http://127.0.0.1:11434';
const MODEL = 'qwen2.5:7b';

const taberu = { written: '食べる', reading: 'たべる', meaning: 'to eat', pos: 'verb' };
const mizu = { written: '水', reading: 'みず', meaning: 'water', pos: 'noun' };
const nomu = { written: '飲む', reading: 'のむ', meaning: 'to drink', pos: 'verb' };

const good = {
  sentence: '私は毎朝パンを食べます。',
  translation: 'I eat bread every morning.',
  grammar: 'パンを uses を to mark the object, and 食べます is the polite present form of 食べる.',
  usage: 'The ます form is polite and neutral, suitable for everyday conversation.',
};

// A fake fetch response.
function ok(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}
function fail(status, body) {
  return { ok: false, status, json: async () => body, text: async () => JSON.stringify(body) };
}
function chatReply(obj) {
  return ok({ message: { role: 'assistant', content: typeof obj === 'string' ? obj : JSON.stringify(obj) } });
}

// Returns a fetch that serves queued responses (or throws queued errors) and records calls.
function mockFetch(...queue) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = calls;
  return fn;
}

// ---------- checkServer ----------

test('checkServer: ok when reachable and the model is installed', async () => {
  const fetch = mockFetch(ok({ models: [{ name: 'llama3.1:8b' }, { name: MODEL }] }));
  const r = await checkServer({ fetch, host: HOST, model: MODEL });
  assert.equal(r.status, 'ok');
  assert.equal(fetch.calls[0].url, `${HOST}/api/tags`);
});

test('checkServer: a model name without a tag matches :latest', async () => {
  const fetch = mockFetch(ok({ models: [{ name: 'gemma2:latest' }] }));
  const r = await checkServer({ fetch, host: HOST, model: 'gemma2' });
  assert.equal(r.status, 'ok');
});

test('checkServer: ollama-down when the server is unreachable', async () => {
  const fetch = mockFetch(new TypeError('fetch failed'));
  const r = await checkServer({ fetch, host: HOST, model: MODEL });
  assert.equal(r.status, 'ollama-down');
});

test('checkServer: ollama-down on a non-OK response', async () => {
  const fetch = mockFetch(fail(500, {}));
  const r = await checkServer({ fetch, host: HOST, model: MODEL });
  assert.equal(r.status, 'ollama-down');
});

test('checkServer: model-missing when reachable but the model is not installed', async () => {
  const fetch = mockFetch(ok({ models: [{ name: 'llama3.1:8b' }] }));
  const r = await checkServer({ fetch, host: HOST, model: MODEL });
  assert.equal(r.status, 'model-missing');
});

test('checkServer: tolerates a trailing slash on the host', async () => {
  const fetch = mockFetch(ok({ models: [{ name: MODEL }] }));
  await checkServer({ fetch, host: `${HOST}/`, model: MODEL });
  assert.equal(fetch.calls[0].url, `${HOST}/api/tags`);
});

// ---------- buildMessages ----------

test('buildMessages: system + user messages that name the word, reading, and meaning', () => {
  const msgs = buildMessages(taberu);
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[msgs.length - 1].role, 'user');
  const text = msgs.map((m) => m.content).join('\n');
  assert.ok(text.includes('食べる'));
  assert.ok(text.includes('たべる'));
  assert.ok(text.includes('to eat'));
});

test('buildMessages: mentions review words only when given', () => {
  const without = buildMessages(taberu).map((m) => m.content).join('\n');
  assert.equal(without.includes('REQUIRED'), false);
  assert.equal(without.includes('水'), false);

  const withReview = buildMessages(taberu, [mizu, nomu]).map((m) => m.content).join('\n');
  assert.ok(withReview.includes('REQUIRED'));
  assert.ok(withReview.includes('水'));
  assert.ok(withReview.includes('飲む'));
});

test('buildMessages: a single review word is required alongside the target word', () => {
  const text = buildMessages(taberu, [mizu]).map((m) => m.content).join('\n');
  assert.match(text, /both/i);
  assert.ok(text.includes('水'));
});

test('SCHEMA has exactly sentence, translation, grammar, usage, all required (reading is computed in code)', () => {
  const fields = ['grammar', 'sentence', 'translation', 'usage'];
  assert.deepEqual([...SCHEMA.required].sort(), fields);
  assert.deepEqual(Object.keys(SCHEMA.properties).sort(), fields);
});

// ---------- containsWord ----------

test('containsWord: ichidan verbs match conjugated forms', () => {
  assert.equal(containsWord('パンを食べます。', taberu), true);
  assert.equal(containsWord('昨日は食べなかった。', taberu), true);
  assert.equal(containsWord('食べる前に手を洗う。', taberu), true);
});

test('containsWord: godan verbs match conjugated forms', () => {
  const iku = { written: '行く', reading: 'いく', meaning: 'to go', pos: 'verb' };
  assert.equal(containsWord('学校に行きます。', iku), true);
  assert.equal(containsWord('駅へ行った。', iku), true);
  assert.equal(containsWord('水を飲みます。', nomu), true);
  assert.equal(containsWord('水を飲んだ。', nomu), true);
});

test('containsWord: 来る matches 来ます', () => {
  const kuru = { written: '来る', reading: 'くる', meaning: 'to come', pos: 'verb' };
  assert.equal(containsWord('友達が来ます。', kuru), true);
});

test('containsWord: i-adjectives match inflected forms', () => {
  const ookii = { written: '大きい', reading: 'おおきい', meaning: 'big', pos: 'i-adjective' };
  assert.equal(containsWord('大きい犬です。', ookii), true);
  assert.equal(containsWord('大きくない家です。', ookii), true);
  assert.equal(containsWord('大きかった。', ookii), true);
});

test('containsWord: nouns and na-adjectives need the written form as is', () => {
  assert.equal(containsWord('水を飲みます。', mizu), true);
  const shizuka = { written: '静か', reading: 'しずか', meaning: 'quiet', pos: 'na-adjective' };
  assert.equal(containsWord('ここは静かな町です。', shizuka), true);
  assert.equal(containsWord('ここはうるさい町です。', shizuka), false);
});

test('containsWord: false when the word is absent', () => {
  assert.equal(containsWord('私は走ります。', taberu), false);
  assert.equal(containsWord('パンを食べる', mizu), false);
});

// ---------- validate ----------

test('validate: accepts a good result and returns trimmed content', () => {
  const r = validate({ ...good, sentence: `  ${good.sentence}  ` }, taberu);
  assert.equal(r.ok, true);
  assert.equal(r.content.sentence, good.sentence);
  assert.equal(r.content.translation, good.translation);
  assert.deepEqual(r.content.review, []);
});

test('validate: rejects empty, missing, or non-string fields', () => {
  for (const field of ['sentence', 'translation', 'grammar', 'usage']) {
    assert.equal(validate({ ...good, [field]: '' }, taberu).ok, false, `${field} empty`);
    assert.equal(validate({ ...good, [field]: '   ' }, taberu).ok, false, `${field} blank`);
    assert.equal(validate({ ...good, [field]: 5 }, taberu).ok, false, `${field} number`);
    const copy = { ...good };
    delete copy[field];
    assert.equal(validate(copy, taberu).ok, false, `${field} missing`);
  }
  assert.equal(validate(null, taberu).ok, false);
  assert.equal(validate('text', taberu).ok, false);
});

test('validate: rejects a sentence that does not contain the word', () => {
  const r = validate({ ...good, sentence: '私は毎朝走ります。' }, taberu);
  assert.equal(r.ok, false);
  assert.match(r.error, /word/i);
});

test('validate: review is found by scanning the sentence for the offered words', () => {
  const sentence = '水を飲みながらパンを食べます。';
  const r = validate({ ...good, sentence }, taberu, [mizu, nomu]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.content.review.sort(), ['水', '飲む'].sort());
});

test('validate: only offered words count, and only if they really appear', () => {
  // 犬 appears but was never offered; 飲む was offered but is absent.
  const r = validate({ ...good, sentence: '犬が水を見ます。食べます。' }, taberu, [mizu, nomu]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.content.review, ['水']);
});

test('validate: review words are a soft requirement (none used is still valid)', () => {
  const r = validate(good, taberu, [mizu]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.content.review, []);
});

test('validate: a stray reviewWordsUsed field from the model is ignored', () => {
  const r = validate({ ...good, reviewWordsUsed: ['水'] }, taberu, [mizu]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.content.review, []);
  assert.equal('reviewWordsUsed' in r.content, false);
});

// ---------- generate ----------

// The reading is computed in code (lib/reading.js); tests inject a fake.
const fakeReader = (sentence) => `よみ(${sentence})`;
const gen = (opts) => generate({ reader: fakeReader, ...opts });

test('generate: sends a non-streaming /api/chat request with the schema and returns content', async () => {
  const fetch = mockFetch(chatReply(good));
  const r = await gen({ fetch, host: HOST, model: MODEL, word: taberu });
  assert.equal(r.ok, true);
  assert.equal(r.content.sentence, good.sentence);
  assert.equal(fetch.calls.length, 1);

  const { url, init } = fetch.calls[0];
  assert.equal(url, `${HOST}/api/chat`);
  assert.equal(init.method, 'POST');
  const body = JSON.parse(init.body);
  assert.equal(body.model, MODEL);
  assert.equal(body.stream, false);
  assert.deepEqual(body.format, SCHEMA);
  assert.ok(Array.isArray(body.messages) && body.messages.length >= 2);
});

test('generate: passes review words into the prompt and reports which were used', async () => {
  const sentence = '水を飲みながら、パンを食べます。';
  const fetch = mockFetch(chatReply({ ...good, sentence }));
  const r = await gen({ fetch, host: HOST, model: MODEL, word: taberu, reviewWords: [mizu] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.content.review, ['水']);
  const prompt = JSON.parse(fetch.calls[0].init.body).messages.map((m) => m.content).join('\n');
  assert.ok(prompt.includes('水'));
});

test('generate: bad output, then good output on the retry', async () => {
  const fetch = mockFetch(chatReply({ ...good, sentence: '走ります。' }), chatReply(good));
  const r = await gen({ fetch, host: HOST, model: MODEL, word: taberu });
  assert.equal(r.ok, true);
  assert.equal(fetch.calls.length, 2);
});

test('generate: unparseable JSON counts as bad output and is retried', async () => {
  const fetch = mockFetch(chatReply('not json at all'), chatReply(good));
  const r = await gen({ fetch, host: HOST, model: MODEL, word: taberu });
  assert.equal(r.ok, true);
  assert.equal(fetch.calls.length, 2);
});

test('generate: gives up quietly after one retry', async () => {
  const fetch = mockFetch(chatReply({ ...good, sentence: '走ります。' }));
  const r = await gen({ fetch, host: HOST, model: MODEL, word: taberu });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'error');
  assert.equal(fetch.calls.length, 2);
});

test('generate: server unreachable gives ollama-down without retrying', async () => {
  const fetch = mockFetch(new TypeError('fetch failed'));
  const r = await gen({ fetch, host: HOST, model: MODEL, word: taberu });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'ollama-down');
  assert.equal(fetch.calls.length, 1);
});

test('generate: missing model (404 not found) gives model-missing without retrying', async () => {
  const fetch = mockFetch(fail(404, { error: `model "${MODEL}" not found, try pulling it first` }));
  const r = await gen({ fetch, host: HOST, model: MODEL, word: taberu });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'model-missing');
  assert.equal(fetch.calls.length, 1);
});

test('generate: an HTTP 500 is retried once, then reported as error', async () => {
  const fetch = mockFetch(fail(500, { error: 'boom' }));
  const r = await gen({ fetch, host: HOST, model: MODEL, word: taberu });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'error');
  assert.equal(fetch.calls.length, 2);
});

test('generate: a timeout aborts the request, reports error, and is not retried', async () => {
  const calls = [];
  const fetch = (url, init) => {
    calls.push(url);
    return new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    });
  };
  const r = await gen({ fetch, host: HOST, model: MODEL, word: taberu, timeoutMs: 20 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'error');
  assert.match(r.error, /timed out/i);
  assert.equal(calls.length, 1);
});

test('generate: a missing reply message is bad output', async () => {
  const fetch = mockFetch(ok({}), chatReply(good));
  const r = await gen({ fetch, host: HOST, model: MODEL, word: taberu });
  assert.equal(r.ok, true);
  assert.equal(fetch.calls.length, 2);
});

test('buildMessages: asks for grammar and usage (not watchOut) with banned topics', () => {
  const text = buildMessages(taberu).map((m) => m.content).join('\n');
  for (const f of ['grammar', 'usage']) assert.ok(text.includes(f), f);
  assert.equal(text.includes('watchOut'), false);
  assert.match(text, /etymology/i);
  assert.match(text, /gender/i);
});

test('validate: content has grammar and usage, and no note or watchOut field', () => {
  const { content } = validate({ ...good, watchOut: 'ignored', note: 'ignored' }, taberu);
  assert.equal(content.grammar, good.grammar);
  assert.equal(content.usage, good.usage);
  assert.equal('note' in content, false);
  assert.equal('watchOut' in content, false);
});

test('generate: the reading comes from the injected reader, not the model', async () => {
  const fetch = mockFetch(chatReply({ ...good, reading: 'めちゃくちゃ' }));
  const r = await generate({ fetch, host: HOST, model: MODEL, word: taberu, reader: fakeReader });
  assert.equal(r.ok, true);
  assert.equal(r.content.reading, fakeReader(good.sentence));
});

test('generate: an async reader works too', async () => {
  const fetch = mockFetch(chatReply(good));
  const reader = async (s) => `async:${s}`;
  const r = await generate({ fetch, host: HOST, model: MODEL, word: taberu, reader });
  assert.equal(r.content.reading, `async:${good.sentence}`);
});

test('generate: the request does not ask the model for a reading', async () => {
  const fetch = mockFetch(chatReply(good));
  await gen({ fetch, host: HOST, model: MODEL, word: taberu });
  const body = JSON.parse(fetch.calls[0].init.body);
  assert.equal('reading' in body.format.properties, false);
  const prompt = body.messages.map((m) => m.content).join('\n');
  assert.equal(/hiragana/i.test(prompt), false);
});

test('generate: a reader that throws gives an error result, not a crash', async () => {
  const fetch = mockFetch(chatReply(good));
  const reader = () => {
    throw new Error('dictionary broke');
  };
  const r = await generate({ fetch, host: HOST, model: MODEL, word: taberu, reader });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'error');
  assert.match(r.error, /reading/i);
});

test('generate: requires a reader', async () => {
  const fetch = mockFetch(chatReply(good));
  await assert.rejects(() => generate({ fetch, host: HOST, model: MODEL, word: taberu }), /reader/);
});

// ---------- stricter validation and prompt rules ----------

test('validate: rejects a translation that contains Japanese or Chinese characters', () => {
  for (const bad of ['I eat 食べます', 'I eat たべます', '我吃面包', 'Eat パン']) {
    const r = validate({ ...good, translation: bad }, taberu);
    assert.equal(r.ok, false, bad);
    assert.match(r.error, /translation/i);
  }
  assert.equal(validate({ ...good, translation: "I'm eating bread, aren't I?" }, taberu).ok, true);
});

test('validate: rejects grammar or usage containing JSON debris', () => {
  for (const field of ['grammar', 'usage']) {
    for (const bad of ['Fine."} reviewWordsUsed: [', 'See {this}', 'ok ] [ broken']) {
      const r = validate({ ...good, [field]: bad }, taberu);
      assert.equal(r.ok, false, `${field}: ${bad}`);
    }
  }
});

test('buildMessages: usage must not be about the polite ます form', () => {
  const text = buildMessages(taberu).map((m) => m.content).join('\n');
  assert.match(text, /do not mention[^.]*polite/i);
});
