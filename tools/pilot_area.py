"""Pilot areas: extent, grids, world origin, datum offsets, labels, flyover, boat and wind.

Every tools/ script takes the area name as its first argument (default: howe), e.g.
    mamba run -n geo_env python tools/fetch_pilot.py howe
"""

import argparse
from dataclasses import dataclass, field
from pathlib import Path

from pyproj import Transformer
from rasterio.transform import from_origin

ROOT = Path(__file__).resolve().parent.parent
UTM = "EPSG:26910"
MRDEM_URL = "/vsicurl/https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif"
NONNA_WCS = "https://nonna-geoserver.data.chs-shc.ca/geoserver/wcs"

to_utm = Transformer.from_crs("EPSG:4326", UTM, always_xy=True)


@dataclass
class Area:
    name: str
    title: str
    coord: str  # shown under the title
    note: str
    bounds: tuple  # detail grid (west, south, east, north), degrees
    origin: tuple  # world origin (lon, lat)
    backdrop: tuple  # low-detail backdrop grid (west, south, east, north), degrees
    # Chart datum height in CGVD2013 (m), from CHS tide stations:
    # elevation_CGVD2013 = elevation_chart_datum + offset.
    datum_offset: float
    # Water bodies with their own offset: (name, (lon, lat) inside it, offset).
    datum_bodies: list = field(default_factory=list)
    # (name, kind, max view distance m, (lon, lat) or None to look up in OSM).
    # kind: land, peak or water.
    labels: list = field(default_factory=list)
    flyover: list = field(default_factory=list)  # (lon, lat, minimum height m)
    boat: tuple = (0, 0, 0)  # (lon, lat, heading degrees true)
    boat_where: str = ""
    wind_from: float = 292  # degrees true
    wind_kn: float = 14
    res: float = 30.0
    backdrop_res: float = 100.0  # 100 m keeps distant ridgelines jagged; 200 m looked smooth

    @property
    def raw(self):
        return ROOT / "data" / "raw" / self.name

    @property
    def work(self):
        return ROOT / "data" / "work" / self.name

    @property
    def vectors(self):
        return ROOT / "data" / "vectors" / self.name

    @property
    def out(self):
        return ROOT / "pilot" / "data" / self.name

    def grid(self, backdrop=False):
        """Return (transform, width, height) of the UTM grid, snapped to its resolution."""
        res = self.backdrop_res if backdrop else self.res
        west, south, east, north = self.backdrop if backdrop else self.bounds
        xs, ys = zip(*[to_utm.transform(x, y) for x in (west, east) for y in (south, north)])
        left = (min(xs) // res) * res
        top = -((-max(ys)) // res) * res
        right = -((-max(xs)) // res) * res
        bottom = (min(ys) // res) * res
        width = int(round((right - left) / res))
        height = int(round((top - bottom) / res))
        return from_origin(left, top, res, res), width, height

    def origin_utm(self):
        return to_utm.transform(*self.origin)


AREAS = {
    # Horseshoe Bay to Gibsons Landing, with the North Shore mountains behind.
    "howe": Area(
        name="howe",
        title="Howe Sound",
        coord="49.3750° N  123.2730° W · Horseshoe Bay to Gibsons",
        note="Real terrain: NRCan MRDEM 30 m elevation and CHS NONNA bathymetry "
             "(not for navigation), OpenStreetMap coastline.",
        bounds=(-123.56, 49.33, -123.10, 49.55),
        origin=(-123.39, 49.40),
        backdrop=(-123.95, 49.15, -122.85, 49.95),
        datum_offset=-2.92,  # Point Atkinson -2.90, Gibsons -2.94
        labels=[
            ("Horseshoe Bay", "land", 9000, None),
            ("Gibsons", "land", 12000, None),
            ("Langdale", "land", 7000, None),
            ("Lions Bay", "land", 9000, None),
            ("Port Mellon", "land", 9000, None),
            ("Point Atkinson", "land", 8000, None),
            ("Bowen Island", "land", 14000, (-123.375, 49.385)),
            ("Keats Island", "land", 10000, None),
            ("Gambier Island", "land", 14000, (-123.405, 49.49)),
            ("Anvil Island", "land", 14000, None),
            ("West Lion", "peak", 26000, None),
            ("Brunswick Mountain", "peak", 26000, None),
            ("Mount Strachan", "peak", 20000, None),
            ("Mount Gardner", "peak", 15000, None),
            ("Howe Sound", "water", 20000, (-123.285, 49.47)),
            ("Queen Charlotte Channel", "water", 10000, (-123.305, 49.36)),
            ("Collingwood Channel", "water", 9000, (-123.425, 49.37)),
            ("Shoal Channel", "water", 6000, (-123.488, 49.405)),
            ("Thornbrough Channel", "water", 9000, (-123.468, 49.48)),
        ],
        # A loop that stays over water: up Queen Charlotte Channel and the east side of Howe Sound,
        # south of Anvil, round the north of Gambier, down Thornbrough Channel past Langdale,
        # between Keats and Bowen (Collingwood Channel) and back along the south of Bowen.
        flyover=[
            (-123.307, 49.336, 90), (-123.296, 49.360, 80), (-123.298, 49.380, 70),
            (-123.291, 49.405, 70), (-123.290, 49.427, 70), (-123.280, 49.451, 80),
            (-123.259, 49.480, 90), (-123.286, 49.502, 100), (-123.325, 49.508, 90),
            (-123.355, 49.540, 100), (-123.405, 49.543, 100), (-123.428, 49.537, 100),
            (-123.450, 49.510, 80), (-123.468, 49.481, 70), (-123.459, 49.447, 70),
            (-123.443, 49.423, 70), (-123.422, 49.394, 70), (-123.437, 49.366, 70),
            (-123.436, 49.339, 80), (-123.400, 49.331, 90), (-123.355, 49.332, 90),
        ],
        boat=(-123.303, 49.379, 285),  # Queen Charlotte Channel, west of Whytecliff
        boat_where="off Horseshoe Bay",
        wind_from=190,  # summer afternoon inflow up Howe Sound
        wind_kn=14,
    ),
    # The first pilot: Halfmoon Bay to Gibsons and the lower Sechelt Inlet.
    "sechelt": Area(
        name="sechelt",
        title="Sechelt",
        coord="49.4742° N  123.7545° W · Sunshine Coast, BC",
        note="Real terrain, Halfmoon Bay to Gibsons: NRCan MRDEM 30 m elevation and CHS NONNA "
             "bathymetry (not for navigation), OpenStreetMap coastline.",
        bounds=(-123.97, 49.35, -123.42, 49.62),
        origin=(-123.7545, 49.4742),
        backdrop=(-124.35, 49.15, -123.05, 49.90),
        datum_offset=-2.91,  # Point Atkinson -2.90, Gibsons -2.94, Halfmoon Bay -2.88
        # Sechelt Inlet sits behind Skookumchuck Narrows and has a smaller tide (Porpoise Bay).
        datum_bodies=[("Sechelt Inlet", (-123.759, 49.482), -1.44)],
        labels=[
            ("Sechelt", "land", 9000, None),
            ("Davis Bay", "land", 8000, None),
            ("Selma Park", "land", 6000, None),
            ("Roberts Creek", "land", 9000, None),
            ("Gibsons", "land", 12000, None),
            ("Trail Islands", "land", 9000, (-123.808, 49.461)),
            ("Keats Island", "land", 12000, None),
            ("Halfmoon Bay", "water", 9000, None),
            ("Sargeant Bay", "water", 7000, None),
            ("Porpoise Bay", "water", 7000, None),
            ("Sechelt Inlet", "water", 11000, (-123.775, 49.555)),
            ("Strait of Georgia", "water", 16000, (-123.78, 49.395)),
        ],
        flyover=[
            (-123.655, 49.415, 90), (-123.700, 49.432, 55), (-123.735, 49.452, 40),
            (-123.780, 49.462, 34), (-123.820, 49.470, 32), (-123.860, 49.482, 30),
            (-123.900, 49.500, 40), (-123.915, 49.520, 70), (-123.880, 49.515, 40),
            (-123.830, 49.495, 50), (-123.780, 49.478, 120), (-123.762, 49.490, 90),
            (-123.770, 49.520, 60), (-123.785, 49.555, 70), (-123.800, 49.590, 140),
            (-123.740, 49.585, 450), (-123.660, 49.540, 760), (-123.620, 49.470, 320),
            (-123.620, 49.425, 130),
        ],
        boat=(-123.752, 49.462, 200),
        boat_where="in Trail Bay",
        wind_from=292,
        wind_kn=14,
    ),
}


def area_from_args(description=""):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("area", nargs="?", default="howe", choices=sorted(AREAS))
    return AREAS[parser.parse_args().area]
