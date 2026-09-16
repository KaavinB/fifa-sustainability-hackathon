// Houston METRO trip planning — METRORail and METRO buses.
//
// WHERE THE ROUTE NUMBERS COME FROM
//
// Nothing in this file knows that the Red Line is route 700 or that the 82
// runs down Westheimer. Every route number, route name, line colour, stop
// name, stop code, headsign and departure time rendered by this app is read
// out of the response below, which is served from METRO's own published GTFS
// feed (`us-tx_houston-metro.gtfs.zip`, the agency's General Transit Feed
// Specification export). There is no hard-coded route table here to drift out
// of date, and no model-written itinerary: if METRO reroutes the 56 tomorrow,
// the app follows on the next feed refresh without a code change.
//
// The router is MOTIS, run as a free public service by the Transitous project,
// which ingests that feed via Transitland. Two consequences worth stating in
// the UI rather than burying here:
//
//   1. Times are SCHEDULED, not live. Transitous skips METRO's GTFS-Realtime
//      feed because it needs an API key, so `realTime` comes back false and a
//      bus running late looks on time. The UI says so.
//   2. METRO's feed ships no fare products, so this app shows no fare figure
//      and links to METRO's own fare page instead of inventing a number.

import { TRANSIT_API, TRANSIT_SEARCH_WINDOW_S, TRANSIT_CO2_PER_KM } from './config.js';
import { pathLength } from './geo.js';

/* ------------------------------------------------------------ polyline --- */

/**
 * Google polyline decoder. MOTIS /v1 encodes at precision 7 and says so on
 * every polyline it returns, so the precision is read rather than assumed —
 * decoding precision-7 data as 5 puts Houston in the Indian Ocean silently.
 */
export function decodePolyline(encoded, precision = 5) {
  if (!encoded) return [];
  const factor = 10 ** precision;
  const points = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat / factor, lon / factor]);
  }
  return points;
}

const line = (poly) => decodePolyline(poly?.points, poly?.precision ?? 7);

/* -------------------------------------------------------------- vehicle --- */

// GTFS route_type, as published in METRO's feed. In Houston this only ever
// comes back as 0 (METRORail, a light-rail/tram type) or 3 (bus), but the
// whole table is here because the router is not Houston-specific.
const VEHICLE_BY_ROUTE_TYPE = {
  0: 'rail', // tram / streetcar / light rail — METRORail
  1: 'rail', // subway
  2: 'rail', // rail
  3: 'bus',
  4: 'ferry',
  5: 'rail', // cable tram
  6: 'rail', // aerial lift
  7: 'rail', // funicular
  11: 'bus', // trolleybus
  12: 'rail', // monorail
};

const VEHICLE_BY_MODE = {
  TRAM: 'rail',
  SUBWAY: 'rail',
  RAIL: 'rail',
  HIGHSPEED_RAIL: 'rail',
  LONG_DISTANCE: 'rail',
  NIGHT_RAIL: 'rail',
  REGIONAL_RAIL: 'rail',
  SUBURBAN: 'rail',
  FUNICULAR: 'rail',
  BUS: 'bus',
  COACH: 'bus',
  FERRY: 'ferry',
};

export const VEHICLES = {
  rail: { label: 'rail', icon: '🚆', noun: 'train' },
  bus: { label: 'bus', icon: '🚌', noun: 'bus' },
  ferry: { label: 'ferry', icon: '⛴', noun: 'ferry' },
};

function vehicleOf(leg) {
  return (
    VEHICLE_BY_ROUTE_TYPE[leg.routeType] || VEHICLE_BY_MODE[leg.mode] || 'bus'
  );
}

const isRideLeg = (leg) => Boolean(leg.routeShortName || leg.routeLongName || leg.tripId);

/* ---------------------------------------------------------------- time --- */

// Every clock time in this app is Houston's, whatever the browser's own zone
// is: a visitor planning from a London hotel still wants the bus to leave at
// 7:16 pm Central, not 1:16 am.
export const HOUSTON_TZ = 'America/Chicago';

const CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: HOUSTON_TZ,
  hour: 'numeric',
  minute: '2-digit',
});

const DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: HOUSTON_TZ,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

export const formatClock = (date) => (date ? CLOCK.format(date) : '');
export const formatDay = (date) => (date ? DAY.format(date) : '');

/** Milliseconds a time zone is ahead of UTC at a given instant. */
function zoneOffsetMs(timeZone, date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const asIfUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asIfUTC - date.getTime();
}

/**
 * A wall-clock string from a `datetime-local` input ("2026-06-15T14:30"),
 * read as Houston time, turned into a real instant. Two passes because the
 * offset itself depends on the instant — which only matters on the two days a
 * year the clocks move, and is cheap enough to always do.
 */
export function houstonWallTimeToDate(wall) {
  const naive = new Date(`${wall}:00Z`);
  if (Number.isNaN(naive.getTime())) return new Date();
  let guess = new Date(naive.getTime() - zoneOffsetMs(HOUSTON_TZ, naive));
  guess = new Date(naive.getTime() - zoneOffsetMs(HOUSTON_TZ, guess));
  return guess;
}

/** The inverse: an instant rendered as a Houston wall-clock `datetime-local` value. */
export function dateToHoustonWallTime(date) {
  const shifted = new Date(date.getTime() + zoneOffsetMs(HOUSTON_TZ, date));
  return shifted.toISOString().slice(0, 16);
}

/* ----------------------------------------------------------------- api --- */

// Identical trips get asked for repeatedly — changing a scoring weight, or
// flipping back from Walk to Transit. Transitous is a volunteer-run service;
// re-asking it the same question is rude and slow.
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function plan(params, signal) {
  const query = new URLSearchParams(params).toString();
  const key = query;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const res = await fetch(`${TRANSIT_API}?${query}`, {
    signal: signal ?? AbortSignal.timeout(25000),
    headers: { Accept: 'application/json' },
  });

  // The router reports a query outside its loaded timetable window as a 400
  // with a readable message; passing that through beats "request failed".
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error || '';
    } catch {
      /* non-JSON error body */
    }
    throw new Error(humanise(detail) || `The transit planner returned ${res.status}.`);
  }

  const data = await res.json();
  cache.set(key, { at: Date.now(), data });
  return data;
}

/**
 * The router's errors are written for whoever is running it. The one people
 * actually hit — asking for a date the loaded timetable does not cover — comes
 * back as "query time 2030-06-15 19:00 is outside of loaded timetable window
 * [2026-08-15 00:00, 2027-09-15 00:00[", half-open bracket and all. Say it in
 * the terms the person typed instead.
 */
function humanise(detail) {
  const window = /outside of loaded timetable window \[([\d-]+)[^,]*, ([\d-]+)/.exec(detail || '');
  if (!window) return detail;

  const day = (iso) => {
    const date = new Date(`${iso}T12:00:00Z`);
    return Number.isNaN(date.getTime())
      ? iso
      : new Intl.DateTimeFormat('en-US', {
          timeZone: HOUSTON_TZ,
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        }).format(date);
  };

  return (
    `METRO's published timetable only covers ${day(window[1])} to ${day(window[2])}. ` +
    `Pick a date in that range.`
  );
}

const place = (coord) => `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`;

/* -------------------------------------------------- itinerary -> route --- */

function stopOf(node) {
  if (!node) return null;
  return {
    name: node.name,
    code: node.stopCode || '',
    coord: [node.lat, node.lon],
    arrival: node.arrival ? new Date(node.arrival) : null,
    departure: node.departure ? new Date(node.departure) : null,
  };
}

// MOTIS walk instructions use compass-relative turns; OSRM uses a maneuver
// type plus a modifier. Translating here means the existing directions
// renderer handles a transit trip's walking legs with no changes at all.
const WALK_MANEUVER = {
  DEPART: { type: 'depart' },
  CONTINUE: { type: 'continue', modifier: 'straight' },
  LEFT: { type: 'turn', modifier: 'left' },
  RIGHT: { type: 'turn', modifier: 'right' },
  SLIGHTLY_LEFT: { type: 'turn', modifier: 'slight left' },
  SLIGHTLY_RIGHT: { type: 'turn', modifier: 'slight right' },
  HARD_LEFT: { type: 'turn', modifier: 'sharp left' },
  HARD_RIGHT: { type: 'turn', modifier: 'sharp right' },
  UTURN_LEFT: { type: 'turn', modifier: 'uturn' },
  UTURN_RIGHT: { type: 'turn', modifier: 'uturn' },
  CIRCLE_CLOCKWISE: { type: 'roundabout', modifier: 'right' },
  CIRCLE_COUNTERCLOCKWISE: { type: 'roundabout', modifier: 'left' },
  STAIRS: { type: 'continue', modifier: 'straight' },
  ELEVATOR: { type: 'continue', modifier: 'straight' },
};

const toLonLat = (points) => points.map(([lat, lon]) => [lon, lat]);

/** One walking leg as OSRM-shaped steps the existing renderer understands. */
function walkSteps(leg, { isLast, walkTo }) {
  const legPoints = line(leg.legGeometry);
  const instructions = leg.steps?.length ? leg.steps : null;
  const steps = [];

  if (instructions) {
    for (const [i, instruction] of instructions.entries()) {
      const points = line(instruction.polyline);
      if (points.length < 2) continue;
      const shape = WALK_MANEUVER[instruction.relativeDirection] || {
        type: 'continue',
        modifier: 'straight',
      };
      steps.push({
        distance: instruction.distance || pathLength(points),
        duration: 0,
        name: instruction.streetName || '',
        ref: '',
        mode: 'walking',
        geometry: { coordinates: toLonLat(points) },
        maneuver: {
          type: i === 0 ? 'depart' : shape.type,
          modifier: i === 0 ? undefined : shape.modifier,
          location: [points[0][1], points[0][0]],
        },
      });
    }
  }

  // A leg with no instructions (a platform-to-platform transfer, usually) is
  // still real distance on foot, so it becomes one step rather than vanishing.
  if (!steps.length && legPoints.length > 1) {
    steps.push({
      distance: leg.distance || pathLength(legPoints),
      duration: leg.duration || 0,
      name: '',
      ref: '',
      mode: 'walking',
      geometry: { coordinates: toLonLat(legPoints) },
      maneuver: { type: 'depart', location: [legPoints[0][1], legPoints[0][0]] },
    });
  }

  // Spread the leg's duration over its steps by distance: MOTIS times the leg,
  // not the individual instructions.
  const walked = steps.reduce((sum, step) => sum + step.distance, 0) || 1;
  for (const step of steps) {
    step.duration = (leg.duration || 0) * (step.distance / walked);
  }

  // "Walk along the path" is fine once. Said again after getting off a bus it
  // is useless: what the rider needs is the name of the stop they are walking
  // to, which the router has already told us.
  if (steps.length && walkTo) steps[0].walkTo = walkTo;

  if (isLast && steps.length) {
    const end = legPoints[legPoints.length - 1] || [leg.to.lat, leg.to.lon];
    steps.push({
      distance: 0,
      duration: 0,
      name: '',
      ref: '',
      mode: 'walking',
      geometry: { coordinates: [[end[1], end[0]]] },
      maneuver: { type: 'arrive', location: [end[1], end[0]] },
    });
  }
  return steps;
}

/** One transit leg as a board step (carrying the ride) plus an alight step. */
function rideSteps(leg, ride, points) {
  const board = points[0] || ride.board.coord;
  const alight = points[points.length - 1] || ride.alight.coord;
  return [
    {
      distance: ride.distance,
      duration: leg.duration || 0,
      name: ride.longName || ride.shortName,
      ref: ride.shortName,
      mode: 'transit',
      transit: { ...ride, kind: 'board' },
      geometry: { coordinates: toLonLat(points) },
      maneuver: { type: 'board', location: [board[1], board[0]] },
    },
    {
      distance: 0,
      duration: 0,
      name: ride.alight.name,
      ref: '',
      mode: 'transit',
      transit: { ...ride, kind: 'alight' },
      geometry: { coordinates: [[alight[1], alight[0]]] },
      maneuver: { type: 'alight', location: [alight[1], alight[0]] },
    },
  ];
}

/**
 * A MOTIS itinerary, rewritten into the same shape every other route in this
 * app has — `points`, `distance`, `duration`, and OSRM-style `legs[].steps[]`
 * — so the scorer, the profile chart, the water matcher and the directions
 * list all treat a bus trip as just another route.
 *
 * Everything transit-specific rides along under `route.transit`.
 */
function toRoute(itinerary) {
  const points = [];
  const steps = [];
  const rides = [];
  const shownLegs = [];
  const walkPoints = [];

  let walkM = 0;
  let rideM = 0;
  let walkSec = 0;
  let rideSec = 0;
  let co2Grams = 0;

  const legs = itinerary.legs.filter((leg) => (line(leg.legGeometry).length > 1) || isRideLeg(leg));

  legs.forEach((leg, index) => {
    const legPoints = line(leg.legGeometry);
    const isLast = index === legs.length - 1;

    // Legs meet end-to-end; drop the repeated junction point.
    const append = points.length ? legPoints.slice(1) : legPoints;
    points.push(...append);

    if (isRideLeg(leg)) {
      const vehicle = vehicleOf(leg);
      const distance = pathLength(legPoints);
      const previous = legs[index - 1];
      const boardStop = stopOf(leg.from);
      const waitSec =
        previous && previous.endTime && leg.startTime
          ? Math.max(0, (new Date(leg.startTime) - new Date(previous.endTime)) / 1000)
          : 0;

      const ride = {
        // Verbatim from METRO's feed: "700" / "METRORAIL RED LINE",
        // "027" / "Shepherd". Route numbers are printed exactly as published,
        // leading zeros and all, rather than prettified into something that
        // does not match the sign on the front of the bus.
        shortName: leg.routeShortName || '',
        longName: leg.routeLongName || '',
        displayName: leg.displayName || leg.routeShortName || leg.routeLongName || '',
        headsign: leg.headsign || '',
        color: leg.routeColor ? `#${leg.routeColor}` : null,
        textColor: leg.routeTextColor ? `#${leg.routeTextColor}` : null,
        agency: leg.agencyName || '',
        agencyUrl: leg.agencyUrl || '',
        fareUrl: leg.agencyFareUrl || '',
        scheduleUrl: leg.routeUrl || '',
        vehicle,
        board: boardStop,
        alight: stopOf(leg.to),
        // "11 stops" means eleven stops between boarding and getting off, so
        // the count a rider can check against the scrolling sign is +1.
        stopCount: (leg.intermediateStops?.length || 0) + 1,
        intermediateStops: (leg.intermediateStops || []).map(stopOf),
        wheelchair: leg.wheelchairAccessible === 'ACCESSIBLE',
        realTime: Boolean(leg.realTime),
        distance,
        duration: leg.duration || 0,
        waitSec,
      };

      rides.push(ride);
      shownLegs.push({ kind: 'ride', ride });
      steps.push(...rideSteps(leg, ride, legPoints));

      rideM += distance;
      rideSec += leg.duration || 0;
      co2Grams += (distance / 1000) * (TRANSIT_CO2_PER_KM[vehicle] ?? TRANSIT_CO2_PER_KM.bus);
      return;
    }

    const distance = leg.distance || pathLength(legPoints);
    walkM += distance;
    walkSec += leg.duration || 0;
    walkPoints.push(legPoints);
    shownLegs.push({ kind: 'walk', distance, duration: leg.duration || 0 });
    // MOTIS names the trip's own endpoints START and END; only a real stop
    // name is worth putting in an instruction.
    const heading = leg.to?.name && !['END', 'START'].includes(leg.to.name) ? leg.to.name : '';
    steps.push(...walkSteps(leg, { isLast, walkTo: heading }));
  });

  const startTime = new Date(itinerary.startTime);
  const endTime = new Date(itinerary.endTime);
  const duration = itinerary.duration || (endTime - startTime) / 1000;
  const distance = walkM + rideM;

  // Anything not spent moving is spent standing at a stop. In a Houston June
  // that is the part of a transit trip that hurts, so it is measured rather
  // than folded into the total.
  const waitSec = Math.max(0, duration - walkSec - rideSec);

  return {
    points,
    distance,
    duration,
    legs: [{ steps }],
    source: rides.length ? 'transit' : 'transit-walk',
    transit: {
      startTime,
      endTime,
      duration,
      transfers: Math.max(0, rides.length - 1),
      rides,
      legs: shownLegs,
      walkPoints,
      walkM,
      rideM,
      walkSec,
      rideSec,
      waitSec,
      // Walking and waiting both happen outdoors. Riding, on a METRO bus or a
      // METRORail car, does not — which is the whole reason this app scores a
      // transit trip differently from a walk of the same length.
      outdoorSec: walkSec + waitSec,
      co2Kg: co2Grams / 1000,
      realTime: rides.some((ride) => ride.realTime),
      fareUrl: rides.find((ride) => ride.fareUrl)?.fareUrl || '',
      agencies: [...new Set(rides.map((ride) => ride.agency).filter(Boolean))],
    },
  };
}

/* ------------------------------------------------------------- dedupe --- */

// Two itineraries are the same trip if they use the same routes between the
// same stops. A timetable-view search returns each option once per departure
// in the window, so without this the list is eleven copies of the Red Line.
function rideSignature(route) {
  if (!route.transit.rides.length) return 'walk-only';
  return route.transit.rides
    .map((ride) => `${ride.shortName}@${ride.board.code || ride.board.name}>${ride.alight.code || ride.alight.name}`)
    .join(' | ');
}

/**
 * Which departure of each distinct trip to keep.
 *
 * Leaving at a time, it is the earliest: the one a person standing at the stop
 * can actually catch. Arriving by a time, it is the *latest* that still makes
 * it — asked to be at NRG by 7pm, "the 5:17 Red Line, arriving 5:55" is a
 * correct answer to a question nobody asked, and the timetable window returns
 * a dozen of them.
 */
function dedupeByRides(routes, { arriveBy = false } = {}) {
  const best = new Map();
  for (const route of routes) {
    const key = rideSignature(route);
    const held = best.get(key);
    if (!held) {
      best.set(key, route);
      continue;
    }
    const better = arriveBy
      ? route.transit.startTime > held.transit.startTime
      : route.transit.startTime < held.transit.startTime;
    if (better) best.set(key, route);
  }
  return [...best.values()];
}

// How far from the time asked about a trip may sit and still be an answer to
// the question. Generous enough for an hourly route, short enough that a
// search variant finding nothing today cannot answer with tomorrow morning.
const WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * Keep only the trips that actually sit near the requested time.
 *
 * Necessary because the searches run independently: ask for rail-only,
 * step-free, at 5pm, find nothing, and MOTIS answers with the first trip that
 * does work — which can be 5am tomorrow. Merged in unfiltered it sorts to the
 * top as the "earliest" departure and quietly becomes the headline result.
 */
function withinWindow(routes, when, arriveBy) {
  const target = when.getTime();
  return routes.filter((route) => {
    const at = arriveBy
      ? route.transit.endTime.getTime()
      : route.transit.startTime.getTime();
    return arriveBy
      ? at <= target + 60 * 1000 && at >= target - WINDOW_MS
      : at >= target - 60 * 1000 && at <= target + WINDOW_MS;
  });
}

/* --------------------------------------------------------------- plan --- */

// Three searches, because one is not enough to compare anything. MOTIS returns
// the *optimal* set for a departure window, which in Houston is usually the
// rail trip repeated at every headway — a true answer, and a useless
// comparison. Asking bus-only and rail-only as well surfaces the alternative
// that the optimal set hides, and every one of them is still a real routed
// trip on METRO's published timetable rather than a plausible-looking guess.
// MOTIS budgets the first and last walking legs in SECONDS (900 each by
// default), and its wheelchair profile walks at roughly 0.69 m/s against about
// 1.03 on foot. Left alone that makes the two profiles cover different
// GROUND: 900s is ~930 m on foot but only ~620 m in a wheelchair, and any trip
// whose last leg falls in between is silently dropped from the step-free
// results only.
//
// That is not an accessibility finding, it is a unit mismatch — and it reads
// as one. Rice to NRG loses METRORail entirely under the defaults, because the
// 971 m from Houston Stadium Stn takes 20 minutes at wheelchair speed; raise
// the budget and the Red Line comes straight back, on the same departure.
// METRORail has level boarding throughout and the feed marks it accessible.
//
// So each profile gets the budget that buys it the same ~1.2 km of walking,
// and the two searches become comparable.
const WALK_BUDGET_S = { FOOT: 1200, WHEELCHAIR: 1800 };

const SEARCHES = [
  { key: 'any', label: 'best available' },
  { key: 'bus', label: 'bus only', transitModes: 'BUS' },
  { key: 'rail', label: 'rail only', transitModes: 'TRAM,SUBWAY,RAIL' },
];

/**
 * Plan a Houston METRO trip.
 *
 * `stepFree` routes the walking parts — the first mile, the last mile, and
 * every transfer between them — with MOTIS's WHEELCHAIR pedestrian profile
 * instead of FOOT. It does not filter the vehicles: METRO's fleet is marked
 * accessible throughout its feed, so the constraint in Houston is the path to
 * the stop, not the bus at it.
 *
 * @returns {{routes: object[], walkOnly: object|null, stepFreeCost: object|null}}
 */
export async function planTransit(
  origin,
  destination,
  { when, arriveBy = false, stepFree = false, signal } = {},
) {
  const time = (when ?? new Date()).toISOString();
  const base = {
    fromPlace: place(origin),
    toPlace: place(destination),
    time,
    arriveBy: String(arriveBy),
    timetableView: 'true',
    searchWindow: String(TRANSIT_SEARCH_WINDOW_S),
    numItineraries: '4',
    directModes: 'WALK',
    pedestrianProfile: stepFree ? 'WHEELCHAIR' : 'FOOT',
    maxPreTransitTime: String(WALK_BUDGET_S[stepFree ? 'WHEELCHAIR' : 'FOOT']),
    maxPostTransitTime: String(WALK_BUDGET_S[stepFree ? 'WHEELCHAIR' : 'FOOT']),
  };

  const responses = await Promise.allSettled(
    SEARCHES.map((search) =>
      plan({ ...base, ...(search.transitModes ? { transitModes: search.transitModes } : {}) }, signal),
    ),
  );

  const ok = responses.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) {
    const reason = responses[0].reason;
    throw new Error(reason?.message || 'The transit planner could not be reached.');
  }

  const asked = when ?? new Date();
  const itineraries = ok.flatMap((data) => data.itineraries || []);
  const routes = dedupeByRides(
    withinWindow(
      itineraries.map(toRoute).filter((route) => route.points.length > 1),
      asked,
      arriveBy,
    ),
    { arriveBy },
  );

  // MOTIS will not return a transit option that is slower than simply walking,
  // so on a short trip the honest answer is the walk — and saying that is more
  // useful than an empty list.
  const directs = ok.flatMap((data) => data.direct || []);
  const walkOnly = directs.length
    ? dedupeByRides(directs.map(toRoute).filter((route) => route.points.length > 1), {
        arriveBy,
      })[0] || null
    : null;

  // Soonest first; the UI re-sorts by score once they are all measured.
  routes.sort((a, b) => a.transit.startTime - b.transit.startTime);

  return {
    routes,
    walkOnly,
    stepFreeCost: stepFree ? await stepFreeCostOf(base, routes, asked, arriveBy, signal) : null,
  };
}

/**
 * What routing step-free costs on this trip.
 *
 * A toggle that silently returns a slower trip teaches nobody anything. One
 * extra unrestricted search — not another three — prices the difference, so
 * the app can say "step-free adds 22 minutes and two transfers here" instead
 * of quietly handing over a worse itinerary.
 *
 * A null result means there was nothing to compare against; `blocked` means
 * the trip exists on foot and does not step-free, which is the finding worth
 * printing loudest.
 */
async function stepFreeCostOf(base, routes, when, arriveBy, signal) {
  let walking;
  try {
    walking = await plan(
      {
        ...base,
        pedestrianProfile: 'FOOT',
        maxPreTransitTime: String(WALK_BUDGET_S.FOOT),
        maxPostTransitTime: String(WALK_BUDGET_S.FOOT),
      },
      signal,
    );
  } catch {
    return null;
  }

  // Same window as the step-free set, or the comparison prices time-of-day
  // service levels rather than step-free access.
  const onFoot = withinWindow(
    (walking.itineraries || [])
      .map(toRoute)
      .filter((route) => route.points.length > 1 && route.transit.rides.length),
    when,
    arriveBy,
  );
  if (!onFoot.length) return null;

  const fastest = (list) => list.reduce((a, b) => (b.duration < a.duration ? b : a));
  const best = fastest(onFoot);

  if (!routes.length) {
    return { blocked: true, baseline: describeTrip(best) };
  }

  const step = fastest(routes);
  return {
    blocked: false,
    minutes: Math.round((step.duration - best.duration) / 60),
    transfers: step.transit.transfers - best.transit.transfers,
    baseline: describeTrip(best),
    stepFree: describeTrip(step),
  };
}

function describeTrip(route) {
  return {
    routes: route.transit.rides.map((ride) => ride.shortName || ride.longName),
    minutes: Math.round(route.duration / 60),
    transfers: route.transit.transfers,
  };
}
