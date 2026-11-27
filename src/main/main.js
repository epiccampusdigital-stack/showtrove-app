const { app, BrowserWindow, ipcMain, dialog, protocol, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

const Store = require('./store');
const { scanLibrary, watchFolders } = require('./scanner');
const { runQueue, searchTmdb } = require('./metadata');
const { detectPlayers, launch } = require('./players');
const subs = require('./subtitles');

// Lets the built-in player switch audio tracks (e.g. Japanese / English dub)
app.commandLine.appendSwitch('enable-experimental-web-platform-features');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');

protocol.registerSchemesAsPrivileged([{
  scheme: 'cv', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true }
}]);

let win, store, stopWatching = () => {};
const enc = p => Buffer.from(p, 'utf8').toString('base64url');
const dec = s => Buffer.from(s, 'base64url').toString('utf8');

const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/webm', '.mov': 'video/mp4', '.ogv': 'video/ogg', '.jpg': 'image/jpeg', '.png': 'image/png' };

// cv://img/<file>   cached poster/cast/backdrop images
// cv://media/<b64>  video streaming with seek (HTTP range) support
// cv://sub/<b64>    subtitle converted to WebVTT
function registerProtocol() {
  protocol.handle('cv', async (req) => {
    const u = new URL(req.url);
    const kind = u.hostname;
    const arg = decodeURIComponent(u.pathname.slice(1));
    try {
      if (kind === 'img') {
        const file = path.join(store.imagesDir, path.basename(arg));
        return new Response(fs.createReadStream(file), { headers: { 'Content-Type': MIME[path.extname(file)] || 'image/jpeg', 'Cache-Control': 'max-age=31536000', 'Access-Control-Allow-Origin': '*' } });
      }
      if (kind === 'sub') {
        return new Response(await subs.loadAsVtt(dec(arg)), { headers: { 'Content-Type': 'text/vtt; charset=utf-8' } });
      }
      if (kind === 'media') {
        const file = dec(arg);
        const { size } = await fs.promises.stat(file);
        const type = MIME[path.extname(file).toLowerCase()] || 'video/mp4';
        const range = req.headers.get('range');
        if (range) {
          const m = /bytes=(\d*)-(\d*)/.exec(range);
          const start = m[1] ? +m[1] : 0;
          const end = m[2] ? Math.min(+m[2], size - 1) : size - 1;
          return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
            status: 206,
            headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' }
          });
        }
        return new Response(Readable.toWeb(fs.createReadStream(file)), { headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
      }
    } catch (e) { return new Response(String(e.message), { status: 404 }); }
    return new Response('not found', { status: 404 });
  });
}

function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }
function stateForUi() {
  return {
    items: Object.values(store.data.items),
    folders: store.data.folders,
    progress: store.data.progress,
    settings: store.userSettings,
    builtIn: Object.keys(require('./builtin-keys')),
    scanReport: store.data.scanReport || null,
    players: detectPlayers(store.settings).map(({ id, name }) => ({ id, name })),
    online: net.isOnline()
  };
}

async function fetchMeta(opts = {}) {
  await runQueue(store, {
    ...opts,
    onProgress: p => send('meta-progress', p),
    onItem: it => send('item-updated', it),
    onError: msg => send('toast', msg === 'offline' ? 'Offline: showing saved info. Details will update when you\'re back online.' : msg)
  });
}

async function rescan() {
  send('scan-status', { scanning: true });
  const r = await scanLibrary(store);
  send('library', stateForUi());
  send('scan-status', { scanning: false, ...r });
  fetchMeta();
  return r;
}

function restartWatchers() {
  stopWatching();
  stopWatching = watchFolders(store, rescan);
}

// ---------- Play ----------
function resolveTarget(item, season, episode) {
  if (item.type === 'tv') {
    const ep = item.episodes[`${season}x${episode}`];
    if (!ep) throw new Error('Episode not found on disk');
    const sorted = Object.values(item.episodes).sort((a, b) => a.season - b.season || a.episode - b.episode);
    const idx = sorted.findIndex(e => e.season === season && e.episode === episode);
    const next = sorted[idx + 1];
    const title = item.meta?.seasons?.[season]?.episodes?.[episode]?.title;
    return {
      file: ep.path,
      label: `${item.meta?.title || item.title} · S${season}E${String(episode).padStart(2, '0')}${title ? ' · ' + title : ''}`,
      ctx: { parentImdbId: item.meta?.imdbId, season, episode, title: item.meta?.title || item.title },
      next: next ? { season: next.season, episode: next.episode } : null
    };
  }
  return {
    file: item.files[0],
    label: item.meta?.title || item.title,
    ctx: { imdbId: item.meta?.imdbId, title: item.meta?.title || item.title, year: item.meta?.year || item.year },
    next: null
  };
}

ipcMain.handle('play', async (_e, { id, season, episode, playerId, skipSubs }) => {
  const item = store.data.items[id];
  if (!item) throw new Error('Not in library');
  const t = resolveTarget(item, season, episode);
  if (!fs.existsSync(t.file)) throw new Error('File not found. Is the drive connected?');
  const settings = store.settings;

  let found = { subs: await subs.findLocalSubs(t.file), downloaded: null };
  if (settings.autoSubtitles && !skipSubs && !found.subs.length && settings.opensubtitlesKey && net.isOnline()) {
    send('toast', 'Looking for subtitles…');
    try { found = await subs.ensureSubtitles(t.file, t.ctx, settings); }
    catch (e) { send('toast', e.message); }
    if (found.downloaded) send('toast', 'Subtitles downloaded ✓');
  }

  const prog = store.data.progress[t.file];
  const start = prog && prog.pos > 30 && prog.pos < prog.dur * 0.95 ? prog.pos : 0;
  store.data.lastPlayed = { ...(store.data.lastPlayed || {}), [id]: { season, episode, at: Date.now() } };
  store.save();

  if (playerId === 'builtin') {
    return {
      mode: 'builtin', file: t.file, src: `cv://media/${enc(t.file)}`, title: t.label, start, next: t.next,
      subs: found.subs.map(s => ({ label: s.label, lang: s.lang, url: `cv://sub/${enc(s.path)}` }))
    };
  }
  await launch(playerId, t.file, { sub: found.subs[0]?.path, start }, settings);
  return { mode: 'external' };
});

ipcMain.handle('find-subtitles', async (_e, { id, season, episode }) => {
  const item = store.data.items[id];
  const t = resolveTarget(item, season, episode);
  const r = await subs.ensureSubtitles(t.file, t.ctx, store.settings, { force: true });
  return r.subs.map(s => ({ label: s.label, lang: s.lang, url: `cv://sub/${enc(s.path)}` }));
});

ipcMain.handle('add-subtitle-file', async (_e, { file }) => {
  const r = await dialog.showOpenDialog(win, { title: 'Load subtitle', defaultPath: path.dirname(file), filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] }], properties: ['openFile'] });
  if (r.canceled) return null;
  const p = r.filePaths[0];
  return { label: path.basename(p), lang: '', url: `cv://sub/${enc(p)}` };
});

ipcMain.handle('save-progress', (_e, { file, pos, dur }) => {
  if (!file || !dur) return;
  store.data.progress[file] = { pos, dur, at: Date.now() };
  store.save();
});

// ---------- Library ----------
ipcMain.handle('get-state', () => stateForUi());
ipcMain.handle('rescan', () => rescan());
ipcMain.handle('add-folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose a folder with movies or TV shows', properties: ['openDirectory', 'multiSelections'] });
  if (r.canceled) return stateForUi();
  for (const f of r.filePaths) if (!store.data.folders.includes(f)) store.data.folders.push(f);
  store.save();
  restartWatchers();
  await rescan();
  return stateForUi();
});
ipcMain.handle('remove-folder', async (_e, folder) => {
  store.data.folders = store.data.folders.filter(f => f !== folder);
  await rescan();
  restartWatchers();
  return stateForUi();
});
ipcMain.handle('save-settings', (_e, patch) => {
  const before = store.settings;
  store.setSettings(patch);
  if (patch.tmdbKey && patch.tmdbKey !== before.tmdbKey) {
    for (const it of Object.values(store.data.items)) if (it.metaStatus === 'error') it.metaStatus = 'pending';
    fetchMeta();
  }
  // New OMDb key: go back and add IMDb / Rotten Tomatoes scores to everything already in the library
  if (patch.omdbKey && patch.omdbKey !== before.omdbKey) {
    for (const it of Object.values(store.data.items)) if (it.metaStatus === 'ok' && !it.meta?.imdbRating) it.metaStatus = 'pending';
    fetchMeta();
  }
  // Different language for titles/plots: re-download details
  if (patch.metadataLanguage && patch.metadataLanguage !== before.metadataLanguage) {
    for (const it of Object.values(store.data.items)) if (it.metaStatus === 'ok') it.metaStatus = 'pending';
    fetchMeta();
  }
  // New fanart.tv key: fetch title logos for everything missing one
  if (patch.fanartKey && patch.fanartKey !== before.fanartKey) {
    for (const it of Object.values(store.data.items)) if (it.metaStatus === 'ok' && !it.meta?.logo) it.metaStatus = 'pending';
    fetchMeta();
  }
  return stateForUi();
});
ipcMain.handle('refresh-item', async (_e, id) => {
  const it = store.data.items[id];
  if (it) { it.metaStatus = 'pending'; if (it.meta?.seasons) for (const s of Object.values(it.meta.seasons)) s.checked = false; }
  await fetchMeta();
  return store.data.items[id];
});
ipcMain.handle('refresh-all', async () => {
  for (const it of Object.values(store.data.items)) it.metaStatus = 'pending';
  fetchMeta({ retryNotFound: true });
});
ipcMain.handle('search-tmdb', (_e, { query, type }) => searchTmdb(query, type, store.settings));
ipcMain.handle('fix-match', async (_e, { id, tmdbId, type }) => {
  const it = store.data.items[id];
  it.override = { tmdbId };
  if (type && type !== it.type) it.type = type;
  it.metaStatus = 'pending';
  await fetchMeta();
  return store.data.items[id];
});
ipcMain.handle('mark-watched', (_e, { file, watched }) => {
  if (watched) store.data.progress[file] = { pos: 1, dur: 1, at: Date.now(), watched: true };
  else delete store.data.progress[file];
  store.save();
  return store.data.progress;
});
ipcMain.handle('browse-exe', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose player .exe', filters: [{ name: 'Programs', extensions: ['exe'] }], properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('open-external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('show-in-folder', (_e, file) => shell.showItemInFolder(file));
ipcMain.handle('toggle-fullscreen', () => { win.setFullScreen(!win.isFullScreen()); return win.isFullScreen(); });
ipcMain.handle('set-fullscreen', (_e, v) => { win.setFullScreen(!!v); });

// ---------- App ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 880, minWidth: 960, minHeight: 600,
    backgroundColor: '#0b0b0f',
    title: 'Showtrove',
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32' ? { color: '#00000000', symbolColor: '#ffffff', height: 40 } : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('enter-full-screen', () => send('fullscreen', true));
  win.on('leave-full-screen', () => send('fullscreen', false));
}

app.whenReady().then(async () => {
  store = new Store(process.env.SHOWTROVE_DATA || app.getPath('userData'));
  registerProtocol();
  createWindow();
  restartWatchers();
  win.webContents.once('did-finish-load', () => rescan());
  if (process.env.CV_HOOK) require(process.env.CV_HOOK)(win, app); // test automation only
  setupUpdates();

  // Came back online? Fetch whatever was waiting.
  let wasOnline = net.isOnline();
  setInterval(() => {
    const now = net.isOnline();
    if (now !== wasOnline) { send('online', now); if (now) fetchMeta(); }
    wasOnline = now;
  }, 15000);
});

/* ---------- Auto-update from GitHub Releases ---------- */
function setupUpdates() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', i => send('update', { state: 'downloading', version: i.version }));
  autoUpdater.on('update-downloaded', i => send('update', { state: 'ready', version: i.version }));
  autoUpdater.on('error', e => console.log('update check failed:', e?.message));
  ipcMain.handle('install-update', () => autoUpdater.quitAndInstall(false, true));
  ipcMain.handle('check-updates', async () => {
    try { const r = await autoUpdater.checkForUpdates(); return r?.updateInfo?.version || null; } catch { return null; }
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 8000);
  setInterval(check, 4 * 60 * 60 * 1000);
}
ipcMain.handle('app-version', () => app.getVersion());

app.on('before-quit', () => { try { store.flush(); } catch { /* ignore */ } });
app.on('window-all-closed', () => app.quit());
