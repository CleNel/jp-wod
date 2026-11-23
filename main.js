const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');

const { Store } = require('./lib/store');
const { loadWords } = require('./lib/words');
const { createReader } = require('./lib/reading');
const ollama = require('./lib/ollama');
const { createGenerator } = require('./lib/generator');
const { createApi } = require('./lib/api');
const { localDateStr } = require('./lib/dates');
const { createClockWatcher } = require('./lib/clock');
const { createWakeHandler } = require('./lib/wake');
const { loginItemOptions, isHiddenLaunch } = require('./lib/login');

// Lets tests and experiments use a throwaway data folder.
if (process.env.JPWOD_USER_DATA) app.setPath('userData', process.env.JPWOD_USER_DATA);
app.setAppUserModelId('com.jpwod.app');

// One instance only: a second launch just brings the first one forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const RETRY_INTERVAL_MS = 10 * 60 * 1000; // while content is missing
const dev = !app.isPackaged;

// Test seams, honored only in dev runs (never in the packaged app):
//   JPWOD_FAKE_TODAY_FILE  a file holding YYYY-MM-DD that overrides today's date
//   JPWOD_CLOCK_TICK_MS    how often the date is re-checked (default 60 seconds)
//   JPWOD_DEBUG            exposes a small handle on globalThis for inspection
function today() {
  const file = dev && process.env.JPWOD_FAKE_TODAY_FILE;
  if (file) {
    try {
      const text = fs.readFileSync(file, 'utf8').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    } catch {
      /* fall through to the real date */
    }
  }
  return localDateStr();
}

let mainWindow = null;
let tray = null;
let quitting = false;
let store = null;
let generator = null;
let api = null;
let lastLoginKey = null;

const startHidden = isHiddenLaunch(process.argv);

// ---------- window ----------

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 420,
    title: 'JP WOD',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenuBarVisibility(false);
  // The renderer is one local page: no popups, no navigating away.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Launched at login with --hidden: stay in the tray until opened.
  win.once('ready-to-show', () => {
    if (!startHidden) win.show();
  });

  // Closing the window hides it; the app keeps running in the tray.
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  mainWindow = win;
  return win;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Tell every window that data changed; the renderer re-reads what it shows.
function notifyChanged() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('changed');
  }
}

// ---------- tray and launch at login ----------

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open JP WOD', click: showWindow },
    {
      label: 'Launch at login',
      type: 'checkbox',
      checked: store.getSettings().launchAtLogin,
      click: (item) => {
        try {
          api.setSettings({ launchAtLogin: item.checked });
        } catch (err) {
          console.error('could not change launch at login:', err);
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: quit },
  ]);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
  tray.setToolTip('JP WOD');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

// Rebuild the menu (the checkbox mirrors the saved setting) and apply the
// login item. Only the packaged app registers itself (see lib/login.js).
function syncSettingsEffects() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(buildTrayMenu());
  const options = loginItemOptions({
    isPackaged: app.isPackaged,
    launchAtLogin: store.getSettings().launchAtLogin,
  });
  const key = JSON.stringify(options);
  if (options && key !== lastLoginKey) {
    app.setLoginItemSettings(options);
    lastLoginKey = key;
  }
}

function quit() {
  quitting = true;
  app.quit();
}

// ---------- backend ----------

function startBackend() {
  store = new Store({
    filePath: path.join(app.getPath('userData'), 'state.json'),
    words: loadWords(path.join(__dirname, 'data', 'words.txt')),
  });

  // The kuromoji dictionary takes about a second to load; generation waits for it.
  const readerPromise = createReader();
  readerPromise.catch((err) => console.error('reading dictionary failed to load:', err));

  generator = createGenerator({
    store,
    today,
    onChange: notifyChanged,
    checkServer: (opts) => ollama.checkServer({ fetch: globalThis.fetch, ...opts }),
    generate: async (opts) =>
      ollama.generate({ fetch: globalThis.fetch, reader: await readerPromise, ...opts }),
  });

  api = createApi({
    store,
    generator,
    today,
    notify: () => {
      notifyChanged();
      syncSettingsEffects();
    },
  });

  // Only our own window's top frame may call the API.
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (
        !mainWindow ||
        event.sender !== mainWindow.webContents ||
        event.senderFrame !== event.sender.mainFrame
      ) {
        throw new Error('untrusted sender');
      }
      return fn(...args);
    });

  handle('overview', () => api.overview());
  handle('day', (date) => api.day(date));
  handle('set-done', (date, done) => api.setDone(date, done));
  handle('regenerate', (date) => api.regenerate(date));
  handle('status', () => api.status());
  handle('settings:get', () => api.getSettings());
  handle('settings:set', (patch) => api.setSettings(patch));

  const run = () => generator.run().catch((err) => console.error('generation run failed:', err));

  // Nothing depends on a scheduled time. Work out what is missing on launch,
  // when the date rolls over, on wake from sleep, and on a timer.
  store.ensureEntries(today(), 0);
  run();
  setInterval(run, RETRY_INTERVAL_MS);

  const clock = createClockWatcher({
    today,
    intervalMs: (dev && Number(process.env.JPWOD_CLOCK_TICK_MS)) || 60000,
    onRollover: () => {
      store.ensureEntries(today(), 0); // the new day exists before anything reads it
      notifyChanged();
      run();
    },
  });
  clock.start();

  const onWake = createWakeHandler({ check: clock.check, run });
  powerMonitor.on('resume', onWake);

  if (dev && process.env.JPWOD_DEBUG) {
    globalThis.__jpwod = {
      window: () => mainWindow,
      tray: () => tray,
      menu: () => buildTrayMenu(),
      settings: () => store.getSettings(),
      loginItem: () => app.getLoginItemSettings(),
      emitResume: () => powerMonitor.emit('resume'),
      showWindow,
    };
  }
}

app.on('second-instance', showWindow);
app.on('before-quit', () => {
  quitting = true;
});

// Closing the window only hides it, so the app lives in the tray until Quit.
app.on('window-all-closed', () => {});

app.whenReady().then(() => {
  startBackend();
  createWindow();
  createTray();
  syncSettingsEffects();

  app.on('activate', showWindow);
});
