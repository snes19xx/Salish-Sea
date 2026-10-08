"""Zoomed crops of the same spots from screenshots taken with different antialiasing, side by side.
Usage: mamba run -n geo_env python tools/bench/aacrop.py out/aa-msaa-1.png out/aa-smaa-1.png ...
Writes out/aa-crops.png: one row per crop box, one column per screenshot (in the order given).
The boxes fit the Sail start at 1920 x 1080 (see README); edit them for other views."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

BOXES = [(930, 430, 1030, 650), (380, 150, 600, 380), (0, 330, 300, 420)]  # mast, tree tops, shoreline
ZOOM = 3

shots = [Path(p) for p in sys.argv[1:]]
imgs = [Image.open(p).convert('RGB') for p in shots]
rows = []
for box in BOXES:
    tiles = [im.crop(box).resize(((box[2] - box[0]) * ZOOM, (box[3] - box[1]) * ZOOM), Image.NEAREST) for im in imgs]
    row = Image.new('RGB', (sum(t.width for t in tiles) + 8 * (len(tiles) - 1), tiles[0].height + 24), 'white')
    x = 0
    for t, p in zip(tiles, shots):
        row.paste(t, (x, 24))
        ImageDraw.Draw(row).text((x + 4, 6), p.stem, fill='black')
        x += t.width + 8
    rows.append(row)
out = Image.new('RGB', (max(r.width for r in rows), sum(r.height for r in rows) + 8 * (len(rows) - 1)), 'white')
y = 0
for r in rows:
    out.paste(r, (0, y))
    y += r.height + 8
dest = shots[0].parent / 'aa-crops.png'
out.save(dest)
print(dest)
