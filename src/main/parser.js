// Turns messy file/folder names into clean titles.
// "The.Dark.Knight.2008.1080p.BluRay.x264-YIFY.mkv" -> { type:'movie', title:'The Dark Knight', year:2008 }
// "Breaking.Bad.S02E05.720p.mkv"                  -> { type:'tv', title:'Breaking Bad', season:2, episode:5 }

const path = require('path');

const VIDEO_EXT = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v', '.webm', '.flv', '.mpg', '.mpeg',
  '.ts', '.m2ts', '.vob', '.3gp', '.ogv', '.divx', '.rmvb'
]);
const SUB_EXT = new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub']);

// Words that mark the start of release junk. Everything after the first hit is dropped.
const JUNK = [
  '2160p', '1080p', '1080i', '720p', '576p', '480p', '360p', '4k', 'uhd', 'hdr', 'hdr10', 'dv', 'dolby',
  'bluray', 'blu-ray', 'bdrip', 'brrip', 'bdremux', 'remux', 'web-dl', 'webdl', 'webrip', 'web', 'hdrip',
  'dvdrip', 'dvdscr', 'dvd', 'hdtv', 'pdtv', 'hdcam', 'cam', 'ts', 'tc', 'r5', 'screener', 'scr',
  'x264', 'x265', 'h264', 'h265', 'h.264', 'h.265', 'hevc', 'avc', 'xvid', 'divx', '10bit', '8bit',
  'aac', 'aac2', 'ac3', 'dts', 'dts-hd', 'ddp5', 'dd5', 'ddp', 'truehd', 'atmos', 'flac', 'mp3', '5.1', '7.1', '2.0',
  'yify', 'yts', 'rarbg', 'eztv', 'ettv', 'psa', 'pahe', 'galaxyrg', 'tigole', 'qxr', 'sparks', 'ganool',
  'extended', 'unrated', 'directors', 'director\'s', 'remastered', 'proper', 'repack', 'limited', 'internal',
  'imax', 'multi', 'dual', 'dubbed', 'subbed', 'esub', 'esubs', 'hindi', 'tamil', 'telugu', 'sinhala', 'nf', 'amzn', 'dsnp', 'hmax', 'atvp',
  'malayalam', 'kannada', 'bengali', 'english', 'eng', 'org', 'audio', 'hq', 'hc', 'predvd', 'camrip', 'hdts', 'hdtc', 'webhd',
  'hdr10plus', 'dovi', 'sdr', 'uncut', 'theatrical', 'criterion', 'hybrid', 'vostfr', 'ita', 'french', 'spanish', 'korean', 'japanese',
  'mkvcage', 'mkvhub', 'psarips', 'tgx', 'ion10', 'cmrg', 'ntb', 'flux', 'kogi', 'evo', 'fgt', 'etrg', 'axxo', 'ytsmx', '1080', '720'
];
const JUNK_SET = new Set(JUNK);

function isVideo(file) { return VIDEO_EXT.has(path.extname(file).toLowerCase()); }
function isSubtitle(file) { return SUB_EXT.has(path.extname(file).toLowerCase()); }

// "www.TamilBlasters.xyz - Movie", "[www.site.com] Movie", "Site.com_Movie"
const SITE_PREFIX = /^\s*(?:\[[^\]]*\]\s*)?(?:www\.)?[a-z0-9-]+\.(?:com|org|net|mx|am|lt|ag|to|xyz|in|me|io|ws|cc|tv|li|se|nz|re|pw|si|ink|mov|ms|is|club|site|live|vip|world)\b\s*[-_\s]+/i;
function tidy(s) {
  return s
    .replace(SITE_PREFIX, '')
    .replace(/\[[^\]]*\]/g, ' ')          // [YTS.MX] etc.
    .replace(/[._]+/g, ' ')               // dots/underscores -> spaces
    .replace(/\s+-\s+/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(s) {
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return s; // already mixed case, keep
  const small = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'vs']);
  return s.toLowerCase().split(' ').map((w, i) =>
    (i > 0 && small.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function stripJunk(words) {
  const out = [];
  for (const w of words) {
    const lw = w.toLowerCase().replace(/[()]/g, '');
    if (JUNK_SET.has(lw) || /^(\d{3,4}p)$/i.test(lw)) break;
    out.push(w);
  }
  return out;
}

function cleanTitle(raw) {
  let t = tidy(raw)
    .replace(/\(\s*\)/g, ' ')              // empty ()
    .replace(/\(([^)]*)$/, '$1')            // unclosed "Inception ("
    .replace(/^([^(]*)\)/, '$1')            // stray ")"
    .replace(/\s+/g, ' ').trim();
  t = t.replace(/\s*-\s*$/, '').replace(/^\s*-\s*/, '');
  t = t.replace(/[\s-]+$/, '');
  return titleCase(t.trim());
}

// --- Movies -----------------------------------------------------------------
function parseMovieName(name) {
  const base = tidy(name);
  // Find all years; use the LAST one that isn't at the very start ("2001 A Space Odyssey 1968")
  const re = /(?:^|[\s(])((?:19|20)\d{2})(?=$|[\s)])/g;
  let m, hit = null;
  while ((m = re.exec(base)) !== null) {
    const idx = m.index + m[0].indexOf(m[1]);
    if (idx > 0) hit = { year: +m[1], idx };
  }
  if (hit) {
    const title = cleanTitle(base.slice(0, hit.idx));
    if (title) return { title, year: hit.year };
  }
  const words = stripJunk(base.split(' '));
  return { title: cleanTitle(words.join(' ')) || cleanTitle(base), year: null };
}

// --- TV ---------------------------------------------------------------------
const EP_PATTERNS = [
  /^(.*?)[\s._-]*S(\d{1,2})[\s._-]*E(\d{1,3})(?:[\s._-]*E?(\d{1,3}))?/i, // S01E02 / S01E02E03
  /^(.*?)(?:^|[\s._-]+)(\d{1,2})x(\d{2,3})\b/i,                             // 1x02
  /^(.*?)[\s._-]*Season[\s._-]*(\d{1,2})[\s._-]*Episode[\s._-]*(\d{1,3})/i // Season 1 Episode 2
];

function parseEpisode(fileName, parentDirs = []) {
  const name = path.parse(fileName).name;
  for (const re of EP_PATTERNS) {
    const m = name.match(re);
    if (m) {
      let show = cleanTitle(m[1] || '');
      const season = +m[2], episode = +m[3];
      if (!show) show = showFromDirs(parentDirs);
      // Pull a year out of the show name: "Doctor Who 2005"
      let year = null;
      const ym = show.match(/^(.*\S)\s+((?:19|20)\d{2})$/);
      if (ym) { show = ym[1]; year = +ym[2]; }
      return { type: 'tv', title: show, year, season, episode, episodeEnd: m[4] ? +m[4] : null };
    }
  }
  // "Show/Season 2/05 - Title.mkv" or "Show/Season 2/Episode 5.mkv"
  const seasonDir = parentDirs.find(d => /^(season|series|s)[\s._-]*\d{1,2}$/i.test(d.trim()));
  if (seasonDir) {
    const em = name.match(/^(?:e|ep|episode)?[\s._-]*(\d{1,3})\b/i);
    if (em) {
      const season = +seasonDir.match(/(\d{1,2})/)[1];
      return { type: 'tv', title: showFromDirs(parentDirs), year: null, season, episode: +em[1], episodeEnd: null };
    }
  }
  return null;
}

function showFromDirs(parentDirs) {
  // parentDirs is nearest-first: ["Season 1", "Breaking Bad", ...]
  for (const d of parentDirs) {
    if (/^(season|series|s)[\s._-]*\d{1,2}$/i.test(d.trim())) continue;
    const cleaned = d.replace(/[\s._-]*S\d{1,2}(?:[\s._-].*)?$/i, ''); // "Breaking.Bad.S01.1080p" -> "Breaking.Bad"
    const p = parseMovieName(cleaned);
    if (p.title) return p.title + (p.year ? ' ' + p.year : '');
  }
  return 'Unknown Show';
}

/**
 * Parse one video file.
 * @param {string} filePath absolute path to the video
 * @param {string} root the library folder it was found in
 */
function parseFile(filePath, root, { siblings = 1 } = {}) {
  const rel = path.relative(root, filePath);
  const parts = rel.split(path.sep);
  const fileName = parts.pop();
  const parentDirs = parts.reverse(); // nearest first

  const ep = parseEpisode(fileName, parentDirs);
  if (ep) return ep;

  // Movie: compare file name vs. its folder name, keep whichever looks better (has a year).
  const fromFile = parseMovieName(path.parse(fileName).name);
  // Only trust the folder name when it holds a single video ("Inception (2010)/movie.mkv").
  // A folder with several different movies must not rename them all after itself.
  const junkName = /^(movie|video|film|sample|main|feature)?[\s._-]*\d*$/i.test(fromFile.title || '');
  if (parentDirs.length && (siblings <= 1 || junkName)) {
    const fromDir = parseMovieName(parentDirs[0]);
    if (fromDir.year && !fromFile.year) return { type: 'movie', ...fromDir };
    if (fromDir.year && fromFile.year && fromDir.title.length >= 2 && /^(movie|video|film)?\s*\d*$/i.test(fromFile.title)) {
      return { type: 'movie', ...fromDir };
    }
  }
  return { type: 'movie', ...fromFile };
}

module.exports = { parseFile, parseMovieName, parseEpisode, isVideo, isSubtitle, VIDEO_EXT, SUB_EXT };
