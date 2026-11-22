const { contextBridge } = require('electron');

// Methods are added here in later stages. Keep this surface small.
contextBridge.exposeInMainWorld('api', {});
