// API keys baked in at build time by GitHub Actions (from repo Secrets).
// keys.json is generated in CI and never committed. Keys typed in Settings always win.
const fs = require('fs');
const path = require('path');

let keys = {};
try { keys = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys.json'), 'utf8')); } catch { /* dev build: none */ }

const MAP = { tmdbKey: 'TMDB_KEY', omdbKey: 'OMDB_KEY', fanartKey: 'FANART_KEY', subdlKey: 'SUBDL_KEY', opensubtitlesKey: 'OPENSUBTITLES_KEY' };
const builtIn = {};
for (const [field, name] of Object.entries(MAP)) {
  const v = (keys[name] || process.env['SHOWTROVE_' + name] || '').trim();
  if (v) builtIn[field] = v;
}
module.exports = builtIn;
