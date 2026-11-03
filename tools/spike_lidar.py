"""Cut a 2 m lidar window around Horseshoe Bay (a first test of lidar) for the web app to draw over the
30 m ground. Writes pilot/data/howe/pilot_lidar.bin (Float32, row 0 = north) and pilot_lidar.json.

The window is aligned to the 30 m grid, so along its edges the 30 m ground is a straight line
between its samples; the lidar is blended into that over the last EDGE metres, so the two meet
without a step. Where the lidar has no data (water), the 30 m heights (with bathymetry) fill in.

    mamba run -n geo_env python tools/spike_lidar.py [lon lat size_m]
"""

import json
import os
import sys

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.warp import reproject
from pyproj import Transformer
from shapely.geometry import box

from merge_dem import coastline_land
from pilot_area import AREAS, ROOT, UTM

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
HRDEM = "/vsicurl/https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-mosaic-2m/2_3-mosaic-2m-dtm.tif"
RES = 2.0
EDGE = 150.0  # metres blended into the 30 m ground at the window edge

lon, lat, size = (float(a) for a in sys.argv[1:4]) if len(sys.argv) > 3 else (-123.282, 49.376, 3000.0)
out = ROOT / "pilot" / "data" / "howe"
meta = json.loads((out / "pilot_height.json").read_text())
NX, NZ, DX = meta["width"], meta["height"], meta["spacing"]
H30 = np.fromfile(out / "pilot_height.bin", dtype="<f4").reshape(NZ, NX)
E0, N0 = meta["origin"]["E0"], meta["origin"]["N0"]

# Window in world metres, snapped to the 30 m grid.
e, n = Transformer.from_crs("EPSG:4326", UTM, always_xy=True).transform(lon, lat)
cells = int(round(size / DX))
c0 = int(round((e - E0 - size / 2 - meta["minX"]) / DX))
r0 = int(round((-(n - N0) - size / 2 - meta["minZ"]) / DX))
x0, z0 = meta["minX"] + c0 * DX, meta["minZ"] + r0 * DX
k = int(round(DX / RES))
M = cells * k + 1  # samples per side

# Lidar on the grid: sample (i, j) at world (x0 + 2i, z0 + 2j), i.e. UTM (E0 + x, N0 - z).
dst = np.full((M, M), np.nan, dtype="float32")
transform = from_origin(E0 + x0 - RES / 2, N0 - z0 + RES / 2, RES, RES)
with rasterio.open(HRDEM) as src:
    reproject(rasterio.band(src, 1), dst, src_nodata=src.nodata, dst_transform=transform, dst_crs=UTM,
              dst_nodata=np.nan, resampling=Resampling.bilinear)
have = np.isfinite(dst)
print(f"Lidar {M} x {M} at {RES} m: {have.mean():.1%} has data, range {np.nanmin(dst):.1f} to {np.nanmax(dst):.1f} m")

# The 30 m ground at every lidar sample (the same triangles' straight lines along the edges).
jj, ii = np.mgrid[0:M, 0:M]
fc, fr = c0 + ii / k, r0 + jj / k
ic, ir = np.minimum(fc.astype(int), NX - 2), np.minimum(fr.astype(int), NZ - 2)
tc, tr = fc - ic, fr - ir
base = ((H30[ir, ic] * (1 - tc) + H30[ir, ic + 1] * tc) * (1 - tr)
        + (H30[ir + 1, ic] * (1 - tc) + H30[ir + 1, ic + 1] * tc) * tr).astype("float32")

# The lidar flattens water to a sheet (the bay sits above 0 m, some shallows below), so land and
# sea come from the OSM coastline drawn at 2 m: land keeps the lidar (at least 0.3 m), sea gets
# the 30 m bathymetry (at most -0.5 m).
land_faces, _ = coastline_land(AREAS["howe"], box(E0 + x0 - RES, N0 - z0 - size - RES, E0 + x0 + size + RES, N0 - z0 + RES))
land = rasterize(((f, 1) for f in land_faces), out_shape=(M, M), transform=transform, fill=0, dtype="uint8").astype(bool)
h = np.where(land, np.maximum(np.where(have, dst, base), 0.3), np.minimum(base, -0.5))
print(f"Land {land.mean():.1%} of window; land without lidar {(land & ~have).mean():.2%}")
d = np.minimum.reduce([ii, jj, M - 1 - ii, M - 1 - jj]) * RES
w = np.clip(d / EDGE, 0, 1)
w = w * w * (3 - 2 * w)
h = (base + (h - base) * w).astype("<f4")
print(f"Below 0 m with lidar data: {(have & (dst < 0)).mean():.1%} of window; "
      f"blended range {h.min():.1f} to {h.max():.1f} m")

h.tofile(out / "pilot_lidar.bin")
(out / "pilot_lidar.json").write_text(json.dumps(
    {"width": M, "height": M, "spacing": RES, "minX": x0, "minZ": z0, "source": "NRCan HRDEM 2 m mosaic (2_3)"}))
print(f"Wrote pilot_lidar.bin ({h.nbytes / 1e6:.1f} MB): x {x0:.0f} to {x0 + size:.0f}, z {z0:.0f} to {z0 + size:.0f}")
