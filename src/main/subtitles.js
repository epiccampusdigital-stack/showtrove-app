// Subtitles: find local ones, convert to WebVTT for the built-in player,
// and auto-download from OpenSubtitles (saved next to the video so KMPlayer/VLC pick them up too).

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { isSubtitle, isVideo } = require('./parser');

const OS_API = 'https://api.opensubtitles.com/api/v1';
const UA = 'Showtrove v1.0.0';

const LANG_NAMES = {
  en: 'English', si: 'Sinhala', ta: 'Tamil', hi: 'Hindi', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
  'zh-cn': 'Chinese (Simplified)', 'zh-tw': 'Chinese (Traditional)', es: 'Spanish', fr: 'French',
  de: 'German', it: 'Italian', pt: 'Portuguese', 'pt-br': 'Portuguese (BR)', ru: 'Russian', ar: 'Arabic'
};
const KNOWN_LANG = new Set(Object.keys(LANG_NAMES).concat(['eng', 'sin', 'tam', 'hin', 'jpn', 'kor', 'chi']));
const LANG3 = { eng: 'en', sin: 'si', tam: 'ta', hin: 'hi', jpn: 'ja', kor: 'ko', chi: 'zh' };

// ---------- Local subtitles ----------
async function findLocalSubs(videoPath) {
  const dir = path.dirname(videoPath);
  const base = path.parse(videoPath).name.toLowerCase();
  const out = [];
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }

  const videosHere = entries.filter(e => e.isFile() && isVideo(e.name)).length;
  const candidates = [];
  for (const e of entries) {
    if (e.isFile() && isSubtitle(e.name)) candidates.push(path.join(dir, e.name));
    if (e.isDirectory() && /^(subs?|subtitles?)$/i.test(e.name)) {
      try {
        for (const s of await fsp.readdir(path.join(dir, e.name))) {
          if (isSubtitle(s)) candidates.push(path.join(dir, e.name, s));
        }
      } catch { /* ignore */ }
    }
  }
  for (const c of candidates) {
    const n = path.parse(c).name.toLowerCase();
    const matches = n.startsWith(base) || videosHere <= 1;
    if (!matches) continue;
    if (path.extname(c).toLowerCase() === '.sub') continue; // VobSub needs .idx, external players only
    const lang = guessLang(n.slice(base.length));
    out.push({ path: c, lang, label: (LANG_NAMES[lang] || (lang ? lang.toUpperCase() : 'Subtitle')) + ` · ${path.basename(c)}` });
  }
  return out;
}

function guessLang(suffix) {
  const bits = suffix.split(/[._\s-]+/).filter(Boolean).map(s => s.toLowerCase());
  for (const b of bits.reverse()) if (KNOWN_LANG.has(b)) return LANG3[b] || b;
  return '';
}

// ---------- Format conversion ----------
function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '');
  return new TextDecoder('windows-1252').decode(buf); // old western subs
}

function srtToVtt(srt) {
  const body = srt.replace(/\r\n?/g, '\n').replace(/^﻿/, '')
    .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, (_, a, b) => `${a.padStart(8, '0')}.${b.padEnd(3, '0')}`)
    .replace(/\{\\an?\d+\}/g, '')            // {\an8} positioning tags
    .replace(/<\/?font[^>]*>/gi, '');        // vtt doesn't do <font>
  return 'WEBVTT\n\n' + body.trim() + '\n';
}

function assToVtt(ass) {
  const lines = ass.replace(/\r\n?/g, '\n').split('\n');
  let fmt = null;
  const cues = [];
  const toTs = t => { const [h, m, s] = t.trim().split(':'); const [sec, cs = '0'] = s.split('.'); return `${h.padStart(2, '0')}:${m}:${sec.padStart(2, '0')}.${(cs + '00').slice(0, 3)}`; };
  for (const l of lines) {
    if (/^Format:/i.test(l) && !fmt) fmt = l.slice(7).split(',').map(s => s.trim().toLowerCase());
    if (/^Dialogue:/i.test(l) && fmt) {
      const parts = l.slice(9).split(',');
      const textIdx = fmt.indexOf('text');
      const text = parts.slice(textIdx).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').trim();
      const start = parts[fmt.indexOf('start')], end = parts[fmt.indexOf('end')];
      if (text && start && end) cues.push(`${toTs(start)} --> ${toTs(end)}\n${text}`);
    }
  }
  return 'WEBVTT\n\n' + cues.join('\n\n') + '\n';
}

async function loadAsVtt(subPath) {
  const text = decodeText(await fsp.readFile(subPath));
  const ext = path.extname(subPath).toLowerCase();
  if (ext === '.vtt') return text;
  if (ext === '.ass' || ext === '.ssa') return assToVtt(text);
  return srtToVtt(text);
}

// ---------- OpenSubtitles hash (64KB head + tail + size) ----------
async function osHash(file) {
  const CHUNK = 65536;
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    if (size < CHUNK * 2) return null;
    const head = Buffer.alloc(CHUNK), tail = Buffer.alloc(CHUNK);
    await fh.read(head, 0, CHUNK, 0);
    await fh.read(tail, 0, CHUNK, size - CHUNK);
    let h = BigInt(size);
    const mask = (1n << 64n) - 1n;
    for (const b of [head, tail]) for (let i = 0; i < CHUNK; i += 8) h = (h + b.readBigUInt64LE(i)) & mask;
    return h.toString(16).padStart(16, '0');
  } finally { await fh.close(); }
}

// ---------- OpenSubtitles API ----------
let osToken = null, osBase = OS_API, osTokenFor = '';

function osHeaders(settings, withAuth) {
  const h = { 'Api-Key': settings.opensubtitlesKey, 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' };
  if (withAuth && osToken) h.Authorization = `Bearer ${osToken}`;
  return h;
}

async function osLogin(settings) {
  if (!settings.opensubtitlesUser || !settings.opensubtitlesPass) return;
  const id = settings.opensubtitlesUser + '|' + settings.opensubtitlesKey;
  if (osToken && osTokenFor === id) return;
  const r = await fetch(`${OS_API}/login`, { method: 'POST', headers: osHeaders(settings), body: JSON.stringify({ username: settings.opensubtitlesUser, password: settings.opensubtitlesPass }) });
  if (!r.ok) throw new Error(`OpenSubtitles login failed (${r.status})`);
  const j = await r.json();
  osToken = j.token; osTokenFor = id;
  if (j.base_url) osBase = `https://${j.base_url.replace(/^https?:\/\//, '')}/api/v1`;
}

const imdbNum = id => id ? String(parseInt(String(id).replace(/^tt/, ''), 10)) : null;

async function osSearch(settings, { hash, imdbId, parentImdbId, season, episode, query, languages }) {
  const p = new URLSearchParams();
  if (hash) p.set('moviehash', hash);
  if (parentImdbId && season != null) {
    p.set('parent_imdb_id', imdbNum(parentImdbId)); p.set('season_number', season); p.set('episode_number', episode);
  } else if (imdbId) p.set('imdb_id', imdbNum(imdbId));
  else if (query) p.set('query', query);
  if (languages) p.set('languages', languages);
  // OpenSubtitles asks for alphabetically sorted params (better caching)
  const sorted = new URLSearchParams([...p.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const r = await fetch(`${OS_API}/subtitles?${sorted}`, { headers: osHeaders(settings) });
  if (!r.ok) throw new Error(`OpenSubtitles search failed (${r.status})`);
  const j = await r.json();
  return (j.data || []).map(d => ({
    fileId: d.attributes.files?.[0]?.file_id,
    fileName: d.attributes.files?.[0]?.file_name || d.attributes.release,
    release: d.attributes.release,
    lang: d.attributes.language,
    downloads: d.attributes.download_count || 0,
    hashMatch: !!d.attributes.moviehash_match,
    machine: !!(d.attributes.machine_translated || d.attributes.ai_translated),
    hearingImpaired: !!d.attributes.hearing_impaired
  })).filter(s => s.fileId);
}

async function osDownload(settings, fileId, videoPath, lang) {
  await osLogin(settings).catch(() => { /* fall back to anonymous */ });
  const r = await fetch(`${osBase}/download`, { method: 'POST', headers: osHeaders(settings, true), body: JSON.stringify({ file_id: fileId, sub_format: 'srt' }) });
  if (r.status === 406 || r.status === 429) throw new Error('OpenSubtitles daily download limit reached. Add your OpenSubtitles login in Settings for a higher limit.');
  if (!r.ok) throw new Error(`OpenSubtitles download failed (${r.status})`);
  const { link } = await r.json();
  const s = await fetch(link);
  if (!s.ok) throw new Error('Could not fetch subtitle file');
  const buf = Buffer.from(await s.arrayBuffer());

  // Save next to the video: "Movie.srt" (players auto-load this) or "Movie.<lang>.srt" if taken.
  const { dir, name } = path.parse(videoPath);
  let target = path.join(dir, `${name}.srt`);
  if (fs.existsSync(target)) target = path.join(dir, `${name}.${lang || 'sub'}.srt`);
  if (fs.existsSync(target)) target = path.join(dir, `${name}.${lang || 'sub'}.${Date.now()}.srt`);
  try {
    await fsp.writeFile(target, buf);
  } catch {
    // Read-only folder (e.g. a DVD): keep it in the app's own cache instead
    const { app } = require('electron');
    const alt = path.join(app.getPath('userData'), 'subtitles');
    await fsp.mkdir(alt, { recursive: true });
    target = path.join(alt, `${name}.${lang || 'sub'}.srt`);
    await fsp.writeFile(target, buf);
  }
  return target;
}

function pickBest(results, langOrder) {
  const rank = l => { const i = langOrder.indexOf((l || '').toLowerCase()); return i === -1 ? 99 : i; };
  return [...results].sort((a, b) =>
    rank(a.lang) - rank(b.lang) ||
    (b.hashMatch - a.hashMatch) ||
    (a.machine - b.machine) ||
    (a.hearingImpaired - b.hearingImpaired) ||
    (b.downloads - a.downloads))[0];
}

/**
 * Make sure a video has subtitles. Returns list of local subs (after downloading if needed).
 * ctx: { imdbId, parentImdbId, season, episode, title, year }
 */
async function ensureSubtitles(videoPath, ctx, settings, { force = false } = {}) {
  let local = await findLocalSubs(videoPath);
  if ((local.length && !force) || !settings.opensubtitlesKey) return { subs: local, downloaded: null };
  const langs = (settings.subtitleLanguages || 'en').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const languages = langs.join(',');
  const hash = await osHash(videoPath).catch(() => null);

  let results = [];
  if (hash) results = await osSearch(settings, { hash, languages }).catch(() => []);
  if (!results.length) results = await osSearch(settings, { ...ctx, languages }).catch(() => []);
  if (!results.length && ctx.title) results = await osSearch(settings, { query: ctx.title + (ctx.year ? ` ${ctx.year}` : ''), languages });
  if (!results.length) return { subs: local, downloaded: null };

  const best = pickBest(results, langs);
  const saved = await osDownload(settings, best.fileId, videoPath, best.lang);
  local = await findLocalSubs(videoPath);
  if (!local.find(s => s.path === saved)) local.push({ path: saved, lang: best.lang, label: (LANG_NAMES[best.lang] || best.lang) + ' · downloaded' });
  return { subs: local, downloaded: saved };
}

module.exports = { findLocalSubs, loadAsVtt, srtToVtt, assToVtt, osHash, osSearch, osDownload, ensureSubtitles, LANG_NAMES };
