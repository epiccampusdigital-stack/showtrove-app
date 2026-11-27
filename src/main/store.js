// Tiny JSON database stored in the app's data folder. Everything (metadata, images,
// watch progress) lives here so the app works fully offline after the first fetch.

const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'library.json');
    this.imagesDir = path.join(dir, 'images');
    fs.mkdirSync(this.imagesDir, { recursive: true });
    this.data = { version: 1, settings: {}, folders: [], items: {}, progress: {} };
    try {
      const loaded = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...this.data, ...loaded };
    } catch { /* first run */ }
    this._timer = null;
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this._timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file); // atomic-ish: never leaves a half-written library
  }

  // What the app actually uses: your own keys, falling back to the built-in ones
  get settings() {
    const s = this.userSettings, builtIn = require('./builtin-keys');
    for (const k of Object.keys(builtIn)) if (!s[k]) s[k] = builtIn[k];
    return s;
  }
  // Only what was typed in Settings (shown in the Settings screen)
  get userSettings() {
    return {
      tmdbKey: '', omdbKey: '', fanartKey: '', subdlKey: '', opensubtitlesKey: '', opensubtitlesUser: '', opensubtitlesPass: '',
      subtitleLanguages: 'en', autoSubtitles: true,
      startView: 'home', heroAutoplay: true, heroSpeed: 9, reduceMotion: false, autoNext: true,
      defaultPlayer: 'ask', // ask | builtin | kmplayer | vlc | potplayer | mpc | system | custom
      customPlayerPath: '', kmplayerPath: '', vlcPath: '',
      metadataLanguage: 'en-US',
      ...this.data.settings
    };
  }
  setSettings(patch) { this.data.settings = { ...this.data.settings, ...patch }; this.save(); }
}

module.exports = Store;
