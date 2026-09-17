#!/usr/bin/env python3
"""Fetch the Harris County boundary and shrink it to something shippable.

    python3 tools/build-county-boundary.py [prefetched-overpass.json]

OSM returns the relation as 76 separate ways and about 8,000 points. Drawn as a
line that is far more detail than a boundary overlay needs, so each way is
simplified with Douglas-Peucker at roughly 40 m and written as a
MultiLineString.

The ways are not stitched into a ring: this is drawn as an outline, and an
unstitched set of lines renders identically while avoiding the endpoint-matching
that makes ring assembly fiddly and fragile.
"""
import json
import math
import urllib.parse
import urllib.request

QUERY = """
[out:json][timeout:90];
relation["boundary"="administrative"]["admin_level"="6"]["name"="Harris County"](29.4,-96.1,30.3,-94.8);
out geom;
"""

MIRRORS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
]

TOLERANCE_M = 40.0


def perpendicular_distance(point, start, end):
    """Metres from `point` to the segment start-end, locally projected."""
    scale_lon = math.cos(math.radians(point[0])) * 111320.0
    px, py = point[1] * scale_lon, point[0] * 111320.0
    ax, ay = start[1] * scale_lon, start[0] * 111320.0
    bx, by = end[1] * scale_lon, end[0] * 111320.0

    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(points, tolerance):
    if len(points) < 3:
        return points
    first, last = 0, len(points) - 1
    worst, index = 0.0, 0
    for i in range(1, last):
        d = perpendicular_distance(points[i], points[first], points[last])
        if d > worst:
            worst, index = d, i
    if worst <= tolerance:
        return [points[first], points[last]]
    return simplify(points[: index + 1], tolerance)[:-1] + simplify(points[index:], tolerance)


def fetch():
    body = urllib.parse.urlencode({'data': QUERY}).encode()
    last = None
    for mirror in MIRRORS:
        try:
            request = urllib.request.Request(
                mirror, data=body,
                headers={'User-Agent': 'houston-route-comparison/1.0 (hackathon)'},
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.load(response)
        except Exception as error:  # noqa: BLE001 - any failure means try the next mirror
            last = error
            print(f'  {mirror} failed: {error}')
    raise SystemExit(f'all mirrors failed: {last}')


def main():
    # Accept a pre-fetched Overpass response, because python's urllib cannot
    # verify certificates on a stock macOS install and curl can:
    #   curl -s -X POST --data-urlencode "data=<query>" <mirror> -o harris.json
    import sys
    if len(sys.argv) > 1:
        print(f'reading {sys.argv[1]}…')
        with open(sys.argv[1]) as handle:
            data = json.load(handle)
    else:
        print('fetching Harris County boundary…')
        data = fetch()
    relation = next((e for e in data.get('elements', []) if e.get('type') == 'relation'), None)
    if relation is None:
        raise SystemExit('no relation returned')

    raw_points = 0
    lines = []
    for member in relation.get('members', []):
        geometry = member.get('geometry')
        if member.get('type') != 'way' or not geometry:
            continue
        points = [[round(g['lat'], 5), round(g['lon'], 5)] for g in geometry]
        raw_points += len(points)
        reduced = simplify(points, TOLERANCE_M)
        if len(reduced) >= 2:
            lines.append(reduced)

    kept = sum(len(line) for line in lines)
    doc = {
        'v': 1,
        'name': relation['tags'].get('name', 'Harris County'),
        'source': 'OpenStreetMap relation, admin_level 6, ODbL',
        'toleranceMetres': TOLERANCE_M,
        'lines': lines,
    }

    out = 'data/harris-county.json'
    with open(out, 'w') as handle:
        json.dump(doc, handle, separators=(',', ':'))

    import os
    print(f'ways      {len(lines)}')
    print(f'points    {raw_points:,} -> {kept:,} ({100 * kept / raw_points:.0f}% kept at {TOLERANCE_M:g} m)')
    print(f'wrote     {out}  {os.path.getsize(out) / 1024:.0f} KB')


if __name__ == '__main__':
    main()
