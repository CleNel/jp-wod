const fs = require('node:fs');
const path = require('node:path');
const { addDays, dayDiff, range } = require('./dates');

const DEFAULT_SETTINGS = Object.freeze({
  host: 'http://127.0.0.1:11434', // not "localhost": it can resolve to IPv6 first
  model: 'gemma3:12b',
  launchAtLogin: true,
});

// mulberry32: small seeded PRNG so shuffles are deterministic in tests.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates on a copy.
function shuffle(items, seed) {
  const rand = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function freshState(seed) {
  return {
    version: 1,
    seed,
    startDate: null,
    order: [],
    entries: {},
    settings: { ...DEFAULT_SETTINGS },
  };
}

class Store {
  // words: [{ written, reading, meaning, pos }]; `written` is the unique key.
  constructor({ filePath, words, seed }) {
    this.filePath = filePath;
    this.words = new Map(words.map((w) => [w.written, w]));
    this.state = this._load(seed ?? Math.floor(Math.random() * 2 ** 31));
  }

  _load(seed) {
    let raw;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return freshState(seed);
      throw err;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.order) || typeof parsed.entries !== 'object') {
        throw new Error('bad shape');
      }
      return {
        ...freshState(seed),
        ...parsed,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      };
    } catch {
      // Keep the unreadable file for inspection and start fresh.
      try {
        fs.renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
      } catch {
        /* ignore */
      }
      return freshState(seed);
    }
  }

  // Atomic: write state.json.tmp, then rename over state.json.
  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  getState() {
    return this.state;
  }

  getStartDate() {
    return this.state.startDate;
  }

  setStartDate(date) {
    this.state.startDate = date;
    this.save();
  }

  getSettings() {
    return { ...this.state.settings };
  }

  setSettings(patch) {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key in patch) this.state.settings[key] = patch[key];
    }
    this.save();
    return this.getSettings();
  }

  // Append words not yet in `order` to its end. Existing positions never move.
  // Words removed from the list keep their slot so no other day shifts.
  syncOrder() {
    const known = new Set(this.state.order);
    const fresh = [...this.words.keys()].filter((k) => !known.has(k));
    if (fresh.length === 0) return false;
    this.state.order.push(...shuffle(fresh, this.state.seed + this.state.order.length));
    return true;
  }

  // Assign a word to every day from startDate through today + ahead.
  // Existing entries are never touched.
  ensureEntries(today, ahead = 7) {
    let changed = this.syncOrder();
    if (!this.state.startDate) {
      this.state.startDate = today;
      changed = true;
    }
    const { order, entries, startDate } = this.state;
    if (order.length === 0) return;

    for (const date of range(startDate, addDays(today, ahead))) {
      if (entries[date]) continue;
      const index = dayDiff(startDate, date) % order.length;
      entries[date] = { key: order[index], done: false, content: null };
      changed = true;
    }
    if (changed) this.save();
  }

  _word(key) {
    return this.words.get(key) || { written: key, reading: '', meaning: '', pos: '' };
  }

  _view(date, entry, today) {
    return {
      date,
      key: entry.key,
      ...this._word(entry.key),
      done: entry.done,
      missed: !entry.done && date < today,
      isToday: date === today,
      hasContent: Boolean(entry.content),
      content: entry.content,
    };
  }

  getDay(date) {
    const entry = this.state.entries[date];
    if (!entry) return null;
    return { ...this._view(date, entry, null), missed: false };
  }

  // Past and today only, newest first.
  overview(today) {
    return Object.keys(this.state.entries)
      .filter((d) => d <= today)
      .sort()
      .reverse()
      .map((d) => this._view(d, this.state.entries[d], today));
  }

  _entry(date) {
    const entry = this.state.entries[date];
    if (!entry) throw new Error(`No entry for ${date}`);
    return entry;
  }

  setDone(date, done) {
    this._entry(date).done = Boolean(done);
    this.save();
  }

  setContent(date, content) {
    this._entry(date).content = content ?? null;
    this.save();
  }

  // Up to n words the user has checked off on days before `date`, for the
  // sentence prompt to optionally reuse. Deterministic for a given date, so
  // regenerating a day offers the same candidates. Never the day's own word.
  reviewCandidates(date, n = 1) {
    const { entries } = this.state;
    const own = entries[date] && entries[date].key;
    const keys = [
      ...new Set(
        Object.keys(entries)
          .filter((d) => d < date && entries[d].done)
          .map((d) => entries[d].key)
      ),
    ]
      .filter((k) => k !== own && this.words.has(k))
      .sort();
    const seed = Number(date.replace(/-/g, '')) + this.state.seed;
    return shuffle(keys, seed)
      .slice(0, n)
      .map((k) => this.words.get(k));
  }

  // Days that need example content: today, then missed (newest first),
  // then the next `ahead` days (soonest first).
  pendingContentDates(today, ahead = 7) {
    const { entries } = this.state;
    const needs = (d) => entries[d] && !entries[d].content;
    const past = Object.keys(entries).filter((d) => d < today).sort().reverse();
    const missed = past.filter((d) => !entries[d].done && needs(d));
    const upcoming = [];
    for (let i = 1; i <= ahead; i++) {
      const d = addDays(today, i);
      if (needs(d)) upcoming.push(d);
    }
    return [...(needs(today) ? [today] : []), ...missed, ...upcoming];
  }
}

module.exports = { Store, DEFAULT_SETTINGS, shuffle, mulberry32 };
