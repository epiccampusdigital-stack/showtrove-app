/* Showtrove renderer: views, scroll effects, detail pages, settings. */
/* global $, $$, esc, icon, img, html, fmtTime, fmtRuntime, hueOf, ambientFrom, posterInner, ratingValue, ratingsHtml, metaLine, toast, reduceMotion, Player */

// `api` is the global exposed by preload.js
const S = {
  items: [], progress: {}, settings: {}, players: [], folders: [], online: true,
  view: 'home', lastView: 'home', query: '',
  lib: { movies: { genre: 'All', sort: 'added', year: 'all', hidden: false, flag: 'off' }, tv: { genre: 'All', sort: 'added', year: 'all', flag: 'off' } },
  hiddenUnlocked: false,
  metaBusy: false, detailId: null, firstPaint: true
};
const VIEWS = ['home', 'movies', 'tv'];
const byId = id => (S.allItems || S.items).find(i => i.id === id);
const isHidden = i => i.hidden === true || (i.hidden !== false && S.settings?.autoHideAdult !== false && (i.autoAdult || i.meta?.adult));
const hasArt = i => !!(i.meta?.poster || i.meta?.backdrop);
const artFirst = list => [...list.filter(hasArt), ...list.filter(i => !hasArt(i))];
const FLAGS = { high: 'High', medium: 'Medium', low: 'Low' };
const FLAG_RANK = { high: 0, medium: 1, low: 2 };
const byFlag = (a, b) => FLAG_RANK[a.flag.level] - FLAG_RANK[b.flag.level] || b.flag.at - a.flag.at;
const flagged = (list = S.items) => list.filter(i => i.flag?.level).sort(byFlag);
const NEW_DAYS = 14;
const isNew = i => Date.now() - addedAt(i) < NEW_DAYS * 864e5 && !watchedAll(i);
function splitItems() {
  S.items = S.allItems.filter(i => !isHidden(i));
  S.hiddenItems = S.allItems.filter(isHidden);
}
if (api.platform === 'win32') document.body.classList.add('win');

/* ================= Data helpers ================= */
const sortTitle = i => (i.meta?.title || i.title).replace(/^(the|a|an)\s+/i, '').toLowerCase();
const addedAt = i => Math.max(i.addedAt || 0, i.latestAt || 0);
const hasKey = k => !!(S.settings?.[k] || S.builtIn?.includes(k));
const isLoading = i => S.metaBusy && i.metaStatus === 'pending' && hasKey('tmdbKey');
const filesOf = i => i.type === 'tv' ? Object.values(i.episodes).map(e => e.path) : i.files;
const sortedEps = i => Object.values(i.episodes).sort((a, b) => a.season - b.season || a.episode - b.episode);
const prog = f => S.progress[f];
const isDone = f => { const p = prog(f); return p && (p.watched || p.pos >= p.dur * 0.95); };
const fraction = f => { const p = prog(f); return p && p.dur ? Math.min(1, p.pos / p.dur) : 0; };
const watchedAll = i => filesOf(i).length > 0 && filesOf(i).every(isDone);

function nextEpisode(item) {
  const eps = sortedEps(item);
  const started = eps.filter(e => prog(e.path));
  if (!started.length) return eps[0];
  const latest = started.sort((a, b) => prog(b.path).at - prog(a.path).at)[0];
  if (!isDone(latest.path)) return latest;
  const idx = eps.indexOf(latest);
  return eps.slice(idx + 1).find(e => !isDone(e.path)) || eps[0];
}

function continueList() {
  const out = [];
  for (const it of S.items) {
    if (it.type === 'movie') {
      const f = it.files[0]; const p = prog(f);
      if (p && !p.watched && p.pos > 30 && p.pos < p.dur * 0.95) out.push({ it, file: f, at: p.at, left: p.dur - p.pos, frac: p.pos / p.dur });
    } else {
      const eps = sortedEps(it);
      const touched = eps.filter(e => prog(e.path)).sort((a, b) => prog(b.path).at - prog(a.path).at)[0];
      if (!touched) continue;
      const p = prog(touched.path);
      if (!isDone(touched.path) && p.pos > 30) out.push({ it, ep: touched, file: touched.path, at: p.at, left: p.dur - p.pos, frac: p.pos / p.dur });
      else {
        const nx = eps[eps.indexOf(touched) + 1];
        if (nx && !prog(nx.path)) out.push({ it, ep: nx, file: nx.path, at: p.at, upNext: true, frac: 0 });
      }
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 12);
}

/* Title as artwork (logo) when we have one, plain text otherwise */
function titleArt(it, cls) {
  const m = it.meta || {}, t = m.title || it.title;
  return m.logo
    ? `<h1 class="${cls} has-logo"><img class="title-logo" src="${img(m.logo)}" alt="${esc(t)}"></h1>`
    : `<h1 class="${cls}">${esc(t)}</h1>`;
}

/* Titles you own that TMDB says are similar */
function moreLikeThis(it) {
  const m = it.meta || {};
  const want = new Set(m.recIds || []);
  const out = want.size ? S.items.filter(o => o.id !== it.id && o.type === it.type && want.has(o.meta?.tmdbId)) : [];
  if (out.length < 6 && m.genres?.length) {
    const g = new Set(m.genres), have = new Set(out.map(o => o.id));
    const extra = S.items.filter(o => o.id !== it.id && !have.has(o.id) && o.type === it.type && o.meta?.collectionId !== m.collectionId)
      .map(o => ({ o, n: (o.meta?.genres || []).filter(x => g.has(x)).length })).filter(x => x.n >= 2)
      .sort((a, b) => b.n - a.n || (ratingValue(b.o) || 0) - (ratingValue(a.o) || 0)).map(x => x.o);
    out.push(...extra.slice(0, 18 - out.length));
  }
  return out.slice(0, 18);
}
function collectionOf(it) {
  const cid = it.meta?.collectionId; if (!cid) return [];
  return S.items.filter(o => o.meta?.collectionId === cid)
    .sort((a, b) => String(a.meta?.releaseDate || a.year).localeCompare(String(b.meta?.releaseDate || b.year)));
}
function miniRow(title, list) {
  return `<div><h3 class="h3">${esc(title)}</h3><div class="row mini-row">${list.map((o, i) => cardHtml(o, i)).join('')}</div></div>`;
}

/* ================= Cards ================= */
function cardHtml(it, i = 0, land = false) {
  const r = ratingValue(it);
  const m = it.meta || {};
  const f = it.type === 'movie' ? fraction(it.files[0]) : 0;
  const sub = [m.year || it.year, m.genres?.[0]].filter(Boolean).join(' · ') || (it.type === 'tv' ? 'Series' : 'Movie');
  const art = land
    ? (m.backdrop ? `<img src="${img(m.backdrop)}" alt="" loading="lazy" decoding="async"><span class="land-title">${esc(m.title || it.title)}</span>` : posterInner(it, { loading: isLoading(it) }))
    : posterInner(it, { loading: isLoading(it) });
  return `<button class="card ${land ? 'land' : ''}" data-id="${esc(it.id)}" style="--i:${i}" aria-label="${esc(m.title || it.title)}">
    <div class="poster">${art}
      ${r ? `<span class="badge-rating">${icon('star')}${r}</span>` : ''}
      ${watchedAll(it) ? `<span class="watched" title="Watched">${icon('check')}</span>` : (isNew(it) ? '<span class="new-badge">New</span>' : '')}
      ${f > 0.01 && f < 0.95 ? `<span class="progress"><i style="transform:scaleX(${f})"></i></span>` : ''}
      <span class="play-chip">${icon('play')}</span>
      ${it.flag?.level ? `<span class="flag-label p-${it.flag.level}">${icon('flag')}${FLAGS[it.flag.level]}</span>` : ''}
      <span class="flag-btn ${it.flag?.level ? 'on p-' + it.flag.level : ''}" data-flag="${esc(it.id)}" role="button" tabindex="0" aria-label="Flag ${esc(m.title || it.title)}" title="Flag">${icon('flag')}</span>
    </div>
    <div class="cap"><b>${esc(m.title || it.title)}</b><small>${esc(sub)}</small></div>
  </button>`;
}

function wideCardHtml(c, i) {
  const { it, ep } = c;
  const m = it.meta || {};
  const epMeta = ep ? m.seasons?.[ep.season]?.episodes?.[ep.episode] : null;
  const shot = epMeta?.still || m.backdrop;
  const label = ep ? `S${ep.season} E${ep.episode}${epMeta?.title ? ' · ' + epMeta.title : ''}` : '';
  const sub = c.upNext ? `Up next · ${label}` : [label, `${fmtRuntime(Math.max(1, Math.round(c.left / 60)))} left`].filter(Boolean).join(' · ');
  return `<button class="wide-card" data-play="${esc(it.id)}" data-s="${ep?.season ?? ''}" data-e="${ep?.episode ?? ''}" style="--i:${i}">
    <div class="shot">${shot ? `<img src="${img(shot)}" alt="" loading="lazy">` : `<div class="thumb-fallback" style="--h:${hueOf(it.title)};position:absolute;inset:0"></div>`}
      <div class="over"><span class="pbtn">${icon('play')}</span><div><b>${esc(m.title || it.title)}</b><small>${esc(sub)}</small></div></div>
      ${c.frac ? `<span class="progress"><i style="transform:scaleX(${c.frac})"></i></span>` : ''}
    </div>
  </button>`;
}

function rowHtml(title, inner, link) {
  return `<section class="section reveal">
    <div class="section-head"><h2>${esc(title)}</h2>${link ? `<button class="link" data-goto="${link}">See all</button>` : ''}</div>
    <div class="row-wrap">
      <button class="row-arrow l" aria-label="Scroll left" disabled><span>${icon('left')}</span></button>
      <div class="row">${inner}</div>
      <button class="row-arrow r" aria-label="Scroll right"><span>${icon('right')}</span></button>
    </div>
  </section>`;
}

/* ================= Views ================= */
function render(dir = 0) {
  const main = $('#main');
  document.body.classList.toggle('solid-top', S.view !== 'home');
  stopHero();
  if (!S.folders.length) { main.innerHTML = onboardingHtml(); bindCommon(main); return; }
  if (S.view === 'home') main.innerHTML = homeHtml();
  else if (S.view === 'search') main.innerHTML = searchHtml();
  else main.innerHTML = libraryHtml(S.view);
  if (dir && !reduceMotion.matches) {
    main.animate([{ opacity: 0, transform: `translateX(${dir * 40}px)` }, { opacity: 1, transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.22,1,.36,1)' });
  }
  bindCommon(main);
  if (S.view === 'home') { startHero(); bindSpotlight(); }
  onScroll();
  S.firstPaint = false;
}

function onboardingHtml() {
  return `<section class="empty"><div class="empty-inner">
    <h1>Your movies, on the big screen</h1>
    <p>Point Showtrove at the folder where you keep movies and shows. It finds the posters, cast and ratings, and keeps everything so it works offline.</p>
    <ol class="steps">
      <li>Add the folder with your movies or TV shows</li>
      <li>Add a free TMDB key in Settings for posters and details</li>
      <li>Press play, in the built-in player or KMPlayer</li>
    </ol>
    <button class="btn primary" data-act="add-folder">${icon('folder')}Add your movie folder</button>
    <button class="btn quiet" data-act="settings">Open settings</button>
  </div></section>`;
}

function homeHtml() {
  const all = S.items;
  if (!all.length) {
    return `<section class="empty"><div class="empty-inner"><h1>No videos found yet</h1>
      <p>We looked in ${S.folders.length} folder${S.folders.length > 1 ? 's' : ''} and didn't find any video files. Copy some movies in, or add another folder.</p>
      <button class="btn primary" data-act="add-folder">${icon('folder')}Add another folder</button></div></section>`;
  }
  const movies = all.filter(i => i.type === 'movie');
  const shows = all.filter(i => i.type === 'tv');
  const recent = artFirst([...all].sort((a, b) => addedAt(b) - addedAt(a)).slice(0, 20));
  const fresh = all.filter(isNew).sort((a, b) => addedAt(b) - addedAt(a));
  const rated = all.filter(i => i.meta?.poster && ratingValue(i)).sort((a, b) => ratingValue(b) - ratingValue(a)).slice(0, 14);
  const cont = continueList();
  let out = heroHtml();

  if (!hasKey('tmdbKey')) {
    out += `<div class="banner reveal in"><p><b>Posters and details are off.</b> Add a free TMDB key and Showtrove fills in posters, cast and ratings for all ${all.length} titles.</p><button class="btn primary sm" data-act="settings">Add TMDB key</button></div>`;
  }
  const L = (it, i) => cardHtml(it, i, true);
  if (cont.length) out += rowHtml('Continue watching', cont.map(wideCardHtml).join(''));
  const flags = flagged(all);
  if (flags.length) out += rowHtml(`Flagged · ${flags.length}`, flags.slice(0, 30).map((it, i) => cardHtml(it, i)).join(''), 'flagged');
  if (fresh.length) out += rowHtml(`Newly added · ${fresh.length}`, fresh.slice(0, 30).map(L).join(''), 'new');
  if (rated.length >= 4) out += spotlightHtml(rated);
  if (!fresh.length) out += rowHtml('Recently added', recent.map(L).join(''));
  if (movies.length) out += rowHtml('Movies', artFirst(movies.sort((a, b) => addedAt(b) - addedAt(a))).slice(0, 24).map((it, i) => cardHtml(it, i)).join(''), 'movies');
  if (shows.length) out += rowHtml('TV shows', artFirst(shows.sort((a, b) => addedAt(b) - addedAt(a))).slice(0, 24).map((it, i) => cardHtml(it, i)).join(''), 'tv');

  const cols = {};
  for (const it of movies) if (it.meta?.collectionId) (cols[it.meta.collectionId] ||= []).push(it);
  Object.values(cols).filter(l => l.length >= 2).sort((a, b) => b.length - a.length).slice(0, 4).forEach(l => {
    l.sort((a, b) => String(a.meta?.releaseDate || a.year).localeCompare(String(b.meta?.releaseDate || b.year)));
    out += rowHtml(l[0].meta.collection || 'Collection', l.map((it, i) => cardHtml(it, i)).join(''));
  });

  const genres = {};
  for (const it of all) for (const g of it.meta?.genres || []) (genres[g] ||= []).push(it);
  Object.entries(genres).filter(([, l]) => l.length >= 4).sort((a, b) => b[1].length - a[1].length).slice(0, 6)
    .forEach(([g, l]) => { out += rowHtml(g, l.slice(0, 24).map(L).join('')); });
  return out + '<div style="height:60px"></div>';
}

/* ---------- Hero: full-screen artwork, shelf of titles along the bottom (Apple TV / PS5) ---------- */
let heroList = [], heroIdx = 0, heroTimer = 0, heroManual = false, hoverT = 0;
const heroMs = () => (+S.settings?.heroSpeed || 9) * 1000;
const heroAuto = () => S.settings?.heroAutoplay !== false;
function heroHtml() {
  const pool = S.items.filter(i => i.meta?.backdrop).length ? S.items.filter(i => i.meta?.backdrop) : S.items;
  const rated = [...pool].sort((a, b) => (ratingValue(b) || 0) - (ratingValue(a) || 0));
  const newest = [...pool].sort((a, b) => addedAt(b) - addedAt(a));
  const seen = new Set();
  heroList = [...newest.slice(0, 3), ...rated, ...newest].filter(i => !seen.has(i.id) && seen.add(i.id)).slice(0, 14);
  if (!heroList.length) return '';
  heroIdx = 0; heroManual = false;
  return `<section class="hero tv ${S.firstPaint ? 'intro' : ''}" id="hero">
    <div class="hero-media" id="heroMedia">${heroList.map((it, i) => `<div class="hero-slide ${i === 0 ? 'on' : ''}" data-i="${i}">${it.meta?.backdrop ? `<img src="${img(it.meta.backdrop)}" alt="" ${i > 2 ? 'loading="lazy"' : ''}>` : `<div class="thumb-fallback" style="--h:${hueOf(it.title)};position:absolute;inset:0"></div>`}</div>`).join('')}</div>
    <div class="lb top"></div><div class="lb bot"></div>
    <div class="hero-content" id="heroContent">${heroTextHtml(heroList[0])}</div>
    <div class="shelf-wrap"><div class="shelf" id="shelf" style="--hero-ms:${heroMs()}ms" role="listbox" aria-label="Featured titles">${heroList.map((it, i) => `
      <button class="tile ${i === 0 ? 'on' : ''}" data-tile="${i}" role="option" aria-selected="${i === 0}" aria-label="${esc(it.meta?.title || it.title)}">
        <div class="poster">${posterInner(it)}</div><span class="timer"><i></i></span>
      </button>`).join('')}</div></div>
  </section>`;
}
function heroTextHtml(it) {
  const m = it.meta || {};
  return `<div class="hero-text">
    ${titleArt(it, 'hero-title swap')}
    ${metaLine(it)}
    ${ratingsHtml(m)}
    ${m.overview ? `<p class="hero-overview">${esc(m.overview)}</p>` : ''}
    <div class="hero-actions">
      <button class="btn primary" data-play="${esc(it.id)}">${icon('play')}${esc(playLabel(it))}</button>
      <button class="btn ghost" data-open="${esc(it.id)}">${icon('info')}More info</button>
    </div></div>`;
}
function setHero(i, { manual = false } = {}) {
  if (!heroList.length) return;
  const n = (i + heroList.length) % heroList.length;
  if (manual) { heroManual = true; $('#shelf')?.classList.add('manual'); }
  if (n === heroIdx && !manual) return;
  heroIdx = n;
  $$('.hero-slide').forEach(s => s.classList.toggle('on', +s.dataset.i === heroIdx));
  $$('.tile').forEach(t => { const on = +t.dataset.tile === heroIdx; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); });
  const tile = $(`.tile[data-tile="${heroIdx}"]`), shelf = $('#shelf');
  if (tile && shelf) {
    const tl = tile.offsetLeft, tr = tl + tile.offsetWidth, pad = 80;
    if (tl < shelf.scrollLeft + pad || tr > shelf.scrollLeft + shelf.clientWidth - pad) shelf.scrollTo({ left: tl - shelf.clientWidth / 3, behavior: 'smooth' });
  }
  const c = $('#heroContent'); if (c) c.innerHTML = heroTextHtml(heroList[heroIdx]);
  setAmbient(heroList[heroIdx]);
  clearTimeout(heroTimer);
  if (!heroManual && heroAuto()) heroTimer = setTimeout(() => setHero(heroIdx + 1), heroMs());
}
function startHero() {
  if (!heroList.length) return;
  setAmbient(heroList[0]);
  if (heroList.length > 1 && heroAuto()) heroTimer = setTimeout(() => setHero(1), heroMs());
  const shelf = $('#shelf'); if (!shelf) return;
  // Hover a tile to preview it, click to open it (PS5 / Apple TV top shelf)
  shelf.addEventListener('pointerover', e => {
    const t = e.target.closest('.tile'); if (!t || e.pointerType !== 'mouse' || shelf.classList.contains('dragging')) return;
    clearTimeout(hoverT); hoverT = setTimeout(() => setHero(+t.dataset.tile, { manual: true }), 160);
  });
  shelf.addEventListener('pointerout', () => clearTimeout(hoverT));
  shelf.addEventListener('click', e => {
    const t = e.target.closest('.tile'); if (!t) return;
    e.stopPropagation();
    if (+t.dataset.tile === heroIdx) openDetail(heroList[heroIdx].id); else setHero(+t.dataset.tile, { manual: true });
  });
  shelf.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault(); setHero(heroIdx + (e.key === 'ArrowRight' ? 1 : -1), { manual: true });
      $(`.tile[data-tile="${heroIdx}"]`)?.focus({ preventScroll: true });
    }
  });
}
function stopHero() { clearTimeout(heroTimer); }
async function setAmbient(it) {
  const c = await ambientFrom(it?.meta?.poster || it?.meta?.backdrop);
  if (c) document.documentElement.style.setProperty('--amb', c);
}

/* ---------- Spotlight carousel ---------- */
function spotlightHtml(list) {
  return `<section class="section spotlight reveal" id="spotlight">
    <div class="section-head"><h2>Top rated in your library</h2></div>
    <div class="spot-glow" id="spotGlow"></div>
    <button class="spot-nav l" data-spot="-1" aria-label="Previous">${icon('left')}</button>
    <div class="spot-track" id="spotTrack">${list.map(it => {
      const m = it.meta;
      const sub = [m.year, it.type === 'tv' ? `${m.numberOfSeasons || 1} season${(m.numberOfSeasons || 1) > 1 ? 's' : ''}` : fmtRuntime(m.runtime)].filter(Boolean).join(' · ');
      return `<button class="spot-card" data-spot-id="${esc(it.id)}">
        <div class="poster"><img src="${img(m.poster)}" alt="" loading="lazy"></div>
        <span class="kind" title="${it.type === 'tv' ? 'TV show' : 'Movie'}">${icon(it.type === 'tv' ? 'tv' : 'film')}</span>
        <span class="score">${ratingValue(it)}${icon('star')}</span>
        <div class="info"><b>${esc(m.title)}</b><small>${esc(sub)}</small></div>
      </button>`;
    }).join('')}</div>
    <button class="spot-nav r" data-spot="1" aria-label="Next">${icon('right')}</button>
    <div class="spot-caption" id="spotCaption"></div>
  </section>`;
}
function bindSpotlight() {
  const track = $('#spotTrack'); if (!track) return;
  const cards = $$('.spot-card', track);
  let focused = -1, raf = 0;
  const update = () => {
    raf = 0;
    if (!track.isConnected) return removeEventListener('resize', kick);
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0, bestD = Infinity;
    cards.forEach((c, i) => {
      const center = c.offsetLeft + c.offsetWidth / 2;
      const d = (center - mid) / 252;
      const a = Math.min(Math.abs(d), 2.2);
      c.style.setProperty('--s', (1 - Math.min(a, 1) * 0.2 - Math.max(0, a - 1) * 0.06).toFixed(3));
      c.style.setProperty('--o', (1 - Math.min(a, 2) * 0.28).toFixed(3));
      c.style.setProperty('--b', (1 - Math.min(a, 1.2) * 0.42).toFixed(3));
      c.style.setProperty('--sat', (1 - Math.min(a, 1) * 0.25).toFixed(3));
      c.style.setProperty('--z', String(100 - Math.round(a * 10)));
      if (Math.abs(d) < bestD) { bestD = Math.abs(d); best = i; }
    });
    if (best !== focused) {
      focused = best;
      cards.forEach((c, i) => c.classList.toggle('focused', i === best));
      const it = byId(cards[best].dataset.spotId);
      ambientFrom(it.meta.poster).then(col => { if (col) $('#spotlight')?.style.setProperty('--spot', col); });
      const cap = $('#spotCaption'); if (!cap) return;
      cap.innerHTML = `<div class="swap" style="display:grid;gap:12px;justify-items:center">${ratingsHtml(it.meta)}${it.meta.overview ? `<p>${esc(it.meta.overview)}</p>` : ''}
        <div class="hero-actions"><button class="btn primary sm" data-play="${esc(it.id)}">${icon('play')}${esc(playLabel(it))}</button><button class="btn quiet" data-open="${esc(it.id)}">Details</button></div></div>`;
    }
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(update); };
  track.addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', kick);
  track.addEventListener('click', e => {
    const c = e.target.closest('.spot-card'); if (!c) return;
    if (c.classList.contains('focused')) openDetail(c.dataset.spotId);
    else c.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  });
  track.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); track.scrollBy({ left: e.key === 'ArrowRight' ? 252 : -252 }); }
  });
  $$('.spot-nav').forEach(b => b.onclick = () => track.scrollBy({ left: 252 * +b.dataset.spot }));
  // start on the 2nd card so there's something on both sides
  requestAnimationFrame(() => { track.style.scrollBehavior = 'auto'; track.scrollLeft = cards[1] ? cards[1].offsetLeft + 140 - track.clientWidth / 2 : 0; track.style.scrollBehavior = ''; update(); });
}

/* ---------- Movies / TV pages ---------- */
function libraryHtml(kind) {
  const type = kind === 'tv' ? 'tv' : 'movie';
  const f = S.lib[kind];
  const showHidden = kind === 'movies' && f.hidden && S.hiddenUnlocked;
  const pool = showHidden ? S.hiddenItems : S.items.filter(i => i.type === type);
  const genres = ['All', ...[...new Set(pool.flatMap(i => i.meta?.genres || []))].sort()];
  if (!genres.includes(f.genre)) f.genre = 'All';
  let list = f.genre === 'All' ? pool : pool.filter(i => i.meta?.genres?.includes(f.genre));
  const yr = i => +(i.meta?.year || i.year) || 0;
  const years = [...new Set(pool.map(yr).filter(Boolean))].sort((a, b) => b - a);
  const decades = [...new Set(years.map(y => Math.floor(y / 10) * 10))];
  if (f.flag !== 'off') list = list.filter(i => i.flag?.level && (f.flag === 'all' || i.flag.level === f.flag));
  if (f.year !== 'all') {
    const [kindY, n] = [f.year[0], +f.year.slice(1)];
    list = list.filter(i => kindY === 'd' ? Math.floor(yr(i) / 10) * 10 === n : yr(i) === n);
  }
  const sorters = {
    added: (a, b) => addedAt(b) - addedAt(a),
    title: (a, b) => sortTitle(a).localeCompare(sortTitle(b)),
    year: (a, b) => (b.meta?.year || b.year || 0) - (a.meta?.year || a.year || 0),
    rating: (a, b) => (ratingValue(b) || 0) - (ratingValue(a) || 0)
  };
  list = artFirst([...list].sort(sorters[f.sort]));
  if (f.flag !== 'off' && f.sort === 'added') list.sort(byFlag); // flagged view: highest priority first
  const label = showHidden ? 'Hidden' : kind === 'tv' ? 'TV shows' : 'Movies';
  const noun = kind === 'tv' ? (list.length === 1 ? 'show' : 'shows') : (list.length === 1 ? 'movie' : 'movies');
  const yearSel = `<label class="select"><span>Year</span><select id="yearSel">
        <option value="all">All years</option>
        ${decades.map(d => `<option value="d${d}" ${f.year === 'd' + d ? 'selected' : ''}>${d}s</option>${years.filter(y => Math.floor(y / 10) * 10 === d).map(y => `<option value="y${y}" ${f.year === 'y' + y ? 'selected' : ''}>&nbsp;&nbsp;${y}</option>`).join('')}`).join('')}
      </select></label>`;
  const hiddenTab = kind === 'movies' ? `<button class="chip lock-chip" data-act="hidden" aria-pressed="${showHidden}">${icon(showHidden ? 'eye' : 'lock')}Hidden</button>` : '';
  return `<div class="page">
    <div class="page-head"><h1>${label}</h1><span class="count">${list.length} ${noun}</span>
      ${showHidden ? `<button class="btn quiet sm" data-act="lock">${icon('lock')}Lock and go back</button>` : ''}</div>
    ${pool.length ? `<div class="toolbar">${hiddenTab}${flagChips(pool, f)}
      <div class="chips" role="group" aria-label="Filter by genre">${genres.map(g => `<button class="chip" data-genre="${esc(g)}" aria-pressed="${g === f.genre}">${esc(g)}</button>`).join('')}</div>
      <label class="select"><span>Sort by</span><select id="sortSel">
        <option value="added" ${f.sort === 'added' ? 'selected' : ''}>Recently added</option>
        <option value="title" ${f.sort === 'title' ? 'selected' : ''}>Title A–Z</option>
        <option value="year" ${f.sort === 'year' ? 'selected' : ''}>Release year</option>
        <option value="rating" ${f.sort === 'rating' ? 'selected' : ''}>Highest rated</option>
      </select></label>${yearSel}</div>
      ${list.length ? `<div class="grid">${list.map((it, i) => cardHtml(it, i)).join('')}</div>` : `<div class="inline-empty"><h2>Nothing here</h2><p>No titles match this genre and year.</p></div>`}`
    : showHidden ? `<div class="toolbar">${hiddenTab}</div><div class="inline-empty"><h2>Nothing hidden yet</h2><p>Open any title and press Hide, or keep adult videos in a folder named XXX or Adult.</p></div>` : `<div class="inline-empty"><h2>No ${label.toLowerCase()} yet</h2><p>${kind === 'tv' ? 'Name episode files like “Show Name S01E02.mkv” or keep them in “Show/Season 1/” folders and they’ll show up here.' : 'Movies you add to your folders will show up here.'}</p><button class="btn primary sm" data-act="add-folder">${icon('folder')}Add a folder</button></div>`}
  </div>`;
}

/* ---------- Search ---------- */
function searchHtml() {
  const q = S.query.trim().toLowerCase();
  const hits = S.items.filter(i => {
    const m = i.meta || {};
    const hay = [i.title, m.title, m.originalTitle, m.year, i.year, ...(m.genres || []), ...(m.cast || []).map(c => c.name), ...(m.directors || []), ...(m.creators || [])].join(' ').toLowerCase();
    return q.split(/\s+/).every(w => hay.includes(w));
  });
  return `<div class="page"><div class="page-head"><h1>“${esc(S.query.trim())}”</h1><span class="count">${hits.length} result${hits.length === 1 ? '' : 's'}</span></div>
    ${hits.length ? `<div class="grid">${hits.map((it, i) => cardHtml(it, i)).join('')}</div>` : `<div class="inline-empty"><h2>Nothing matches</h2><p>Try a title, an actor or a genre. Search looks through everything in your folders.</p><button class="btn quiet" data-act="clear-search">Clear search</button></div>`}</div>`;
}

/* ================= Binding ================= */
let revealObs;
function bindCommon(root) {
  revealObs?.disconnect();
  revealObs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); revealObs.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  $$('.reveal:not(.in)', root).forEach(el => revealObs.observe(el));
  $$('.card', root).forEach((c, i) => { if (!c.style.getPropertyValue('--i')) c.style.setProperty('--i', i); });

  $$('.row-wrap', root).forEach(w => {
    const row = $('.row', w), l = $('.row-arrow.l', w), r = $('.row-arrow.r', w);
    $$('.card, .wide-card', row).forEach((c, i) => c.style.setProperty('--i', i));
    const upd = () => { l.disabled = row.scrollLeft < 8; r.disabled = row.scrollLeft + row.clientWidth >= row.scrollWidth - 8; };
    row.addEventListener('scroll', upd, { passive: true }); upd();
    l.onclick = () => row.scrollBy({ left: -row.clientWidth * 0.8 });
    r.onclick = () => row.scrollBy({ left: row.clientWidth * 0.8 });
  });
  const sel = $('#sortSel', root);
  if (sel) sel.onchange = () => { S.lib[S.view].sort = sel.value; render(); };
  const ysel = $('#yearSel', root);
  if (ysel) { ysel.value = S.lib[S.view].year; ysel.onchange = () => { S.lib[S.view].year = ysel.value; render(); }; }
}

// One delegated click handler for the whole app
document.addEventListener('click', e => {
  const fb = e.target.closest('[data-flag]');
  if (fb) { e.preventDefault(); e.stopPropagation(); return openFlagMenu(fb.dataset.flag, fb); }
  const fl = e.target.closest('[data-flagf]');
  if (fl) { S.lib[S.view].flag = fl.dataset.flagf; return render(); }
  const t = e.target.closest('[data-play],[data-open],[data-act],[data-goto],[data-genre],.card');
  if (!t || t.closest('.spot-track, .shelf')) return;
  if (t.dataset.play !== undefined) {
    e.stopPropagation();
    const s = t.dataset.s ? +t.dataset.s : undefined, ep = t.dataset.e ? +t.dataset.e : undefined;
    return startPlay(t.dataset.play, s, ep, t);
  }
  if (t.dataset.open) return openDetail(t.dataset.open);
  if (t.dataset.goto) return go(t.dataset.goto);
  if (t.dataset.genre) { S.lib[S.view].genre = t.dataset.genre; return render(); }
  if (t.dataset.act === 'hidden') { e.preventDefault(); return toggleHiddenTab(); }
  if (t.dataset.act === 'lock') { S.hiddenUnlocked = false; S.lib.movies.hidden = false; render(); return toast('Hidden titles locked'); }
  if (t.classList.contains('card')) return openDetail(t.dataset.id);
  const act = t.dataset.act;
  if (act === 'add-folder') addFolder();
  if (act === 'settings') openSettings();
  if (act === 'clear-search') { $('#searchInput').value = ''; S.query = ''; go(S.lastView); }
});

/* ================= Navigation ================= */
function go(view) {
  if (view !== 'movies' && S.hiddenUnlocked) { S.hiddenUnlocked = false; S.lib.movies.hidden = false; } // leaving Movies locks Hidden again
  if (view === 'flagged') { S.lib.movies.flag = 'all'; S.lib.tv.flag = 'all'; view = S.items.some(i => i.type === 'movie' && i.flag) ? 'movies' : 'tv'; }
  if (view === 'new') { S.lib.movies.sort = 'added'; S.lib.movies.year = 'all'; view = 'movies'; }
  if (view === S.view && view !== 'search') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const from = VIEWS.indexOf(S.view), to = VIEWS.indexOf(view);
  if (view !== 'search') { S.lastView = view; if (S.query) { S.query = ''; $('#searchInput').value = ''; } }
  S.view = view;
  updateSwitch();
  window.scrollTo(0, 0);
  render(from >= 0 && to >= 0 ? Math.sign(to - from) : 0);
}
function updateSwitch() {
  const active = S.view === 'search' ? null : S.view;
  $$('#switch button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === active)));
  const b = active && $(`#switch button[data-view="${active}"]`);
  const pill = $('#switchPill');
  if (!b) { pill.style.opacity = 0; return; }
  pill.style.opacity = 1;
  pill.style.width = b.offsetWidth + 'px';
  pill.style.transform = `translateX(${b.offsetLeft}px)`;
}
$$('#switch button').forEach(b => b.onclick = () => go(b.dataset.view));
$('#brand').onclick = () => go('home');
$('#settingsBtn').onclick = () => openSettings();
$('#refreshBtn').onclick = () => api.rescan();
addEventListener('resize', updateSwitch);

let searchT = 0;
$('#searchInput').addEventListener('input', e => {
  clearTimeout(searchT);
  searchT = setTimeout(() => {
    S.query = e.target.value;
    if (S.query.trim()) { if (S.view !== 'search') { S.view = 'search'; updateSwitch(); } window.scrollTo(0, 0); render(); }
    else go(S.lastView);
  }, 120);
});

addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#searchInput').focus(); $('#searchInput').select(); }
  if (e.key === 'Escape') {
    if (Player.isOpen()) return;
    if ($('.popover')) return closePopover();
    if (!$('#modalLayer').hidden) return closeModal();
    if (!$('#detailLayer').hidden) return closeDetail();
    if (document.activeElement === $('#searchInput')) { $('#searchInput').blur(); }
  }
});

/* ================= Scroll effects ================= */
let scrollRaf = 0;
function onScroll() {
  scrollRaf = 0;
  const y = window.scrollY;
  document.body.classList.toggle('scrolled', y > 12);
  const hero = $('#hero');
  if (hero && !reduceMotion.matches) {
    const h = hero.offsetHeight;
    const p = Math.max(0, Math.min(1, y / (h * 0.65)));
    hero.style.setProperty('--sy', Math.min(y, h));
    hero.style.setProperty('--lb', p.toFixed(3));
    const media = $('#heroMedia');
    if (media && y < h * 1.2) media.style.transform = `translate3d(0, ${y * 0.38}px, 0) scale(${1 + p * 0.07})`;
  }
}
addEventListener('scroll', () => { if (!scrollRaf) scrollRaf = requestAnimationFrame(onScroll); }, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) stopHero(); else if (S.view === 'home' && heroList.length > 1 && !heroManual && heroAuto()) { clearTimeout(heroTimer); heroTimer = setTimeout(() => setHero(heroIdx + 1), heroMs()); } });

/* ================= Detail page ================= */
function playLabel(it) {
  if (it.type === 'tv') {
    const ep = nextEpisode(it); if (!ep) return 'Play';
    const p = prog(ep.path);
    return `${p && !isDone(ep.path) && p.pos > 30 ? 'Resume' : 'Play'} S${ep.season} E${ep.episode}`;
  }
  const p = prog(it.files[0]);
  if (p && !p.watched && p.pos > 30 && p.pos < p.dur * 0.95) return `Resume from ${fmtTime(p.pos)}`;
  return 'Play';
}

function openDetail(id, { keepSeason } = {}) {
  const it = byId(id); if (!it) return;
  const layer = $('#detailLayer');
  const reopening = !layer.hidden && S.detailId === id;
  S.detailId = id;
  const m = it.meta || {};
  const seasonNums = [...new Set(Object.values(it.episodes || {}).map(e => e.season))].sort((a, b) => a - b);
  const curSeason = keepSeason ?? (it.type === 'tv' ? nextEpisode(it)?.season ?? seasonNums[0] : null);
  const facts = [];
  if (m.directors?.length) facts.push(['Director', m.directors.join(', ')]);
  if (m.creators?.length) facts.push(['Created by', m.creators.join(', ')]);
  if (m.writers?.length) facts.push(['Writers', m.writers.join(', ')]);
  if (m.networks?.length) facts.push(['Network', m.networks.join(', ')]);
  if (m.status && it.type === 'tv') facts.push(['Status', m.status]);
  if (m.languages?.length) facts.push(['Language', m.languages.slice(0, 3).join(', ')]);
  if (m.awards) facts.push(['Awards', m.awards]);
  if (m.collection) facts.push(['Part of', m.collection]);

  const stats = [];
  if (m.imdbRating) stats.push(['IMDb', `${esc(m.imdbRating)}<span>/10</span>`]);
  if (m.rottenTomatoes) stats.push(['Rotten Tomatoes', esc(m.rottenTomatoes)]);
  if (m.metacritic) stats.push(['Metacritic', esc(m.metacritic.split('/')[0])]);
  if (!m.imdbRating && m.tmdbRating) stats.push(['TMDB', `${esc(m.tmdbRating)}<span>/10</span>`]);
  if (it.type === 'tv') stats.push(['On your PC', `${Object.keys(it.episodes).length}<span> ep</span>`]);
  else if (m.runtime) stats.push(['Runtime', `${Math.floor(m.runtime / 60)}<span>h</span> ${m.runtime % 60}<span>m</span>`]);
  if (m.year || it.year) stats.push(['Released', esc(m.year || it.year)]);

  layer.innerHTML = `
    <div class="detail-back"><button class="icon-btn" id="detailClose" aria-label="Back">${icon('left')}</button></div>
    <div class="d-stage"><div class="bg" id="dBg">${m.backdrop ? `<img src="${img(m.backdrop)}" alt="">` : `<div class="thumb-fallback" style="--h:${hueOf(it.title)};position:absolute;inset:0"></div>`}</div><div class="dim"></div><div class="lb top"></div></div>
    <div class="d-content">
      <div style="display:grid;gap:12px">${titleArt(it, 'detail-title')}${m.tagline ? `<p class="tagline">${esc(m.tagline)}</p>` : ''}${metaLine(it)}</div>
      ${stats.length ? `<div class="stats">${stats.map(([k, v]) => `<div class="stat"><small>${k}</small><b>${v}</b></div>`).join('')}</div>`
        : (it.metaStatus === 'notfound' ? `<p style="color:var(--text-3)">We couldn't match this title automatically. Use “Fix match” to pick the right one.</p>` : '')}
      <div class="detail-actions">
        <div class="split"><button class="btn primary" id="dPlay">${icon('play')}${esc(playLabel(it))}</button><button class="btn primary caret" id="dPlayWith" aria-label="Choose player" title="Play with…">${icon('down')}</button></div>
        ${m.trailerKey ? `<button class="btn ghost" id="dTrailer">${icon('trailer')}Trailer</button>` : ''}
        ${it.type === 'movie' ? `<button class="btn quiet" id="dWatched">${icon(watchedAll(it) ? 'check' : 'eye')}${watchedAll(it) ? 'Watched' : 'Mark as watched'}</button>` : ''}
        <button class="btn quiet" id="dFix">${icon('wand')}Fix match</button>
        <button class="btn quiet ${it.flag?.level ? 'flag-on p-' + it.flag.level : ''}" id="dFlag" data-flag="${esc(it.id)}">${icon('flag')}${it.flag?.level ? FLAGS[it.flag.level] + ' priority' : 'Flag'}</button>
        <button class="btn quiet" id="dHide">${icon(isHidden(it) ? 'eye' : 'lock')}${isHidden(it) ? 'Unhide' : 'Hide'}</button>
        <button class="btn quiet" id="dRefresh">${icon('refresh')}Refresh info</button>
      </div>
      ${m.overview ? `<p class="overview">${esc(m.overview)}</p>` : ''}
      ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      ${it.type === 'tv' ? `<div><h3 class="h3">Episodes</h3>
        ${seasonNums.length > 1 ? `<div class="seasons" role="group" aria-label="Seasons" style="margin:12px 0 10px">${seasonNums.map(sn => `<button class="chip" data-season="${sn}" aria-pressed="${sn === curSeason}">${esc(m.seasons?.[sn]?.name || 'Season ' + sn)}</button>`).join('')}</div>` : ''}
        <div class="episodes" id="eps">${episodesHtml(it, curSeason)}</div></div>` : ''}
      ${m.cast?.length ? `<div><h3 class="h3">Cast</h3><div class="cast">${m.cast.map(c => `<div class="person"><div class="ph">${c.photo ? `<img src="${img(c.photo)}" alt="" loading="lazy">` : esc(c.name[0])}</div><b>${esc(c.name)}</b><small>${esc(c.character)}</small></div>`).join('')}</div></div>` : ''}
      ${(() => { const c = collectionOf(it); return c.length > 1 ? miniRow(m.collection || 'Collection', c) : ''; })()}
      ${(() => { const ml = moreLikeThis(it); return ml.length ? miniRow('More like this', ml) : ''; })()}
      <div><h3 class="h3">On your PC</h3><div class="file-list">${(it.type === 'tv' ? [it.root] : it.files).map(f => `<div style="display:flex;gap:10px;align-items:center;justify-content:space-between"><code>${esc(f)}</code><button class="btn quiet sm" data-reveal="${esc(f)}">${icon('folder', 'sm')}Show in folder</button></div>`).join('')}</div></div>
    </div>`;
  if (!reopening) { layer.hidden = false; layer.classList.remove('out'); layer.scrollTop = 0; document.body.style.overflow = 'hidden'; }
  setAmbient(it);

  const go1 = () => it.type === 'tv' ? nextEpisode(it) : null;
  $('#detailClose').onclick = closeDetail;
  $('#dPlay').onclick = e => { const ep = go1(); startPlay(id, ep?.season, ep?.episode, e.currentTarget); };
  $('#dPlayWith').onclick = e => { const ep = go1(); startPlay(id, ep?.season, ep?.episode, e.currentTarget, true); };
  $('#dTrailer') && ($('#dTrailer').onclick = () => api.openExternal(`https://www.youtube.com/watch?v=${m.trailerKey}`));
  $('#dFix').onclick = () => openFixMatch(it);
  $('#dHide').onclick = async () => {
    const hide = !isHidden(it);
    if (hide && !(await api.pinStatus()).set) { const ok = await pinFlow('create'); if (!ok) return; }
    applyState(await api.setHidden(id, hide)); closeDetail();
    toast(hide ? 'Moved to Movies → Hidden' : 'Back in your library', 'ok');
  };
  $('#dRefresh').onclick = async e => {
    const b = e.currentTarget; b.disabled = true; b.innerHTML = `${icon('refresh')}Refreshing…`; b.querySelector('.ic').style.animation = 'spin 1s linear infinite';
    await api.refreshItem(id); toast('Details updated', 'ok');
  };
  $('#dWatched') && ($('#dWatched').onclick = async () => {
    S.progress = await api.markWatched(it.files[0], !watchedAll(it)); openDetail(id); refreshCards(id);
  });
  $$('[data-reveal]', layer).forEach(b => b.onclick = () => api.showInFolder(b.dataset.reveal));
  $$('[data-season]', layer).forEach(b => b.onclick = () => {
    $$('[data-season]', layer).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('#eps').innerHTML = episodesHtml(it, +b.dataset.season); bindEpisodes(it);
  });
  bindEpisodes(it);
}

function episodesHtml(it, season) {
  const eps = sortedEps(it).filter(e => e.season === season);
  return eps.map((e, i) => {
    const em = it.meta?.seasons?.[season]?.episodes?.[e.episode] || {};
    const f = fraction(e.path);
    return `<button class="ep" data-ep="${e.season}x${e.episode}" style="--i:${i}">
      <span class="n">${e.episode}</span>
      <span class="shot">${em.still ? `<img src="${img(em.still)}" alt="" loading="lazy">` : `<span class="thumb-fallback" style="--h:${hueOf(it.title + e.episode)};position:absolute;inset:0"></span>`}
        <span class="pbtn"><span>${icon('play')}</span></span>${f > 0.01 ? `<span class="progress"><i style="transform:scaleX(${f})"></i></span>` : ''}</span>
      <span class="t"><b>${esc(em.title || `Episode ${e.episode}`)}</b>${em.overview ? `<p>${esc(em.overview)}</p>` : ''}</span>
      <span class="rt">${isDone(e.path) ? icon('check') : ''}${em.runtime ? `<span>${em.runtime}m</span>` : ''}</span>
    </button>`;
  }).join('');
}
function bindEpisodes(it) {
  $$('#eps .ep').forEach(b => b.onclick = () => { const [s, e] = b.dataset.ep.split('x').map(Number); startPlay(it.id, s, e, b); });
}

function closeDetail() {
  const layer = $('#detailLayer');
  if (layer.hidden) return;
  layer.classList.add('out');
  setTimeout(() => { layer.hidden = true; layer.innerHTML = ''; layer.classList.remove('out'); }, reduceMotion.matches ? 0 : 200);
  document.body.style.overflow = '';
  S.detailId = null;
  if (S.view === 'home' && heroList[heroIdx]) setAmbient(heroList[heroIdx]);
}
$('#detailLayer').addEventListener('scroll', e => {
  const y = e.target.scrollTop, stage = $('.d-stage', e.target), bg = $('#dBg');
  if (!stage) return;
  stage.style.setProperty('--dk', Math.min(0.72, y / 800).toFixed(3));
  if (reduceMotion.matches) return;
  bg.style.transform = `translate3d(0, ${-y * 0.08}px, 0) scale(${1 + Math.min(y, 800) / 8000})`;
  bg.style.filter = `blur(${Math.min(10, y / 90).toFixed(1)}px)`;
  stage.style.setProperty('--lb', Math.min(1, y / 500).toFixed(3));
}, { passive: true });

/* ================= Playing ================= */
async function startPlay(id, season, episode, anchor, forceChoose = false) {
  const it = byId(id); if (!it) return;
  if (it.type === 'tv' && season == null) { const ep = nextEpisode(it); season = ep?.season; episode = ep?.episode; }
  let player = S.settings.defaultPlayer;
  const installed = S.players.map(p => p.id);
  if (forceChoose || player === 'ask' || !installed.includes(player)) {
    player = await choosePlayer(anchor);
    if (!player) return;
  }
  const name = S.players.find(p => p.id === player)?.name || 'player';
  try {
    if (player !== 'builtin') toast(`Opening in ${name}…`);
    const r = await api.play({ id, season, episode, playerId: player });
    if (r.mode === 'builtin') Player.open(r, { id, season, episode, item: it });
  } catch (e) { toast(cleanErr(e)); }
}
const cleanErr = e => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

let popResolve = null;
function choosePlayer(anchor) {
  closePopover();
  return new Promise(res => {
    popResolve = res;
    const pop = html(`<div class="popover" role="menu">
      <h4>Play with</h4>
      ${S.players.map(p => `<button class="opt" role="menuitem" data-pl="${p.id}">${icon(p.id === 'builtin' ? 'play' : p.id === 'system' ? 'external' : 'film')}${esc(p.name)}${p.id === S.settings.defaultPlayer ? '<span class="tag">Default</span>' : ''}</button>`).join('')}
      ${!S.players.some(p => p.id === 'kmplayer') ? `<p style="padding:4px 12px 6px;font-size:13px;color:var(--text-3);max-width:250px">KMPlayer not found. Set its location in Settings.</p>` : ''}
      <hr><label class="check"><input type="checkbox" id="rememberPl">Always use this player</label>
    </div>`);
    document.body.append(pop);
    const r = (anchor || document.body).getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = Math.min(r.left, innerWidth - pw - 12), y = r.bottom + 8;
    if (y + ph > innerHeight - 12) { y = Math.max(12, r.top - ph - 8); pop.style.transformOrigin = 'bottom left'; }
    pop.style.left = Math.max(12, x) + 'px'; pop.style.top = y + 'px';
    pop.querySelector('.opt').focus();
    pop.onclick = async e => {
      const b = e.target.closest('[data-pl]'); if (!b) return;
      const pl = b.dataset.pl;
      if ($('#rememberPl').checked) { S.settings = (await api.saveSettings({ defaultPlayer: pl })).settings; toast(`Movies will open in ${b.textContent.replace('Default', '').trim()}. Change it in Settings.`, 'ok'); }
      closePopover(pl);
    };
    pop.onkeydown = e => {
      const opts = $$('.opt', pop), i = opts.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); opts[(i + 1) % opts.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); opts[(i - 1 + opts.length) % opts.length].focus(); }
    };
    setTimeout(() => document.addEventListener('mousedown', outside), 0);
  });
}
function outside(e) { if (!e.target.closest('.popover')) closePopover(); }
function closePopover(val = null) {
  document.removeEventListener('mousedown', outside);
  $$('.popover').forEach(p => p.remove());
  if (popResolve) { const r = popResolve; popResolve = null; r(val); }
}

/* ================= Modals ================= */
let modalCloseT = 0, modalOnClose = null;
function openModal(inner, onClose = null) {
  const L = $('#modalLayer');
  clearTimeout(modalCloseT); // a modal that was still closing must not wipe this one
  const prev = modalOnClose; modalOnClose = null; prev?.();
  L.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${inner}</div>`;
  L.hidden = false; L.classList.remove('out');
  L.onmousedown = e => { if (e.target === L) closeModal(); };
  modalOnClose = onClose;
  setTimeout(() => $('input, button.primary', L)?.focus(), 30);
  return $('.modal', L);
}
function closeModal() {
  const L = $('#modalLayer'); if (L.hidden) return;
  const cb = modalOnClose; modalOnClose = null; cb?.();
  L.classList.add('out');
  clearTimeout(modalCloseT);
  modalCloseT = setTimeout(() => { L.hidden = true; L.innerHTML = ''; L.classList.remove('out'); }, 170);
}

async function addFolder() {
  const st = await api.addFolder();
  applyState(st);
  if (!$('#modalLayer').hidden) openSettings();
}

function openSettings(tab = 'general') {
  const s = S.settings;
  const pl = S.players;
  const has = id => pl.some(p => p.id === id);
  const sel = (v, cur) => v === cur ? 'selected' : '';
  const tog = (id, on, label, hint = '') => `<label class="toggle"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><i aria-hidden="true"></i></label>`;
  let subSize = 30; try { subSize = +(localStorage.getItem('cv-subsize') ?? 30); } catch { /* ignore */ }
  const TABS = [['general', 'General'], ['library', 'Library'], ['playback', 'Playback'], ['subtitles', 'Subtitles'], ['advanced', 'Advanced']];
  const m = openModal(`
    <div class="modal-head"><h2>Settings</h2><button class="icon-btn" data-close aria-label="Close settings">${icon('x')}</button></div>
    <nav class="set-tabs" role="tablist">${TABS.map(([k, l]) => `<button class="chip" role="tab" data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</nav>
    <div class="modal-body">

      <div class="set-panel" data-panel="general">
        <section class="group"><h3>Home screen</h3>
          <label class="field"><span>Open Showtrove on</span><select class="input" id="sStart">
            <option value="home" ${sel('home', s.startView)}>Home</option><option value="movies" ${sel('movies', s.startView)}>Movies</option><option value="tv" ${sel('tv', s.startView)}>TV shows</option></select></label>
          ${tog('sHeroAuto', s.heroAutoplay, 'Slideshow on the big banner', 'Moves to the next featured title on its own')}
          <label class="field"><span>Slideshow speed</span><select class="input" id="sHeroSpeed">
            <option value="6" ${sel(6, +s.heroSpeed)}>Fast (6 seconds)</option><option value="9" ${sel(9, +s.heroSpeed)}>Normal (9 seconds)</option><option value="14" ${sel(14, +s.heroSpeed)}>Slow (14 seconds)</option></select></label>
        </section>
        <section class="group"><h3>Look and feel</h3>
          ${tog('sReduce', s.reduceMotion, 'Reduce motion', 'Turns off parallax, zooms and slide animations')}
          <label class="field"><span>Language for titles and plots</span><select class="input" id="sMetaLang">
            ${[['en-US', 'English'], ['si-LK', 'Sinhala'], ['ta-IN', 'Tamil'], ['hi-IN', 'Hindi'], ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'], ['zh-CN', 'Chinese'], ['fr-FR', 'French'], ['es-ES', 'Spanish'], ['de-DE', 'German']]
              .map(([v, l]) => `<option value="${v}" ${sel(v, s.metadataLanguage)}>${l}</option>`).join('')}</select>
            <small>Falls back to English when a translation isn't available. Changing it re-downloads details.</small></label>
        </section>
        <section class="group"><h3>Updates</h3><p class="hint">Showtrove updates itself and asks before restarting. <span id="sVer"></span></p>
          <div><button class="btn ghost sm" id="sCheckUpd">${icon('refresh')}Check for updates</button></div>
        </section>
      </div>

      <div class="set-panel" data-panel="library">
        ${libraryReportHtml()}
        <section class="group"><h3>Library folders</h3><p class="hint">Showtrove watches these folders and their subfolders. New movies show up on their own.</p>
          <div class="folder-list">${S.folders.map(f => { const r = S.scanReport?.folders?.find(x => x.root === f); return `<div class="folder">${icon('folder')}<div class="f-info"><code title="${esc(f)}">${esc(f)}</code><small>${r ? (r.online ? `${r.movies} movies · ${r.shows} shows (${r.episodes} episodes)` : '<span class="warn">Not connected right now. Its titles are kept until you plug it back in</span>') : 'Not scanned yet'}</small></div><button class="btn quiet sm danger" data-rm="${esc(f)}">Remove</button></div>`; }).join('') || '<p class="hint">No folders yet.</p>'}</div>
          <div><button class="btn ghost sm" data-act="add-folder">${icon('folder')}Add a folder</button></div>
        </section>
        <section class="group"><h3>Hidden titles</h3><p class="hint">Hidden titles only show in Movies → Hidden, behind your PIN. They never appear on Home, in search or in rows.</p>
          ${tog('sAutoHide', s.autoHideAdult !== false, 'Hide adult videos automatically', 'Based on file and folder names like XXX, and TMDB\'s adult flag')}
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><span class="hint-s">${S.hiddenItems?.length || 0} hidden</span><button class="btn ghost sm" id="sPin">${icon('lock')}Set or change PIN</button></div>
        </section>
        <section class="group"><h3>Tidy up</h3>
          <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn ghost sm" id="sRescan">${icon('folder')}Rescan folders now</button><button class="btn ghost sm" id="sRefreshAll">${icon('refresh')}Re-download all posters and details</button></div>
        </section>
      </div>

      <div class="set-panel" data-panel="playback">
        <section class="group"><h3>Playing</h3>
          <label class="field"><span>When I press play</span><select class="input" id="sPlayer">
            <option value="ask" ${sel('ask', s.defaultPlayer)}>Ask me which player each time</option>
            ${pl.map(p => `<option value="${p.id}" ${sel(p.id, s.defaultPlayer)}>Always use ${esc(p.name)}</option>`).join('')}
          </select></label>
          ${tog('sAutoNext', s.autoNext, 'Play the next episode automatically', 'Starts after an 8-second countdown in the built-in player')}
        </section>
        <details class="more"><summary>Player locations</summary>
          <div class="group" style="margin-top:14px">
          <label class="field"><span>KMPlayer ${has('kmplayer') ? '<span style="color:var(--ok)">· found</span>' : ''}</span>
            <div class="input-row"><input class="input" id="sKmp" value="${esc(s.kmplayerPath)}" placeholder="${has('kmplayer') ? 'Found automatically' : 'C:\\Program Files\\KMPlayer 64X\\KMPlayer64.exe'}" spellcheck="false"><button class="btn ghost sm" data-browse="sKmp">Browse</button></div></label>
          <label class="field"><span>VLC ${has('vlc') ? '<span style="color:var(--ok)">· found</span>' : ''}</span>
            <div class="input-row"><input class="input" id="sVlc" value="${esc(s.vlcPath)}" placeholder="${has('vlc') ? 'Found automatically' : 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe'}" spellcheck="false"><button class="btn ghost sm" data-browse="sVlc">Browse</button></div></label>
          <label class="field"><span>Another player</span>
            <div class="input-row"><input class="input" id="sCustom" value="${esc(s.customPlayerPath)}" placeholder="Any .exe, e.g. PotPlayer or MPC-BE" spellcheck="false"><button class="btn ghost sm" data-browse="sCustom">Browse</button></div></label>
          </div>
        </details>
      </div>

      <div class="set-panel" data-panel="subtitles">
        <section class="group"><h3>Subtitles</h3><p class="hint">When a video has none, Showtrove downloads one and saves it next to the video, so KMPlayer and VLC use it too.</p>
          ${tog('sAutoSub', s.autoSubtitles, 'Find subtitles automatically', 'Before a video starts, if it has no subtitle file')}
          <label class="field"><span>Languages, in order of preference</span><input class="input" id="sLangs" value="${esc(s.subtitleLanguages)}" spellcheck="false">
            <small>Two-letter codes, e.g. <b>en, si</b> for English then Sinhala. Others: ta Tamil, hi Hindi, ja Japanese, ko Korean</small></label>
          <label class="field"><span>Text size in the built-in player</span><select class="input" id="sSubSize">
            ${[[24, 'Small'], [30, 'Medium'], [38, 'Large'], [46, 'Extra large']].map(([v, l]) => `<option value="${v}" ${Math.abs(v - subSize) < 4 ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </section>
        <section class="group"><h3>OpenSubtitles account <em class="opt">· optional</em></h3><p class="hint">Free accounts get more subtitle downloads per day. Saved only on this PC.</p>
          <div class="two">
            <label class="field"><span>Username</span><input class="input" id="sOsUser" value="${esc(s.opensubtitlesUser)}" autocomplete="off"></label>
            <label class="field"><span>Password</span><input class="input" id="sOsPass" type="password" value="${esc(s.opensubtitlesPass)}" autocomplete="off"></label>
          </div>
          <small class="hint-s">No account? <a data-link="https://www.opensubtitles.com/en/users/sign_up">Sign up free</a></small>
        </section>
      </div>

      <div class="set-panel" data-panel="advanced">
        <section class="group"><h3>Your own API keys <em class="opt">· optional</em></h3>
          <p class="hint">${S.builtIn?.length ? 'Showtrove already includes these, so you can leave them empty. Paste your own key only if you want to use it instead.' : 'Free keys for posters, ratings and subtitles. Saved only on this PC.'}</p>
          <label class="field"><span>TMDB</span><input class="input" id="sTmdb" value="${esc(s.tmdbKey)}" spellcheck="false" autocomplete="off" placeholder="API key or read access token"><small>Posters, cast, plot · <a data-link="https://www.themoviedb.org/settings/api">get a key</a></small></label>
          <label class="field"><span>OMDb</span><input class="input" id="sOmdb" value="${esc(s.omdbKey)}" spellcheck="false" autocomplete="off"><small>IMDb and Rotten Tomatoes scores · <a data-link="https://www.omdbapi.com/apikey.aspx">get a key</a></small></label>
          <label class="field"><span>Fanart.tv</span><input class="input" id="sFanart" value="${esc(s.fanartKey)}" spellcheck="false" autocomplete="off"><small>Title logos · <a data-link="https://fanart.tv/get-an-api-key/">get a key</a></small></label>
          <label class="field"><span>OpenSubtitles</span><input class="input" id="sOsKey" value="${esc(s.opensubtitlesKey)}" spellcheck="false" autocomplete="off"><small>Subtitles · <a data-link="https://www.opensubtitles.com/en/consumers">get a key</a></small></label>
          <label class="field"><span>SubDL</span><input class="input" id="sSubdl" value="${esc(s.subdlKey)}" spellcheck="false" autocomplete="off"><small>Backup subtitles · <a data-link="https://subdl.com">get a key</a></small></label>
        </section>
      </div>
    </div>
    <div class="modal-foot"><button class="btn quiet" data-close>Cancel</button><button class="btn primary" id="sSave">${icon('check')}Save settings</button></div>`);

  const showTab = k => {
    $$('[data-tab]', m).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === k)));
    $$('[data-panel]', m).forEach(p => { p.hidden = p.dataset.panel !== k; });
    $('.modal-body', m).scrollTop = 0;
  };
  $$('[data-tab]', m).forEach(b => b.onclick = () => showTab(b.dataset.tab));
  showTab(tab);

  $$('[data-close]', m).forEach(b => b.onclick = closeModal);
  // Keys that ship with the app: show that they're covered, let people paste their own to override
  for (const [id, k] of [['sTmdb', 'tmdbKey'], ['sOmdb', 'omdbKey'], ['sFanart', 'fanartKey'], ['sSubdl', 'subdlKey'], ['sOsKey', 'opensubtitlesKey']]) {
    const el = $('#' + id, m);
    if (el && !s[k] && S.builtIn?.includes(k)) { el.placeholder = 'Built in ✓  (leave empty, or paste your own key)'; el.classList.add('built-in'); }
  }
  $$('[data-link]', m).forEach(a => a.onclick = () => api.openExternal(a.dataset.link));
  $$('[data-rm]', m).forEach(b => b.onclick = async () => {
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Click again to remove'; return; }
    applyState(await api.removeFolder(b.dataset.rm)); openSettings('library'); toast('Folder removed. Your files are untouched.');
  });
  $$('[data-browse]', m).forEach(b => b.onclick = async () => { const p = await api.browseExe(); if (p) $('#' + b.dataset.browse).value = p; });
  $('#sPin').onclick = async () => { const { set } = await api.pinStatus(); closeModal(); await pinFlow(set ? 'change' : 'create'); };
  $$('[data-fix]', m).forEach(b => b.onclick = () => { const it = byId(b.dataset.fix); closeModal(); if (it) openFixMatch(it); });
  $$('.skip-row [data-reveal]', m).forEach(b => b.onclick = e => { e.preventDefault(); e.stopPropagation(); api.showInFolder(b.dataset.reveal); });
  $('#sRefreshAll').onclick = () => { api.refreshAll(); toast('Re-downloading details in the background'); };
  $('#sRescan').onclick = () => api.rescan();
  api.appVersion().then(v => { const e = $('#sVer'); if (e) e.textContent = `You have version ${v}.`; });
  $('#sCheckUpd').onclick = async () => {
    toast('Checking for updates…');
    const v = await api.checkUpdates?.().catch(() => null);
    const cur = await api.appVersion();
    toast(v && v !== cur ? `Version ${v} found. Downloading…` : 'You have the latest version ✓');
  };
  $('#sSave').onclick = async () => {
    const tm = $('#sTmdb').value.trim();
    if (tm && !/^[A-Za-z0-9._-]{20,}$/.test(tm)) { showTab('advanced'); const f = $('#sTmdb'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); toast('That TMDB key looks incomplete. Paste the whole key.'); return; }
    try { localStorage.setItem('cv-subsize', $('#sSubSize').value); } catch { /* ignore */ }
    const st = await api.saveSettings({
      autoHideAdult: $('#sAutoHide').checked, startView: $('#sStart').value, heroAutoplay: $('#sHeroAuto').checked, heroSpeed: +$('#sHeroSpeed').value,
      reduceMotion: $('#sReduce').checked, metadataLanguage: $('#sMetaLang').value, autoNext: $('#sAutoNext').checked,
      tmdbKey: tm, omdbKey: $('#sOmdb').value.trim(), fanartKey: $('#sFanart').value.trim(), subdlKey: $('#sSubdl').value.trim(),
      opensubtitlesKey: $('#sOsKey').value.trim(), opensubtitlesUser: $('#sOsUser').value.trim(), opensubtitlesPass: $('#sOsPass').value,
      subtitleLanguages: $('#sLangs').value.toLowerCase().replace(/[^a-z,-]/g, '') || 'en', autoSubtitles: $('#sAutoSub').checked,
      defaultPlayer: $('#sPlayer').value, kmplayerPath: $('#sKmp').value.trim(), vlcPath: $('#sVlc').value.trim(), customPlayerPath: $('#sCustom').value.trim()
    });
    applyState(st); closeModal(); toast('Settings saved', 'ok');
  };
}

/* ---------- Flags ---------- */
function flagChips(pool, f) {
  const n = pool.filter(i => i.flag?.level).length;
  if (!n && f.flag === 'off') return '';
  const on = f.flag !== 'off';
  return `<div class="chips flag-chips" role="group" aria-label="Flags">
    <button class="chip" data-flagf="${on ? 'off' : 'all'}" aria-pressed="${on}">${icon('flag')}Flagged · ${n}</button>
    ${on ? Object.entries(FLAGS).map(([k, l]) => `<button class="chip p-${k}" data-flagf="${f.flag === k ? 'all' : k}" aria-pressed="${f.flag === k}"><i class="pdot"></i>${l}</button>`).join('') : ''}
  </div>`;
}
function openFlagMenu(id, anchor) {
  document.querySelector('.flag-menu')?.remove();
  const it = byId(id); if (!it) return;
  const cur = it.flag?.level || null;
  const menu = html(`<div class="flag-menu" role="menu">
    <small>Flag as</small>
    ${Object.entries(FLAGS).map(([k, l]) => `<button role="menuitemradio" aria-checked="${cur === k}" data-lv="${k}" class="p-${k}"><i class="pdot"></i>${l} priority${cur === k ? icon('check') : ''}</button>`).join('')}
    ${cur ? `<button data-lv="" class="clear">${icon('x')}Remove flag</button>` : ''}
  </div>`);
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.min(window.innerWidth - mw - 12, Math.max(12, r.left)) + 'px';
  menu.style.top = (r.bottom + mh + 8 > window.innerHeight ? r.top - mh - 8 : r.bottom + 8) + 'px';
  const close = () => { menu.remove(); document.removeEventListener('pointerdown', outside, true); };
  const outside = ev => { if (!menu.contains(ev.target)) close(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  menu.querySelectorAll('[data-lv]').forEach(b => b.onclick = async ev => {
    ev.stopPropagation();
    const lv = b.dataset.lv || null;
    close();
    const upd = await api.setFlag(id, lv);
    if (!upd) return;
    const i = S.allItems.findIndex(x => x.id === id); if (i >= 0) S.allItems[i] = upd;
    splitItems();
    if (S.detailId === id) openDetail(id, { keepSeason: +($('#detailLayer [data-season][aria-pressed="true"]')?.dataset.season) || undefined });
    const y = window.scrollY; render(); window.scrollTo(0, y);
    toast(lv ? `Flagged · ${FLAGS[lv]} priority` : 'Flag removed', 'ok');
  });
}

/* ---------- Hidden titles: PIN lock ---------- */
async function toggleHiddenTab() {
  const f = S.lib.movies;
  if (f.hidden && S.hiddenUnlocked) { f.hidden = false; S.hiddenUnlocked = false; return render(); }
  const { set } = await api.pinStatus();
  const ok = await pinFlow(set ? 'enter' : 'create');
  if (!ok) return;
  S.hiddenUnlocked = true; f.hidden = true; f.genre = 'All'; f.year = 'all'; render();
}
// mode: 'enter' | 'create' | 'change'. Resolves true when done.
function pinFlow(mode) {
  return new Promise(res => {
    let settled = false;
    const resolve = v => { if (!settled) { settled = true; res(v); } };
    let step = mode === 'change' ? 'old' : mode === 'create' ? 'new' : 'enter', oldPin = '', first = '';
    const title = () => ({ enter: 'Enter your PIN', old: 'Enter your current PIN', new: mode === 'change' ? 'Choose a new PIN' : 'Create a PIN for Hidden', confirm: 'Type it again' })[step];
    const sub = () => step === 'new' ? '4 to 8 digits. You\'ll need it every time you open Hidden.' : step === 'enter' ? 'Hidden titles are locked.' : '';
    const m = openModal(`<div class="modal-head"><h2 id="pinT"></h2><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body pin-body"><p class="hint" id="pinS"></p>
        <input class="input pin-input" id="pinIn" type="password" inputmode="numeric" maxlength="8" autocomplete="off" aria-label="PIN">
        <p class="err" id="pinE" hidden></p>
        <div class="pin-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, '✓'].map(k => `<button class="pin-k" data-k="${k}">${k}</button>`).join('')}</div>
      </div>`, () => resolve(false));
    m.classList.add('pin-modal');
    const inp = $('#pinIn', m), err = $('#pinE', m);
    const paint = () => { $('#pinT', m).textContent = title(); $('#pinS', m).textContent = sub(); inp.value = ''; inp.focus(); };
    const fail = msg => { err.hidden = false; err.textContent = msg; inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake'); inp.value = ''; };
    const done = v => { resolve(v); closeModal(); };
    const submit = async () => {
      const v = inp.value.trim(); err.hidden = true;
      if (!/^\d{4,8}$/.test(v)) return fail('Use 4 to 8 numbers');
      if (step === 'enter') return (await api.pinCheck(v)) ? done(true) : fail('Wrong PIN');
      if (step === 'old') { if (!(await api.pinCheck(v))) return fail('Wrong PIN'); oldPin = v; step = 'new'; return paint(); }
      if (step === 'new') { first = v; step = 'confirm'; return paint(); }
      if (step === 'confirm') {
        if (v !== first) { step = 'new'; paint(); return fail('Those didn\'t match. Try again'); }
        const ok = await api.pinSet(v, oldPin);
        if (!ok) return fail('Could not save the PIN');
        toast(mode === 'change' ? 'PIN changed' : 'PIN set', 'ok'); return done(true);
      }
    };
    $$('[data-close]', m).forEach(b => b.onclick = () => done(false));
    $$('[data-k]', m).forEach(b => b.onclick = () => {
      const k = b.dataset.k;
      if (k === '⌫') inp.value = inp.value.slice(0, -1); else if (k === '✓') submit(); else if (inp.value.length < 8) inp.value += k;
      inp.focus();
    });
    inp.onkeydown = e => { if (e.key === 'Enter') submit(); };
    paint();
  });
}

/* Settings → Library: counts, what's not showing and why */
function libraryReportHtml() {
  const movies = S.items.filter(i => i.type === 'movie'), shows = S.items.filter(i => i.type === 'tv');
  const eps = shows.reduce((n, i) => n + Object.keys(i.episodes || {}).length, 0);
  const rep = S.scanReport;
  const busy = S.items.filter(i => i.metaStatus === 'pending').length;
  const unmatched = S.items.filter(i => i.metaStatus === 'notfound' || i.metaStatus === 'error');
  const problems = (rep?.skipped || []).filter(x => !x.intended), intended = (rep?.skipped || []).filter(x => x.intended);
  const group = list => { const g = {}; for (const x of list) (g[x.reason] ||= []).push(x.path); return g; };
  const listHtml = g => Object.entries(g).map(([reason, list]) => `<div class="skip-group"><b>${esc(reason)} · ${list.length}</b>${list.slice(0, 40).map(pth => `<div class="skip-row"><code title="${esc(pth)}">${esc(pth)}</code><button class="btn quiet sm" data-reveal="${esc(pth)}">${icon('folder', 'sm')}Show</button></div>`).join('')}${list.length > 40 ? `<small class="hint-s">…and ${list.length - 40} more</small>` : ''}</div>`).join('');
  const probN = rep?.skippedCount ?? problems.length, intN = rep?.intendedCount ?? intended.length;
  const when = rep?.at ? new Date(rep.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null;
  return `<section class="group"><h3>What's in your library</h3>${when ? `<p class="hint">Last checked ${esc(when)}${busy ? ` · still matching ${busy} title${busy > 1 ? 's' : ''}…` : ''}</p>` : ''}
    <div class="lib-stats">
      <div><b>${movies.length}</b><small>Movies</small></div>
      <div><b>${shows.length}</b><small>TV shows</small></div>
      <div><b>${eps}</b><small>Episodes</small></div>
      <div class="${probN + unmatched.length ? 'warn' : 'ok'}"><b>${probN + unmatched.length}</b><small>${probN + unmatched.length ? 'Need your attention' : 'Problems'}</small></div>
    </div>
    ${unmatched.length ? `<details class="more"><summary>Couldn't identify (${unmatched.length}) <span class="hint-s">· showing with the file name, no poster</span></summary>
      <p class="hint-s" style="margin-top:10px">Usually the file name is too different from the real title. Click Fix match and search the right name once.</p>
      <div class="skip-list">${unmatched.map(i => `<div class="skip-row"><div><b>${esc(i.title)}${i.year ? ` (${i.year})` : ''}</b><code>${esc((i.files?.[0] || i.root || '').split(/[\\/]/).slice(-2).join('/'))}</code></div><button class="btn ghost sm" data-fix="${esc(i.id)}">${icon('wand')}Fix match</button></div>`).join('')}</div></details>` : ''}
    ${probN ? `<details class="more"><summary>Can't be played (${probN}) <span class="hint-s">· unfinished, disc images, archives, locked folders</span></summary>
      <div class="skip-list">${listHtml(group(problems))}</div></details>` : ''}
    ${intN ? `<details class="more quiet"><summary>Skipped on purpose (${intN}) <span class="hint-s">· samples, trailers and bonus features</span></summary>
      <div class="skip-list">${listHtml(group(intended))}</div></details>` : ''}
    ${!probN && !unmatched.length && rep ? `<p class="hint-s" style="color:var(--ok)">Everything in your folders is showing ✓${busy ? ' (a few titles are still being matched)' : ''}</p>` : ''}
  </section>`;
}

function openFixMatch(it) {
  let type = it.type;
  const m = openModal(`
    <div class="modal-head"><h2>Fix match</h2><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <p class="hint" style="color:var(--text-3)">File: <code style="font-size:13px">${esc((it.files?.[0] || it.root || '').split(/[\\/]/).pop())}</code></p>
      <div class="field"><span>Search for the right title</span>
        <div class="input-row"><input class="input" id="fmQ" value="${esc(it.title + (it.year ? ' ' + it.year : ''))}" spellcheck="false"><button class="btn primary sm" id="fmGo">${icon('search')}Search</button></div>
        <small>Add the year to narrow it down, e.g. “Dune 2021”</small></div>
      <div class="seasons" role="group" aria-label="Type"><button class="chip" data-t="movie" aria-pressed="${type === 'movie'}">Movie</button><button class="chip" data-t="tv" aria-pressed="${type === 'tv'}">TV show</button></div>
      <div id="fmRes" class="results"></div>
    </div>`);
  $$('[data-close]', m).forEach(b => b.onclick = closeModal);
  $$('[data-t]', m).forEach(b => b.onclick = () => { type = b.dataset.t; $$('[data-t]', m).forEach(x => x.setAttribute('aria-pressed', String(x === b))); search(); });
  const search = async () => {
    const box = $('#fmRes');
    if (!hasKey('tmdbKey')) { box.innerHTML = '<p class="err">Add your TMDB key in Settings first.</p>'; return; }
    box.innerHTML = Array.from({ length: 6 }, () => '<div class="result"><div class="poster"><div class="fallback loading"></div></div></div>').join('');
    try {
      const res = await api.searchTmdb($('#fmQ').value, type);
      box.innerHTML = res.length ? res.map(r => `<button class="result" data-tm="${r.tmdbId}"><div class="poster">${r.poster ? `<img src="${esc(r.poster)}" alt="">` : `<div class="fallback" style="--h:${hueOf(r.title)}"><b style="font-size:18px">${esc(r.title)}</b></div>`}</div><b>${esc(r.title)}</b><small>${esc(r.year || '—')}</small></button>`).join('') : '<p class="hint">No results. Try a shorter title.</p>';
      $$('[data-tm]', box).forEach(b => b.onclick = async () => {
        b.style.opacity = .5;
        await api.fixMatch(it.id, +b.dataset.tm, type);
        closeModal(); toast('Match updated', 'ok');
      });
    } catch (e) { box.innerHTML = `<p class="err">${esc(cleanErr(e))}</p>`; }
  };
  $('#fmGo').onclick = search;
  $('#fmQ').onkeydown = e => { if (e.key === 'Enter') search(); };
  search();
}

/* ================= Live updates ================= */
function applyState(st) {
  window.__players = st.players;
  document.body.classList.toggle('reduce-motion', !!st.settings?.reduceMotion);
  document.body.classList.toggle('no-hero-auto', st.settings?.heroAutoplay === false);
  Object.assign(S, { allItems: st.items, progress: st.progress, settings: st.settings, builtIn: st.builtIn || [], scanReport: st.scanReport || null, players: st.players, folders: st.folders, online: st.online });
  splitItems();
  render();
}
function refreshCards(id) {
  const it = byId(id); if (!it) return;
  $$(`.card[data-id="${CSS.escape(id)}"]`).forEach(c => {
    if (c.classList.contains('detail-poster')) { c.innerHTML = posterInner(it); return; }
    const n = html(cardHtml(it, +c.style.getPropertyValue('--i') || 0, c.classList.contains('land')));
    n.style.cssText = c.style.cssText;
    c.replaceWith(n);
  });
}

api.onLibrary(st => {
  const was = S.items.length; applyState(st);
  const now = S.items.length;
  if (now > was && was) toast(`${now - was} new title${now - was > 1 ? 's' : ''} added`, 'ok');
});
api.onItem(it => {
  const i = S.allItems.findIndex(x => x.id === it.id);
  if (i >= 0) S.allItems[i] = it; else S.allItems.push(it);
  const wasHidden = S.hiddenItems?.some(x => x.id === it.id);
  splitItems();
  if (wasHidden !== isHidden(it)) render();
  refreshCards(it.id);
  if (S.detailId === it.id) openDetail(it.id, { keepSeason: +($('#detailLayer [data-season][aria-pressed="true"]')?.dataset.season) || undefined });
});
let metaDoneT = 0;
api.onMetaProgress(p => {
  const st = $('#status');
  S.metaBusy = p.current != null;
  if (p.total && p.current != null) {
    st.hidden = false;
    st.innerHTML = `<span>Getting details · <span class="num">${p.done} of ${p.total}</span></span><span class="bar"><i style="transform:scaleX(${p.total ? p.done / p.total : 0})"></i></span>`;
  } else if (!st.hidden) {
    st.innerHTML = `${icon('check', 'sm')}<span>Library up to date</span>`;
    clearTimeout(metaDoneT);
    metaDoneT = setTimeout(() => { st.hidden = true; }, 1800);
    // Rebuild the page once everything has artwork, but only if it won't yank the user's scroll
    if (S.view !== 'home' || window.scrollY < 200) render();
  }
});
api.onScanStatus(s => {
  $('#refreshBtn').classList.toggle('spin', !!s.scanning);
  if (!s.scanning && s.added === 0 && s.removed === 0 && S.manualScan) toast('No changes found', 'ok');
});
$('#refreshBtn').addEventListener('click', () => { S.manualScan = true; setTimeout(() => S.manualScan = false, 8000); });
api.onToast(msg => toast(msg, /✓/.test(msg) ? 'ok' : ''));
api.onUpdate(u => {
  const pill = $('#updPill');
  if (pill) { pill.hidden = false; pill.dataset.state = u.state; pill.querySelector('span').textContent = u.state === 'ready' ? `Update ready · ${u.version}` : `Downloading ${u.version}…`; }
  if (u.state === 'downloading') toast(`Downloading Showtrove ${u.version} in the background…`);
  if (u.state === 'ready' && !document.querySelector('.update-bar')) {
    const bar = html(`<div class="update-bar" role="status"><span>Showtrove ${esc(u.version)} is ready</span><button class="btn small primary" type="button">Restart to update</button><button class="btn small ghost" type="button" aria-label="Later">Later</button></div>`);
    bar.querySelector('.primary').onclick = () => api.installUpdate();
    bar.querySelector('.ghost').onclick = () => bar.remove();
    document.body.append(bar);
  }
});
api.onOnline(on => { S.online = on; toast(on ? 'Back online. Updating details…' : 'You\'re offline. Everything saved still works.'); });
api.onFullscreen(fs => document.body.classList.toggle('fullscreen', fs));

// Player tells us progress changed → refresh cards
window.addEventListener('cv-progress', e => { S.progress[e.detail.file] = e.detail.p; });
window.addEventListener('cv-player-closed', () => { if (S.detailId) openDetail(S.detailId, { keepSeason: +($('#detailLayer [data-season][aria-pressed="true"]')?.dataset.season) || undefined }); render(); });

$('#updPill')?.addEventListener('click', () => { if ($('#updPill').dataset.state === 'ready') api.installUpdate(); else toast('Still downloading the update. It installs when it\'s ready.'); });

/* ================= Boot ================= */
(async () => {
  enableDragScroll(); enableTilt();
  const st0 = await api.getState();
  if (['movies', 'tv'].includes(st0.settings?.startView)) S.view = S.lastView = st0.settings.startView;
  applyState(st0);
  requestAnimationFrame(updateSwitch);
  document.fonts.ready.then(updateSwitch);
})();
