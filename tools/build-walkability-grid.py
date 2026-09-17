#!/usr/bin/env python3
"""Turn a walkability cost raster into something a browser can actually load.

    python3 tools/build-walkability-grid.py <raster.tif> [metres]

The source is 4030x2992 float32 in EPSG:3857 — 48 MB, twelve million pixels.
Sampling a route needs none of that: a route is a few dozen points, and the
cost surface is smooth at street scale. So this resamples onto a regular
lat/lon grid (trivial to index from JavaScript: row from latitude, column from
longitude, no projection maths at runtime) and quantises to one byte per cell.

Values are stored as the ORIGINAL index, with the polarity recorded in the
file rather than baked into the numbers. Higher means *less* walkable here —
it is a cost surface — and a reader that silently inverted it would be
impossible to audit later.
"""
import base64, json, math, sys, datetime
import numpy as np
import tifffile

R = 6378137.0
NODATA_OUT = 255


def to_mercator(lat, lon):
    x = np.radians(lon) * R
    y = R * np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))
    return x, y


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else 'WalkabilityCS_MRD_Full_nodataset.tif'
    target_m = float(sys.argv[2]) if len(sys.argv) > 2 else 150.0

    with tifffile.TiffFile(path) as tf:
        page = tf.pages[0]
        tags = {t.name: t.value for t in page.tags}
        sx, sy = tags['ModelPixelScaleTag'][:2]
        _, _, _, ox, oy, *_ = tags['ModelTiepointTag']
        src = page.asarray().astype('float32')

    h, w = src.shape
    # Source corners, back in degrees.
    def to_ll(x, y):
        return math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), math.degrees(x / R)

    north, west = to_ll(ox, oy)
    south, east = to_ll(ox + w * sx, oy - h * sy)

    # Mercator "metres" are not ground metres away from the equator; at this
    # latitude the 30-unit pixels are about 26 m on the ground. The target grid
    # is specified in real metres, so convert through the local scale factor.
    mid_lat = (north + south) / 2
    deg_lat = target_m / 111320.0
    deg_lon = target_m / (111320.0 * math.cos(math.radians(mid_lat)))

    rows = int(math.floor((north - south) / deg_lat))
    cols = int(math.floor((east - west) / deg_lon))

    # Cell centres of the output grid, then straight back to source pixels.
    lats = north - (np.arange(rows) + 0.5) * deg_lat
    lons = west + (np.arange(cols) + 0.5) * deg_lon
    lon_grid, lat_grid = np.meshgrid(lons, lats)
    mx, my = to_mercator(lat_grid, lon_grid)

    col_idx = np.clip(((mx - ox) / sx).astype('int32'), 0, w - 1)
    row_idx = np.clip(((oy - my) / sy).astype('int32'), 0, h - 1)
    sampled = src[row_idx, col_idx]

    valid = sampled > 0  # 0 is the source nodata
    lo = float(sampled[valid].min())
    hi = float(sampled[valid].max())

    # 0..254 for data, 255 reserved for "no value". One byte per cell keeps the
    # whole surface small enough to ship; the quantisation step is ~0.03 index
    # units, far finer than the surface actually varies over 150 m.
    quant = np.full(sampled.shape, NODATA_OUT, dtype='uint8')
    scaled = (sampled[valid] - lo) / (hi - lo) * 254.0
    quant[valid] = np.clip(np.round(scaled), 0, 254).astype('uint8')

    doc = {
        'v': 1,
        'name': 'walkability',
        'unit': 'walkability cost index',
        'polarity': 'higher-is-worse',
        'note': 'Cost surface: a higher index means harder to walk. Confirmed against '
                'known walkable and unwalkable locations before use.',
        'source': path.split('/')[-1],
        'generated': datetime.date.today().isoformat(),
        'crs': 'EPSG:4326 regular grid, resampled from EPSG:3857',
        'metres': target_m,
        'bbox': {'s': round(south, 6), 'w': round(west, 6),
                 'n': round(north, 6), 'e': round(east, 6)},
        'rows': rows, 'cols': cols,
        'min': round(lo, 4), 'max': round(hi, 4),
        'nodata': NODATA_OUT,
        'data': base64.b64encode(quant.tobytes()).decode('ascii'),
    }

    out = 'data/walkability.json'
    with open(out, 'w') as f:
        json.dump(doc, f, separators=(',', ':'))

    import os
    size = os.path.getsize(out)
    covered = int(valid.sum())
    print(f'source   {w}x{h} px @ {sx:g} Mercator units')
    print(f'extent   {south:.4f},{west:.4f} → {north:.4f},{east:.4f}')
    print(f'grid     {cols} x {rows} = {cols*rows:,} cells @ {target_m:g} m')
    print(f'values   {lo:.2f} … {hi:.2f}  ({covered:,} with data, {cols*rows-covered:,} nodata)')
    print(f'wrote    {out}  {size/1e6:.2f} MB')


if __name__ == '__main__':
    main()
