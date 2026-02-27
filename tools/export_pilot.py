"""Export a merged pilot area for the browser demo in pilot/.

Writes to pilot/data/<area>/:
    pilot_height.bin    Float32 little-endian, row-major, row 0 = north (detail grid)
    pilot_backdrop.bin  same format, low-detail backdrop grid
    pilot_mask.bin      Uint8 per detail cell: 1 = built-up (no trees)
    pilot_height.json   grids, world origin, labels, flyover path, boat start, wind, lakes

World coordinates: 1 unit = 1 m, x = east, -z = north, origin at the area's origin.

    mamba run -n geo_env python tools/export_pilot.py [howe|sechelt]
"""

import json

import numpy as np
import rasterio
from shapely.geometry import shape

from pilot_area import area_from_args, to_utm


def world_xz(lon, lat, e0, n0):
    e, n = to_utm.transform(lon, lat)
    return e - e0, -(n - n0)


def grid_meta(transform, rows, cols, e0, n0):
    """Grid description in world coordinates (pixel centres; row 0 has the smallest z)."""
    res = transform.a
    return {"width": cols, "height": rows, "spacing": res,
            "minX": round(transform.c + res / 2 - e0, 2),
            "minZ": round(-(transform.f - res / 2 - n0), 2)}


def find_place(features, name):
    hits = [f for f in features if f["properties"]["name"] == name]
    if not hits:
        return None
    # Prefer settlements and named natural features over anything else.
    hits.sort(key=lambda f: (f["properties"]["place"] is None and f["properties"]["natural"] is None))
    return hits[0]["geometry"]["coordinates"]


def main():
    area = area_from_args("Export a pilot area for the browser")
    area.out.mkdir(parents=True, exist_ok=True)
    e0, n0 = area.origin_utm()

    with rasterio.open(area.work / "merged_30m.tif") as src:
        h = src.read(1).astype("<f4")
        detail = grid_meta(src.transform, *h.shape, e0, n0)
    with rasterio.open(area.work / "town_mask.tif") as src:
        towns = src.read(1).astype("u1")
    with rasterio.open(area.work / "backdrop.tif") as src:
        b = src.read(1).astype("<f4")
        back = grid_meta(src.transform, *b.shape, e0, n0)

    (area.out / "pilot_height.bin").write_bytes(np.ascontiguousarray(h).tobytes())
    (area.out / "pilot_backdrop.bin").write_bytes(np.ascontiguousarray(b).tobytes())
    (area.out / "pilot_mask.bin").write_bytes(np.ascontiguousarray(towns).tobytes())

    rows, cols, res = h.shape[0], h.shape[1], detail["spacing"]

    def height_at(x, z):
        c = int(round((x - detail["minX"]) / res))
        r = int(round((z - detail["minZ"]) / res))
        if 0 <= r < rows and 0 <= c < cols:
            return float(h[r, c])
        return None

    places = json.loads((area.vectors / "places_osm.geojson").read_text())["features"]
    labels = []
    for name, kind, max_dist, lonlat in area.labels:
        lonlat = lonlat or find_place(places, name)
        if lonlat is None:
            print(f"Label not found in OSM, skipped: {name}")
            continue
        x, z = world_xz(*lonlat, e0, n0)
        ground = height_at(x, z)
        if ground is None:
            print(f"Label outside the grid, skipped: {name}")
            continue
        y = {"land": max(ground, 0) + 40, "peak": ground + 60, "water": 5}[kind]
        labels.append({"name": name, "kind": "land" if kind == "peak" else kind,
                       "x": round(x), "y": round(y), "z": round(z), "max": max_dist})

    path = []
    for lon, lat, y in area.flyover:
        x, z = world_xz(lon, lat, e0, n0)
        path.append([round(x), y, round(z)])

    bx, bz = world_xz(area.boat[0], area.boat[1], e0, n0)
    boat_height = height_at(bx, bz)
    if boat_height is None or boat_height > -3:
        print(f"WARNING: boat start is not in open water (height {boat_height})")

    lake_out = []
    for f in json.loads((area.vectors / "lakes.geojson").read_text())["features"]:
        geom = shape(f["geometry"]).simplify(0.0001)
        polys = list(geom.geoms) if hasattr(geom, "geoms") else [geom]
        rings = [[[round(v) for v in world_xz(lon, lat, e0, n0)] for lon, lat in p.exterior.coords]
                 for p in polys]
        lake_out.append({"name": f["properties"]["name"], "surface": f["properties"]["surface_m"],
                         "rings": rings})

    meta = {
        "area": area.name, "title": area.title, "coord": area.coord, "note": area.note,
        **detail,
        "backdrop": back,
        "format": "Float32 little-endian, row-major, row 0 = north (min z); mask Uint8, 1 = built-up",
        "heights": "metres above CGVD2013; sea level = 0",
        "crs": "EPSG:26910",
        "origin": {"lon": area.origin[0], "lat": area.origin[1],
                   "E0": round(e0, 2), "N0": round(n0, 2)},
        "boundsLonLat": list(area.bounds),
        "datum": {"default": area.datum_offset,
                  "bodies": [{"name": n, "offset": o} for n, _, o in area.datum_bodies]},
        "labels": labels,
        "flyover": path,
        "boat": {"x": round(bx), "z": round(bz), "hdg": area.boat[2], "where": area.boat_where},
        "wind": {"from": area.wind_from, "kn": area.wind_kn},
        "lakes": lake_out,
        "sources": "NRCan MRDEM-30; CHS NONNA-10/100 (not for navigation); OpenStreetMap contributors",
    }
    (area.out / "pilot_height.json").write_text(json.dumps(meta, indent=1))
    print(f"Exported {area.name}: detail {cols} x {rows} ({h.nbytes / 1e6:.1f} MB), backdrop "
          f"{b.shape[1]} x {b.shape[0]} ({b.nbytes / 1e6:.1f} MB), {len(labels)} labels, "
          f"{len(path)} flyover points, {len(lake_out)} lakes; boat start height {boat_height} m")


if __name__ == "__main__":
    main()
