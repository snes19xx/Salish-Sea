"""Download the raw data for a pilot area.

Writes to data/raw/<area>/ and data/vectors/<area>/. Safe to re-run: finished downloads are skipped.

    mamba run -n geo_env python tools/fetch_pilot.py [howe|sechelt]
"""

import json
import math
import time

import numpy as np
import rasterio
import requests
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT
from shapely.geometry import LineString, Point, Polygon, mapping
from shapely.ops import polygonize, unary_union

from pilot_area import MRDEM_URL, NONNA_WCS, UTM, area_from_args

OVERPASS = "https://overpass-api.de/api/interpreter"
HEADERS = {"User-Agent": "sunshine-coast-3d/0.1 (personal project; data pipeline)"}
MARGIN_DEG = 0.02  # fetch a little beyond the pilot edges
NONNA_TILE_M = 10_000  # tile size in EPSG:3857 metres per WCS request

GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                GDAL_HTTP_MULTIRANGE="YES", GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES")


def fetch_mrdem(area, backdrop=False):
    out = area.raw / ("land_backdrop.tif" if backdrop else "land_mrdem30.tif")
    if out.exists():
        print(f"MRDEM: {out.name} exists, skipping")
        return
    transform, width, height = area.grid(backdrop=backdrop)
    res = area.backdrop_res if backdrop else area.res
    print(f"MRDEM: warping {out.name}, {width} x {height} at {res:.0f} m ...")
    # Averaging lets GDAL use the COG's overviews for the coarse backdrop.
    resampling = Resampling.average if backdrop else Resampling.bilinear
    with rasterio.Env(**GDAL_ENV), rasterio.open(MRDEM_URL) as src:
        with WarpedVRT(src, crs=UTM, transform=transform, width=width, height=height,
                       resampling=resampling, src_nodata=src.nodata, nodata=np.nan,
                       dtype="float32") as vrt:
            data = vrt.read(1)
    profile = dict(driver="GTiff", width=width, height=height, count=1, dtype="float32",
                   crs=UTM, transform=transform, nodata=np.nan, compress="deflate",
                   predictor=3, tiled=True)
    with rasterio.open(out, "w", **profile) as dst:
        dst.write(data, 1)
    print(f"MRDEM: wrote {out.name}; valid {np.isfinite(data).mean():.1%}, "
          f"range {np.nanmin(data):.1f} to {np.nanmax(data):.1f} m")


def fetch_nonna(area, level):
    folder = area.raw / f"nonna{level}"
    folder.mkdir(parents=True, exist_ok=True)
    west, south, east, north = area.bounds
    to_merc = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    x0, y0 = to_merc.transform(west - MARGIN_DEG, south - MARGIN_DEG)
    x1, y1 = to_merc.transform(east + MARGIN_DEG, north + MARGIN_DEG)
    nx = math.ceil((x1 - x0) / NONNA_TILE_M)
    ny = math.ceil((y1 - y0) / NONNA_TILE_M)
    coverage = f"nonna__NONNA {level} Coverage"
    print(f"NONNA-{level}: {nx * ny} tiles")
    for j in range(ny):
        for i in range(nx):
            out = folder / f"tile_{i:02d}_{j:02d}.tif"
            if out.exists():
                continue
            tx0, ty0 = x0 + i * NONNA_TILE_M, y0 + j * NONNA_TILE_M
            tx1, ty1 = min(tx0 + NONNA_TILE_M, x1), min(ty0 + NONNA_TILE_M, y1)
            params = [("service", "WCS"), ("version", "2.0.1"), ("request", "GetCoverage"),
                      ("coverageId", coverage), ("format", "image/tiff"),
                      ("subset", f"X({tx0},{tx1})"), ("subset", f"Y({ty0},{ty1})")]
            for attempt in range(4):
                try:
                    r = requests.get(NONNA_WCS, params=params, headers=HEADERS, timeout=120)
                    if r.ok and r.content[:2] in (b"II", b"MM"):
                        out.write_bytes(r.content)
                        break
                    print(f"  {out.name}: HTTP {r.status_code} {r.content[:120]!r}")
                except requests.RequestException as err:
                    print(f"  {out.name}: {err}")
                time.sleep(3 * (attempt + 1))
            else:
                raise RuntimeError(f"NONNA-{level} tile {out.name} failed after 4 attempts")
    print(f"NONNA-{level}: done")


def overpass(area, query, name):
    cache = area.raw / f"osm_{name}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    west, south, east, north = area.bounds
    bbox = f"{south - MARGIN_DEG},{west - MARGIN_DEG},{north + MARGIN_DEG},{east + MARGIN_DEG}"
    full = f"[out:json][timeout:180][bbox:{bbox}];{query}"
    for attempt in range(5):
        try:
            r = requests.post(OVERPASS, data={"data": full}, headers=HEADERS, timeout=240)
            if r.ok:
                cache.write_text(r.text)
                return r.json()
            print(f"  Overpass {name}: HTTP {r.status_code}, retrying")
        except requests.RequestException as err:
            print(f"  Overpass {name}: {err}, retrying")
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"Overpass query {name} failed")


def way_line(el):
    return LineString([(p["lon"], p["lat"]) for p in el["geometry"]])


def osm_polygon(el):
    """Polygon for a closed way or a multipolygon relation (returned with out geom)."""
    if el["type"] == "way":
        pts = [(p["lon"], p["lat"]) for p in el.get("geometry", [])]
        if len(pts) < 4 or pts[0] != pts[-1]:
            return None
        poly = Polygon(pts)
    else:
        members = [m for m in el.get("members", []) if m.get("type") == "way" and "geometry" in m]
        outers = [way_line(m) for m in members if m.get("role") == "outer"]
        inners = [way_line(m) for m in members if m.get("role") == "inner"]
        if not outers:
            return None
        poly = unary_union(list(polygonize(unary_union(outers))))
        if inners:
            poly = poly.difference(unary_union(list(polygonize(unary_union(inners)))))
    if not poly.is_valid:
        poly = poly.buffer(0)
    return None if poly.is_empty else poly


def write_geojson(path, features):
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    print(f"OSM: wrote {path.name} ({len(features)} features)")


def fetch_osm(area):
    area.vectors.mkdir(parents=True, exist_ok=True)

    # Coastline: OSM draws land on the left of each way.
    coast = overpass(area, 'way["natural"="coastline"];out geom;', "coastline")
    write_geojson(area.vectors / "coastline.geojson", [
        {"type": "Feature", "properties": {"id": el["id"]}, "geometry": mapping(way_line(el))}
        for el in coast["elements"] if el["type"] == "way"])

    # Lakes and other inland water.
    water = overpass(area, '(way["natural"="water"];relation["natural"="water"];);out geom;', "water")
    feats = []
    for el in water["elements"]:
        tags = el.get("tags", {})
        if tags.get("water") in ("river", "canal", "stream", "lagoon", "wastewater"):
            continue
        poly = osm_polygon(el)
        if poly is not None:
            feats.append({"type": "Feature",
                          "properties": {"id": el["id"], "name": tags.get("name"),
                                         "water": tags.get("water")},
                          "geometry": mapping(poly)})
    write_geojson(area.vectors / "water_osm.geojson", feats)

    # Built-up land, so trees are not planted in towns.
    towns = overpass(area, '(way["landuse"~"^(residential|commercial|industrial|retail)$"];'
                           'relation["landuse"~"^(residential|commercial|industrial|retail)$"];);'
                           'out geom;', "towns")
    feats = []
    for el in towns["elements"]:
        poly = osm_polygon(el)
        if poly is not None:
            feats.append({"type": "Feature", "properties": {"id": el["id"],
                                                            "landuse": el["tags"].get("landuse")},
                          "geometry": mapping(poly)})
    write_geojson(area.vectors / "towns_osm.geojson", feats)

    # Place names for labels.
    places = overpass(
        area,
        '(nwr["place"~"^(town|village|hamlet|suburb|neighbourhood|locality|island|islet)$"]["name"];'
        'nwr["natural"~"^(bay|strait|peninsula|cape|peak|beach)$"]["name"];'
        'nwr["water"="bay"]["name"];);out center tags;', "places")
    feats = []
    for el in places["elements"]:
        if el["type"] == "node":
            lon, lat = el["lon"], el["lat"]
        elif "center" in el:
            lon, lat = el["center"]["lon"], el["center"]["lat"]
        else:
            continue
        tags = el.get("tags", {})
        feats.append({"type": "Feature",
                      "properties": {"name": tags["name"], "place": tags.get("place"),
                                     "natural": tags.get("natural"), "ele": tags.get("ele"),
                                     "osm": f'{el["type"]}/{el["id"]}'},
                      "geometry": mapping(Point(lon, lat))})
    write_geojson(area.vectors / "places_osm.geojson", feats)

    # Roads and ferry routes for the minimap (no service roads, tracks or paths).
    roads = overpass(
        area,
        '(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|'
        'living_street)(_link)?$"];way["route"="ferry"];);out geom;', "roads")
    write_geojson(area.vectors / "roads_osm.geojson", [
        {"type": "Feature",
         "properties": {"id": el["id"], "highway": el["tags"].get("highway"),
                        "route": el["tags"].get("route"), "name": el["tags"].get("name")},
         "geometry": mapping(way_line(el))}
        for el in roads["elements"] if el["type"] == "way" and len(el.get("geometry", [])) >= 2])


if __name__ == "__main__":
    area = area_from_args("Download MRDEM, NONNA and OSM data for a pilot area")
    area.raw.mkdir(parents=True, exist_ok=True)
    fetch_osm(area)
    fetch_nonna(area, 100)
    fetch_nonna(area, 10)
    fetch_mrdem(area)
    fetch_mrdem(area, backdrop=True)
