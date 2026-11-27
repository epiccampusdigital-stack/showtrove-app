// On-the-fly conversion for files the built-in player can't decode:
//  - "audio" mode: keep the picture as-is, convert AC3 / DTS / TrueHD sound to AAC (cheap)
//  - "full" mode: also convert the picture to H.264 (for HEVC 10-bit, MPEG-2, VC-1, old AVI codecs …)
// Output is fragmented MP4 streamed straight into the <video> element.

const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');

let ffmpegPath = null;
try { ffmpegPath = require('ffmpeg-static'); } catch { /* not bundled */ }
if (ffmpegPath) ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');

const available = () => !!ffmpegPath;

// Codecs Chromium plays natively (HEVC only with hardware support, so it is tried first and checked)
const OK_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1', 'hevc']);
const OK_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_f32le']);

const probeCache = new Map();
function probe(file) {
  if (!ffmpegPath) return Promise.resolve(null);
  if (probeCache.has(file)) return Promise.resolve(probeCache.get(file));
  return new Promise(resolve => {
    execFile(ffmpegPath, ['-hide_banner', '-i', file], { maxBuffer: 4 << 20, timeout: 20000, windowsHide: true }, (_err, _out, stderr = '') => {
      const dm = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      const duration = dm ? (+dm[1]) * 3600 + (+dm[2]) * 60 + (+dm[3]) : 0;
      const audio = [];
      let video = null, n = 0;
      for (const line of stderr.split('\n')) {
        const m = line.match(/Stream #\d+:\d+(?:\[\w+\])?(?:\((\w+)\))?: (Video|Audio): (\w+)/);
        if (!m) continue;
        if (m[2] === 'Video' && !video && !/attached pic|mjpeg|png/i.test(line)) {
          video = { codec: m[3], tenBit: /p10|10le|yuv420p10/.test(line) };
        }
        if (m[2] === 'Audio') {
          const ch = (line.match(/(\d\.\d|stereo|mono)/) || [])[1] || '';
          audio.push({ index: n++, codec: m[3], lang: m[1] || '', channels: ch, label: [langName(m[1]), m[3].toUpperCase(), ch].filter(Boolean).join(' · ') });
        }
      }
      const info = {
        duration, video, audio,
        audioOk: !audio.length || OK_AUDIO.has(audio[0].codec),
        videoOk: !video || (OK_VIDEO.has(video.codec) && !(video.codec === 'h264' && video.tenBit))
      };
      probeCache.set(file, info);
      resolve(info);
    });
  });
}

const LANGS = { eng: 'English', sin: 'Sinhala', tam: 'Tamil', hin: 'Hindi', jpn: 'Japanese', kor: 'Korean', chi: 'Chinese', zho: 'Chinese', spa: 'Spanish', fre: 'French', fra: 'French', ger: 'German', deu: 'German', ita: 'Italian', rus: 'Russian', por: 'Portuguese', ara: 'Arabic', tel: 'Telugu', mal: 'Malayalam', und: '' };
const langName = c => (c && LANGS[c] !== undefined ? LANGS[c] : c || '');

let current = null; // one conversion at a time: a new seek replaces the old stream
function stream(file, { ss = 0, audio = 0, mode = 'audio' } = {}) {
  if (!ffmpegPath) throw new Error('Converter not available');
  if (current) { try { current.kill('SIGKILL'); } catch { /* gone */ } }
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (ss > 0) args.push('-ss', String(ss));
  args.push('-i', file, '-map', '0:v:0?', '-map', `0:a:${audio}?`, '-sn', '-dn');
  if (mode === 'full') args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-vf', "scale='min(1920,iw)':-2", '-g', '96');
  else args.push('-c:v', 'copy');
  args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1');
  const proc = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', d => console.log('[ffmpeg]', String(d).trim().slice(0, 300)));
  current = proc;
  proc.on('exit', () => { if (current === proc) current = null; });
  return { body: Readable.toWeb(proc.stdout), kill: () => { try { proc.kill('SIGKILL'); } catch { /* gone */ } } };
}
function stopAll() { if (current) { try { current.kill('SIGKILL'); } catch { /* gone */ } current = null; } }

module.exports = { available, probe, stream, stopAll };
