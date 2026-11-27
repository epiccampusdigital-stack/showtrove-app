// Drives the app and saves screenshots. Run: CV_HOOK=$PWD/test/shoot-hook.js CV_SHOTS=/tmp/shots electron .
const fs = require('fs'), path = require('path');
module.exports = (win, app) => {
  const out = process.env.CV_SHOTS; fs.mkdirSync(out, { recursive: true });
  const wc = win.webContents;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const js = c => wc.executeJavaScript(c).catch(e => console.log('JS ERR', e.message));
  const shot = async n => { const im = await wc.capturePage(); fs.writeFileSync(path.join(out, n + '.png'), im.toPNG()); console.log('shot', n); };
  wc.on('console-message', (_e, lvl, msg) => { if (lvl >= 2) console.log('RENDERER:', msg); });
  wc.once('did-finish-load', async () => {
    win.setSize(1440, 900);
    await wait(3500); await shot('01-home');
    await js('setHero(3, {manual:true})'); await wait(1600); await shot('01b-shelf');
    await js('window.scrollTo(0, 520)'); await wait(1500); await shot('02-scrolled');
    await js('document.querySelector("#spotlight").scrollIntoView({block:"center"})'); await wait(1600); await shot('03-spotlight');
    await js('window.scrollTo(0, document.body.scrollHeight)'); await wait(1500); await shot('04-rows');
    await js('document.querySelector("[data-view=movies]").click()'); await wait(1400); await shot('05-movies');
    await js('document.querySelector("[data-view=tv]").click()'); await wait(1400); await shot('06-tv');
    await js('document.querySelector(".grid .card").click()'); await wait(1400); await shot('07-detail-tv');
    await js('document.querySelector("#detailLayer").scrollTop = 520'); await wait(900); await shot('08-detail-tv-scrolled');
    await js('document.querySelector("#dPlay").click()'); await wait(700); await shot('09-player-chooser');
    await js('document.querySelector("[data-pl=builtin]").click()'); await wait(2500); await shot('10-player');
    await js('document.querySelector("#plSubs").click()'); await wait(600); await shot('11-player-subs');
    await js('Player.close()'); await wait(500);
    await js('document.querySelector("#detailClose").click()'); await wait(400);
    await js('document.querySelector("[data-view=movies]").click()'); await wait(800);
    await js('document.querySelector(".card[data-id*=salt]").click()'); await wait(1200); await shot('12-detail-movie');
    await js('document.querySelector("#detailClose").click()'); await wait(300);
    await js('document.querySelector("#searchInput").value="mystery"; document.querySelector("#searchInput").dispatchEvent(new Event("input"))'); await wait(800); await shot('13-search');
    await js('document.querySelector("#settingsBtn").click()'); await wait(700); await shot('14-settings');
    await js('closeModal()'); await js('document.querySelector("#searchInput").value=""; document.querySelector("#searchInput").dispatchEvent(new Event("input"))');
    win.setSize(820, 900); await wait(1200); await js('window.scrollTo(0,0)'); await wait(600); await shot('15-narrow');
    app.quit();
  });
};
