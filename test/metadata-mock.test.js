// Runs the TMDB/OMDb code against fake API responses (no network needed).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Store = require('../src/main/store');
const { runQueue } = require('../src/main/metadata');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cvmeta-'));
const store = new Store(dir);
store.setSettings({ tmdbKey: 'x'.repeat(32), omdbKey: 'k' });
store.data.items = {
  'm:a': { id: 'm:a', type: 'movie', title: 'Sample Film', year: 2010, files: ['/x/a.mkv'], episodes: {}, metaStatus: 'pending' },
  't:b': { id: 't:b', type: 'tv', title: 'Sample Show', year: null, files: [], episodes: { '1x1': { season: 1, episode: 1, path: '/x/s1e1.mkv' } }, metaStatus: 'pending' }
};
const calls = [];
global.fetch = async (url) => {
  calls.push(String(url));
  const u = new URL(url);
  const J = o => ({ ok: true, status: 200, json: async () => o });
  if (u.hostname === 'image.tmdb.org') return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
  if (u.hostname === 'www.omdbapi.com') return J({ Response: 'True', imdbRating: '8.8', imdbVotes: '2,000', Rated: 'PG-13', Ratings: [{ Source: 'Rotten Tomatoes', Value: '87%' }] });
  const p = u.pathname.replace('/3', '');
  if (p === '/search/movie') return J({ results: [{ id: 99, title: 'Other', release_date: '1999-01-01', popularity: 50 }, { id: 1, title: 'Sample Film', release_date: '2010-07-16', popularity: 10 }] });
  if (p === '/movie/1') return J({ id: 1, imdb_id: 'tt1', title: 'Sample Film', release_date: '2010-07-16', overview: 'o', genres: [{ name: 'Drama' }], runtime: 148, vote_average: 8.37, poster_path: '/p.jpg', backdrop_path: '/b.jpg', credits: { cast: [{ name: 'A', character: 'B', profile_path: '/c.jpg' }], crew: [{ job: 'Director', name: 'D', department: 'Directing' }] }, videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'yt', official: true }] }, release_dates: { results: [] } });
  if (p === '/search/tv') return J({ results: [{ id: 5, name: 'Sample Show', first_air_date: '2008-01-20' }] });
  if (p === '/tv/5') return J({ id: 5, name: 'Sample Show', first_air_date: '2008-01-20', number_of_seasons: 5, external_ids: { imdb_id: 'tt5' }, genres: [], aggregate_credits: { cast: [{ name: 'W', roles: [{ character: 'H' }] }] }, videos: { results: [] }, content_ratings: { results: [] } });
  if (p === '/tv/5/season/1') return J({ name: 'Season 1', episodes: [{ episode_number: 1, name: 'Pilot', still_path: '/s.jpg', vote_average: 8 }] });
  return { ok: false, status: 404, json: async () => ({}) };
};

(async () => {
  await runQueue(store, {});
  const m = store.data.items['m:a'], t = store.data.items['t:b'];
  assert.strictEqual(m.metaStatus, 'ok');
  assert.strictEqual(m.meta.tmdbId, 1, 'picked the result whose title+year match');
  assert.strictEqual(m.meta.imdbRating, '8.8');
  assert.strictEqual(m.meta.rottenTomatoes, '87%');
  assert.strictEqual(m.meta.tmdbRating, 8.4);
  assert.deepStrictEqual(m.meta.directors, ['D']);
  assert.ok(m.meta.poster && fs.existsSync(path.join(store.imagesDir, m.meta.poster)), 'poster cached on disk');
  assert.strictEqual(t.metaStatus, 'ok');
  assert.strictEqual(t.meta.seasons[1].episodes[1].title, 'Pilot');
  assert.strictEqual(t.meta.imdbId, 'tt5');
  assert.ok(calls.some(c => c.includes('api_key=')), 'v3 key sent as api_key');

  // Offline: fetch throws -> item stays pending, nothing lost
  store.data.items['m:c'] = { id: 'm:c', type: 'movie', title: 'Later', files: ['/x/c.mkv'], episodes: {}, metaStatus: 'pending' };
  global.fetch = async () => { throw new TypeError('fetch failed'); };
  let offline = false;
  await runQueue(store, { onError: e => { offline = e === 'offline'; } });
  assert.ok(offline);
  assert.strictEqual(store.data.items['m:c'].metaStatus, 'pending');
  assert.strictEqual(store.data.items['m:a'].meta.title, 'Sample Film', 'saved info survives offline');
  console.log('metadata mock: all passed');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
