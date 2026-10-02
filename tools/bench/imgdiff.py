"""Compare the pilot and web app screenshots from compare.mjs.

For each view prints the mean and 99th-percentile difference per pixel (0-255, max over RGB) and
the share of pixels that differ by more than 8, and writes a heat map (out/diff-<view>.png).
Usage: mamba run -n geo_env python tools/bench/imgdiff.py
"""
import glob
import os

import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")

for a in sorted(glob.glob(os.path.join(OUT, "cmp-pilot-*.png"))):
    view = os.path.basename(a)[len("cmp-pilot-"):-4]
    b = os.path.join(OUT, f"cmp-web-{view}.png")
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
