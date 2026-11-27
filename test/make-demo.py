# Builds a SAMPLE library for screenshots: fictional titles, generated abstract artwork, tiny test videos.
# Usage: python3 test/make-demo.py /tmp/cvdemo
import json, os, random, subprocess, sys, hashlib, time
from PIL import Image, ImageDraw, ImageFilter

root = sys.argv[1]
lib = os.path.join(root, 'Movies')
data = os.path.join(root, 'data'); imgs = os.path.join(data, 'images')
os.makedirs(imgs, exist_ok=True)
random.seed(7)

def art(name, w, h, hue):
    import colorsys
    im = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(im)
    c1 = [int(x*255) for x in colorsys.hls_to_rgb(hue, .16, .55)]
    c2 = [int(x*255) for x in colorsys.hls_to_rgb((hue+.08) % 1, .42, .7)]
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(c1[i]*(1-t)+c2[i]*t) for i in range(3)))
    for _ in range(7):
        r = random.randint(w//8, w//2); x = random.randint(-r, w); y = random.randint(-r, h)
        col = [int(v*255) for v in colorsys.hls_to_rgb((hue+random.uniform(-.1,.15)) % 1, random.uniform(.3,.75), .8)]
        d.ellipse([x, y, x+r, y+r], fill=tuple(col))
    im = im.filter(ImageFilter.GaussianBlur(w/22))
    d = ImageDraw.Draw(im)
    # a silhouette horizon so it reads like a film still
    pts = [(0, h)] + [(x, int(h*.72 - random.random()*h*.12)) for x in range(0, w+40, 40)] + [(w, h)]
    d.polygon(pts, fill=(12, 10, 12))
    im.save(os.path.join(imgs, name), quality=88)
    return name

movies = [
  ('The Long Harbor', 2019, 'The.Long.Harbor.2019.1080p.BluRay.x264-YIFY.mp4', 8.1, '91%', ['Drama', 'Mystery'], 132),
  ('Neon Monsoon', 2023, 'Neon Monsoon (2023)/Neon.Monsoon.2023.WEB-DL.mkv', 7.6, '84%', ['Sci-Fi', 'Thriller'], 118),
  ('Paper Lanterns', 2016, 'Paper_Lanterns_2016_720p.mp4', 7.9, '95%', ['Animation', 'Family'], 97),
  ('Ironwood', 2021, 'Ironwood.2021.2160p.HDR.mkv', 6.8, '72%', ['Action', 'Thriller'], 126),
  ('Salt and Static', 2018, 'Salt and Static 2018.mp4', 7.2, '88%', ['Drama'], 104),
  ('The Quiet Orbit', 2024, '[YTS.MX] The Quiet Orbit (2024) [1080p].mp4', 8.4, '93%', ['Sci-Fi', 'Drama'], 141),
  ('Kingfisher Road', 2014, 'Kingfisher.Road.2014.DVDRip.avi.mp4', 7.0, '79%', ['Mystery', 'Drama'], 111),
  ('Glasshouse', 2022, 'Glasshouse.2022.mkv', 6.5, '64%', ['Thriller', 'Mystery'], 99),
  ('Summer of Kites', 2012, 'Summer of Kites (2012)/movie.mp4', 7.7, '90%', ['Family', 'Drama'], 102),
  ('Afterglow Express', 2020, 'Afterglow.Express.2020.mp4', 7.4, '81%', ['Action', 'Sci-Fi'], 123),
]
shows = [('Lighthouse Keepers', 2019, 8.6, '96%', ['Drama', 'Mystery'], [(1, 6), (2, 4)]),
         ('Night Market', 2022, 7.8, '88%', ['Thriller', 'Drama'], [(1, 5)])]

def video(path, secs=8, hue=0):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path): return
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', f'testsrc2=size=640x360:rate=24:duration={secs}',
                    '-f', 'lavfi', '-i', f'sine=frequency={300+hue}:duration={secs}', '-c:v', 'libx264', '-preset', 'ultrafast',
                    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', path], check=True)

items, progress = {}, {}
first = None
for i, (t, y, fname, f, rt, g, rt_min) in enumerate(movies):
    p = os.path.join(lib, fname); video(p, 8, i*40)
    first = first or p
    hue = random.random()
    pid = f'p{i}.jpg'; bid = f'b{i}.jpg'
    art(pid, 500, 750, hue); art(bid, 1280, 720, hue)
    cast = []
    for k, n in enumerate(['Asha Perera', 'Daniel Okafor', 'Mina Sato', 'Leo Brandt', 'Ruth Kiplagat', 'Tomás Rivera']):
        cid = f'c{i}_{k}.jpg'; art(cid, 185, 231, random.random()); cast.append({'name': n, 'character': 'Character ' + str(k+1), 'photo': cid})
    key = 'm:' + t.lower() + '|' + str(y)
    items[key] = {'id': key, 'type': 'movie', 'title': t, 'year': y, 'root': lib, 'addedAt': time.time()*1000 - i*86400000,
        'files': [p], 'episodes': {}, 'metaStatus': 'ok', 'meta': {
        'tmdbId': i, 'imdbId': f'tt{i}', 'title': t, 'year': y, 'overview': f'Sample description for {t}. In your real library this is the plot from TMDB: who it follows, what is at stake, and where it is set.',
        'tagline': 'Sample tagline', 'genres': g, 'runtime': rt_min, 'certification': 'PG-13', 'tmdbRating': round(f-0.3, 1), 'imdbRating': str(f), 'imdbVotes': '120,000',
        'rottenTomatoes': rt, 'metacritic': '74/100', 'poster': pid, 'backdrop': bid, 'cast': cast, 'directors': ['Sample Director'], 'writers': ['Sample Writer'], 'trailerKey': None, 'languages': ['English']}}
for j, (t, y, f, rt, g, seasons) in enumerate(shows):
    hue = random.random(); pid = f'tp{j}.jpg'; bid = f'tb{j}.jpg'; art(pid, 500, 750, hue); art(bid, 1280, 720, hue)
    eps, smeta = {}, {}
    for s, n in seasons:
        smeta[s] = {'name': f'Season {s}', 'episodes': {}, 'checked': True}
        for e in range(1, n+1):
            p = os.path.join(root, 'TV', t, f'Season {s}', f'{t.replace(" ", ".")}.S{s:02d}E{e:02d}.720p.mp4'); video(p, 6, e*30)
            eps[f'{s}x{e}'] = {'season': s, 'episode': e, 'path': p, 'addedAt': time.time()*1000}
            st = f'st{j}_{s}_{e}.jpg'; art(st, 300, 169, random.random())
            smeta[s]['episodes'][e] = {'title': f'Sample episode title {e}', 'overview': 'Sample episode summary from TMDB.', 'runtime': 52, 'still': st, 'rating': 8.0}
    items['t:' + t.lower()] = {'id': 't:' + t.lower(), 'type': 'tv', 'title': t, 'year': y, 'root': os.path.join(root, 'TV'), 'addedAt': time.time()*1000 - j*3600000,
        'files': [], 'episodes': eps, 'metaStatus': 'ok', 'meta': {'tmdbId': 100+j, 'imdbId': f'tt9{j}', 'title': t, 'year': y, 'overview': f'Sample description for the series {t}.',
        'genres': g, 'certification': 'TV-14', 'tmdbRating': f, 'imdbRating': str(f), 'rottenTomatoes': rt, 'poster': pid, 'backdrop': bid, 'cast': [],
        'creators': ['Sample Creator'], 'networks': ['Sample Network'], 'status': 'Returning Series', 'numberOfSeasons': len(seasons), 'seasons': smeta}}

# Some watch progress so "Continue watching" has content
lh = items['t:lighthouse keepers']['episodes']
progress[lh['1x2']['path']] = {'pos': 3.0, 'dur': 6.0, 'at': time.time()*1000}
progress[first] = {'pos': 40, 'dur': 100, 'at': time.time()*1000 - 1000}
progress[items['m:salt and static|2018']['files'][0]] = {'pos': 1, 'dur': 1, 'watched': True, 'at': 1}
with open(os.path.join(lib, 'Salt and Static 2018.srt'), 'w') as fh:
    fh.write('1\n00:00:00,500 --> 00:00:04,000\nThis is a sample subtitle line\n\n2\n00:00:04,200 --> 00:00:07,500\n<i>Loaded automatically from the .srt file</i>\n')

json.dump({'version': 1, 'settings': {'tmdbKey': 'demo-key-for-screenshots-000', 'defaultPlayer': 'ask'}, 'folders': [lib, os.path.join(root, 'TV')],
           'items': items, 'progress': progress}, open(os.path.join(data, 'library.json'), 'w'))
print('demo ready:', len(items), 'titles')
