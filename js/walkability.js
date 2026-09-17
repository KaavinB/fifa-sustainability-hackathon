// The walkability cost surface, as a grid the browser can actually sample.
//
// Source is a 53 MB float32 GeoTIFF at 30 m in Web Mercator. Routes are a few
// dozen points and the surface is smooth at street scale, so it ships as a
// 150 m lat/lon grid quantised to one byte a cell — 173 KB over the wire, and
// a lookup is two divisions with no projection maths.
// See tools/build-walkability-grid.py.
//
// IMPORTANT: this is a COST surface. A higher index means *harder* to walk.
// The file records that in `polarity` rather than pre-inverting the numbers,
// and `easeAt` is the only place the inversion happens. Confirmed against
// known walkable and unwalkable locations before it was wired in: Montrose
// 2.43, Rice Village 2.48 against ship channel 9.39 and airside IAH 8.93.

import { WALKABILITY_URL } from './config.js';

let grid = null;
let loading = null;

/** Load once; a failure is remembered so we don't retry on every route. */
export async function loadWalkability() {
  if (grid !== null) return grid;
  if (loading) return loading;

  loading = fetch(WALKABILITY_URL)
    .then(async (res) => {
      if (!res.ok) throw new Error(`walkability grid ${res.status}`);
      const doc = await res.json();

      const binary = atob(doc.data);
      const cells = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) cells[i] = binary.charCodeAt(i);

      grid = {
        cells,
        rows: doc.rows,
        cols: doc.cols,
        bbox: doc.bbox,
        min: doc.min,
        max: doc.max,
        nodata: doc.nodata,
        metres: doc.metres,
        polarity: doc.polarity,
        higherIsWorse: doc.polarity !== 'higher-is-better',
      };
      return grid;
    })
    .catch(() => {
      grid = false; // absent, not pending
      return grid;
    });

  return loading;
}

/** Raw cost index at a point, or null where the surface has no value. */
export function indexAt(lat, lon) {
  if (!grid) return null;
  const { bbox, rows, cols, cells, nodata, min, max } = grid;
  if (lat < bbox.s || lat > bbox.n || lon < bbox.w || lon > bbox.e) return null;

  const row = Math.min(rows - 1, Math.floor(((bbox.n - lat) / (bbox.n - bbox.s)) * rows));
  const col = Math.min(cols - 1, Math.floor(((lon - bbox.w) / (bbox.e - bbox.w)) * cols));
  const raw = cells[row * cols + col];
  if (raw === nodata) return null;
  return min + (raw / 254) * (max - min);
}

/**
 * 0..1 where 1 is easiest to walk — the single place the cost surface is
 * inverted. Everything downstream reads this, so the polarity lives in one
 * line rather than being assumed in five.
 */
export function easeAt(lat, lon) {
  const value = indexAt(lat, lon);
  if (value === null) return null;
  const span = grid.max - grid.min || 1;
  const normalised = (value - grid.min) / span;
  return grid.higherIsWorse ? 1 - normalised : normalised;
}

/** Ease along a path, plus how much of it the surface actually covers. */
export function pathWalkability(points) {
  if (!grid || !points?.length) return { ease: null, coverage: 0, values: [] };

  const values = points.map(([lat, lon]) => easeAt(lat, lon));
  const known = values.filter((v) => v !== null);
  return {
    // Null rather than 0 when nothing is covered: "no data" and "unwalkable"
    // are different claims and the UI must not conflate them.
    ease: known.length ? known.reduce((a, b) => a + b, 0) / known.length : null,
    coverage: values.length ? known.length / values.length : 0,
    values,
  };
}

export const walkabilityMeta = () => grid || null;
