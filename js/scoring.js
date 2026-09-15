// Turns a raw OSRM route + the OSM green layer into the numbers the UI compares.

import {
  GREEN_BUFFER_M,
  TREE_BUFFER_M,
  SAMPLE_SPACING_M,
  MODES,
  TRANSIT_CO2_PER_KM,
} from './config.js';
import { samplePath, haversine, pointSegmentDistance } from './geo.js';
import { insideGreen } from './greenspace.js';
import { waterAlongRoute, WATER_BUFFER_M } from './water.js';

// Roads we would rather not walk, bike, or sit in traffic beside. OSRM step
// names carry a `ref` (I-45, US-59, TX-288) for exactly the roads that hurt.
const BIG_ROAD_REF = /^(I-|US-|TX-|SH-|FM-|BW-|Sam Houston|Hardy Toll|Westpark Toll)/i;
const BIG_ROAD_NAME =
  /(Freeway|Fwy|Tollway|Toll Rd|Interstate|Expressway|Expwy|Parkway Feeder|Feeder)/i;

export function isBigRoad(name = '', ref = '') {
  return BIG_ROAD_REF.test(ref) || BIG_ROAD_NAME.test(name);
}

/**
 * Green and shade share for an arbitrary path — a whole route, or a single
 * turn-by-turn step. Short paths get sampled finely so a 30 m step still
 * gets a meaningful answer instead of one lucky sample.
 */
export function pathGreenMetrics(points, layer, spacing = SAMPLE_SPACING_M) {
  if (!layer || points.length < 2) {
    return { greenShare: 0, shadeShare: 0, samples: [], greenAt: [], shadeAt: [] };
  }
  const samples = samplePath(points, spacing);
  return { ...greenMetrics(samples, layer), samples };
}

/** Fraction of route samples that are inside or beside green space. */
function greenMetrics(samples, layer) {
  const { proj, polygons, canopyPolygons, greenIndex, treeIndex } = layer;
  let greenHits = 0;
  let treeHits = 0;
  // Kept per sample, not just counted: the profile chart needs to know *where*
  // along the route each quality holds, which the averages throw away.
  const greenAt = new Uint8Array(samples.length);
  const shadeAt = new Uint8Array(samples.length);

  for (const [index, p] of samples.entries()) {
    const xy = proj.toXY(p);

    let green = insideGreen(xy, polygons);
    if (!green) {
      for (const seg of greenIndex.near(xy)) {
        if (pointSegmentDistance(xy, seg.a, seg.b) <= GREEN_BUFFER_M) {
          green = true;
          break;
        }
      }
    }
    if (green) {
      greenHits++;
      greenAt[index] = 1;
    }

    let shaded = insideGreen(xy, canopyPolygons);
    if (!shaded) {
      for (const t of treeIndex.near(xy)) {
        const d = t.b
          ? pointSegmentDistance(xy, t.a, t.b)
          : Math.hypot(xy[0] - t.a[0], xy[1] - t.a[1]);
        if (d <= TREE_BUFFER_M) {
          shaded = true;
          break;
        }
      }
    }
    if (shaded) {
      treeHits++;
      shadeAt[index] = 1;
    }
  }

  const n = Math.max(1, samples.length);
  return { greenShare: greenHits / n, shadeShare: treeHits / n, greenAt, shadeAt };
}

/**
 * Share of route distance spent on freeways and major arterials.
 *
 * Riding counts for nothing here, in both directions: a bus that runs down the
 * 288 feeder is not an unpleasant experience for the person sitting on it, and
 * neither is it a calm one — the question simply does not apply from inside a
 * vehicle you are not steering. So a transit trip is measured on its walking
 * legs only, which is the part the rider is actually exposed to. Boarding and
 * getting off are not turns to remember either.
 */
function bigRoadShare(route) {
  let big = 0;
  let known = 0;
  let turns = 0;

  for (const leg of route.legs) {
    for (const step of leg.steps || []) {
      if (step.mode === 'transit') continue;
      const dist = step.distance || 0;
      known += dist;
      if (isBigRoad(step.name || '', step.ref || '')) big += dist;
      const type = step.maneuver?.type;
      if (type && !['depart', 'arrive', 'continue'].includes(type)) turns++;
    }
  }

  // Turns per kilometre of the distance those turns are spread over — the
  // walked part on a transit trip, the whole route otherwise.
  const over = known > 0 ? known : route.distance;
  return {
    bigRoadShare: known > 0 ? big / known : 0,
    turns,
    turnsPerKm: over > 0 ? turns / (over / 1000) : 0,
  };
}

function normalise(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || max - min < 1e-9) return values.map(() => 1);
  return values.map((v) => (v - min) / (max - min));
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * The stretches of a route, as [startM, endM] along it, that are covered on
 * foot. Everything on a walk or a bike ride is; on a transit trip it is the
 * legs either side of the ride.
 */
function walkSpans(route) {
  if (!route.transit) return null;
  const spans = [];
  let cursor = 0;
  let open = null;
  for (const leg of route.legs || []) {
    for (const step of leg.steps || []) {
      const end = cursor + (step.distance || 0);
      if (step.mode === 'transit') {
        if (open !== null) spans.push([open, cursor]);
        open = null;
      } else if (open === null) {
        open = cursor;
      }
      cursor = end;
    }
  }
  if (open !== null) spans.push([open, cursor]);
  return spans.filter(([from, to]) => to > from);
}

/**
 * Per-sample series along the route, for the profile chart: where it is green,
 * where it is shaded, and where it runs along a big road. Same 75 m samples the
 * score is averaged from, so the chart and the number can never disagree.
 *
 * The busy series comes from OSRM steps rather than the green layer, so each
 * sample is matched to the step it falls inside by cumulative distance.
 */
function buildProfile(route, samples, green) {
  if (samples.length < 2) return null;

  // Chords between 75 m samples cut corners, so the accumulated length falls
  // short of the routed distance. Scale to the real distance: the axis has to
  // agree with the route, or the water and turn marks — which are positioned
  // from the routed distance — land in the wrong place.
  const distances = new Float64Array(samples.length);
  for (let i = 1; i < samples.length; i++) {
    distances[i] = distances[i - 1] + haversine(samples[i - 1], samples[i]);
  }
  const walked = distances[distances.length - 1] || 1;
  const total = route.distance || walked;
  const stretch = total / walked;
  for (let i = 0; i < distances.length; i++) distances[i] *= stretch;

  // Flatten the steps once, keeping the distance each one starts at.
  const spans = [];
  let cursor = 0;
  for (const leg of route.legs || []) {
    for (const step of leg.steps || []) {
      spans.push({
        start: cursor,
        end: cursor + (step.distance || 0),
        busy: isBigRoad(step.name || '', step.ref || ''),
        ride: step.mode === 'transit',
      });
      cursor += step.distance || 0;
    }
  }

  const busyAt = new Uint8Array(samples.length);
  // Where you are on board rather than on your feet. Used twice: drawn as its
  // own row on the profile, and used to restrict the green and shade averages
  // to the part of the trip spent outdoors.
  const rideAt = new Uint8Array(samples.length);
  if (spans.length) {
    // Steps and samples are both ordered, so walk them together rather than
    // searching the step list for every sample.
    let cursorIndex = 0;
    for (let i = 0; i < samples.length; i++) {
      const along = distances[i];
      while (cursorIndex < spans.length - 1 && along > spans[cursorIndex].end) cursorIndex++;
      busyAt[i] = spans[cursorIndex].busy ? 1 : 0;
      rideAt[i] = spans[cursorIndex].ride ? 1 : 0;
    }
  }

  return {
    total,
    distances,
    coords: samples,
    green: green.greenAt ?? [],
    shade: green.shadeAt ?? [],
    busy: busyAt,
    ride: rideAt,
    hasRide: spans.some((span) => span.ride),
  };
}

/**
 * Re-average the per-sample green and shade series over the samples that are
 * actually outdoors.
 *
 * A transit trip's shade percentage has to mean "shade where you are standing
 * in it". Averaged over the whole route it measures the tree cover along a
 * rail corridor seen through a window, which is not a number about anybody's
 * comfort — and it would make the 12-mile ride swamp the half-mile walk that
 * decides whether the trip is bearable.
 */
function outdoorShares(green, rideAt) {
  if (!rideAt?.length || !green.greenAt?.length) return null;
  let outdoor = 0;
  let greenHits = 0;
  let shadeHits = 0;
  for (let i = 0; i < rideAt.length; i++) {
    if (rideAt[i]) continue;
    outdoor++;
    if (green.greenAt[i]) greenHits++;
    if (green.shadeAt[i]) shadeHits++;
  }
  if (!outdoor) return null;
  return { greenShare: greenHits / outdoor, shadeShare: shadeHits / outdoor, outdoorSamples: outdoor };
}

/**
 * Score every candidate route, two ways.
 *
 * ABSOLUTE puts each component on a fixed 0–1 scale that means the same thing
 * on every trip: the actual share of the route beside green space, under
 * canopy, and off big roads, plus how close it comes to a straight line. A 60
 * here is the same 60 tomorrow, in another city, for another trip — so scores
 * can be compared, tracked, and reported.
 *
 * RELATIVE normalises each component across this candidate set, which spreads
 * the field out and answers "which of these is nicest" even when every option
 * is similar. It cannot be compared across trips: the best of five bad routes
 * still scores 100.
 *
 * Both are computed every time; the UI picks which to display.
 */
export function scoreRoutes(routes, layer, mode, weights, scoreMode = 'absolute') {
  const modeCfg = MODES[mode];

  const enriched = routes.map((route) => {
    const samples = samplePath(route.points, SAMPLE_SPACING_M);
    const green = layer
      ? greenMetrics(samples, layer)
      : { greenShare: 0, shadeShare: 0, greenAt: [], shadeAt: [] };
    const roads = bigRoadShare(route);
    const profile = buildProfile(route, samples, green);
    const km = route.distance / 1000;
    const minutes = route.duration / 60;

    // On a transit trip the green and shade figures describe the walking and
    // waiting, not the ride. Everything else scores a route end to end.
    const outdoor = profile?.hasRide ? outdoorShares(green, profile.ride) : null;
    const greenShare = outdoor ? outdoor.greenShare : green.greenShare;
    const shadeShare = outdoor ? outdoor.shadeShare : green.shadeShare;

    // How close this route comes to the straight line between the endpoints.
    // In a grid city a good route lands around 0.75-0.85; it is the absolute
    // anchor for directness, where the relative score can only use "vs. the
    // shortest option we happened to find".
    const crowFlyM = haversine(route.points[0], route.points[route.points.length - 1]);
    const efficiency = clamp01(crowFlyM / Math.max(route.distance, 1));

    // Fountains are only worth finding where you are on foot. Matching them
    // against a rail alignment would count every fountain the train passes.
    const water = waterAlongRoute(route.points, layer?.water, WATER_BUFFER_M, {
      onFoot: walkSpans(route),
    });

    // Unshaded minutes outdoors — the number that matters for a June World Cup
    // in Houston, where afternoon heat index runs past 105F.
    //
    // For a transit trip "outdoors" is the walk to the stop plus the wait at
    // it, not the ride: a 52-minute Red Line trip with a 9-minute walk and a
    // 6-minute wait leaves you in the sun for 15 minutes, and reporting 52
    // would be the single most misleading number this app could print.
    const outdoorMinutes = route.transit
      ? route.transit.outdoorSec / 60
      : modeCfg.heatExposed
        ? minutes
        : 0;
    const exposedMinutes = outdoorMinutes * (1 - shadeShare);

    // Per-leg for a transit trip — walking legs emit nothing, and a METRORail
    // car and a bus are charged at their own rates. Everything else is one
    // vehicle for the whole distance.
    const walkKm = route.transit ? route.transit.walkM / 1000 : km;
    const co2Kg = route.transit ? route.transit.co2Kg : (km * modeCfg.co2PerKm) / 1000;

    return {
      ...route,
      samples,
      profile,
      water,
      metrics: {
        km,
        minutes,
        outdoorMinutes,
        greenShare,
        shadeShare,
        bigRoadShare: roads.bigRoadShare,
        turns: roads.turns,
        turnsPerKm: roads.turnsPerKm,
        crowFlyKm: crowFlyM / 1000,
        efficiency,
        waterStops: water.stops.length,
        longestDryKm: water.longestDryM / 1000,
        exposedMinutes,
        co2Kg,
        co2SavedVsDrivingKg: (km * MODES.car.co2PerKm) / 1000 - co2Kg,
        transitCo2Kg: (km * TRANSIT_CO2_PER_KM.bus) / 1000,
        kcal: walkKm * modeCfg.kcalPerKm,
        cost: walkKm * modeCfg.costPerKm,
      },
    };
  });

  const shortest = Math.min(...enriched.map((r) => r.distance));
  const combine = (c) =>
    100 * (weights.green * c.green + weights.shade * c.shade + weights.quiet * c.quiet + weights.direct * c.direct);

  const greenN = normalise(enriched.map((r) => r.metrics.greenShare));
  const shadeN = normalise(enriched.map((r) => r.metrics.shadeShare));
  const quietN = normalise(enriched.map((r) => -r.metrics.bigRoadShare));
  const directN = normalise(
    enriched.map((r) => -(r.distance / shortest - 1) * 4 - r.metrics.turnsPerKm / 6),
  );

  enriched.forEach((route, i) => {
    const m = route.metrics;

    const absolute = {
      green: clamp01(m.greenShare),
      shade: clamp01(m.shadeShare),
      quiet: clamp01(1 - m.bigRoadShare),
      // Mostly "does it go straight there", tempered by how fiddly it is:
      // a route with more than ~15 turns per km is tiring however direct.
      direct: clamp01(0.7 * m.efficiency + 0.3 * clamp01(1 - m.turnsPerKm / 15)),
    };

    const relative = { green: greenN[i], shade: shadeN[i], quiet: quietN[i], direct: directN[i] };

    route.components = { absolute, relative };
    route.scores = { absolute: combine(absolute), relative: combine(relative) };
    route.pleasantness = route.scores[scoreMode];
    m.detourPct = (route.distance / shortest - 1) * 100;
  });

  return enriched;
}

/** Label the standouts: fastest, shortest, greenest, coolest, best overall. */
export function assignBadges(routes) {
  const best = (fn) => routes.reduce((a, b) => (fn(b) > fn(a) ? b : a));
  const worst = (fn) => routes.reduce((a, b) => (fn(b) < fn(a) ? b : a));

  routes.forEach((r) => (r.badges = []));
  worst((r) => r.duration).badges.push({ key: 'fastest', label: 'Fastest' });
  worst((r) => r.distance).badges.push({ key: 'shortest', label: 'Shortest' });
  best((r) => r.pleasantness).badges.push({ key: 'pleasant', label: 'Most pleasant' });
  best((r) => r.metrics.greenShare).badges.push({ key: 'green', label: 'Greenest' });
  best((r) => r.metrics.shadeShare).badges.push({ key: 'shade', label: 'Most shaded' });

  // Only worth flagging when there is actually water to find.
  const wettest = best((r) => r.metrics.waterStops);
  if (wettest.metrics.waterStops > 0) {
    wettest.badges.push({ key: 'water', label: `${wettest.metrics.waterStops} water stops` });
  }
  return routes;
}

export function formatDuration(seconds) {
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`;
}

export function formatDistance(metres) {
  const miles = metres / 1609.34;
  return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

export { haversine };
