// Simulated pedestrian demand for a major-event week.
//
//   node tools/simulate-demand.mjs [routeCount]
//
// Routes a large sample of realistic trips — every hotel and a grid of
// neighbourhood points, to each venue — then aggregates where those routes
// overlap. Overlap is the useful signal: a street carrying 300 of 1000
// simulated trips is where shade and water actually matter, and comparing that
// against canopy says where the city should spend first.
//
// It runs offline and writes data/demand.json because a thousand routing calls
// is not something to do in a browser, or twice. The public OSRM instances are
// shared, so requests are deliberately throttled.

import { writeFile, readFile, mkdir } from 'node:fs/promises';

// Every successful route is cached to disk, so an interrupted run resumes for
// free and a re-run costs nothing. This is what makes 1000 routes reasonable
// to ask of a shared public service at all.
let cache = new Map();

async function loadCache() {
  try {
    cache = new Map(Object.entries(JSON.parse(await readFile(CACHE_PATH, 'utf8'))));
    console.log(`  ${cache.size} routes already cached`);
  } catch {
    cache = new Map();
  }
}

async function saveCache() {
  await writeFile(CACHE_PATH, JSON.stringify(Object.fromEntries(cache)));
}

const ROUTE_TARGET = Number(process.argv[2] || 1000);

// venues  — event-day demand: everyone walking to a tournament site.
// jobs    — everyday demand: people walking to where the jobs are, sampled
//           from the employment grid and capped at a plausible walking range.
//
// The two answer different questions and neither subsumes the other. Venue
// demand partly presupposes its answer, since every trip ends at one of four
// places and the corridors feeding them are guaranteed to dominate. Jobs
// demand makes no such assumption, which is why it is worth having both.
const MODE = (process.argv[3] || 'venues').toLowerCase();
const MAX_WALK_M = 2500; // ~30 minutes; nobody walks across the county to work
// One worker, roughly one request per second. A burst of ~40 got this IP
// throttled for several minutes, which took the live app's routing down with
// it — routing.openstreetmap.de and router.project-osrm.org resolve to the
// same host, so there is no second service to fall back to. Slow and cached
// beats fast and blocked.
const CONCURRENCY = 1;
const SPACING_MS = 1100;
const CACHE_PATH = 'tools/.route-cache.json';
const CELL_M = 60; // grid resolution for the overlap count
const UA = 'houston-route-comparison/1.0 (FIFA Sustainability Hackathon)';

// Where a visitor is actually trying to get to during the tournament.
const VENUES = [
  { name: 'NRG Stadium', coord: [29.6847, -95.4107], weight: 3 },
  { name: 'Discovery Green', coord: [29.753, -95.3596], weight: 2 },
  { name: 'George R. Brown', coord: [29.7527, -95.3565], weight: 1 },
  { name: 'Shell Energy Stadium', coord: [29.7522, -95.3524], weight: 1 },
];

const BBOX = { s: 29.66, w: -95.43, n: 29.78, e: -95.33 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query) {
  const mirrors = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];
  let lastError;
  for (const mirror of mirrors) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: { 'User-Agent': UA },
        body: new URLSearchParams({ data: query }),
      });
      if (!res.ok) throw new Error(`${mirror} -> ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      console.warn('  overpass retry:', err.message);
      await sleep(3000);
    }
  }
  throw lastError;
}

async function loadHotels() {
  const json = await overpass(`
    [out:json][timeout:90];
    (nwr["tourism"~"^(hotel|hostel|motel|guest_house)$"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}););
    out center tags;`);

  return (json.elements || [])
    .map((el) => {
      const coord = el.type === 'node' ? [el.lat, el.lon] : el.center && [el.center.lat, el.center.lon];
      if (!coord || !el.tags?.name) return null;
      return {
        name: el.tags.name,
        brand: el.tags.brand || null,
        rooms: el.tags.rooms ? Number(el.tags.rooms) : null,
        coord,
      };
    })
    .filter(Boolean);
}

/**
 * Destinations drawn from the employment grid, weighted by jobs and limited to
 * what is walkable from the origin. Without the distance cap every trip becomes
 * a fifteen-kilometre slog to the medical centre, which is not a walk anyone
 * takes and not a corridor worth planning for.
 */
async function jobDestinations() {
  const doc = JSON.parse(await readFile('data/economic-intensity.json', 'utf8'));
  const { bbox, rows, cols } = doc;
  const latStep = (bbox.n - bbox.s) / rows;
  const lonStep = (bbox.e - bbox.w) / cols;

  return doc.cells
    .filter(([, , jobs]) => jobs >= 50) // skip cells with a handful of jobs
    .map(([row, col, jobs]) => ({
      name: `${jobs} jobs`,
      coord: [bbox.n - (row + 0.5) * latStep, bbox.w + (col + 0.5) * lonStep],
      jobs,
    }));
}

/** Weighted pick: a cell with ten times the jobs is ten times as likely. */
function pickWeighted(candidates) {
  const total = candidates.reduce((sum, c) => sum + c.jobs, 0);
  let roll = Math.random() * total;
  for (const c of candidates) {
    roll -= c.jobs;
    if (roll <= 0) return c;
  }
  return candidates[candidates.length - 1];
}

function metresBetween(a, b) {
  const dLat = (a[0] - b[0]) * 111320;
  const dLon = (a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** Neighbourhood origins, so demand is not only hotel guests. */
function gridOrigins(step = 0.012) {
  const points = [];
  for (let lat = BBOX.s + step; lat < BBOX.n; lat += step) {
    for (let lon = BBOX.w + step; lon < BBOX.e; lon += step) {
      points.push({ name: `Area ${lat.toFixed(3)},${lon.toFixed(3)}`, coord: [lat, lon], area: true });
    }
  }
  return points;
}

async function route(from, to) {
  const cacheKey = `${from[0].toFixed(5)},${from[1].toFixed(5)}>${to[0].toFixed(5)},${to[1].toFixed(5)}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const url =
    `https://routing.openstreetmap.de/routed-foot/route/v1/driving/` +
    `${from[1].toFixed(6)},${from[0].toFixed(6)};${to[1].toFixed(6)},${to[0].toFixed(6)}` +
    `?overview=full&geometries=geojson&alternatives=false&steps=false`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error(data.message || 'no route');
  const r = data.routes[0];
  const result = {
    points: r.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
    distance: r.distance,
    duration: r.duration,
  };
  cache.set(cacheKey, result);
  return result;
}

/** Back off hard when the service starts refusing, rather than pushing on. */
let backoff = 0;

async function politePause() {
  await sleep(SPACING_MS + backoff);
}

const key = (lat, lon) => {
  const latStep = CELL_M / 111320;
  const lonStep = CELL_M / (111320 * Math.cos((29.72 * Math.PI) / 180));
  return `${Math.round(lat / latStep)}:${Math.round(lon / lonStep)}`;
};

async function main() {
  await mkdir('data', { recursive: true });
  await loadCache();

  // Hotels are visitor origins and a venue-run concern only; the jobs run has
  // no use for them and should not make the Overpass call.
  let hotels = [];
  if (MODE !== 'jobs') {
    console.log('Loading lodging from OpenStreetMap…');
    hotels = await loadHotels();
    console.log(`  ${hotels.length} named hotels`);
  }

  // Everyday trips start where people live, not where visitors sleep, so the
  // jobs run drops the hotels and uses a denser neighbourhood grid.
  const origins =
    MODE === 'jobs' ? gridOrigins(0.006) : [...hotels, ...gridOrigins()];
  console.log(
    MODE === 'jobs'
      ? `  ${origins.length} neighbourhood origins`
      : `  ${origins.length} origins (${hotels.length} hotels + ${origins.length - hotels.length} area points)`,
  );

  const pairs = [];
  if (MODE === 'jobs') {
    const destinations = await jobDestinations();
    console.log(`  ${destinations.length.toLocaleString()} job cells with 50+ employees`);

    for (const origin of origins) {
      const reachable = destinations.filter(
        (d) => metresBetween(origin.coord, d.coord) <= MAX_WALK_M,
      );
      if (!reachable.length) continue;
      // Several trips per origin, so a dense neighbourhood generates more
      // demand than an empty one rather than each origin counting once.
      for (let i = 0; i < 8; i++) {
        pairs.push({ origin, venue: pickWeighted(reachable) });
      }
    }
  } else {
    for (const origin of origins) {
      for (const venue of VENUES) {
        for (let i = 0; i < venue.weight; i++) pairs.push({ origin, venue });
        if (pairs.length >= ROUTE_TARGET * 2) break;
      }
    }
  }

  // Even spread rather than the first N origins.
  pairs.sort(() => Math.random() - 0.5);
  const selected = pairs.slice(0, ROUTE_TARGET);
  console.log(`Routing ${selected.length} ${MODE} trips on foot, throttled…`);

  const cells = new Map();
  const perHotel = new Map();
  let done = 0;
  let failed = 0;
  const failures = new Map();

  async function worker(offset) {
    for (let i = offset; i < selected.length; i += CONCURRENCY) {
      const { origin, venue } = selected[i];
      try {
        const result = await route(origin.coord, venue.coord);

        // Count each cell once per route, so a slow winding street does not
        // out-score a busy straight one just by having more vertices.
        const seen = new Set();
        for (const [lat, lon] of result.points) seen.add(key(lat, lon));
        for (const k of seen) {
          const cell = cells.get(k) || { count: 0, lat: 0, lon: 0, n: 0 };
          cell.count++;
          cells.set(k, cell);
        }
        for (const [lat, lon] of result.points) {
          const cell = cells.get(key(lat, lon));
          cell.lat += lat;
          cell.lon += lon;
          cell.n++;
        }

        if (!origin.area) {
          const entry = perHotel.get(origin.name) || { ...origin, trips: [] };
          entry.trips.push({ venue: venue.name, distance: result.distance, duration: result.duration });
          perHotel.set(origin.name, entry);
        }
        backoff = Math.max(0, backoff - 500);
      } catch (err) {
        failed++;
        failures.set(err.message, (failures.get(err.message) || 0) + 1);
        // Throttling shows up as an instant connection failure. Give the
        // service real room rather than hammering it while it is saying no.
        backoff = Math.min(30000, backoff === 0 ? 4000 : backoff * 2);
        console.warn(`  backing off ${backoff}ms after: ${err.message}`);
      }
      done++;
      if (done % 25 === 0) {
        console.log(`  ${done}/${selected.length} (${failed} failed, ${cache.size} cached)`);
        await saveCache();
      }
      await politePause();
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  await saveCache();
  console.log(`Routed ${done - failed} trips, ${failed} failed.`);
  if (failures.size) console.log('  failure reasons:', Object.fromEntries(failures));

  // Only the venue run needs this: there, every trip ends at one of four
  // places, so those four cells top the list by arithmetic. Job trips end all
  // over the county, so there is nothing to exclude.
  const VENUE_EXCLUSION_M = MODE === 'jobs' ? 0 : 450;
  const nearVenue = (coord) =>
    VENUES.some((v) => {
      const dLat = (coord[0] - v.coord[0]) * 111320;
      const dLon = (coord[1] - v.coord[1]) * 96500;
      return Math.hypot(dLat, dLon) < VENUE_EXCLUSION_M;
    });

  // Every route ends at a venue, so the venue is always the top cell — that is
  // arithmetic, not a finding. The corridors feeding it are the finding.
  const hotspots = [...cells.entries()]
    .map(([k, cell]) => ({ key: k, count: cell.count, coord: [cell.lat / cell.n, cell.lon / cell.n] }))
    .filter((h) => !nearVenue(h.coord))
    .sort((a, b) => b.count - a.count);

  const hotels_ranked = [...perHotel.values()]
    .map((hotel) => {
      const toStadium = hotel.trips.find((t) => t.venue === 'NRG Stadium');
      return {
        name: hotel.name,
        brand: hotel.brand,
        rooms: hotel.rooms,
        coord: hotel.coord.map((v) => Math.round(v * 1e5) / 1e5),
        walkMinutesToStadium: toStadium ? Math.round(toStadium.duration / 60) : null,
        walkKmToStadium: toStadium ? Math.round(toStadium.distance) / 1000 : null,
      };
    })
    .filter((h) => h.walkMinutesToStadium !== null)
    .sort((a, b) => a.walkMinutesToStadium - b.walkMinutesToStadium);

  const out = MODE === 'jobs' ? 'data/demand-jobs.json' : 'data/demand.json';

  await writeFile(
    out,
    JSON.stringify({
      v: 1,
      mode: MODE,
      maxWalkMetres: MODE === 'jobs' ? MAX_WALK_M : null,
      generated: new Date().toISOString().slice(0, 10),
      routed: done - failed,
      cellMetres: CELL_M,
      venues: VENUES.map((v) => ({ name: v.name, coord: v.coord })),
      hotspots: hotspots.slice(0, 400).map((h) => ({
        c: h.coord.map((v) => Math.round(v * 1e5) / 1e5),
        n: h.count,
      })),
      hotels: hotels_ranked,
    }),
  );

  console.log(`\nWrote ${out} — ${hotspots.length} cells, top count ${hotspots[0]?.count}`);
  console.log('Top 8 overlap points:');
  for (const h of hotspots.slice(0, 8)) {
    console.log(`  ${String(h.count).padStart(4)} routes  ${h.coord[0].toFixed(5)}, ${h.coord[1].toFixed(5)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
