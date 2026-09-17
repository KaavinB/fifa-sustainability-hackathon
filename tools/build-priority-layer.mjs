// The priority layer: where to spend first.
//
//   node tools/build-priority-layer.mjs [topN]
//
// Deliverable 2b of the brief — high intensity crossed with low walkability.
// Neither half is a finding on its own. A busy corridor that is already
// pleasant needs nothing; a miserable corridor nobody walks down is not where
// a limited budget goes. The product of the two is the question a city
// actually has to answer.
//
// Intensity comes from the 1,000-route demand simulation (tools/simulate-demand.mjs),
// difficulty from the GIS team's walkability cost surface (tools/build-walkability-grid.py).
// Both are prebuilt, so this is a join and costs nothing at run time.

import { readFile, writeFile } from 'node:fs/promises';

const TOP_N = Number(process.argv[2] || 40);
const UA = 'houston-route-comparison/1.0 (FIFA Sustainability Hackathon)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeSampler(doc) {
  const cells = Buffer.from(doc.data, 'base64');
  const { bbox, rows, cols, min, max, nodata } = doc;

  return (lat, lon) => {
    if (lat < bbox.s || lat > bbox.n || lon < bbox.w || lon > bbox.e) return null;
    const row = Math.min(rows - 1, Math.floor(((bbox.n - lat) / (bbox.n - bbox.s)) * rows));
    const col = Math.min(cols - 1, Math.floor(((lon - bbox.w) / (bbox.e - bbox.w)) * cols));
    const raw = cells[row * cols + col];
    if (raw === nodata) return null;
    return min + (raw / 254) * (max - min);
  };
}

/** Name a point, so the output reads as a place rather than a coordinate. */
async function nameOf(lat, lon) {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const p = (await res.json()).features?.[0]?.properties;
    if (!p) return null;
    return [p.street || p.name, p.district || p.city].filter(Boolean).join(' · ') || null;
  } catch {
    return null;
  }
}

async function main() {
  const demand = JSON.parse(await readFile('data/demand.json', 'utf8'));
  const walk = JSON.parse(await readFile('data/walkability.json', 'utf8'));
  const costAt = makeSampler(walk);

  console.log(`demand: ${demand.hotspots.length} cells from ${demand.routed} routes`);
  console.log(`walkability: ${walk.cols}x${walk.rows} @ ${walk.metres} m, ${walk.polarity}`);

  const maxTrips = Math.max(...demand.hotspots.map((h) => h.n));

  const scored = demand.hotspots
    .map((h) => {
      const [lat, lon] = h.c;
      const cost = costAt(lat, lon);
      if (cost === null) return null;

      // Both on 0..1 before multiplying, so neither half can dominate by
      // having a bigger native range.
      const intensity = h.n / maxTrips;
      const difficulty = (cost - walk.min) / (walk.max - walk.min);

      return {
        coord: [lat, lon],
        trips: h.n,
        cost: Math.round(cost * 100) / 100,
        intensity: Math.round(intensity * 1000) / 1000,
        difficulty: Math.round(difficulty * 1000) / 1000,
        // The product, not the sum: a corridor has to be both busy AND hard
        // before it earns money. A sum would let either half carry it alone.
        priority: Math.round(intensity * difficulty * 1000) / 1000,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority);

  console.log(`\n${scored.length} cells have both demand and walkability coverage`);

  // Spread the picks out: neighbouring cells on one street are one place, and
  // a top-ten of the same block is not a list of ten priorities.
  const picked = [];
  for (const cell of scored) {
    const far = picked.every((p) => {
      const dLat = (p.coord[0] - cell.coord[0]) * 111320;
      const dLon = (p.coord[1] - cell.coord[1]) * 96500;
      return Math.hypot(dLat, dLon) > 400;
    });
    if (far) picked.push(cell);
    if (picked.length >= TOP_N) break;
  }

  console.log(`naming ${picked.length} sites…`);
  for (const cell of picked) {
    cell.name = await nameOf(cell.coord[0], cell.coord[1]);
    await sleep(900); // shared public geocoder
  }

  await writeFile(
    'data/priority.json',
    JSON.stringify({
      v: 1,
      generated: new Date().toISOString().slice(0, 10),
      method:
        'intensity x difficulty, both normalised 0..1. Intensity is the share of ' +
        `${demand.routed} simulated walking trips passing a 60 m cell; difficulty is the ` +
        "GIS team's walkability cost index at that cell. Venue surroundings are excluded " +
        'upstream, since every route ends at a venue.',
      routed: demand.routed,
      sites: picked,
    }),
  );

  console.log('\nHighest priority — busiest AND hardest to walk:\n');
  console.log(`${'#'.padStart(3)}  ${'priority'.padStart(8)}  ${'trips'.padStart(5)}  ${'cost'.padStart(5)}  place`);
  picked.slice(0, 12).forEach((c, i) => {
    console.log(
      `${String(i + 1).padStart(3)}  ${String(c.priority).padStart(8)}  ${String(c.trips).padStart(5)}  ` +
        `${String(c.cost).padStart(5)}  ${c.name || c.coord.map((v) => v.toFixed(4)).join(', ')}`,
    );
  });
  console.log('\nwrote data/priority.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
