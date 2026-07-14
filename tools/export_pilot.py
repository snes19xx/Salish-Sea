"""Export a merged pilot area for the browser demo in pilot/.

Writes to pilot/data/<area>/:
    pilot_height.bin    Float32 little-endian, row-major, row 0 = north (detail grid)
    pilot_backdrop.bin  same format, low-detail backdrop grid
    pilot_mask.bin      Uint8 per detail cell: 1 = built-up (no trees)
    pilot_height.json   grids, world origin, labels, flyover path, boat start, wind, lakes
    pilot_map.json      minimap vectors: land, lakes, roads, ferries and place names

World coordinates: 1 unit = 1 m, x = east, -z = north, origin at the area's origin.

    mamba run -n geo_env python tools/export_pilot.py [howe|sechelt]
"""

import json

import numpy as np
import rasterio
from shapely.geometry import box, shape

from merge_dem import coastline_land, to_utm_geom
from pilot_area import area_from_args, to_utm

MAP_MARGIN_M = 1000  # beyond the detail grid
MAP_SIMPLIFY_M = 5
MIN_LAKE_M2 = 3000
ROAD_CLASS = {"motorway": "major", "trunk": "major", "primary": "main", "secondary": "main"}
# Minimap labels, most important first; the browser drops any that collide with earlier ones.
MAP_LABEL_KINDS = [("town", {"town", "village"}), ("water", {"strait"}), ("place", {"suburb", "hamlet"}),
                   ("island", {"island"}), ("bay", {"bay"})]


def world_xz(lon, lat, e0, n0):
    e, n = to_utm.transform(lon, lat)
    return e - e0, -(n - n0)


def flat_coords(coords, e0, n0):
    """UTM coordinates as one flat list of whole world metres: x0, z0, x1, z1, ..."""
    out = []
    for e, n in coords:
        out += [round(e - e0), round(n0 - n)]
    return out


def polygon_rings(geom, e0, n0):
    polys = list(geom.geoms) if hasattr(geom, "geoms") else [geom]
    return [[flat_coords(p.exterior.coords, e0, n0)] + [flat_coords(r.coords, e0, n0) for r in p.interiors]
            for p in polys if p.geom_type == "Polygon" and not p.is_empty]


def export_map(area, src_transform, rows, cols, e0, n0):
    """Vectors for the browser's minimap, in world metres, clipped to the detail grid plus a margin."""
    res = src_transform.a
    west, north = src_transform.c, src_transform.f
    clip = box(west, north - rows * res, west + cols * res, north).buffer(MAP_MARGIN_M, join_style="mitre")
    land_faces, _ = coastline_land(area, clip)
    land = [r for f in land_faces for r in polygon_rings(f.simplify(MAP_SIMPLIFY_M), e0, n0)]

    lakes = []
    for f in json.loads((area.vectors / "water_osm.geojson").read_text())["features"]:
        g = to_utm_geom(shape(f["geometry"])).intersection(clip)
        if g.area >= MIN_LAKE_M2:
            lakes += polygon_rings(g.simplify(MAP_SIMPLIFY_M), e0, n0)

    roads = {"major": [], "main": [], "minor": [], "ferry": []}
    for f in json.loads((area.vectors / "roads_osm.geojson").read_text())["features"]:
        p = f["properties"]
        kind = "ferry" if p["route"] == "ferry" else ROAD_CLASS.get((p["highway"] or "").removesuffix("_link"), "minor")
        g = to_utm_geom(shape(f["geometry"])).intersection(clip).simplify(MAP_SIMPLIFY_M)
        for ln in (g.geoms if hasattr(g, "geoms") else [g]):
            if ln.geom_type == "LineString" and not ln.is_empty:
                roads[kind].append(flat_coords(ln.coords, e0, n0))

    # The area's own land and water labels come first, then OSM places by importance.
    places = json.loads((area.vectors / "places_osm.geojson").read_text())["features"]
    towns = {f["properties"]["name"] for f in places if f["properties"]["place"] in ("town", "village")}
    labels, seen = [], set()
    for name, kind, _, lonlat in area.labels:
        lonlat = lonlat or find_place(places, name)
        if kind == "peak" or lonlat is None:
            continue
        if kind != "water":
            kind = "island" if name.endswith("Island") else "town" if name in towns else "place"
        x, z = world_xz(*lonlat, e0, n0)
        labels.append({"name": name, "kind": kind, "x": round(x), "z": round(z)})
        seen.add(name)
    for kind, tags in MAP_LABEL_KINDS:
        for f in places:
            p = f["properties"]
            if p["name"] in seen or (p["place"] or p["natural"]) not in tags:
                continue
            x, z = world_xz(*f["geometry"]["coordinates"], e0, n0)
            e, n = x + e0, n0 - z
            if clip.contains(box(e, n, e, n)):
                labels.append({"name": p["name"], "kind": kind, "x": round(x), "z": round(z)})
                seen.add(p["name"])

    minx, miny, maxx, maxy = clip.bounds
    out = {"extent": [round(minx - e0), round(n0 - maxy), round(maxx - e0), round(n0 - miny)],
           "land": land, "lakes": lakes, "roads": roads, "labels": labels,
           "credit": "© OpenStreetMap contributors"}
    path = area.out / "pilot_map.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Minimap: {len(land)} land and {len(lakes)} lake polygons, "
          f"{sum(len(v) for v in roads.values())} road lines, {len(labels)} labels "
          f"({path.stat().st_size / 1e6:.1f} MB)")


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
        detail_transform = src.transform
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
    export_map(area, detail_transform, rows, cols, e0, n0)
    print(f"Exported {area.name}: detail {cols} x {rows} ({h.nbytes / 1e6:.1f} MB), backdrop "
          f"{b.shape[1]} x {b.shape[0]} ({b.nbytes / 1e6:.1f} MB), {len(labels)} labels, "
          f"{len(path)} flyover points, {len(lake_out)} lakes; boat start height {boat_height} m")


if __name__ == "__main__":
    main()
