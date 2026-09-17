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

  console.log('Loading lodging from OpenStreetMap…');
  const hotels = await loadHotels();
  console.log(`  ${hotels.length} named hotels`);

  const origins = [...hotels, ...gridOrigins()];
  console.log(`  ${origins.length} origins (${hotels.length} hotels + ${origins.length - hotels.length} area points)`);

  // Build the job list, weighted so the stadium draws the most trips.
  const jobs = [];
  for (const origin of origins) {
    for (const venue of VENUES) {
      for (let i = 0; i < venue.weight; i++) jobs.push({ origin, venue });
      if (jobs.length >= ROUTE_TARGET * 2) break;
    }
  }
  // Even spread rather than the first N origins.
  jobs.sort(() => Math.random() - 0.5);
  const selected = jobs.slice(0, ROUTE_TARGET);
  console.log(`Routing ${selected.length} trips on foot, throttled…`);

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

  const VENUE_EXCLUSION_M = 450;
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

  await writeFile(
    'data/demand.json',
    JSON.stringify({
      v: 1,
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

  console.log(`\nWrote data/demand.json — ${hotspots.length} cells, top count ${hotspots[0]?.count}`);
  console.log('Top 8 overlap points:');
  for (const h of hotspots.slice(0, 8)) {
    console.log(`  ${String(h.count).padStart(4)} routes  ${h.coord[0].toFixed(5)}, ${h.coord[1].toFixed(5)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
