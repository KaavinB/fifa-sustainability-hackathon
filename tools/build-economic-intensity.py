#!/usr/bin/env python3
"""Aggregate the Harris County business file into an economic-intensity grid.

    python3 tools/build-economic-intensity.py <businesses.csv> [metres]

Deliverable 2a of the brief lists economic intensity as an input to the
high-intensity-corridor classification. This turns 256,000 individual business
records into a grid the browser can hold, and does it by aggregating — the
source carries named individuals, phone numbers, gender and ethnicity, and none
of that should travel with a public demo even where the licence permits it.
Only counts per cell leave this script.

Two measures are produced per cell:

  jobs   total employees — economic intensity in the sense the brief means
  walk   employees in businesses people walk *to*: food, retail, personal
         services. Kept separate because the walkability index already contains
         a "stops for rest and water" term, and conflating the two would score
         the same signal twice.
"""
import csv
import json
import math
import os
import sys
from collections import defaultdict

# NAICS two- and three-digit prefixes for places a pedestrian actually goes.
# Deliberately excludes 621 (offices of physicians), which is the single
# largest category in the file at 25,739 records and would otherwise let the
# medical centre dominate a measure of street life.
WALK_PREFIXES = (
    '722',  # food services and drinking places
    '445',  # grocery and beverage stores
    '446',  # health and personal care stores
    '448',  # clothing and accessories
    '451', '459',  # sporting goods, hobby, books
    '452', '455',  # general merchandise
    '812',  # personal and laundry services
    '713',  # amusement and recreation
    '711',  # performing arts and spectator sports
    '512',  # motion picture and sound
)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
        '~/Downloads/harrisBusinesses_filtered.csv'
    )
    metres = float(sys.argv[2]) if len(sys.argv) > 2 else 150.0

    # Same extent as the walkability surface, so the two layers line up.
    bbox = {'s': 29.490137, 'w': -95.980093, 'n': 30.189554, 'e': -94.89403}
    mid_lat = (bbox['s'] + bbox['n']) / 2
    deg_lat = metres / 111320.0
    deg_lon = metres / (111320.0 * math.cos(math.radians(mid_lat)))
    rows = int((bbox['n'] - bbox['s']) / deg_lat)
    cols = int((bbox['e'] - bbox['w']) / deg_lon)

    cells = defaultdict(lambda: [0, 0, 0])  # jobs, walk-jobs, count
    total = kept = outside = actual = modeled = no_jobs = 0
    walk_records = 0

    with open(path, newline='', encoding='utf-8-sig') as handle:
        for record in csv.DictReader(handle):
            total += 1
            try:
                lat = float(record['Latitude'])
                lon = float(record['Longitude'])
            except (TypeError, ValueError):
                continue

            if not (bbox['s'] <= lat <= bbox['n'] and bbox['w'] <= lon <= bbox['e']):
                outside += 1
                continue

            # Zero-padded text in the source: "00004" is four employees.
            raw = (record.get('AcLocEmpSz') or '').strip().lstrip('0')
            jobs = int(raw) if raw.isdigit() else 0
            if jobs == 0:
                no_jobs += 1

            if (record.get('ModEmpSz') or '').strip().lower().startswith('actual'):
                actual += 1
            else:
                modeled += 1

            naics = (record.get('NaicsCd') or '').strip()
            is_walk = naics.startswith(WALK_PREFIXES)
            if is_walk:
                walk_records += 1

            row = int((bbox['n'] - lat) / deg_lat)
            col = int((lon - bbox['w']) / deg_lon)
            cell = cells[(row, col)]
            cell[0] += jobs
            cell[1] += jobs if is_walk else 0
            cell[2] += 1
            kept += 1

    # Sparse, because most of a county is empty: storing only occupied cells is
    # a fraction of the size of a dense grid and the lookup is identical.
    packed = [[r, c, v[0], v[1], v[2]] for (r, c), v in cells.items()]
    packed.sort(key=lambda p: -p[2])

    doc = {
        'v': 1,
        'name': 'economic intensity',
        'source': 'Harris County business directory, aggregated. No individual records.',
        'metres': metres,
        'bbox': bbox,
        'rows': rows,
        'cols': cols,
        'records': kept,
        'employeeCounts': {'actual': actual, 'modeled': modeled},
        'format': '[row, col, jobs, walkJobs, businesses]',
        'cells': packed,
    }

    out = 'data/economic-intensity.json'
    with open(out, 'w') as handle:
        json.dump(doc, handle, separators=(',', ':'))

    top_jobs = max(p[2] for p in packed)
    print(f'read        {total:,} records')
    print(f'  in extent {kept:,}   outside {outside:,}')
    print(f'  employees {actual:,} actual, {modeled:,} modelled by SIC'
          f'  ({100 * actual / max(1, actual + modeled):.0f}% measured)')
    print(f'  no count  {no_jobs:,}')
    print(f'  walk-relevant records {walk_records:,} ({100 * walk_records / max(1, kept):.0f}%)')
    print(f'grid        {cols} x {rows} @ {metres:g} m — {len(packed):,} occupied cells '
          f'({100 * len(packed) / max(1, rows * cols):.1f}% of the grid)')
    print(f'busiest cell {top_jobs:,} jobs')
    print(f'wrote       {out}  {os.path.getsize(out) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
