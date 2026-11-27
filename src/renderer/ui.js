// Small UI helpers shared by app.js and player.js
/* eslint-disable no-unused-vars */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function icon(name, cls = '') { return `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`; }
function img(name) { return name ? `cv://img/${encodeURIComponent(name)}` : ''; }
function html(str) { const t = document.createElement('template'); t.innerHTML = str.trim(); return t.content.firstElementChild; }

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
function fmtRuntime(min) { if (!min) return ''; const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h ${m}m` : `${m}m`; }
function hueOf(str) { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

/* Pull an ambient colour from a poster (the "light from the screen") */
const ambCache = new Map();
function ambientFrom(name) {
  if (!name) return Promise.resolve(null);
  if (ambCache.has(name)) return ambCache.get(name);
  const p = new Promise(res => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = 24; c.height = 36;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(im, 0, 0, 24, 36);
        const d = g.getImageData(0, 0, 24, 36).data;
        let best = null, bestScore = -1;
        const buckets = {};
        for (let i = 0; i < d.length; i += 4) {
          const [r, gg, b] = [d[i], d[i + 1], d[i + 2]];
          const max = Math.max(r, gg, b), min = Math.min(r, gg, b), sat = max ? (max - min) / max : 0;
          if (max < 40) continue;
          const key = `${r >> 5},${gg >> 5},${b >> 5}`;
          const bk = buckets[key] || (buckets[key] = { r: 0, g: 0, b: 0, n: 0, sat: 0 });
          bk.r += r; bk.g += gg; bk.b += b; bk.n++; bk.sat += sat;
        }
        for (const bk of Object.values(buckets)) {
          const score = bk.n * (0.25 + bk.sat / bk.n);
          if (score > bestScore) { bestScore = score; best = bk; }
        }
        if (!best) return res(null);
        let r = best.r / best.n, gg = best.g / best.n, b = best.b / best.n;
        // push saturation so the glow reads as light, not mud
        const avg = (r + gg + b) / 3; r = avg + (r - avg) * 1.5; gg = avg + (gg - avg) * 1.5; b = avg + (b - avg) * 1.5;
        const cl = v => Math.max(0, Math.min(255, Math.round(v)));
        res(`rgb(${cl(r)} ${cl(gg)} ${cl(b)})`);
      } catch { res(null); }
    };
    im.onerror = () => res(null);
    im.src = img(name);
  });
  ambCache.set(name, p);
  return p;
}

/* ---------- Pieces ---------- */
function posterInner(item, { loading } = {}) {
  const m = item.meta;
  if (m?.poster) return `<img src="${img(m.poster)}" alt="" loading="lazy" decoding="async">`;
  const t = m?.title || item.title;
  const yr = m?.year || item.year;
  const sub = loading ? 'Finding details…' : [yr, item.type === 'tv' ? 'Series' : ''].filter(Boolean).join(' · ');
  return `<div class="fallback ${loading ? 'loading' : ''}" style="--h:${hueOf(t)}"><b>${esc(t)}</b><small>${esc(sub)}</small></div>`;
}

function ratingValue(item) {
  const m = item.meta || {};
  const v = parseFloat(m.imdbRating) || m.tmdbRating;
  return v ? Number(v).toFixed(1) : null;
}

function ratingsHtml(m) {
  if (!m) return '';
  const r = [];
  if (m.imdbRating) r.push(`<span class="rating" title="IMDb${m.imdbVotes ? ' · ' + esc(m.imdbVotes) + ' votes' : ''}"><span class="src imdb">IMDb</span>${esc(m.imdbRating)}<small>/10</small></span>`);
  if (m.rottenTomatoes) r.push(`<span class="rating" title="Rotten Tomatoes critics score"><span class="src rt">RT</span>${esc(m.rottenTomatoes)}</span>`);
  if (m.metacritic) r.push(`<span class="rating" title="Metacritic"><span class="src mc">MC</span>${esc(m.metacritic.split('/')[0])}</span>`);
  if (m.tmdbRating) r.push(`<span class="rating" title="TMDB user score"><span class="src tmdb">TMDB</span>${esc(m.tmdbRating)}</span>`);
  return r.length ? `<div class="ratings">${r.join('')}</div>` : '';
}

function metaLine(item) {
  const m = item.meta || {};
  const bits = [];
  const yr = m.year || item.year;
  if (yr) bits.push(`<span>${yr}</span>`);
  if (item.type === 'tv') {
    const n = m.numberOfSeasons || new Set(Object.values(item.episodes).map(e => e.season)).size;
    bits.push(`<span class="dot">${n} season${n === 1 ? '' : 's'}</span>`);
  } else if (m.runtime) bits.push(`<span class="dot">${fmtRuntime(m.runtime)}</span>`);
  if (m.certification) bits.push(`<span class="cert">${esc(m.certification)}</span>`);
  if (m.genres?.length) bits.push(`<span class="dot">${esc(m.genres.slice(0, 3).join(', '))}</span>`);
  return `<div class="meta-line">${bits.join('')}</div>`;
}

let toastTimer = 0;
function toast(msg, kind = '') {
  const box = $('#toasts');
  const last = box.lastElementChild;
  if (last && last.dataset.msg === msg) return;
  const el = html(`<div class="toast ${kind}" data-msg="${esc(msg)}">${kind === 'ok' ? icon('check') : ''}<span>${esc(msg)}</span></div>`);
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => { el.classList.add('bye'); setTimeout(() => el.remove(), 220); }, 3600);
}

/* ---------- Swipe: click-and-drag any horizontal row, with momentum ---------- */
function enableDragScroll() {
  const SEL = '.row, .shelf, .spot-track, .chips, .cast, .seasons';
  let st = null, suppress = false;
  document.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const el = e.target.closest(SEL); if (!el || el.scrollWidth <= el.clientWidth) return;
    st = { el, x: e.clientX, left: el.scrollLeft, moved: false, v: 0, lastX: e.clientX, lastT: performance.now() };
  });
  addEventListener('pointermove', e => {
    if (!st) return;
    const dx = e.clientX - st.x;
    if (!st.moved && Math.abs(dx) < 6) return;
    if (!st.moved) { st.moved = true; st.el.classList.add('dragging'); }
    st.el.scrollLeft = st.left - dx;
    const now = performance.now(), dt = Math.max(1, now - st.lastT);
    st.v = 0.8 * ((st.lastX - e.clientX) / dt) + 0.2 * st.v; st.lastX = e.clientX; st.lastT = now;
  });
  addEventListener('pointerup', () => {
    if (!st) return;
    const { el, moved } = st; let v = st.v * 16; st = null;
    if (!moved) return;
    suppress = true; setTimeout(() => { suppress = false; }, 0);
    const glide = () => {
      if (Math.abs(v) < 0.4 || reduceMotion.matches) { el.classList.remove('dragging'); el.dispatchEvent(new Event('scroll')); return; }
      el.scrollLeft += v; v *= 0.94; requestAnimationFrame(glide);
    };
    requestAnimationFrame(glide);
  });
  // A drag shouldn't also count as a click on the card under the cursor
  document.addEventListener('click', e => { if (suppress) { e.stopPropagation(); e.preventDefault(); suppress = false; } }, true);
  // Mouse wheel over a row: vertical wheel keeps scrolling the page; horizontal trackpad swipes scroll the row (native)
}

/* ---------- Apple TV tilt: cards lean toward the cursor and catch the light ---------- */
function enableTilt() {
  if (reduceMotion.matches) return;
  let cur = null;
  const SEL = '.card:not(.detail-poster), .tile, .wide-card';
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target.closest(SEL);
    if (cur && cur !== el) { cur.classList.remove('tilting'); cur.style.removeProperty('--rx'); cur.style.removeProperty('--ry'); cur = null; }
    if (!el || el.closest('.dragging')) return;
    const p = el.querySelector('.poster, .shot'); if (!p) return;
    if (!p.querySelector('.sheen')) { p.insertAdjacentHTML('beforeend', '<span class="sheen"></span>'); el.classList.add('tiltable'); }
    const r = p.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', ((x - 0.5) * 10).toFixed(2) + 'deg');
    el.style.setProperty('--rx', ((0.5 - y) * 10).toFixed(2) + 'deg');
    el.style.setProperty('--gx', (x * 100).toFixed(1) + '%');
    el.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
    el.classList.add('tilting'); cur = el;
  }, { passive: true });
  document.addEventListener('pointerleave', () => { cur?.classList.remove('tilting'); cur = null; });
}
