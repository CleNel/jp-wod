// Ollama client. `fetch` is injected so tests can mock it.
// Host should be http://127.0.0.1:11434, not localhost: on Windows, localhost
// can resolve to IPv6 first while Ollama listens on IPv4.

const DEFAULT_TIMEOUT_MS = 180000; // first request after launch can be slow (model load)

// Structured output schema for /api/chat `format`.
const SCHEMA = {
  type: 'object',
  properties: {
    sentence: { type: 'string' },
    translation: { type: 'string' },
    grammar: { type: 'string' },
    usage: { type: 'string' },
  },
  required: ['sentence', 'translation', 'grammar', 'usage'],
};

const trimSlash = (host) => host.replace(/\/+$/, '');

// ---------- server check ----------

// -> { status: 'ok' | 'ollama-down' | 'model-missing' }
async function checkServer({ fetch, host, model }) {
  let res;
  try {
    res = await fetch(`${trimSlash(host)}/api/tags`);
  } catch {
    return { status: 'ollama-down' };
  }
  if (!res.ok) return { status: 'ollama-down' };

  let body;
  try {
    body = await res.json();
  } catch {
    return { status: 'ollama-down' };
  }
  const names = (body.models || []).map((m) => m.name || m.model);
  const wanted = model.includes(':') ? model : `${model}:latest`;
  return { status: names.includes(wanted) || names.includes(model) ? 'ok' : 'model-missing' };
}

// ---------- prompt ----------

function buildMessages(word, reviewWords = []) {
  const system = [
    'You write example material for an English-speaking beginner learning Japanese (JLPT N5).',
    'The learner reads ENGLISH. Every explanation must be in English.',
    'Reply with one JSON object and nothing else.',
    '',
    'LANGUAGE OF EACH FIELD (strict):',
    '- sentence: Japanese only. One short, natural, polite-form sentence with beginner vocabulary.',
    '- translation: ENGLISH ONLY. No Japanese and no Chinese characters.',
    '',
    'TWO SHORT NOTES. Each is ENGLISH, exactly ONE sentence, and may quote Japanese words:',
    '- grammar: explain one grammar point that is visible in THIS sentence: what a particle ' +
      'does, how the target word is conjugated, or a subject or topic that was left out. ' +
      'Quote the Japanese piece you are explaining.',
    '- usage: the nuance of the target word, the situations it is typically used in, or a ' +
      'common phrase or collocation with it. Do not mention the polite ます form or ' +
      'politeness level of the verb ending; that is covered elsewhere.',
    '',
    'NEVER write Chinese. NEVER write romaji. NEVER put Japanese in translation. ' +
      'In the notes, do not talk about etymology, kanji history, stroke order, pitch accent, ' +
      'or grammatical gender and number (Japanese has none). Do not state anything you are ' +
      'not sure is true.',
    '',
    'Example for the word 読む (よむ, to read, verb):',
    JSON.stringify({
      sentence: '毎晩、本を読みます。',
      translation: 'I read a book every night.',
      grammar: '本を uses the particle を to mark the object, and 読みます is the polite present form of 読む.',
      usage: 'The ます form is polite and neutral, fine for everyday conversation.',
    }),
  ].join('\n');

  const lines = [
    `Target word: ${word.written}`,
    `Reading: ${word.reading}`,
    `Meaning: ${word.meaning}`,
    `Part of speech: ${word.pos}`,
    '',
    `Write one example sentence that contains the exact target word ${word.written}. ` +
      'Verbs and adjectives may be conjugated (for example 食べる may appear as 食べます), ' +
      'but the word must clearly be there.',
    'The sentence must make sense in real life (no odd combinations). ' +
      'Return the fields sentence, translation, grammar and usage, ' +
      'in the languages required above.',
  ];

  if (reviewWords.length > 0) {
    const single = reviewWords.length === 1;
    lines.push(
      '',
      single
        ? 'REQUIRED: the sentence must contain BOTH the target word and the review word below, ' +
            'which the learner already knows. Make a sensible, natural sentence that uses both ' +
            'together; choose a situation where they make sense. Do not use other advanced vocabulary.'
        : 'REQUIRED: the sentence must contain the target word AND at least one of the review ' +
            'words below, which the learner already knows. Choose the one that makes a sensible, ' +
            'natural sentence together with the target word. Do not use other advanced vocabulary.',
      ...reviewWords.map((w) => `- ${w.written} (${w.reading}, ${w.meaning})`)
    );
  }

  return [
    { role: 'system', content: system },
    { role: 'user', content: lines.join('\n') },
  ];
}

// ---------- validation ----------

const isKana = (ch) => /[ぁ-ゖァ-ヺ]/.test(ch);

// Does the sentence contain the word, allowing conjugation? Verbs and
// i-adjectives match on the stem (trailing kana dropped): 食べる -> 食べ.
function containsWord(sentence, word) {
  const { written, pos } = word;
  let needle = written;
  if ((pos === 'verb' || pos === 'i-adjective') && written.length > 1 && isKana(written.slice(-1))) {
    needle = written.slice(0, -1);
  }
  return sentence.includes(needle);
}

// The translation must be English: no kana, no kanji/Chinese.
const JAPANESE_OR_CHINESE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/;
// Models sometimes leak the end of their JSON into a text field.
const JSON_DEBRIS = /[{}\[\]]/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

// -> { ok: true, content } | { ok: false, error }
function validate(result, word, reviewWords = []) {
  if (!result || typeof result !== 'object') {
    return { ok: false, error: 'reply is not an object' };
  }
  const content = {
    sentence: str(result.sentence),
    translation: str(result.translation),
    grammar: str(result.grammar),
    usage: str(result.usage),
  };
  for (const [field, value] of Object.entries(content)) {
    if (!value) return { ok: false, error: `field "${field}" is missing or empty` };
  }
  if (JAPANESE_OR_CHINESE.test(content.translation)) {
    return { ok: false, error: 'translation contains Japanese or Chinese characters' };
  }
  for (const field of ['grammar', 'usage']) {
    if (JSON_DEBRIS.test(content[field])) {
      return { ok: false, error: `field "${field}" contains JSON debris` };
    }
  }
  if (!containsWord(content.sentence, word)) {
    return { ok: false, error: `sentence does not contain the word ${word.written}` };
  }

  // Review words are asked for in the prompt but a sentence without them is
  // still valid. Which were used is found by scanning the sentence for the
  // offered words (the model's own claims are not trusted).
  const review = reviewWords
    .filter((w) => containsWord(content.sentence, w))
    .map((w) => w.written);

  return { ok: true, content: { ...content, review } };
}

// ---------- generation ----------

async function readError(res) {
  try {
    const body = await res.json();
    return typeof body.error === 'string' ? body.error : JSON.stringify(body);
  } catch {
    return `HTTP ${res.status}`;
  }
}

// One request. -> { ok, content } or { ok: false, status, error, retry }
async function attempt({ fetch, host, model, word, reviewWords, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetch(`${trimSlash(host)}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: buildMessages(word, reviewWords),
          stream: false,
          format: SCHEMA,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return { ok: false, status: 'error', error: 'request timed out', retry: false };
      }
      return { ok: false, status: 'ollama-down', error: String(err && err.message), retry: false };
    }

    if (!res.ok) {
      const error = await readError(res);
      if (res.status === 404 && /not found/i.test(error)) {
        return { ok: false, status: 'model-missing', error, retry: false };
      }
      return { ok: false, status: 'error', error, retry: true };
    }

    let parsed;
    try {
      const body = await res.json();
      const text = body && body.message && body.message.content;
      if (typeof text !== 'string') throw new Error('reply has no message content');
      parsed = JSON.parse(text);
    } catch (err) {
      return { ok: false, status: 'error', error: `unreadable reply: ${err.message}`, retry: true };
    }

    const checked = validate(parsed, word, reviewWords);
    if (!checked.ok) return { ok: false, status: 'error', error: checked.error, retry: true };
    return { ok: true, content: checked.content };
  } finally {
    clearTimeout(timer);
  }
}

// Generate example content for a word. Retries once on bad output or a server
// error; an unreachable server, a missing model, or a timeout stops at once.
// The hiragana reading is NOT asked of the model: `reader` (see lib/reading.js)
// computes it from the validated sentence. It may be sync or async.
// -> { ok: true, content } | { ok: false, status, error }
async function generate({
  fetch,
  host,
  model,
  word,
  reader,
  reviewWords = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (typeof reader !== 'function') throw new TypeError('generate: a reader function is required');
  let last;
  for (let i = 0; i < 2; i++) {
    last = await attempt({ fetch, host, model, word, reviewWords, timeoutMs });
    if (last.ok || !last.retry) break;
  }
  if (!last.ok) return { ok: false, status: last.status, error: last.error };

  try {
    const reading = await reader(last.content.sentence);
    return { ok: true, content: { ...last.content, reading } };
  } catch (err) {
    return { ok: false, status: 'error', error: `could not compute reading: ${err.message}` };
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  SCHEMA,
  checkServer,
  buildMessages,
  containsWord,
  validate,
  generate,
};
