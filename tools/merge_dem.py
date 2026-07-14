"""Merge MRDEM land and NONNA bathymetry into one height grid for a pilot area.

Output (data/work/<area>/):
    merged_30m.tif     heights in metres above CGVD2013; sea level is 0
    land_mask.tif      1 = land (from the OSM coastline), 0 = sea
    town_mask.tif      1 = built-up land from OSM (no trees)
    backdrop.tif       low-detail heights for the surrounding mountains
    preview.png        hillshade with the coastline, for a visual check
and data/vectors/<area>/lakes.geojson (lakes above sea level with their surface height).

    mamba run -n geo_env python tools/merge_dem.py [howe|sechelt]
"""

import json

import matplotlib
import numpy as np
import rasterio
import shapely
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.fill import fillnodata
from rasterio.warp import reproject
from scipy import ndimage
from shapely.geometry import box, shape
from shapely.ops import polygonize, unary_union

from pilot_area import UTM, area_from_args, to_utm

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

NONNA_NIL = 1e30  # NONNA marks no-data with float32 max (3.4e38)
SHORE_BAND_PX = 3  # blend this many pixels (90 m) either side of the shoreline
MIN_LAKE_AREA_M2 = 20_000
BACKDROP_SEA_M = -40.0  # the backdrop has no bathymetry; its sea floor sits at this depth
BACKDROP_LAND_MIN_M = 0.5  # backdrop cells at or below this are treated as sea


def to_utm_geom(geom):
    return shapely.transform(geom, lambda xy: np.column_stack(to_utm.transform(xy[:, 0], xy[:, 1])))


def land_mask_from_coastline(area, transform, width, height):
    """Rasterise land from OSM coastline ways, which keep land on their left."""
    grid_box = box(transform.c, transform.f - height * transform.a,
                   transform.c + width * transform.a, transform.f)
    land_faces, lines = coastline_land(area, grid_box)
    mask = rasterize(((f, 1) for f in land_faces), out_shape=(height, width),
                     transform=transform, fill=0, dtype="uint8")
    return mask.astype(bool), lines


def coastline_land(area, grid_box):
    """Land polygons (UTM) inside grid_box from the OSM coastline, plus the merged coast lines."""
    feats = json.loads((area.vectors / "coastline.geojson").read_text())["features"]
    ways = [to_utm_geom(shape(f["geometry"])) for f in feats]
    # Join ways end to end, keeping their direction, so the side test works at way joints.
    coast = shapely.line_merge(shapely.MultiLineString(ways), directed=True)
    lines = list(coast.geoms) if hasattr(coast, "geoms") else [coast]

    noded = unary_union([ln.intersection(grid_box) for ln in lines] + [grid_box.exterior])
    faces = list(polygonize(noded))
    tree = shapely.STRtree(lines)

    land_faces = []
    for face in faces:
        p = face.representative_point()
        line = lines[tree.nearest(p)]
        d = line.project(p)
        a = line.interpolate(max(d - 1.0, 0.0))
        b = line.interpolate(min(d + 1.0, line.length))
        q = line.interpolate(d)
        cross = (b.x - a.x) * (p.y - q.y) - (b.y - a.y) * (p.x - q.x)
        if cross > 0:
            land_faces.append(face)
    print(f"Coastline: {len(lines)} lines, {len(faces)} faces, {len(land_faces)} land")
    return land_faces, lines


def datum_offsets(area, sea, transform):
    """Chart-datum offset per pixel: one per connected water body, default elsewhere."""
    offset = np.full(sea.shape, area.datum_offset, dtype="float32")
    if not area.datum_bodies:
        print(f"Datum: {area.datum_offset} m everywhere")
        return offset
    labels, n = ndimage.label(sea)
    sizes = ndimage.sum(sea, labels, range(1, n + 1))
    main_label = int(np.argmax(sizes)) + 1
    # Tide stations sit on docks, so the point may fall on a land pixel: snap to the nearest water.
    _, (near_r, near_c) = ndimage.distance_transform_edt(~sea, return_indices=True)
    for name, lonlat, value in area.datum_bodies:
        col, row = ~transform * to_utm.transform(*lonlat)
        row, col = int(row), int(col)
        snap_r, snap_c = near_r[row, col], near_c[row, col]
        if abs(snap_r - row) + abs(snap_c - col) > 40:
            raise RuntimeError(f"No water within ~1 km of the {name} datum point")
        label = labels[snap_r, snap_c]
        if label == main_label:
            print(f"WARNING: {name} is connected to the main water body inside the grid; "
                  f"its offset is not applied")
            continue
        offset[labels == label] = value
        print(f"Datum: {name} {int(sizes[label - 1])} px at {value} m")
    print(f"Datum: main water body {int(sizes[main_label - 1])} px at {area.datum_offset} m "
          f"({n} water bodies)")
    return offset


def read_bathymetry(area, level, transform, width, height, resampling):
    out = np.full((height, width), np.nan, dtype="float32")
    tiles = sorted((area.raw / f"nonna{level}").glob("tile_*.tif"))
    for path in tiles:
        with rasterio.open(path) as src:
            a = src.read(1).astype("float32")
            a[~np.isfinite(a) | (np.abs(a) > NONNA_NIL)] = np.nan
            if not np.isfinite(a).any():
                continue
            tmp = np.full((height, width), np.nan, dtype="float32")
            reproject(a, tmp, src_transform=src.transform, src_crs=src.crs, src_nodata=np.nan,
                      dst_transform=transform, dst_crs=UTM, dst_nodata=np.nan,
                      resampling=resampling)
        fill = np.isnan(out) & np.isfinite(tmp)
        out[fill] = tmp[fill]
    print(f"NONNA-{level}: {len(tiles)} tiles, covers {np.isfinite(out).mean():.1%} of grid")
    return out


def rasterize_vectors(path, transform, width, height):
    feats = json.loads(path.read_text())["features"]
    geoms = [to_utm_geom(shape(f["geometry"])) for f in feats]
    if not geoms:
        return np.zeros((height, width), dtype=bool)
    return rasterize(((g, 1) for g in geoms), out_shape=(height, width), transform=transform,
                     fill=0, dtype="uint8").astype(bool)


def lakes(area, land_dem, sea, transform, width, height):
    feats = json.loads((area.vectors / "water_osm.geojson").read_text())["features"]
    out = []
    for f in feats:
        geom = to_utm_geom(shape(f["geometry"]))
        if geom.area < MIN_LAKE_AREA_M2:
            continue
        px = rasterize([(geom, 1)], out_shape=(height, width), transform=transform,
                       fill=0, dtype="uint8").astype(bool)
        if px.sum() < 4 or (sea & px).sum() > 0.5 * px.sum():
            continue
        vals = land_dem[px & np.isfinite(land_dem)]
        if vals.size < 4:
            continue
        surface = float(np.percentile(vals, 20))
        if surface < 1.5:
            continue
        props = dict(f["properties"], surface_m=round(surface, 2), area_m2=round(geom.area))
        out.append({"type": "Feature", "properties": props, "geometry": f["geometry"]})
    (area.vectors / "lakes.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": out}))
    named = ", ".join(sorted({f["properties"]["name"] for f in out if f["properties"]["name"]}))
    print(f"Lakes: {len(out)} above sea level ({named})")


def backdrop(area):
    """Low-detail heights around the pilot: MRDEM land, flat sea floor elsewhere."""
    transform, width, height = area.grid(backdrop=True)
    with rasterio.open(area.raw / "land_backdrop.tif") as src:
        b = src.read(1)
    land = np.isfinite(b) & (b > BACKDROP_LAND_MIN_M)
    b = np.where(land, b, BACKDROP_SEA_M).astype("float32")
    profile = dict(driver="GTiff", width=width, height=height, count=1, crs=UTM, dtype="float32",
                   transform=transform, compress="deflate", tiled=True, predictor=3)
    with rasterio.open(area.work / "backdrop.tif", "w", **profile) as dst:
        dst.write(b, 1)
    print(f"Backdrop: {width} x {height} at {area.backdrop_res:.0f} m, {land.mean():.1%} land, "
          f"max {b.max():.0f} m")


def hillshade(h, res, az=315, alt=45):
    gy, gx = np.gradient(h, res)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = np.radians(az), np.radians(alt)
    return np.clip(np.sin(alt) * np.cos(slope) +
                   np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1)


def preview(area, h, land, towns, transform, lines):
    hs = hillshade(h, transform.a)
    sea_t = np.clip(-h / 300, 0, 1)[..., None]
    sea_col = (1 - sea_t) * np.array([0.55, 0.78, 0.85]) + sea_t * np.array([0.05, 0.15, 0.35])
    land_t = np.clip(h / 1500, 0, 1)[..., None]
    land_col = (1 - land_t) * np.array([0.35, 0.55, 0.30]) + land_t * np.array([0.85, 0.82, 0.78])
    land_col = np.where(towns[..., None], np.array([0.75, 0.55, 0.45]), land_col)
    rgb = np.where(land[..., None], land_col, sea_col) * (0.35 + 0.65 * hs[..., None])
    extent = (transform.c, transform.c + h.shape[1] * transform.a,
              transform.f - h.shape[0] * transform.a, transform.f)
    fig, ax = plt.subplots(figsize=(16, 16 * h.shape[0] / h.shape[1]), dpi=100)
    ax.imshow(rgb, extent=extent)
    for ln in lines:
        x, y = ln.xy
        ax.plot(x, y, color="red", lw=0.4)
    ax.set_xlim(extent[:2])
    ax.set_ylim(extent[2:])
    ax.set_title(f"{area.title}: merged DEM (hillshade); red = OSM coastline, tan = towns")
    fig.tight_layout()
    fig.savefig(area.work / "preview.png")
    plt.close(fig)


def main():
    area = area_from_args("Merge land and bathymetry for a pilot area")
    area.work.mkdir(parents=True, exist_ok=True)
    transform, width, height = area.grid()
    profile = dict(driver="GTiff", width=width, height=height, count=1, crs=UTM,
                   transform=transform, compress="deflate", tiled=True)

    with rasterio.open(area.raw / "land_mrdem30.tif") as src:
        land_dem = src.read(1)

    land, lines = land_mask_from_coastline(area, transform, width, height)
    sea = ~land
    offset = datum_offsets(area, sea, transform)

    b10 = read_bathymetry(area, 10, transform, width, height, Resampling.average)
    b100 = read_bathymetry(area, 100, transform, width, height, Resampling.bilinear)
    bathy = np.where(np.isfinite(b10), b10, b100) + offset

    # Checks: how well do the DEM and the coastline agree?
    shore_dist_land = ndimage.distance_transform_edt(land)
    inland = land & (shore_dist_land > 3)
    print(f"Check: inland pixels with MRDEM <= 0: {(inland & (land_dem <= 0)).sum()} "
          f"of {inland.sum()}")
    print(f"Check: sea pixels with NONNA data: {np.isfinite(bathy[sea]).mean():.1%}; "
          f"NONNA-10 share {np.isfinite(b10[sea]).mean():.1%}")

    h = np.full((height, width), np.nan, dtype="float32")
    h[land] = np.maximum(land_dem[land], 0.3)
    h[sea] = np.minimum(bathy[sea], -0.3)

    # Seed shallow water right at the shore where NONNA has no data, then fill the gaps.
    shore_dist_sea = ndimage.distance_transform_edt(sea)
    seed = sea & np.isnan(h) & (shore_dist_sea <= 1.5)
    h[seed] = -0.5
    missing = np.isnan(h)
    print(f"Filling {missing.sum()} missing pixels ({missing.mean():.2%})")
    h = fillnodata(h, mask=~missing, max_search_distance=400, smoothing_iterations=0)
    still = np.isnan(h)
    if still.any():
        h[still & sea] = -50.0
        h[still & land] = 1.0

    # Blend a band either side of the shoreline so beaches don't become cliffs.
    band = (np.minimum(shore_dist_land, shore_dist_sea) <= SHORE_BAND_PX)
    smoothed = ndimage.gaussian_filter(h, sigma=1.0)
    h[band] = smoothed[band]
    h[land] = np.maximum(h[land], 0.3)
    h[sea] = np.minimum(h[sea], -0.3)

    towns = rasterize_vectors(area.vectors / "towns_osm.geojson", transform, width, height) & land

    with rasterio.open(area.work / "merged_30m.tif", "w", dtype="float32", nodata=None,
                       predictor=3, **profile) as dst:
        dst.write(h.astype("float32"), 1)
    with rasterio.open(area.work / "land_mask.tif", "w", dtype="uint8", **profile) as dst:
        dst.write(land.astype("uint8"), 1)
    with rasterio.open(area.work / "town_mask.tif", "w", dtype="uint8", **profile) as dst:
        dst.write(towns.astype("uint8"), 1)
    print(f"Merged: {width} x {height}, {land.mean():.1%} land ({towns.sum() / land.sum():.1%} "
          f"of it built-up), range {h.min():.1f} to {h.max():.1f} m")

    lakes(area, land_dem, sea, transform, width, height)
    backdrop(area)
    preview(area, h, land, towns, transform, lines)
    print(f"Wrote {area.work.relative_to(area.work.parents[2])}/")


if __name__ == "__main__":
    main()
