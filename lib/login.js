// Launch at login. Only the packaged app registers itself: a dev run would
// register electron.exe instead. The login item passes --hidden so the app
// starts in the tray without opening a window.

function loginItemOptions({ isPackaged, launchAtLogin }) {
  if (!isPackaged) return null;
  return { openAtLogin: Boolean(launchAtLogin), args: ['--hidden'] };
}

function isHiddenLaunch(argv) {
  return argv.includes('--hidden');
}

module.exports = { loginItemOptions, isHiddenLaunch };
