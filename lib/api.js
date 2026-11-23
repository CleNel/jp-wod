// The app's API, as plain functions. main.js exposes these over IPC and
// preload.js exposes them to the renderer as window.api. Everything the
// renderer sends is untrusted, so every argument is validated here.

const { dayDiff } = require('./dates');

function checkDate(date) {
  if (typeof date !== 'string') throw new TypeError('date must be a YYYY-MM-DD string');
  try {
    dayDiff('2000-01-01', date); // throws on a malformed or impossible date
  } catch {
    throw new TypeError('date must be a YYYY-MM-DD string');
  }
  return date;
}

const HOST_RE = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?\/?$/;

// -> a clean patch, or throws. Unknown keys are dropped.
function checkSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('settings must be an object');
  }
  const clean = {};
  if ('model' in patch) {
    if (typeof patch.model !== 'string' || !patch.model.trim() || patch.model.length > 100) {
      throw new TypeError('model must be a non-empty string of at most 100 characters');
    }
    clean.model = patch.model.trim();
  }
  if ('host' in patch) {
    if (typeof patch.host !== 'string' || !HOST_RE.test(patch.host)) {
      throw new TypeError('host must be an http:// or https:// address');
    }
    clean.host = patch.host;
  }
  if ('launchAtLogin' in patch) {
    if (typeof patch.launchAtLogin !== 'boolean') {
      throw new TypeError('launchAtLogin must be a boolean');
    }
    clean.launchAtLogin = patch.launchAtLogin;
  }
  return clean;
}

function createApi({ store, generator, today, notify = () => {} }) {
  const ensure = () => {
    const t = today();
    store.ensureEntries(t, 0);
    return t;
  };

  return {
    // Past days and today, newest first, without the content payload.
    overview() {
      const t = ensure();
      return store.overview(t).map(({ content, ...day }) => ({
        ...day,
        generating: generator.isGenerating(day.date),
      }));
    },

    // store.getDay knows nothing about "today", so the flags are set here;
    // they must match what overview() says for the same day.
    day(date) {
      checkDate(date);
      const t = ensure();
      const day = store.getDay(date);
      if (!day) return null;
      return {
        ...day,
        isToday: date === t,
        missed: !day.done && date < t,
        generating: generator.isGenerating(date),
      };
    },

    setDone(date, done) {
      checkDate(date);
      if (typeof done !== 'boolean') throw new TypeError('done must be a boolean');
      store.setDone(date, done);
      notify();
    },

    async regenerate(date) {
      checkDate(date);
      return generator.regenerate(date);
    },

    status() {
      return generator.getStatus();
    },

    getSettings() {
      return store.getSettings();
    },

    // Validates the whole patch before applying any of it, then re-runs
    // generation (a new model or host may fix a failing status).
    setSettings(patch) {
      const clean = checkSettings(patch);
      const settings = store.setSettings(clean);
      notify();
      Promise.resolve(generator.run()).catch(() => {});
      return settings;
    },
  };
}

module.exports = { createApi, checkDate, checkSettings };
