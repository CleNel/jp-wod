const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const { Store } = require('./lib/store');
const { loadWords } = require('./lib/words');
const { createReader } = require('./lib/reading');
const ollama = require('./lib/ollama');
const { createGenerator } = require('./lib/generator');
const { createApi } = require('./lib/api');
const { localDateStr } = require('./lib/dates');

// Lets tests and experiments use a throwaway data folder.
if (process.env.JPWOD_USER_DATA) app.setPath('userData', process.env.JPWOD_USER_DATA);

const RETRY_INTERVAL_MS = 10 * 60 * 1000; // while content is missing

let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 420,
    title: 'JP WOD',
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
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

// Tell every window that data changed; the renderer re-reads what it shows.
function notifyChanged() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('changed');
  }
}

function startBackend() {
  const store = new Store({
    filePath: path.join(app.getPath('userData'), 'state.json'),
    words: loadWords(path.join(__dirname, 'data', 'words.txt')),
  });

  // The kuromoji dictionary takes about a second to load; generation waits for it.
  const readerPromise = createReader();
  readerPromise.catch((err) => console.error('reading dictionary failed to load:', err));

  const generator = createGenerator({
    store,
    today: localDateStr,
    onChange: notifyChanged,
    checkServer: (opts) => ollama.checkServer({ fetch: globalThis.fetch, ...opts }),
    generate: async (opts) =>
      ollama.generate({ fetch: globalThis.fetch, reader: await readerPromise, ...opts }),
  });

  const api = createApi({ store, generator, today: localDateStr, notify: notifyChanged });

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

  // Nothing depends on a scheduled time: work out what is missing on launch
  // and on a timer. (Wake from sleep and midnight rollover come in Stage 7.)
  store.ensureEntries(localDateStr(), 0);
  const run = () => generator.run().catch((err) => console.error('generation run failed:', err));
  run();
  setInterval(run, RETRY_INTERVAL_MS);
}

app.whenReady().then(() => {
  startBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
