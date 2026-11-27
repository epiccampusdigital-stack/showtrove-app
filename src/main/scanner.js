// Walks your library folders and groups video files into movies and TV shows.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { parseFile, isVideo } = require('./parser');

const SKIP_DIRS = /^(\$recycle\.bin|system volume information|\.|extras?$|featurettes?$|behind the scenes$|deleted scenes$|trailers?$|samples?$)/i;

// Files that look like movies but can't be played or listed, with a plain reason
const NOT_PLAYABLE = [
  [/\.(part|crdownload|!qb|!ut|bc!|tmp|download)$/i, 'Still downloading (unfinished file)'],
  [/\.(iso|img|bin|cue|nrg|mdf)$/i, 'Disc image. Mount it or rip it to MKV/MP4 first'],
  [/\.(rar|zip|7z|r\d\d)$/i, 'Inside a compressed archive. Extract it first'],
  [/\.(vob|ifo|bup)$/i, 'DVD folder files. Rip the DVD to MKV/MP4 first'],
  [/\.(rmvb|rm|divx|xvid)$/i, 'Old video format Showtrove doesn\'t read']
];
const SKIP_REASON = name =>
  /^\$recycle\.bin|^system volume information/i.test(name) ? null
  : /^\./.test(name) ? null
  : /^samples?$/i.test(name) ? 'Sample clips folder'
  : /^trailers?$/i.test(name) ? 'Trailers folder'
  : 'Bonus features folder (extras, featurettes, deleted scenes)';

// Fast walk: subfolders are read in parallel and no per-file disk lookups are needed.
async function walk(dir, out = [], skipped = []) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch (e) { skipped.push({ path: dir, reason: e.code === 'EPERM' || e.code === 'EACCES' ? 'Folder is locked (no permission to read it)' : 'Folder could not be read' }); return out; }
  const subdirs = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.test(e.name)) subdirs.push(full);
      else { const r = SKIP_REASON(e.name); if (r) skipped.push({ path: full, reason: r }); }
    } else if (e.isFile() || e.isSymbolicLink()) {
      if (isVideo(e.name)) {
        if (/(^|[\s._-])sample([\s._-]|$)/i.test(path.parse(e.name).name)) { skipped.push({ path: full, reason: 'Sample clip' }); continue; }
        out.push({ path: full });
      } else {
        const hit = NOT_PLAYABLE.find(([re]) => re.test(e.name));
        if (hit) skipped.push({ path: full, reason: hit[1] });
      }
    }
  }
  // 8 folders at a time keeps network drives / USB disks happy
  for (let i = 0; i < subdirs.length; i += 8) await Promise.all(subdirs.slice(i, i + 8).map(d => walk(d, out, skipped)));
  return out;
}

const keyOf = p => (p.type === 'tv' ? 't:' : 'm:') + p.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + (p.year ? '|' + p.year : '');

/**
 * Scan all folders and merge results into store.data.items.
 * Keeps already-fetched metadata. Returns { added, removed }.
 */
async function scanLibrary(store) {
  const items = store.data.items;
  const seen = new Set();
  const liveRoots = [];
  let added = 0;
  const skipped = [], offline = [];

  for (const root of store.data.folders) {
    if (!fs.existsSync(root)) { offline.push(root); continue; } // drive unplugged: keep its items, don't delete
    liveRoots.push(root);
    const files = await walk(root, [], skipped);
    for (const f of files) {
      const p = parseFile(f.path, root);
      const id = keyOf(p);
      seen.add(id);
      let it = items[id];
      if (!it) {
        it = items[id] = {
          id, type: p.type, title: p.title, year: p.year || null, root,
          addedAt: Date.now(), files: [], episodes: {}, meta: null, metaStatus: 'pending'
        };
        added++;
      }
      it.root = root;
      if (p.type === 'movie') {
        if (!it.files.includes(f.path)) it.files.push(f.path);
        it.files = it.files.filter(x => fs.existsSync(x)).sort();
      } else {
        const ek = `${p.season}x${p.episode}`;
        const prev = it.episodes[ek] || {};
        it.episodes[ek] = { ...prev, season: p.season, episode: p.episode, episodeEnd: p.episodeEnd, path: f.path, addedAt: prev.addedAt || Date.now() };
        it.latestAt = Math.max(it.latestAt || 0, it.episodes[ek].addedAt);
      }
    }
  }

  // Drop entries whose files are gone (only for drives that are currently connected)
  let removed = 0;
  for (const [id, it] of Object.entries(items)) {
    const rootLive = liveRoots.includes(it.root);
    const rootKnown = store.data.folders.includes(it.root);
    if (!rootKnown) { delete items[id]; removed++; continue; }
    if (!rootLive) continue;
    if (it.type === 'tv') {
      for (const [k, ep] of Object.entries(it.episodes)) if (!fs.existsSync(ep.path)) delete it.episodes[k];
      if (!Object.keys(it.episodes).length) { delete items[id]; removed++; }
    } else {
      it.files = it.files.filter(x => fs.existsSync(x));
      if (!it.files.length && !seen.has(id)) { delete items[id]; removed++; }
    }
  }
  // Report for Settings → Library: what's showing, what isn't and why
  const all = Object.values(items);
  store.data.scanReport = {
    at: Date.now(),
    folders: store.data.folders.map(root => {
      const mine = all.filter(i => i.root === root);
      return { root, online: !offline.includes(root), movies: mine.filter(i => i.type === 'movie').length,
        shows: mine.filter(i => i.type === 'tv').length,
        episodes: mine.filter(i => i.type === 'tv').reduce((n, i) => n + Object.keys(i.episodes).length, 0) };
    }),
    skippedCount: skipped.length,
    skipped: skipped.slice(0, 400)
  };
  store.save();
  return { added, removed };
}

/** Watch folders so new downloads show up on their own. */
function watchFolders(store, onChange) {
  const watchers = [];
  let t = null;
  const kick = () => { clearTimeout(t); t = setTimeout(onChange, 4000); }; // wait for copies to settle
  for (const root of store.data.folders) {
    try {
      const w = fs.watch(root, { recursive: true }, (ev, name) => {
        if (!name) return kick();
        if (isVideo(name) || !path.extname(name)) kick();
      });
      w.on('error', () => {});
      watchers.push(w);
    } catch { /* recursive watch unsupported here; manual rescan still works */ }
  }
  return () => watchers.forEach(w => w.close());
}

module.exports = { scanLibrary, watchFolders, walk };
