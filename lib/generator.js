// Generation queue. No Electron in here, so it can be tested.
//
// Priority: today, then missed days newest first (store.pendingContentDates
// with ahead = 0: sentences are written on the day, never ahead). One day is
// generated at a time. A day is never generated twice at once: `inFlight`
// guards both the background run and a user's Regenerate.
//
// Status is the outcome of the latest attempt:
//   'ok' | 'ollama-down' | 'model-missing' | 'error'

function createGenerator({ store, generate, checkServer, today, onChange = () => {} }) {
  let status = 'ok';
  let error = null;
  const inFlight = new Set();
  let running = null;
  let rerun = false;

  const emit = () => {
    try {
      onChange();
    } catch {
      /* a broken listener must not break generation */
    }
  };

  const wordFor = (date) => {
    const day = store.getDay(date);
    if (!day) return null;
    // A word removed from words.txt has no reading: nothing to generate from.
    if (!day.reading) return null;
    return { written: day.written, reading: day.reading, meaning: day.meaning, pos: day.pos };
  };

  // Days that still need content and can be generated.
  const pendingDates = (t) => store.pendingContentDates(t, 0).filter((d) => wordFor(d));

  // One day. Returns { started: false } if it is already being generated.
  async function generateDay(date) {
    if (inFlight.has(date)) return { started: false };
    const word = wordFor(date);
    if (!word) return { started: false };

    inFlight.add(date);
    emit();
    try {
      const { host, model } = store.getSettings();
      const result = await generate({ host, model, word, reviewWords: store.reviewCandidates(date) });
      if (result.ok) {
        store.setContent(date, result.content);
        status = 'ok';
        error = null;
      } else {
        status = result.status;
        error = result.error || null;
      }
      return { started: true, ...result };
    } catch (err) {
      status = 'error';
      error = String((err && err.message) || err);
      return { started: true, ok: false, status: 'error', error };
    } finally {
      inFlight.delete(date);
      emit();
    }
  }

  async function runOnce() {
    const t = today();
    store.ensureEntries(t, 0);
    const pending = pendingDates(t);
    if (pending.length === 0) return;

    const { host, model } = store.getSettings();
    const check = await checkServer({ host, model });
    if (check.status !== 'ok') {
      status = check.status;
      error = null;
      emit();
      return;
    }
    if (status !== 'ok') {
      status = 'ok';
      error = null;
      emit();
    }

    for (const date of pending) {
      const day = store.getDay(date);
      if (!day || day.content) continue;
      const r = await generateDay(date);
      if (r.status === 'ollama-down' || r.status === 'model-missing') break;
    }
  }

  // Fill in whatever is missing. Calls made while a run is in progress are
  // coalesced into one follow-up run.
  function run() {
    if (running) {
      rerun = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          rerun = false;
          await runOnce();
        } while (rerun);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  // User-triggered. The old content stays until the new one succeeds.
  async function regenerate(date) {
    if (!store.getDay(date)) throw new Error(`No entry for ${date}`);
    return generateDay(date);
  }

  return {
    run,
    regenerate,
    isGenerating: (date) => inFlight.has(date),
    getStatus: () => ({ status, error, generating: [...inFlight] }),
  };
}

module.exports = { createGenerator };
