// What to do when the PC wakes from sleep: re-check the date at once (a day may
// have passed), then wait a few seconds for the network to come back before
// asking Ollama for anything. Several resume events in a row make one run.

function createWakeHandler({
  check,
  run,
  delayMs = 5000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let timer = null;

  return function onWake() {
    try {
      check();
    } catch {
      /* ignore */
    }
    if (timer !== null) clearTimeoutFn(timer);
    timer = setTimeoutFn(() => {
      timer = null;
      try {
        const result = run();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch {
        /* ignore */
      }
    }, delayMs);
  };
}

module.exports = { createWakeHandler };
