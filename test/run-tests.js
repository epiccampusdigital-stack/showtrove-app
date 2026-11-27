// Plain-node tests: `npm test`
const assert = require('assert');
const path = require('path');
const { parseFile } = require('../src/main/parser');
const { srtToVtt } = require('../src/main/subtitles');

const root = path.join(path.sep, 'lib');
const P = (...p) => path.join(root, ...p);
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); } }
function eq(file, exp) {
  t(file, () => {
    const got = parseFile(P(...file.split('/')), root);
    for (const k of Object.keys(exp)) assert.deepStrictEqual(got[k], exp[k], `${file} -> ${k}: got ${JSON.stringify(got[k])}`);
  });
}

// Movies
eq('The.Dark.Knight.2008.1080p.BluRay.x264-YIFY.mkv', { type: 'movie', title: 'The Dark Knight', year: 2008 });
eq('Inception (2010) [1080p] [YTS.MX]/Inception.2010.1080p.BluRay.x264.mp4', { type: 'movie', title: 'Inception', year: 2010 });
eq('2001.A.Space.Odyssey.1968.REMASTERED.1080p.mkv', { type: 'movie', title: '2001 A Space Odyssey', year: 1968 });
eq('Blade Runner 2049 (2017)/movie.mkv', { type: 'movie', title: 'Blade Runner 2049', year: 2017 });
eq('Parasite (2019)/Parasite.mkv', { type: 'movie', title: 'Parasite', year: 2019 });
eq('interstellar.mp4', { type: 'movie', title: 'Interstellar', year: null });
eq('Spirited_Away_720p_x264.avi', { type: 'movie', title: 'Spirited Away', year: null });
eq('[YTS.AM] Joker (2019) [WEBRip].mp4', { type: 'movie', title: 'Joker', year: 2019 });
// TV
eq('Breaking.Bad.S02E05.720p.HDTV.mkv', { type: 'tv', title: 'Breaking Bad', season: 2, episode: 5 });
eq('Breaking Bad/Season 1/Breaking Bad - S01E01 - Pilot.mkv', { type: 'tv', title: 'Breaking Bad', season: 1, episode: 1 });
eq('The Office (US)/Season 3/03x07 - Branch Wars.mkv', { type: 'tv', title: 'The Office (US)', season: 3, episode: 7 });
eq('Dark.S01.1080p.NF/Dark.S01E03.1080p.mkv', { type: 'tv', title: 'Dark', season: 1, episode: 3 });
eq('Friends/Season 2/05.mkv', { type: 'tv', title: 'Friends', season: 2, episode: 5 });
eq('Show.Name.1x02.mkv', { type: 'tv', title: 'Show Name', season: 1, episode: 2 });
eq('Doctor.Who.2005.S01E01.mkv', { type: 'tv', title: 'Doctor Who', year: 2005, season: 1, episode: 1 });

// Subtitles
t('srt->vtt', () => {
  const v = srtToVtt('1\r\n00:00:01,500 --> 00:00:03,000\r\nHello\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,250\r\n<i>World</i>\r\n');
  assert.ok(v.startsWith('WEBVTT'));
  assert.ok(v.includes('00:00:01.500 --> 00:00:03.000'));
  assert.ok(v.includes('<i>World</i>'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
