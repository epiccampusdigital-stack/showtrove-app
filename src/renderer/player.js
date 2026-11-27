/* Built-in player: KMPlayer-style shortcuts, subtitles (auto/online/file), sync, audio tracks, speed, resume, next episode. */
/* global $, $$, esc, icon, html, fmtTime, toast, api */

const Player = (() => {
  let L, v, ctx, data, hideT, saveT, subOffset = 0, subSize = 30, menu = null, nextT = 0, audioCheckT = 0;
  let curSub = -1, subs = [];
  // Converted playback (ffmpeg): txs = { mode: 'audio'|'full', offset, audio } ; info = probe result
  let txs = null, info = null, resumed = false, seekPending = null;
  const T = () => (txs ? txs.offset : 0) + (v?.currentTime || 0);
  const D = () => txs ? (info?.duration || 0) : ((isFinite(v?.duration) && v.duration) || info?.duration || 0);
  function seekTo(t) {
    const d = D(); t = Math.max(0, d ? Math.min(d - 1, t) : t);
    if (txs) startTx(txs.mode, t, txs.audio); else v.currentTime = t;
  }
  function startTx(mode, at = T(), audio = txs ? txs.audio : 0) {
    if (!info?.canConvert) return false;
    txs = { mode, offset: at, audio };
    spin(true);
    $('.pl-error')?.remove(); $('.pl-card')?.remove();
    v.src = `${info.txBase}?m=${mode}&ss=${at.toFixed(2)}&a=${audio}`;
    loadSubs();
    v.play().catch(() => {});
    return true;
  }

  const isOpen = () => L && !L.hidden;

  function open(d, c) {
    data = d; ctx = c; subs = d.subs || []; subOffset = 0; curSub = subs.length ? 0 : -1;
    txs = null; info = null; resumed = false; seekPending = null;
    L = $('#playerLayer');
    L.innerHTML = `
      <video id="pv" preload="auto" crossorigin="anonymous"></video>
      <div class="pl-spinner" id="plSpin"></div>
      <div class="pl-flash" id="plFlash"></div>
      <div class="pl-osd" id="plOsd"></div>
      <div class="pl-top"><button class="icon-btn" id="plBack" aria-label="Close player">${icon('left', 'lg')}</button><h2>${esc(d.title)}</h2></div>
      <div class="pl-bottom">
        <div class="seek" id="plSeek"><div class="rail"><div class="buf" id="plBuf"></div><div class="done" id="plDone"></div></div><div class="knob" id="plKnob"></div><div class="tip" id="plTip">0:00</div></div>
        <div class="pl-controls">
          <button class="icon-btn" id="plPlay" aria-label="Play or pause (Space)">${icon('pause')}</button>
          <button class="icon-btn" id="plB10" aria-label="Back 10 seconds (Left)">${icon('back10')}</button>
          <button class="icon-btn" id="plF10" aria-label="Forward 10 seconds (Right)">${icon('fwd10')}</button>
          <div class="vol"><button class="icon-btn" id="plMute" aria-label="Mute (M)">${icon('vol')}</button><input type="range" id="plVol" min="0" max="1" step="0.02" aria-label="Volume"></div>
          <span class="pl-time num" id="plTime">0:00 / 0:00</span>
          <span class="pl-spacer"></span>
          ${d.next ? `<button class="icon-btn" id="plNext" aria-label="Next episode (N)" title="Next episode">${icon('next')}</button>` : ''}
          <button class="icon-btn" id="plSubs" aria-label="Subtitles (S)" title="Subtitles">${icon('cc')}</button>
          <button class="icon-btn" id="plAudio" aria-label="Audio and speed" title="Audio and speed">${icon('gauge')}</button>
          <button class="icon-btn" id="plFull" aria-label="Full screen (F)">${icon('full')}</button>
        </div>
      </div>`;
    L.hidden = false;
    document.body.style.overflow = 'hidden';
    v = $('#pv');
    try { v.volume = +(localStorage.getItem('cv-vol') ?? 1); subSize = +(localStorage.getItem('cv-subsize') ?? 30); } catch { /* storage unavailable */ }
    L.style.setProperty('--sub-size', subSize + 'px');
    $('#plVol').value = v.volume;
    v.src = d.src;
    loadSubs();
    // Look inside the file: formats Chromium can't play get converted right away (no silent first seconds)
    api.probe(d.file).then(p => {
      info = p;
      if (!p?.canConvert || txs || !isOpen()) return;
      if (p.video && !p.videoOk && p.video.codec !== 'hevc') { osd('Converting this video so it plays here…', 3000); startTx('full', resumed ? T() : d.start || 0); }
      else if (!p.audioOk) { osd(`Converting ${p.audio[0]?.codec?.toUpperCase() || ''} sound…`, 2500); startTx('audio', resumed ? T() : d.start || 0); }
    }).catch(() => {});
    v.addEventListener('loadedmetadata', () => {
      if (d.start && !resumed && !txs) { v.currentTime = d.start; osd(`Resumed from ${fmtTime(d.start)}`); }
      resumed = true;
      v.play().catch(() => {});
      // HEVC/odd codecs: metadata loads but no picture
      const srcNow = v.src;
      setTimeout(() => { if (v.src === srcNow && v.videoWidth === 0 && !v.error && info?.video !== null) unsupported('video'); }, 2500);
    });
    v.addEventListener('playing', () => { spin(false); checkAudio(); });
    v.addEventListener('waiting', () => spin(true));
    v.addEventListener('play', () => setPlayIcon());
    v.addEventListener('pause', () => { setPlayIcon(); wake(); save(); });
    v.addEventListener('timeupdate', tick);
    v.addEventListener('progress', buffered);
    v.addEventListener('volumechange', () => { $('#plMute').innerHTML = icon(v.muted || v.volume === 0 ? 'mute' : 'vol'); $('#plVol').value = v.muted ? 0 : v.volume; try { localStorage.setItem('cv-vol', v.volume); } catch { /* ignore */ } });
    v.addEventListener('ended', ended);
    v.addEventListener('error', () => unsupported('file'));
    v.addEventListener('click', () => { if (menu) return closeMenu(); toggle(); });
    v.addEventListener('dblclick', () => api.toggleFullscreen());

    $('#plBack').onclick = close;
    $('#plPlay').onclick = toggle;
    $('#plB10').onclick = () => skip(-10);
    $('#plF10').onclick = () => skip(10);
    $('#plMute').onclick = () => { v.muted = !v.muted; };
    $('#plVol').oninput = e => { v.muted = false; v.volume = +e.target.value; };
    $('#plFull').onclick = () => api.toggleFullscreen();
    $('#plSubs').onclick = e => { e.stopPropagation(); menu?.dataset.kind === 'subs' ? closeMenu() : subsMenu(); };
    $('#plAudio').onclick = e => { e.stopPropagation(); menu?.dataset.kind === 'audio' ? closeMenu() : audioMenu(); };
    $('#plNext') && ($('#plNext').onclick = playNext);
    bindSeek();
    L.addEventListener('mousemove', wake);
    addEventListener('keydown', keys, true);
    wake();
  }

  /* ---------- Subtitles ---------- */
  function loadSubs() {
    $$('track', v).forEach(t => t.remove());
    subs.forEach((s, i) => {
      const t = document.createElement('track');
      t.kind = 'subtitles'; t.label = s.label; t.srclang = s.lang || 'und'; t.src = s.url;
      v.append(t);
      t.addEventListener('load', () => applyOffset(t.track, subOffset, true));
      if (i === curSub) t.default = true;
    });
    setTimeout(selectSub.bind(null, curSub), 50);
  }
  function selectSub(i) {
    curSub = i;
    [...v.textTracks].forEach((t, k) => { t.mode = k === i ? 'showing' : 'disabled'; });
    $('#plSubs')?.classList.toggle('on', i >= 0);
  }
  function applyOffset(track, delta, fresh) {
    if (!track?.cues) return;
    const d = fresh ? subOffset - (txs ? txs.offset : 0) : delta;
    if (!d) return;
    for (const c of [...track.cues]) { c.startTime = Math.max(0, c.startTime + d); c.endTime = Math.max(0, c.endTime + d); }
  }
  function shiftSubs(delta) {
    subOffset = Math.round((subOffset + delta) * 10) / 10;
    [...v.textTracks].forEach(t => applyOffset(t, delta));
    osd(`Subtitle delay ${subOffset > 0 ? '+' : ''}${subOffset.toFixed(1)}s`);
    if (menu?.dataset.kind === 'subs') subsMenu();
  }
  function sizeSubs(delta) {
    subSize = Math.max(16, Math.min(64, subSize + delta));
    L.style.setProperty('--sub-size', subSize + 'px');
    try { localStorage.setItem('cv-subsize', subSize); } catch { /* ignore */ }
    osd(`Subtitle size ${subSize}`);
    if (menu?.dataset.kind === 'subs') subsMenu();
  }
  async function findOnline() {
    closeMenu(); osd('Searching OpenSubtitles…', 4000);
    try {
      const found = await api.findSubtitles({ id: ctx.id, season: ctx.season, episode: ctx.episode });
      const before = subs.length;
      subs = found; curSub = Math.max(0, found.length - 1);
      loadSubs();
      osd(found.length > before ? 'Subtitles downloaded ✓' : 'No new subtitles found');
    } catch (e) { osd(String(e.message || e).replace(/^.*?Error: /, '')); }
  }
  async function loadFile() {
    closeMenu();
    const s = await api.addSubtitleFile(data.file);
    if (s) { subs.push(s); curSub = subs.length - 1; loadSubs(); osd(`Loaded ${s.label}`); }
  }

  /* ---------- Menus ---------- */
  function openMenu(kind, inner) {
    closeMenu();
    menu = html(`<div class="pl-menu" data-kind="${kind}">${inner}</div>`);
    menu.addEventListener('click', e => e.stopPropagation());
    L.append(menu);
    setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
  }
  function closeMenu() { menu?.remove(); menu = null; }
  function subsMenu() {
    openMenu('subs', `<h4>Subtitles</h4>
      <button class="opt ${curSub < 0 ? 'sel' : ''}" data-s="-1">${icon('check')}Off</button>
      ${subs.map((s, i) => `<button class="opt ${i === curSub ? 'sel' : ''}" data-s="${i}">${icon('check')}<span>${esc(s.label)}</span></button>`).join('')}
      <button class="opt" data-a="online">${icon('search')}Find subtitles online</button>
      <button class="opt" data-a="file">${icon('folder')}Load from file…</button>
      <h4>Sync and size</h4>
      <div class="stepper"><span>Delay</span><div><button data-d="-0.5" aria-label="Earlier">−</button><output class="num">${subOffset > 0 ? '+' : ''}${subOffset.toFixed(1)}s</output><button data-d="0.5" aria-label="Later">+</button></div></div>
      <div class="stepper"><span>Size</span><div><button data-z="-2" aria-label="Smaller">−</button><output class="num">${subSize}</output><button data-z="2" aria-label="Bigger">+</button></div></div>`);
    menu.onclick = e => {
      e.stopPropagation();
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.s !== undefined) { selectSub(+b.dataset.s); subsMenu(); }
      if (b.dataset.a === 'online') findOnline();
      if (b.dataset.a === 'file') loadFile();
      if (b.dataset.d) shiftSubs(+b.dataset.d);
      if (b.dataset.z) sizeSubs(+b.dataset.z);
    };
  }
  function audioMenu() {
    const native = !txs && v.audioTracks && v.audioTracks.length > 1;
    const at = native ? [...v.audioTracks] : [];
    const ft = !native && info?.audio?.length > 1 && info.canConvert ? info.audio : [];
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    openMenu('audio', `
      ${at.length > 1 ? `<h4>Audio</h4>${at.map((t, i) => `<button class="opt ${t.enabled ? 'sel' : ''}" data-at="${i}">${icon('check')}${esc(t.label || t.language || 'Track ' + (i + 1))}</button>`).join('')}` : ''}
      ${ft.length ? `<h4>Audio</h4>${ft.map(t => `<button class="opt ${(txs ? txs.audio : 0) === t.index ? 'sel' : ''}" data-ft="${t.index}">${icon('check')}${esc(t.label || 'Track ' + (t.index + 1))}</button>`).join('')}` : ''}
      <h4>Speed</h4>${speeds.map(s => `<button class="opt ${v.playbackRate === s ? 'sel' : ''}" data-sp="${s}">${icon('check')}<span class="num">${s === 1 ? 'Normal' : s + '×'}</span></button>`).join('')}
      <h4>Something wrong?</h4><button class="opt" data-ext="1">${icon('external')}Open in another player</button>`);
    menu.onclick = e => {
      e.stopPropagation();
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.at) { at.forEach((t, i) => { t.enabled = i === +b.dataset.at; }); audioMenu(); }
      if (b.dataset.ft !== undefined) { closeMenu(); osd('Switching audio…'); startTx(txs ? txs.mode : 'audio', T(), +b.dataset.ft); }
      if (b.dataset.sp) { v.playbackRate = +b.dataset.sp; osd(`Speed ${v.playbackRate}×`); audioMenu(); }
      if (b.dataset.ext) { closeMenu(); handOff(); }
    };
  }

  /* ---------- Transport ---------- */
  function toggle() { if (v.paused) v.play(); else v.pause(); flash(v.paused ? 'pause' : 'play'); }
  function skip(s) { const to = Math.max(0, T() + s); seekTo(to); osd(`${s > 0 ? '+' : '−'}${Math.abs(s)}s · ${fmtTime(to)}`); }
  function setPlayIcon() { const b = $('#plPlay'); if (b) b.innerHTML = icon(v.paused ? 'play' : 'pause'); }
  function spin(on) { const s = $('#plSpin'); if (s) s.hidden = !on; }
  function flash(name) { const f = $('#plFlash'); f.innerHTML = icon(name); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
  let osdT = 0;
  function osd(msg, ms = 1400) { const o = $('#plOsd'); if (!o) return; o.textContent = msg; o.classList.add('on'); clearTimeout(osdT); osdT = setTimeout(() => o.classList.remove('on'), ms); }
  function wake() {
    L.classList.remove('idle'); clearTimeout(hideT);
    hideT = setTimeout(() => { if (!v.paused && !menu) L.classList.add('idle'); }, 2600);
  }
  function tick() {
    if (!isOpen() || !$('#plDone')) return;
    const d = D(), t = seekPending ?? T();
    $('#plDone').style.transform = `scaleX(${d ? t / d : 0})`;
    $('#plKnob').style.left = `${d ? (t / d) * 100 : 0}%`;
    $('#plTime').textContent = `${fmtTime(t)} / ${fmtTime(d)}`;
    if (!saveT) saveT = setTimeout(() => { saveT = 0; save(); }, 5000);
    if (data.next && d && d - t < 25 && d - t > 1 && !$('.pl-card')) upNext(false);
  }
  function buffered() {
    if (!isOpen() || !$('#plBuf')) return;
    const b = v.buffered, d = D(); if (!b.length || !d) return;
    $('#plBuf').style.transform = `scaleX(${Math.min(1, ((txs ? txs.offset : 0) + b.end(b.length - 1)) / d)})`;
  }
  function save() {
    const dur = v ? D() : 0;
    if (!dur) return;
    const p = { pos: T(), dur, at: Date.now() };
    api.saveProgress({ file: data.file, ...p });
    window.dispatchEvent(new CustomEvent('cv-progress', { detail: { file: data.file, p } }));
  }
  function bindSeek() {
    const el = $('#plSeek'), tip = $('#plTip');
    const at = x => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); };
    el.addEventListener('mousemove', e => { const f = at(e.clientX); tip.textContent = fmtTime(f * D()); tip.style.left = f * 100 + '%'; });
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId); el.classList.add('drag');
      // Converted files restart the converter on seek, so only jump when the drag ends
      const move = ev => { const t = at(ev.clientX) * D(); if (txs) { seekPending = t; tick(); } else { v.currentTime = t; tick(); } };
      move(e);
      el.onpointermove = move;
      el.onpointerup = () => { el.onpointermove = null; el.classList.remove('drag'); if (seekPending != null) { const t = seekPending; seekPending = null; seekTo(t); } };
    });
  }
  function keys(e) {
    if (!isOpen() || e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    const k = e.key.toLowerCase();
    const map = {
      ' ': toggle, k: toggle, enter: () => api.toggleFullscreen(),
      arrowleft: () => skip(e.shiftKey ? -60 : e.ctrlKey ? -30 : -10), arrowright: () => skip(e.shiftKey ? 60 : e.ctrlKey ? 30 : 10),
      arrowup: () => { v.volume = Math.min(1, v.volume + 0.05); osd(`Volume ${Math.round(v.volume * 100)}%`); },
      arrowdown: () => { v.volume = Math.max(0, v.volume - 0.05); osd(`Volume ${Math.round(v.volume * 100)}%`); },
      m: () => { v.muted = !v.muted; osd(v.muted ? 'Muted' : 'Sound on'); },
      f: () => api.toggleFullscreen(),
      s: () => { const n = curSub + 1 >= subs.length ? -1 : curSub + 1; selectSub(n); osd(n < 0 ? 'Subtitles off' : subs[n].label); },
      ',': () => shiftSubs(-0.1), '.': () => shiftSubs(0.1),
      '[': () => { v.playbackRate = Math.max(0.25, +(v.playbackRate - 0.1).toFixed(2)); osd(`Speed ${v.playbackRate}×`); },
      ']': () => { v.playbackRate = Math.min(3, +(v.playbackRate + 0.1).toFixed(2)); osd(`Speed ${v.playbackRate}×`); },
      backspace: () => { v.playbackRate = 1; osd('Speed normal'); },
      '=': () => sizeSubs(2), '-': () => sizeSubs(-2),
      n: () => data.next && playNext(),
      escape: () => { if (menu) return closeMenu(); if (document.body.classList.contains('fullscreen')) api.setFullscreen(false); else close(); }
    };
    if (map[k]) { e.preventDefault(); e.stopPropagation(); map[k](); wake(); }
  }

  /* ---------- Problems & hand-off ---------- */
  function checkAudio() {
    clearTimeout(audioCheckT);
    if (txs) return;
    // AC3 / DTS audio in MKV: picture plays, sound doesn't
    audioCheckT = setTimeout(() => {
      if (!v || v.paused || v.muted) return;
      const hasTracks = v.audioTracks ? v.audioTracks.length > 0 : true;
      if (hasTracks && v.webkitAudioDecodedByteCount === 0 && v.currentTime > 2) {
        if (!txs && info?.canConvert && info.audio?.length) { osd('Fixing the sound…', 2500); startTx('audio'); return; }
        card(`<b>No sound?</b><p>This file's audio format (often AC3 or DTS) isn't supported by the built-in player. KMPlayer or VLC will play it with sound.</p>
          <div class="row-btns"><button class="btn primary sm" data-h="1">${icon('external')}Continue in another player</button><button class="btn quiet sm" data-x>Keep watching</button></div>`);
      }
    }, 3500);
  }
  async function unsupported(what) {
    if ($('.pl-error')) return;
    if (!info) info = await api.probe(data.file).catch(() => null);
    if (info?.canConvert && (!txs || txs.mode !== 'full')) { osd('Converting this video so it plays here…', 3000); startTx('full'); return; }
    spin(false);
    const box = html(`<div class="pl-error"><div>
      <h2>This file needs a different player</h2>
      <p>The built-in player can't decode this ${what === 'video' ? 'video format (often HEVC/x265)' : 'file'}. It will play in KMPlayer or VLC, and your subtitles go with it.</p>
      <div class="row-btns" id="plAlt"></div></div></div>`);
    L.append(box);
    const players = (window.__players || []).filter(p => p.id !== 'builtin');
    $('#plAlt').innerHTML = players.map((p, i) => `<button class="btn ${i === 0 ? 'primary' : 'ghost'}" data-pl="${p.id}">${icon('external')}Open in ${esc(p.name)}</button>`).join('') + `<button class="btn quiet" data-close>Go back</button>`;
    box.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.close !== undefined) return close();
      launchExternal(b.dataset.pl);
    };
  }
  function handOff() {
    const players = (window.__players || []).filter(p => p.id !== 'builtin');
    card(`<b>Continue in…</b><p>Picks up at ${fmtTime(v.currentTime)}.</p><div class="row-btns">${players.map((p, i) => `<button class="btn ${i === 0 ? 'primary' : 'ghost'} sm" data-pl="${p.id}">${esc(p.name)}</button>`).join('')}</div>`);
  }
  async function launchExternal(pl) {
    save();
    try {
      await api.play({ id: ctx.id, season: ctx.season, episode: ctx.episode, playerId: pl, skipSubs: true });
      close();
    } catch (e) { toast(String(e.message || e).replace(/^.*?Error: /, '')); }
  }
  function card(inner) {
    $('.pl-card')?.remove();
    const c = html(`<div class="pl-card">${inner}</div>`);
    c.onclick = e => {
      e.stopPropagation();
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.x !== undefined) c.remove();
      if (b.dataset.h) { c.remove(); handOff(); }
      if (b.dataset.pl) launchExternal(b.dataset.pl);
      if (b.dataset.next !== undefined) playNext();
    };
    L.append(c);
    return c;
  }

  /* ---------- Next episode ---------- */
  function upNext(auto) {
    const n = data.next; if (!n) return;
    const m = ctx.item.meta?.seasons?.[n.season]?.episodes?.[n.episode];
    card(`<b>Up next · S${n.season} E${n.episode}</b>${m?.title ? `<p>${esc(m.title)}</p>` : ''}
      <div class="row-btns"><button class="btn primary sm ${auto && S.settings?.autoNext !== false ? 'count' : ''}" data-next>${icon('play')}Play next episode</button><button class="btn quiet sm" data-x>Not now</button></div>`);
    if (auto && S.settings?.autoNext !== false) { clearTimeout(nextT); nextT = setTimeout(playNext, 8000); }
  }
  function ended() {
    save();
    if (data.next) upNext(true);
    else { osd('The end', 2500); setTimeout(close, 2500); }
  }
  async function playNext() {
    clearTimeout(nextT);
    const n = data.next; save();
    try {
      const r = await api.play({ id: ctx.id, season: n.season, episode: n.episode, playerId: 'builtin' });
      teardown(false);
      open(r, { ...ctx, season: n.season, episode: n.episode });
    } catch (e) { toast(String(e.message || e)); }
  }

  /* ---------- Close ---------- */
  function teardown(hide = true) {
    save();
    api.stopConvert?.(); txs = null;
    clearTimeout(hideT); clearTimeout(nextT); clearTimeout(audioCheckT); clearTimeout(saveT); saveT = 0;
    removeEventListener('keydown', keys, true);
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    closeMenu();
    if (hide) { L.hidden = true; L.innerHTML = ''; document.body.style.overflow = $('#detailLayer').hidden ? '' : 'hidden'; }
  }
  function close() {
    teardown(true);
    api.setFullscreen(false);
    window.dispatchEvent(new Event('cv-player-closed'));
  }

  return { open, close, isOpen };
})();
