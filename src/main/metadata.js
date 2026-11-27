// Pulls posters, plot, cast, ratings from TMDB (+ IMDb / Rotten Tomatoes via OMDb)
// and caches the images on disk so everything shows offline.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const TMDB = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';

class OfflineError extends Error {}

async function http(url, opts = {}) {
  let r;
  try { r = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw new OfflineError(e.message); }
  return r;
}

function tmdbUrl(p, params, settings) {
  const key = (settings.tmdbKey || '').trim();
  const q = new URLSearchParams({ language: settings.metadataLanguage || 'en-US', ...params });
  const headers = { Accept: 'application/json' };
  if (key.length > 40) headers.Authorization = `Bearer ${key}`; // v4 "Read Access Token"
  else q.set('api_key', key);                                    // v3 "API Key"
  return { url: `${TMDB}${p}?${q}`, headers };
}

async function tmdb(p, params, settings) {
  if (!settings.tmdbKey) throw new Error('NO_TMDB_KEY');
  const { url, headers } = tmdbUrl(p, params, settings);
  const r = await http(url, { headers });
  if (r.status === 401) throw new Error('TMDB key is not valid. Check it in Settings.');
  if (r.status === 429) { await new Promise(res => setTimeout(res, 1500)); return tmdb(p, params, settings); }
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  return r.json();
}

async function cacheImage(store, tmdbPath, size) {
  if (!tmdbPath) return null;
  const url = IMG + size + tmdbPath;
  const name = crypto.createHash('sha1').update(url).digest('hex').slice(0, 20) + path.extname(tmdbPath);
  const file = path.join(store.imagesDir, name);
  if (fs.existsSync(file)) return name;
  try {
    const r = await http(url);
    if (!r.ok) return null;
    await fsp.writeFile(file, Buffer.from(await r.arrayBuffer()));
    return name;
  } catch { return null; }
}

// Same as cacheImage but for any https image URL (fanart.tv logos)
async function cacheUrl(store, url) {
  if (!url) return null;
  const name = crypto.createHash('sha1').update(url).digest('hex').slice(0, 20) + (path.extname(new URL(url).pathname) || '.png');
  const file = path.join(store.imagesDir, name);
  if (fs.existsSync(file)) return name;
  try {
    const r = await http(url);
    if (!r.ok) return null;
    await fsp.writeFile(file, Buffer.from(await r.arrayBuffer()));
    return name;
  } catch { return null; }
}

// Title logo: fanart.tv (if key) first, then TMDB's own logos. English, then language-neutral.
const pickLang = (list, langOf) => {
  const want = ['en', '00', '', null, undefined];
  for (const l of want) { const hit = list.find(x => langOf(x) === l); if (hit) return hit; }
  return list[0];
};
async function fanartLogo(kind, id, settings) {
  const key = (settings.fanartKey || '').trim();
  if (!key || !id) return null;
  try {
    const r = await http(`https://webservice.fanart.tv/v3/${kind}/${id}?api_key=${encodeURIComponent(key)}`);
    if (!r.ok) return null;
    const j = await r.json();
    const list = kind === 'movies' ? [...(j.hdmovielogo || []), ...(j.movielogo || [])] : [...(j.hdtvlogo || []), ...(j.clearlogo || [])];
    if (!list.length) return null;
    const sorted = [...list].sort((a, b) => (+b.likes || 0) - (+a.likes || 0));
    return pickLang(sorted, x => x.lang)?.url || null;
  } catch (e) { if (e instanceof OfflineError) throw e; return null; }
}
async function titleLogo(store, kind, fanartId, images, settings) {
  const fan = await fanartLogo(kind, fanartId, settings);
  if (fan) { const n = await cacheUrl(store, fan); if (n) return n; }
  const logos = (images?.logos || []).filter(l => !/\.svg$/i.test(l.file_path));
  if (!logos.length) return null;
  const best = pickLang([...logos].sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0)), x => x.iso_639_1);
  return cacheImage(store, best.file_path, 'w500');
}
const recIds = d => [...new Set([...(d.recommendations?.results || []), ...(d.similar?.results || [])].map(r => r.id))].slice(0, 60);

async function omdb(imdbId, settings) {
  if (!settings.omdbKey || !imdbId) return {};
  try {
    const r = await http(`https://www.omdbapi.com/?apikey=${encodeURIComponent(settings.omdbKey)}&i=${imdbId}&tomatoes=true`);
    const j = await r.json();
    if (j.Response === 'False') return {};
    const rt = (j.Ratings || []).find(x => x.Source === 'Rotten Tomatoes');
    const mc = (j.Ratings || []).find(x => x.Source === 'Metacritic');
    return {
      imdbRating: j.imdbRating && j.imdbRating !== 'N/A' ? j.imdbRating : null,
      imdbVotes: j.imdbVotes && j.imdbVotes !== 'N/A' ? j.imdbVotes : null,
      rottenTomatoes: rt ? rt.Value : null,
      metacritic: mc ? mc.Value : null,
      rated: j.Rated && j.Rated !== 'N/A' ? j.Rated : null,
      awards: j.Awards && j.Awards !== 'N/A' ? j.Awards : null
    };
  } catch (e) { if (e instanceof OfflineError) throw e; return {}; }
}

async function castList(store, credits) {
  const top = (credits?.cast || []).slice(0, 12);
  return Promise.all(top.map(async c => ({
    name: c.name, character: c.character || '', photo: await cacheImage(store, c.profile_path, 'w185')
  })));
}

function trailer(videos) {
  const v = (videos?.results || []).filter(x => x.site === 'YouTube');
  const best = v.find(x => x.type === 'Trailer' && x.official) || v.find(x => x.type === 'Trailer') || v[0];
  return best ? best.key : null;
}

function pickResult(results, title, year, dateField) {
  if (!results?.length) return null;
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const t = norm(title);
  const scored = results.slice(0, 10).map((r, i) => {
    const y = +(r[dateField] || '').slice(0, 4);
    let s = -i * 2 + Math.min(r.popularity || 0, 50) / 10;
    if (norm(r.title || r.name) === t || norm(r.original_title || r.original_name) === t) s += 20;
    if (year && y === year) s += 25; else if (year && Math.abs(y - year) === 1) s += 10;
    return { r, s };
  });
  return scored.sort((a, b) => b.s - a.s)[0].r;
}

// Non-English language picked but TMDB has no translated plot: use the English one
async function englishFallback(d, p, settings) {
  const lang = settings.metadataLanguage || 'en-US';
  if (lang.startsWith('en') || d.overview) return;
  try {
    const e = await tmdb(p, {}, { ...settings, metadataLanguage: 'en-US' });
    d.overview = e.overview; d.tagline = d.tagline || e.tagline;
  } catch (err) { if (err instanceof OfflineError) throw err; }
}

// Different ways to write a title, tried in order until TMDB finds it
function titleVariants(title) {
  const out = [];
  const add = t => { t = (t || '').replace(/\s+/g, ' ').trim(); if (t.length >= 1 && !out.includes(t)) out.push(t); };
  add(title);
  add(title.replace(/\b(extended|unrated|uncut|remastered|theatrical|imax|criterion|director'?s cut|final cut|special edition|anniversary edition|collector'?s edition)\b.*$/i, ''));
  add(title.replace(/&/g, 'and'));
  add(title.replace(/\band\b/gi, '&'));
  add(title.replace(/['’]/g, ''));
  add(title.replace(/\s*\(.*?\)\s*/g, ' '));
  if (/ - /.test(title)) { add(title.split(' - ')[0]); add(title.split(' - ').slice(1).join(' ')); }
  add(title.replace(/^(the|a|an) /i, ''));
  add(title.replace(/\b(part|pt|chapter|vol(ume)?)\s*(\d+|[ivx]+)\b.*$/i, ''));
  add(title.replace(/\s\d+$/, ''));               // "Movie 2" -> "Movie" (sequel numbering in odd places)
  add(title.replace(/([a-z])([A-Z])/g, '$1 $2'));   // "TheDarkKnight"
  return out.slice(0, 7);
}

async function findId(kind, item, settings) {
  const path = kind === 'tv' ? '/search/tv' : '/search/movie';
  const yearKey = kind === 'tv' ? 'first_air_date_year' : 'year';
  const dateField = kind === 'tv' ? 'first_air_date' : 'release_date';
  for (const q of titleVariants(item.title)) {
    if (item.year) {
      const r = await tmdb(path, { query: q, [yearKey]: item.year }, settings);
      const hit = pickResult(r.results, q, item.year, dateField);
      if (hit) return { id: hit.id, kind };
    }
    const r = await tmdb(path, { query: q }, settings);
    const hit = pickResult(r.results, q, item.year, dateField);
    if (hit && (!item.year || Math.abs(+(hit[dateField] || '').slice(0, 4) - item.year) <= 2 || r.results.length === 1)) return { id: hit.id, kind };
  }
  // Last try: search everything (catches a show filed as a movie and the other way round)
  const r = await tmdb('/search/multi', { query: titleVariants(item.title)[0] }, settings);
  const m = (r.results || []).find(x => x.media_type === kind) || (r.results || []).find(x => x.media_type === 'movie' || x.media_type === 'tv');
  return m ? { id: m.id, kind: m.media_type } : null;
}

// ---------- Movies ----------
async function fetchMovie(store, item, settings) {
  let id = item.override?.tmdbId;
  if (!id) {
    const f = await findId('movie', item, settings);
    if (!f) return null;
    if (f.kind === 'tv') return null; // a movie file that only matches a show: leave it for Fix match
    id = f.id;
  }
  const d = await tmdb(`/movie/${id}`, { append_to_response: 'credits,videos,release_dates,images,recommendations,similar', include_image_language: 'en,null' }, settings);
  await englishFallback(d, `/movie/${id}`, settings);
  const usCert = (d.release_dates?.results || []).find(r => r.iso_3166_1 === 'US')?.release_dates?.find(x => x.certification)?.certification;
  const [poster, backdrop, cast, extra, logo] = await Promise.all([
    cacheImage(store, d.poster_path, 'w500'),
    cacheImage(store, d.backdrop_path, 'w1280'),
    castList(store, d.credits),
    omdb(d.imdb_id, settings),
    titleLogo(store, 'movies', d.id, d.images, settings)
  ]);
  return {
    tmdbId: d.id, imdbId: d.imdb_id || null, title: d.title, originalTitle: d.original_title,
    year: d.release_date ? +d.release_date.slice(0, 4) : item.year, releaseDate: d.release_date,
    overview: d.overview, tagline: d.tagline, genres: (d.genres || []).map(g => g.name),
    runtime: d.runtime, certification: extra.rated || usCert || null,
    tmdbRating: d.vote_average ? +d.vote_average.toFixed(1) : null, tmdbVotes: d.vote_count,
    ...extra, poster, backdrop, cast,
    directors: (d.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name),
    writers: [...new Set((d.credits?.crew || []).filter(c => c.department === 'Writing').map(c => c.name))].slice(0, 3),
    trailerKey: trailer(d.videos), languages: (d.spoken_languages || []).map(l => l.english_name),
    collection: d.belongs_to_collection?.name || null, collectionId: d.belongs_to_collection?.id || null,
    logo, recIds: recIds(d), adult: !!d.adult, schema: 2, fetchedAt: Date.now()
  };
}

// ---------- TV ----------
async function fetchTv(store, item, settings) {
  let id = item.override?.tmdbId;
  if (!id) {
    const f = await findId('tv', item, settings);
    if (!f || f.kind !== 'tv') return null;
    id = f.id;
  }
  const d = await tmdb(`/tv/${id}`, { append_to_response: 'credits,aggregate_credits,external_ids,videos,content_ratings,images,recommendations,similar', include_image_language: 'en,null' }, settings);
  await englishFallback(d, `/tv/${id}`, settings);
  const imdbId = d.external_ids?.imdb_id || null;
  const cert = (d.content_ratings?.results || []).find(r => r.iso_3166_1 === 'US')?.rating;
  const [poster, backdrop, cast, extra, logo] = await Promise.all([
    cacheImage(store, d.poster_path, 'w500'),
    cacheImage(store, d.backdrop_path, 'w1280'),
    castList(store, d.aggregate_credits?.cast?.length ? { cast: d.aggregate_credits.cast.map(c => ({ ...c, character: c.roles?.[0]?.character })) } : d.credits),
    omdb(imdbId, settings),
    titleLogo(store, 'tv', d.external_ids?.tvdb_id, d.images, settings)
  ]);

  // Seasons you actually have on disk
  const haveSeasons = [...new Set(Object.values(item.episodes).map(e => e.season))].sort((a, b) => a - b);
  const seasons = {};
  for (const sn of haveSeasons) {
    try {
      const s = await tmdb(`/tv/${id}/season/${sn}`, {}, settings);
      const eps = {};
      for (const e of s.episodes || []) {
        const have = item.episodes[`${sn}x${e.episode_number}`];
        eps[e.episode_number] = {
          title: e.name, overview: e.overview, airDate: e.air_date, runtime: e.runtime,
          rating: e.vote_average ? +e.vote_average.toFixed(1) : null,
          still: have ? await cacheImage(store, e.still_path, 'w300') : null
        };
      }
      seasons[sn] = { name: s.name, overview: s.overview, poster: await cacheImage(store, s.poster_path, 'w342'), episodes: eps };
    } catch (e) { if (e instanceof OfflineError) throw e; }
  }
  return {
    tmdbId: d.id, imdbId, title: d.name, originalTitle: d.original_name,
    year: d.first_air_date ? +d.first_air_date.slice(0, 4) : item.year, releaseDate: d.first_air_date,
    overview: d.overview, tagline: d.tagline, genres: (d.genres || []).map(g => g.name),
    runtime: d.episode_run_time?.[0] || null, certification: extra.rated || cert || null,
    tmdbRating: d.vote_average ? +d.vote_average.toFixed(1) : null, tmdbVotes: d.vote_count,
    ...extra, poster, backdrop, cast,
    creators: (d.created_by || []).map(c => c.name), networks: (d.networks || []).map(n => n.name),
    status: d.status, numberOfSeasons: d.number_of_seasons, numberOfEpisodes: d.number_of_episodes,
    trailerKey: trailer(d.videos), seasons, logo, recIds: recIds(d), schema: 2, fetchedAt: Date.now()
  };
}

async function fetchItem(store, item, settings) {
  return item.type === 'tv' ? fetchTv(store, item, settings) : fetchMovie(store, item, settings);
}

/** For "Fix match": search TMDB and return choices. */
async function searchTmdb(query, type, settings) {
  const ym = query.match(/^(.*?)\s*\(?((?:19|20)\d{2})\)?\s*$/);
  const q = ym ? ym[1] : query;
  const params = { query: q };
  if (ym) params[type === 'tv' ? 'first_air_date_year' : 'year'] = ym[2];
  const res = await tmdb(type === 'tv' ? '/search/tv' : '/search/movie', params, settings);
  return (res.results || []).slice(0, 12).map(r => ({
    tmdbId: r.id, title: r.title || r.name, year: (r.release_date || r.first_air_date || '').slice(0, 4),
    overview: r.overview, poster: r.poster_path ? IMG + 'w185' + r.poster_path : null
  }));
}

/**
 * Background queue: fetch metadata for everything that needs it.
 * onProgress({done,total,current}) and onItem(item) let the UI update live.
 */
let running = false;
async function runQueue(store, { onProgress, onItem, onError, retryNotFound = false } = {}) {
  if (running) return;
  const settings = store.settings;
  if (!settings.tmdbKey) return;
  running = true;
  try {
    // Episodes added later to a show that's already fetched also trigger a refresh
    for (const it of Object.values(store.data.items)) {
      if (it.type === 'tv' && it.meta && it.metaStatus === 'ok') {
        const missing = Object.values(it.episodes).some(e => !it.meta.seasons?.[e.season]?.episodes?.[e.episode]?.title && !it.meta.seasons?.[e.season]?.checked);
        if (missing) it.metaStatus = 'pending';
      }
    }
    for (const it of Object.values(store.data.items)) if (it.metaStatus === 'ok' && it.meta && (it.meta.schema || 1) < 2) it.metaStatus = 'pending';
    if ((store.data.matcher || 0) < 2) {
      for (const it of Object.values(store.data.items)) if (it.metaStatus === 'notfound' || it.metaStatus === 'error') it.metaStatus = 'pending';
      store.data.matcher = 2;
    }
    // Adult files are never sent to TMDB (they'd only match the wrong movie anyway)
    for (const it of Object.values(store.data.items)) if (it.autoAdult && it.hidden !== false && it.metaStatus === 'pending') it.metaStatus = 'skipped';
    const todo = Object.values(store.data.items).filter(i =>
      i.metaStatus === 'pending' || i.metaStatus === 'error' || (retryNotFound && i.metaStatus === 'notfound'));
    let done = 0;
    const total = todo.length;
    const worker = async () => {
      while (todo.length) {
        const it = todo.shift();
        onProgress?.({ done, total, current: it.title });
        try {
          const meta = await fetchItem(store, it, settings);
          if (meta) {
            if (meta.seasons) for (const s of Object.values(meta.seasons)) s.checked = true;
            it.meta = meta; it.metaStatus = 'ok';
          } else it.metaStatus = 'notfound';
        } catch (e) {
          if (e instanceof OfflineError) { it.metaStatus = 'pending'; todo.length = 0; onError?.('offline'); break; }
          it.metaStatus = 'error'; it.metaError = e.message;
          if (/key/i.test(e.message)) { todo.length = 0; onError?.(e.message); break; }
        }
        done++;
        store.save();
        onItem?.(it);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    onProgress?.({ done: total, total, current: null });
  } finally { running = false; store.save(); }
}

module.exports = { runQueue, fetchItem, searchTmdb, OfflineError };
