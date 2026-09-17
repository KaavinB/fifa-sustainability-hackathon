// Central configuration: endpoints, travel modes, scoring weights, Houston presets.

// BASEMAPS
//
// CARTO began requiring an API key and now serves an "API KEY REQUIRED"
// watermark baked into otherwise valid 200 responses — which is why the tile
// error fallback never caught it: nothing errored.
//
// OpenFreeMap serves vector tiles with no key and no rate limit. Liberty is the
// OSM style built to read like Google/Mapbox Streets, which is what raster OSM
// tiles are not. Vector also means crisp labels at any zoom and a style that can
// be recoloured later if we want the routes to dominate harder.
//
// `raster` entries need no WebGL, so one is kept as the fallback for a machine
// or a network that cannot do vector.
export const BASEMAPS = {
  streets: {
    label: 'Streets',
    type: 'vector',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    attribution:
      '&copy; <a href="https://openfreemap.org/">OpenFreeMap</a> ' +
      '<a href="https://www.openmaptiles.org/">OpenMapTiles</a> ' +
      'data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  plain: {
    label: 'Plain',
    type: 'vector',
    style: 'https://tiles.openfreemap.org/styles/positron',
    attribution:
      '&copy; <a href="https://openfreemap.org/">OpenFreeMap</a> ' +
      '<a href="https://www.openmaptiles.org/">OpenMapTiles</a> ' +
      'data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  osm: {
    label: 'OSM',
    type: 'raster',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
};

// Order the automatic fallback walks when a provider starts failing.
export const BASEMAP_ORDER = ['streets', 'plain', 'osm'];

export const HOUSTON_CENTER = [29.7604, -95.3698];

// FOSSGIS public OSRM instances (same servers openstreetmap.org uses for routing).
// All three accept "driving" in the URL path; the profile is chosen by the host path.
export const OSRM_HOSTS = {
  car: 'https://routing.openstreetmap.de/routed-car',
  bike: 'https://routing.openstreetmap.de/routed-bike',
  foot: 'https://routing.openstreetmap.de/routed-foot',
};

// TRANSIT ROUTING
//
// MOTIS, run as a free keyless public service by the Transitous project, which
// ingests Houston METRO's own GTFS feed (Transitland
// `f-9vk-metropolitantransitauthorityofharriscounty`). Every route number,
// stop name and departure time the app shows is read back out of this
// response — see the header of js/transit.js for why that matters.
export const TRANSIT_API = 'https://api.transitous.org/api/v1/plan';

// How wide a departure window to search, in seconds. An hour is long enough to
// catch a second option on a 30-minute headway, which most METRO local routes
// run outside rush hour.
export const TRANSIT_SEARCH_WINDOW_S = 3600;

// Where METRO's timetable and fare information actually lives, for the links
// this app shows instead of numbers it cannot source.
export const METRO_LINKS = {
  fares: 'https://www.ridemetro.org/fares-passes',
  schedules: 'https://www.ridemetro.org/schedules-maps',
  agency: 'https://www.ridemetro.org/',
  feed: 'https://www.transit.land/feeds/f-9vk-metropolitantransitauthorityofharriscounty',
  router: 'https://transitous.org/',
};

// WEATHER AND AIR
//
// Open-Meteo, keyless and CORS-open, for the conditions a trip happens in.
// Temperature and humidity come back as model output; the heat index the app
// reports is computed from them here with the National Weather Service's own
// equation rather than taken from Open-Meteo's `apparent_temperature`, so the
// number can be checked line by line in js/weather.js.
export const WEATHER_API = 'https://api.open-meteo.com/v1/forecast';
export const AIR_QUALITY_API = 'https://air-quality-api.open-meteo.com/v1/air-quality';

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Photon is an OSM geocoder built for type-ahead; Nominatim's usage policy
// explicitly rules autocomplete out, so it is kept for one-shot lookups only.
export const PHOTON_SEARCH_URL = 'https://photon.komoot.io/api/';
export const PHOTON_REVERSE_URL = 'https://photon.komoot.io/reverse';
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

// Results are biased toward Houston but searched across Texas. Restricting
// the box to the metro made statewide queries silently wrong rather than
// empty: "UT Austin" came back as UTMB Galveston, "Texas Tech" as an A&M
// building in the medical center. Photon's lat/lon bias already floats local
// results to the top, so the wider box costs nothing for in-town searches.
export const SEARCH_BIAS = { lat: 29.7604, lon: -95.3698 };
export const GREATER_HOUSTON = { s: 29.0, w: -96.2, n: 30.6, e: -94.6 };
export const TEXAS = { s: 25.5, w: -107.0, n: 36.8, e: -93.3 };

// IMPACT FACTORS
//
// Every number below is a published average applied to the routed distance —
// none of it is measured, live, or specific to a given vehicle or person.
// They are constants precisely so they are auditable and easy to replace; the
// UI lists these sources under "Trip impact" rather than hiding them here.
export const MODES = {
  car: {
    label: 'Drive',
    verb: 'Head',
    gerund: 'driving',
    icon: '🚗',
    // 404 g CO2/mile ÷ 1.609 — US EPA's typical passenger vehicle, one occupant.
    co2PerKm: 251,
    kcalPerKm: 0,
    // Only the walk/bike portion of a trip is heat-exposed; a car is (usually) air conditioned.
    heatExposed: false,
    // $0.67/mile ÷ 1.609 — IRS 2024 standard mileage rate, which bundles fuel,
    // maintenance, insurance and depreciation.
    costPerKm: 0.42,
    // Straight-line ceiling past which the request is refused. The public OSRM
    // instances are shared, and asking one to route a 300 km walk makes it
    // grind for everybody.
    maxTripKm: 800,
  },
  bike: {
    label: 'Bike',
    verb: 'Ride',
    gerund: 'cycling',
    icon: '🚲',
    // Manufacturing and maintenance only. The European Cyclists' Federation
    // puts cycling at ~21 g/km all-in, of which ~16 g is the extra food eaten;
    // that part is reported separately here as calories, not carbon.
    co2PerKm: 5,
    kcalPerKm: 30, // ~500 kcal/h at a 16 km/h commuting pace
    heatExposed: true,
    costPerKm: 0.03, // rough maintenance allowance — the softest number here
    maxTripKm: 120, // a long day's ride
  },
  transit: {
    label: 'Transit',
    verb: 'Walk',
    gerund: 'by METRO',
    icon: '🚌',
    // A transit trip is not one emission factor: the walking legs emit
    // nothing and each ride is charged at its own vehicle's rate (see
    // TRANSIT_CO2_PER_KM), so this is computed per leg in js/transit.js
    // rather than read from here. The figures below describe the walking
    // part, which is the only part a rider's own body is doing.
    co2PerKm: 0,
    kcalPerKm: 62,
    // Partly. Walking to the stop and standing at it are outdoors; the ride
    // is not. The scorer uses the route's own outdoor seconds instead of
    // treating the whole trip as exposed.
    heatExposed: true,
    costPerKm: 0,
    // METRO's network reaches roughly this far across the service area;
    // beyond it there is nothing for the planner to find.
    maxTripKm: 120,
  },
  foot: {
    label: 'Walk',
    verb: 'Walk',
    gerund: 'walking',
    icon: '🚶',
    co2PerKm: 0,
    kcalPerKm: 62, // ~100 kcal/mile for a ~70 kg adult at moderate pace
    heatExposed: true,
    costPerKm: 0,
    maxTripKm: 42, // roughly a marathon; beyond this it is not a walk
  },
};

// Transit CO2 per passenger-kilometre, by vehicle.
//
// The bus figure is the one this app has always used for its "what if you took
// transit" comparison line: a METRO local bus at average occupancy, ~0.17 kg
// CO2 per passenger-mile (FTA transit averages).
//
// The rail figure is derived from it rather than pulled from a second study,
// so the two are on the same footing instead of quietly mixing
// methodologies: the FTA's own averages put light rail at 0.36 lb CO2e per
// passenger-mile against 0.64 lb for a transit bus, and 105 g/km scaled by
// that 0.56 ratio is 59. It is an average for US light rail, not a
// measurement of METRORail, which runs on ERCOT grid power and would need
// Houston's own generation mix to do properly.
export const TRANSIT_CO2_PER_KM = {
  bus: 105,
  rail: 59,
  ferry: 105,
};

// Rendered in the UI so the provenance of each figure travels with the number.
export const IMPACT_SOURCES = [
  {
    figure: 'Driving CO₂ — 251 g/km',
    source: 'US EPA, typical passenger vehicle: ~404 g CO₂ per mile, single occupant',
  },
  {
    figure: 'Cycling CO₂ — 5 g/km',
    source: "European Cyclists' Federation lifecycle estimate, manufacturing share only",
  },
  { figure: 'Walking CO₂ — 0 g/km', source: 'no vehicle; dietary energy reported as calories' },
  {
    figure: 'Transit CO₂ — 105 g/km bus, 59 g/km rail',
    source:
      'FTA transit averages, local bus at average occupancy (~0.17 kg/passenger-mile); ' +
      'rail scaled from it by the FTA light-rail : bus ratio (0.36 vs 0.64 lb/passenger-mile)',
  },
  {
    figure: 'METRO routes, stops and times',
    source:
      "METRO's own GTFS feed, routed live by MOTIS/Transitous — every route number and " +
      'departure time is read from the feed, not stored in this app. Scheduled times, not live.',
  },
  { figure: 'Calories — 62 kcal/km walking, 30 cycling', source: '~100 kcal/mile, ~70 kg adult' },
  { figure: 'Driving cost — $0.42/km', source: 'IRS 2024 standard mileage rate, $0.67/mile' },
  {
    figure: 'Unshaded minutes',
    source: 'computed here: time outdoors × the share of the route with no mapped canopy',
  },
  {
    figure: 'Heat index',
    source:
      "computed here from Open-Meteo's temperature and humidity using the US National " +
      'Weather Service equation (Rothfusz regression, with the NWS dry and humid ' +
      'corrections). It assumes shade — in direct sun the real figure runs up to ~15 °F higher',
  },
  {
    figure: 'Ozone, PM2.5 and US AQI',
    source:
      "Open-Meteo's air-quality model (CAMS) — modelled for the area, not a reading from " +
      'a nearby monitor. Index categories are the EPA’s',
  },
  {
    figure: 'Green, shade, water',
    source: 'computed here from OpenStreetMap geometry along the route',
  },
];

// Default weights for the composite "pleasantness" score. Tunable in the UI.
// Score from the best measurement; explain with the legible one.
//
// The GIS index already contains tree canopy (10%) and urban heat (15%) as
// 30 m rasters from LiDAR, LANDSAT and land-surface temperature. The shade
// layer here is built from roughly two thousand individually mapped OSM trees
// and sampled every 75 m — coarser and far less complete. It is not a
// finer-grained view of the same thing, it is a worse one, so it carries no
// weight in the score. Counting it would count canopy twice, the second time
// badly.
//
// It stays in the app because it is the only canopy signal that can be
// isolated: the index ships as a composite that cannot be decomposed, so
// "unshaded minutes" and the Shade row on the profile have no other source.
// Those report; they no longer score. If the team exports the five component
// rasters separately, their canopy replaces ours outright.
//
// Directness takes the largest remaining share for the opposite reason: it is
// the one thing the index does not measure at all, being a property of the
// route rather than of the place.
export const DEFAULT_WEIGHTS = {
  walk: 0.55, // the GIS multidimensional walkability index
  direct: 0.25, // route geometry — absent from the index entirely
  green: 0.12, // park and bayou frontage, which is amenity rather than canopy
  quiet: 0.08, // partly inside the index's raw-walkability component already
  shade: 0, // duplicate of the index's canopy and UHI; reported, not scored
};

// Distances in metres.
export const GREEN_BUFFER_M = 60; // "next to green space"
export const TREE_BUFFER_M = 30; // "under canopy"
export const SAMPLE_SPACING_M = 75; // route sampling resolution

// Houston landmarks, weighted toward FIFA World Cup 2026 venues and fan sites.
export const PRESETS = [
  { name: 'NRG Stadium (Houston Sports Park / WC26 venue)', coord: [29.6847, -95.4107] },
  { name: 'Discovery Green (Fan Festival site)', coord: [29.7530, -95.3596] },
  { name: 'George R. Brown Convention Center', coord: [29.7527, -95.3565] },
  { name: 'Shell Energy Stadium', coord: [29.7522, -95.3524] },
  { name: 'Downtown Houston (City Hall)', coord: [29.7604, -95.3698] },
  { name: 'Rice University', coord: [29.7174, -95.4018] },
  { name: 'Texas Medical Center', coord: [29.7080, -95.3980] },
  { name: 'Museum District (MFAH)', coord: [29.7256, -95.3906] },
  { name: 'Buffalo Bayou Park', coord: [29.7614, -95.3894] },
  { name: 'Hermann Park / Houston Zoo', coord: [29.7157, -95.3900] },
  { name: 'The Heights (19th St)', coord: [29.8027, -95.4113] },
  { name: 'Montrose (Westheimer & Montrose)', coord: [29.7434, -95.3906] },
  { name: 'EaDo (East Downtown)', coord: [29.7480, -95.3450] },
  { name: 'Midtown METRORail (Ensemble/HCC)', coord: [29.7395, -95.3800] },
  { name: 'Memorial Park', coord: [29.7642, -95.4364] },
  { name: 'Houston Hobby Airport (HOU)', coord: [29.6454, -95.2789] },
  { name: 'Bush Intercontinental (IAH)', coord: [29.9902, -95.3368] },
  { name: 'Galleria / Uptown', coord: [29.7398, -95.4618] },
];

// Palette used for route lines and cards, in draw order.
export const ROUTE_COLORS = ['#1f7a4d', '#2563eb', '#b45309', '#7c3aed', '#be123c', '#0f766e'];

export const FALLBACK_DATA_URL = 'data/houston-green.json';

// Walkability cost surface, prebuilt by tools/build-walkability-grid.py
export const WALKABILITY_URL = 'data/walkability.json';

// Priority sites: high walking demand crossed with low walkability.
export const PRIORITY_URL = 'data/priority.json';
