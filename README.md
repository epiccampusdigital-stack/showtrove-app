# Showtrove 

Your own cinematic, offline-first movie and TV library for Windows. Point it at a folder, and it finds every movie and episode inside (all subfolders), pulls posters, cast, plot, IMDb / Rotten Tomatoes / TMDB ratings, saves it all on your PC, and plays in the built-in player, KMPlayer, VLC or anything else.

## Run it

**Quick try (no install):** unzip `Showtrove-Windows-portable.zip` and double-click `Showtrove.exe`.

**From source (for development in VS Code / Claude Code):**

```
npm install
npm start          # run the app
npm test           # parser + subtitle tests
npm run dist       # build a proper Windows installer (run this on Windows) → dist/
```

## First run

1. **Add your movie folder.** Any folder works, and so does a whole drive like `D:\`. Movies and TV shows can be mixed. Showtrove sorts them by file name and watches the folder, so new downloads appear on their own.
2. **Settings → TMDB API key** (free): themoviedb.org → Settings → API. This turns on posters, cast, plot and episodes.
3. **Settings → OMDb key** (free): adds IMDb and Rotten Tomatoes scores.
4. **Settings → OpenSubtitles key** (free): automatic subtitles. Add your OpenSubtitles login for more than 5 downloads a day.

Everything fetched (text and images) is stored in `%APPDATA%\Showtrove\`, so the library looks the same offline.

## File naming that works best

| Kind | Examples that are recognised |
|---|---|
| Movies | `The.Dark.Knight.2008.1080p.BluRay.x264-YIFY.mkv`, `Inception (2010)/movie.mp4`, `[YTS.MX] Joker (2019).mp4` |
| TV | `Breaking.Bad.S02E05.mkv`, `Show/Season 1/Show - S01E01 - Pilot.mkv`, `Show/Season 2/05.mkv`, `Show 1x02.mkv` |

If something matches wrong, open it and use **Fix match**.

## Playing

- **Play** asks which player to use (built-in, KMPlayer, VLC, PotPlayer, MPC-HC, Windows default). Tick **Always use this player** to skip the question. The arrow next to Play always lets you choose.
- **Subtitles:** if there's no `.srt` next to the video, one is downloaded and saved as `MovieName.srt` beside it, so KMPlayer and VLC load it too.
- **Built-in player shortcuts:** Space/K play-pause · ←/→ 10s (Ctrl 30s, Shift 60s) · ↑/↓ volume · M mute · F or double-click full screen · S cycle subtitles · `,` / `.` subtitle delay ∓0.1s · `-` / `=` subtitle size · `[` / `]` speed · N next episode · Esc back.
- The built-in player handles most MP4/MKV (H.264) files. For HEVC/x265 video or AC3/DTS audio it tells you and hands off to KMPlayer/VLC at the same position.

## Project layout

```
src/main/      Electron main process
  main.js        window, IPC, cv:// protocol (images, streaming video with seek, subtitles)
  scanner.js     fast recursive folder walk + grouping into movies / shows
  parser.js      messy filename → title, year, season, episode
  metadata.js    TMDB + OMDb fetch, image cache, offline queue
  subtitles.js   local .srt/.ass/.vtt, OpenSubtitles hash search + download
  players.js     find KMPlayer / VLC / PotPlayer / MPC and launch them
  store.js       JSON library in %APPDATA%
src/renderer/  UI (plain HTML/CSS/JS, no build step)
test/          tests, sample-library generator, screenshot hook
```

Font: Switzer by Indian Type Foundry (Fontshare, free for commercial use), bundled for offline use. To change fonts, edit `--font-display` / `--font-ui` at the top of `src/renderer/styles.css`.

## Releasing an update

Every installed copy checks GitHub for a new version when it opens (and every 4 hours), downloads it in the background, and asks the user to restart.

1. Make the change and bump `version` in `package.json` (e.g. 1.0.1 → 1.0.2).
2. Commit, then tag and push:
   ```
   git commit -am "Showtrove 1.0.2"
   git tag v1.0.2
   git push && git push --tags
   ```
3. GitHub Actions (`.github/workflows/release.yml`) builds the installer on Windows and publishes the release. About 10 minutes later every copy updates itself.

The repo must be **public** for updates to download without a token (or keep the code private and publish releases to a separate public repo).
