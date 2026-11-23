// Notices when the local calendar date changes: at midnight while the app is
// running, or after the PC was off or asleep for days. Nothing depends on a
// scheduled time, so this just compares today's date every minute (and on
// demand, when the PC wakes).

function createClockWatcher({
  today,
  onRollover,
  intervalMs = 60000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let last = today();
  let handle = null;

  // Any change counts, including several days at once or a clock set back.
  function check() {
    const now = today();
    if (now === last) return;
    const before = last;
    last = now;
    try {
      onRollover(now, before);
    } catch {
      /* a broken listener must not stop later checks */
    }
  }

  return {
    check,
    start() {
      if (handle !== null) return;
      handle = setIntervalFn(check, intervalMs);
    },
    stop() {
      if (handle === null) return;
      clearIntervalFn(handle);
      handle = null;
    },
  };
}

module.exports = { createClockWatcher };
