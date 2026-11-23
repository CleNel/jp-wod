const { contextBridge, ipcRenderer } = require('electron');

// The renderer's whole view of the app. Keep this surface small: every method
// is validated again in lib/api.js because the renderer is untrusted.
contextBridge.exposeInMainWorld('api', {
  overview: () => ipcRenderer.invoke('overview'),
  day: (date) => ipcRenderer.invoke('day', date),
  setDone: (date, done) => ipcRenderer.invoke('set-done', date, done),
  regenerate: (date) => ipcRenderer.invoke('regenerate', date),
  status: () => ipcRenderer.invoke('status'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  // Calls back whenever data changed. Returns a function that unsubscribes.
  onChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('changed', listener);
    return () => ipcRenderer.removeListener('changed', listener);
  },
});
