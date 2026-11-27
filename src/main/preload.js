const { contextBridge, ipcRenderer } = require('electron');

const on = (ch) => (fn) => { const h = (_e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  rescan: () => ipcRenderer.invoke('rescan'),
  addFolder: () => ipcRenderer.invoke('add-folder'),
  removeFolder: (f) => ipcRenderer.invoke('remove-folder', f),
  saveSettings: (p) => ipcRenderer.invoke('save-settings', p),
  refreshItem: (id) => ipcRenderer.invoke('refresh-item', id),
  refreshAll: () => ipcRenderer.invoke('refresh-all'),
  searchTmdb: (query, type) => ipcRenderer.invoke('search-tmdb', { query, type }),
  fixMatch: (id, tmdbId, type) => ipcRenderer.invoke('fix-match', { id, tmdbId, type }),
  play: (opts) => ipcRenderer.invoke('play', opts),
  findSubtitles: (opts) => ipcRenderer.invoke('find-subtitles', opts),
  addSubtitleFile: (file) => ipcRenderer.invoke('add-subtitle-file', { file }),
  saveProgress: (p) => ipcRenderer.invoke('save-progress', p),
  markWatched: (file, watched) => ipcRenderer.invoke('mark-watched', { file, watched }),
  browseExe: () => ipcRenderer.invoke('browse-exe'),
  openExternal: (u) => ipcRenderer.invoke('open-external', u),
  showInFolder: (f) => ipcRenderer.invoke('show-in-folder', f),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  setFullscreen: (v) => ipcRenderer.invoke('set-fullscreen', v),
  onLibrary: on('library'),
  onItem: on('item-updated'),
  onMetaProgress: on('meta-progress'),
  onScanStatus: on('scan-status'),
  onToast: on('toast'),
  onOnline: on('online'),
  onFullscreen: on('fullscreen'),
  onUpdate: on('update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  appVersion: () => ipcRenderer.invoke('app-version'),
  platform: process.platform
});
