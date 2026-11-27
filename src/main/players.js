// Finds installed video players (KMPlayer, VLC, PotPlayer, MPC) and launches them.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { shell } = require('electron');

const PF = process.env.ProgramFiles || 'C:\\Program Files';
const PF86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCAL = process.env.LOCALAPPDATA || '';

const KNOWN = {
  kmplayer: {
    name: 'KMPlayer',
    paths: [
      path.join(PF, 'KMPlayer 64X', 'KMPlayer64.exe'),
      path.join(PF, 'KMPlayer', 'KMPlayer.exe'),
      path.join(PF86, 'KMPlayer', 'KMPlayer.exe'),
      'C:\\KMPlayer\\KMPlayer.exe',
      path.join(PF, 'The KMPlayer', 'KMPlayer.exe'),
      path.join(PF86, 'The KMPlayer', 'KMPlayer.exe')
    ],
    args: (file, sub) => [file] // KMPlayer auto-loads "Movie.srt" next to "Movie.mkv"
  },
  vlc: {
    name: 'VLC',
    paths: [path.join(PF, 'VideoLAN', 'VLC', 'vlc.exe'), path.join(PF86, 'VideoLAN', 'VLC', 'vlc.exe')],
    args: (file, sub, start) => [file, ...(sub ? [`--sub-file=${sub}`] : []), ...(start ? [`--start-time=${Math.floor(start)}`] : [])]
  },
  potplayer: {
    name: 'PotPlayer',
    paths: [
      path.join(PF, 'DAUM', 'PotPlayer', 'PotPlayerMini64.exe'),
      path.join(PF86, 'DAUM', 'PotPlayer', 'PotPlayerMini.exe'),
      path.join(PF, 'PotPlayer', 'PotPlayerMini64.exe')
    ],
    args: (file, sub, start) => [file, ...(sub ? [`/sub=${sub}`] : []), ...(start ? [`/seek=${Math.floor(start)}`] : [])]
  },
  mpc: {
    name: 'MPC-HC',
    paths: [
      path.join(PF, 'MPC-HC', 'mpc-hc64.exe'), path.join(PF86, 'MPC-HC', 'mpc-hc.exe'),
      path.join(PF, 'K-Lite Codec Pack', 'MPC-HC64', 'mpc-hc64.exe'), path.join(PF86, 'K-Lite Codec Pack', 'MPC-HC64', 'mpc-hc64.exe'),
      path.join(LOCAL, 'Programs', 'MPC-HC', 'mpc-hc64.exe')
    ],
    args: (file, sub, start) => [file, ...(sub ? ['/sub', sub] : []), ...(start ? ['/startpos', fmt(start)] : [])]
  }
};

function fmt(s) { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = Math.floor(s % 60); return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; }

/** List players found on this PC (+ the custom one from Settings). */
function detectPlayers(settings) {
  const found = [{ id: 'builtin', name: 'Built-in player' }];
  for (const [id, p] of Object.entries(KNOWN)) {
    const override = settings[`${id}Path`];
    const exe = (override && fs.existsSync(override)) ? override : p.paths.find(x => fs.existsSync(x));
    if (exe) found.push({ id, name: p.name, exe });
  }
  if (settings.customPlayerPath && fs.existsSync(settings.customPlayerPath)) {
    found.push({ id: 'custom', name: path.parse(settings.customPlayerPath).name, exe: settings.customPlayerPath });
  }
  found.push({ id: 'system', name: 'Windows default app' });
  return found;
}

async function launch(playerId, file, { sub, start } = {}, settings) {
  if (playerId === 'system') {
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
    return;
  }
  const p = detectPlayers(settings).find(x => x.id === playerId);
  if (!p?.exe) throw new Error(`${KNOWN[playerId]?.name || playerId} isn't installed (or its path isn't set in Settings).`);
  const args = KNOWN[playerId] ? KNOWN[playerId].args(file, sub, start) : [file];
  const child = spawn(p.exe, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

module.exports = { detectPlayers, launch };
