"""Compare two sets of screenshots from compare.mjs (by default the pilot's and the web app's).

For each view prints the mean and 99th-percentile difference per pixel (0-255, max over RGB) and
the share of pixels that differ by more than 8, and writes a heat map (out/diff-<view>.png).
Usage: mamba run -n geo_env python tools/bench/imgdiff.py [tag A] [tag B]
       (tags as in out/cmp-<tag>-<view>.png; default pilot web)
"""
import glob
import os
import sys

import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
A, B = (sys.argv[1:3] + ["pilot", "web"][len(sys.argv[1:3]):])[:2]

for a in sorted(glob.glob(os.path.join(OUT, f"cmp-{A}-*.png"))):
    view = os.path.basename(a)[len(f"cmp-{A}-"):-4]
    b = os.path.join(OUT, f"cmp-{B}-{view}.png")
    if not os.path.exists(b):
        continue
    pa = np.asarray(Image.open(a).convert("RGB")).astype(np.int16)
    pb = np.asarray(Image.open(b).convert("RGB")).astype(np.int16)
    if pa.shape != pb.shape:
        print(f"{view}: sizes differ {pa.shape} {pb.shape}")
        continue
    d = np.abs(pa - pb).max(axis=2)
    print(f"{view:12s} mean {d.mean():5.2f}  p99 {np.percentile(d, 99):5.1f}  max {d.max():3d}  >8: {100 * (d > 8).mean():5.2f}%")
    Image.fromarray(np.clip(d * 8, 0, 255).astype(np.uint8)).save(os.path.join(OUT, f"diff-{view}.png"))
