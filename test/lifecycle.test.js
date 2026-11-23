const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createClockWatcher } = require('../lib/clock');
const { createWakeHandler } = require('../lib/wake');
const { loginItemOptions, isHiddenLaunch } = require('../lib/login');

// ---------- clock watcher (midnight rollover) ----------

function makeClock(startDate) {
  let date = startDate;
  const events = [];
  const watcher = createClockWatcher({
    today: () => date,
    onRollover: (now, before) => events.push([now, before]),
  });
  return { watcher, events, set: (d) => (date = d) };
}

test('clock: no rollover while the date is unchanged', () => {
  const { watcher, events } = makeClock('2026-05-10');
  watcher.check();
  watcher.check();
  assert.deepEqual(events, []);
});

test('clock: fires once when the date changes, with the new and old date', () => {
  const { watcher, events, set } = makeClock('2026-05-10');
  set('2026-05-11');
  watcher.check();
  watcher.check();
  assert.deepEqual(events, [['2026-05-11', '2026-05-10']]);
});

test('clock: several days passing (PC was off) is one rollover', () => {
  const { watcher, events, set } = makeClock('2026-05-10');
  set('2026-05-14');
  watcher.check();
  assert.deepEqual(events, [['2026-05-14', '2026-05-10']]);
});

test('clock: year rollover works', () => {
  const { watcher, events, set } = makeClock('2026-12-31');
  set('2027-01-01');
  watcher.check();
  assert.deepEqual(events, [['2027-01-01', '2026-12-31']]);
});

test('clock: a clock set backwards is also a change', () => {
  const { watcher, events, set } = makeClock('2026-05-10');
  set('2026-05-08');
  watcher.check();
  assert.deepEqual(events, [['2026-05-08', '2026-05-10']]);
});

test('clock: a throwing listener does not break later checks', () => {
  let date = '2026-05-10';
  let calls = 0;
  const watcher = createClockWatcher({
    today: () => date,
    onRollover: () => {
      calls++;
      throw new Error('boom');
    },
  });
  date = '2026-05-11';
  watcher.check();
  date = '2026-05-12';
  watcher.check();
  assert.equal(calls, 2);
});

test('clock: start registers a 60 second interval and stop clears it', () => {
  const registered = [];
  const cleared = [];
  const watcher = createClockWatcher({
    today: () => '2026-05-10',
    onRollover: () => {},
    setIntervalFn: (fn, ms) => {
      registered.push([fn, ms]);
      return 'handle';
    },
    clearIntervalFn: (h) => cleared.push(h),
  });
  watcher.start();
  assert.equal(registered.length, 1);
  assert.equal(registered[0][1], 60000);
  watcher.stop();
  assert.deepEqual(cleared, ['handle']);
});

test('clock: start twice does not stack intervals; the interval length is configurable', () => {
  const registered = [];
  const watcher = createClockWatcher({
    today: () => '2026-05-10',
    onRollover: () => {},
    intervalMs: 1000,
    setIntervalFn: (fn, ms) => registered.push(ms) && 'h',
    clearIntervalFn: () => {},
  });
  watcher.start();
  watcher.start();
  assert.deepEqual(registered, [1000]);
});

// ---------- wake handler ----------

function makeWake(opts = {}) {
  const log = [];
  const timers = [];
  const handler = createWakeHandler({
    check: () => log.push('check'),
    run: () => {
      log.push('run');
      if (opts.runThrows) throw new Error('nope');
    },
    setTimeoutFn: (fn, ms) => {
      timers.push({ fn, ms, cleared: false });
      return timers.length - 1;
    },
    clearTimeoutFn: (i) => {
      if (timers[i]) timers[i].cleared = true;
    },
  });
  const fire = () => timers.filter((t) => !t.cleared).forEach((t) => t.fn());
  return { handler, log, timers, fire };
}

test('wake: checks the date right away, then runs generation after about 5 seconds', () => {
  const { handler, log, timers, fire } = makeWake();
  handler();
  assert.deepEqual(log, ['check']);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 5000);
  fire();
  assert.deepEqual(log, ['check', 'run']);
});

test('wake: repeated resume events within the delay produce a single run', () => {
  const { handler, log, timers, fire } = makeWake();
  handler();
  handler();
  handler();
  assert.equal(timers.filter((t) => !t.cleared).length, 1);
  fire();
  assert.equal(log.filter((x) => x === 'run').length, 1);
  assert.equal(log.filter((x) => x === 'check').length, 3);
});

test('wake: a failing run does not throw out of the timer', () => {
  const { handler, fire } = makeWake({ runThrows: true });
  handler();
  assert.doesNotThrow(fire);
});

// ---------- launch at login and hidden start ----------

test('login: nothing is registered from an unpackaged (dev) run', () => {
  assert.equal(loginItemOptions({ isPackaged: false, launchAtLogin: true }), null);
  assert.equal(loginItemOptions({ isPackaged: false, launchAtLogin: false }), null);
});

test('login: a packaged app registers with --hidden when enabled', () => {
  assert.deepEqual(loginItemOptions({ isPackaged: true, launchAtLogin: true }), {
    openAtLogin: true,
    args: ['--hidden'],
  });
});

test('login: a packaged app unregisters when disabled', () => {
  const opts = loginItemOptions({ isPackaged: true, launchAtLogin: false });
  assert.equal(opts.openAtLogin, false);
});

test('isHiddenLaunch looks for exactly --hidden', () => {
  assert.equal(isHiddenLaunch(['JP WOD.exe', '--hidden']), true);
  assert.equal(isHiddenLaunch(['electron.exe', '.', '--hidden']), true);
  assert.equal(isHiddenLaunch(['electron.exe', '.']), false);
  assert.equal(isHiddenLaunch(['JP WOD.exe', '--hidden-ish']), false);
  assert.equal(isHiddenLaunch([]), false);
});

// ---------- tray icon asset ----------

test('assets/tray.png is a valid 32x32 RGBA PNG', () => {
  const buf = fs.readFileSync(path.join(__dirname, '..', 'assets', 'tray.png'));
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]); // PNG signature
  assert.equal(buf.subarray(12, 16).toString(), 'IHDR');
  assert.equal(buf.readUInt32BE(16), 32); // width
  assert.equal(buf.readUInt32BE(20), 32); // height
  assert.equal(buf[24], 8); // bit depth
  assert.equal(buf[25], 6); // RGBA
});
