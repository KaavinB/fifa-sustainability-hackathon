// Heat, sun and air along the route — the conditions the trip actually happens in.
//
// WHY THIS EXISTS
//
// Until this file, the app's entire thesis was heat and it had no heat data at
// all. "Unshaded minutes" was pure geometry — minutes times the share of the
// route with no mapped canopy — and it read exactly the same at 70 °F as at
// 105 °F. Twenty-three unshaded minutes in March is a pleasant walk. The same
// twenty-three minutes on a Houston afternoon is the reason somebody orders a
// car instead, which is the decision this whole app exists to change.
//
// PROVENANCE, IN ORDER OF HOW MUCH WE TRUST IT
//
//   1. Temperature, humidity, UV, rain  — Open-Meteo, from national weather
//      models. Measured inputs, not derived.
//   2. Heat index                       — computed HERE from (1), with the US
//      National Weather Service's own published equation, so the number is the
//      one Houstonians hear on the news and can be checked line by line below.
//      Open-Meteo also ships an `apparent_temperature`, which is NOT used: it
//      is a different model's opaque output, and a figure this app leans on
//      this hard should be one it can show its working for.
//   3. Ozone and PM2.5                  — Open-Meteo's air-quality model
//      (CAMS). Modelled, not a reading from a monitor down the road.
//   4. US AQI                           — Open-Meteo's conversion of (3) to
//      the EPA index. Reported as theirs, and labelled as modelled.
//
// Both endpoints are keyless and send `access-control-allow-origin: *`.

import { WEATHER_API, AIR_QUALITY_API } from './config.js';

/* ------------------------------------------------------------ heat index --- */

/**
 * The US National Weather Service heat index, in °F, from air temperature and
 * relative humidity — "what it feels like" in the specific sense the NWS means
 * it, which is the shade temperature that would feel the same at a reference
 * humidity. It assumes shade and a light breeze; in direct sun the real figure
 * runs up to about 15 °F higher, which is precisely why this app spends so much
 * effort on where the shade is.
 *
 * Steidl/Rothfusz regression plus the two corrections NWS applies at the dry
 * and humid edges. Below about 80 °F the regression misbehaves, so NWS uses a
 * simple average form there instead, and so does this.
 */
export function heatIndexF(tempF, rh) {
  if (!Number.isFinite(tempF) || !Number.isFinite(rh)) return null;

  // NWS: try the simple form first; if it lands under 80 °F, that is the answer.
  const simple = 0.5 * (tempF + 61.0 + (tempF - 68.0) * 1.2 + rh * 0.094);
  if ((simple + tempF) / 2 < 80) return simple;

  const t = tempF;
  const r = rh;
  let hi =
    -42.379 +
    2.04901523 * t +
    10.14333127 * r -
    0.22475541 * t * r -
    0.00683783 * t * t -
    0.05481717 * r * r +
    0.00122874 * t * t * r +
    0.00085282 * t * r * r -
    0.00000199 * t * t * r * r;

  // Dry air overstates the index; very humid air at moderate heat understates it.
  if (r < 13 && t >= 80 && t <= 112) {
    hi -= ((13 - r) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
  } else if (r > 85 && t >= 80 && t <= 87) {
    hi += ((r - 85) / 10) * ((87 - t) / 5);
  }
  return hi;
}

/**
 * The NWS heat-index bands, and the ramp that draws them.
 *
 * The colour encodes the official band rather than a continuous temperature,
 * because the bands are the part that carries meaning — they are what the
 * warnings are issued against. Five steps of one hue, light to dark: monotone
 * in lightness, every adjacent gap over 0.06, light end clear of the 2:1 floor
 * against the card, hue spread 10°. Checked with the dataviz validator's
 * ordinal mode rather than by eye.
 *
 * `label` is always rendered beside the colour. Nothing here is colour-alone.
 */
export const HEAT_BANDS = [
  { max: 80, label: 'No heat caution', short: 'Mild', color: '#f09a9a', advice: '' },
  {
    max: 90,
    label: 'Caution',
    short: 'Caution',
    color: '#e66b6b',
    advice: 'Fatigue possible with prolonged exposure.',
  },
  {
    max: 103,
    label: 'Extreme Caution',
    short: 'Ext. caution',
    color: '#d43a3a',
    advice: 'Heat cramps and heat exhaustion possible with prolonged exposure.',
  },
  {
    max: 125,
    label: 'Danger',
    short: 'Danger',
    color: '#ab1c1c',
    advice: 'Heat exhaustion likely, heat stroke possible with prolonged exposure.',
  },
  {
    max: Infinity,
    label: 'Extreme Danger',
    short: 'Ext. danger',
    color: '#6e1212',
    advice: 'Heat stroke highly likely.',
  },
];

export function heatBand(heatIndex) {
  if (!Number.isFinite(heatIndex)) return null;
  return HEAT_BANDS.find((band) => heatIndex < band.max) ?? HEAT_BANDS[HEAT_BANDS.length - 1];
}

/* -------------------------------------------------------------- air ------- */

// EPA's index categories. The breakpoints are the EPA's; the AQI value they are
// applied to is Open-Meteo's model output, which is why the UI says "modelled".
export const AQI_BANDS = [
  { max: 51, label: 'Good', color: '#1f7a4d' },
  { max: 101, label: 'Moderate', color: '#b45309' },
  { max: 151, label: 'Unhealthy for sensitive groups', color: '#d43a3a' },
  { max: 201, label: 'Unhealthy', color: '#ab1c1c' },
  { max: 301, label: 'Very unhealthy', color: '#6e1212' },
  { max: Infinity, label: 'Hazardous', color: '#4c0d0d' },
];

export function aqiBand(aqi) {
  if (!Number.isFinite(aqi)) return null;
  return AQI_BANDS.find((band) => aqi < band.max) ?? AQI_BANDS[AQI_BANDS.length - 1];
}

/* --------------------------------------------------------------- load ----- */

const cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

async function getJSON(url, signal) {
  const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
  return res.json();
}

/**
 * Hourly conditions around a point. One trip crosses a few kilometres of a
 * city, over which the forecast does not meaningfully vary, so the request is
 * made for the midpoint and cached on a coarse grid.
 */
export async function loadConditions(coord, { signal } = {}) {
  const lat = coord[0].toFixed(2);
  const lon = coord[1].toFixed(2);
  const key = `${lat},${lon}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const weatherUrl =
    `${WEATHER_API}?latitude=${lat}&longitude=${lon}` +
    '&hourly=temperature_2m,relative_humidity_2m,uv_index,precipitation_probability' +
    '&temperature_unit=fahrenheit&timezone=America%2FChicago&forecast_days=7';
  const airUrl =
    `${AIR_QUALITY_API}?latitude=${lat}&longitude=${lon}` +
    '&hourly=us_aqi,ozone,pm2_5&timezone=America%2FChicago&forecast_days=5';

  // Air quality is the optional half: losing it costs one stat, losing the
  // forecast costs the feature, so they are not allowed to fail together.
  const [weather, air] = await Promise.all([
    getJSON(weatherUrl, signal),
    getJSON(airUrl, signal).catch(() => null),
  ]);

  const airAt = new Map();
  if (air?.hourly?.time) {
    air.hourly.time.forEach((stamp, i) => {
      airAt.set(stamp, {
        aqi: air.hourly.us_aqi?.[i] ?? null,
        ozone: air.hourly.ozone?.[i] ?? null,
        pm25: air.hourly.pm2_5?.[i] ?? null,
      });
    });
  }

  const h = weather.hourly;
  const hours = h.time.map((stamp, i) => {
    const tempF = h.temperature_2m[i];
    const humidity = h.relative_humidity_2m[i];
    return {
      // Open-Meteo is asked for Houston local time and returns stamps without
      // a zone, so they are parsed as local wall time and kept as the label
      // they already are rather than converted twice.
      stamp,
      hour: Number(stamp.slice(11, 13)),
      date: stamp.slice(0, 10),
      tempF,
      humidity,
      uv: h.uv_index?.[i] ?? null,
      rainPct: h.precipitation_probability?.[i] ?? null,
      heatIndex: heatIndexF(tempF, humidity),
      ...(airAt.get(stamp) ?? { aqi: null, ozone: null, pm25: null }),
    };
  });

  const data = { hours, byStamp: new Map(hours.map((x) => [x.stamp, x])) };
  cache.set(key, { at: Date.now(), data });
  return data;
}

/* ------------------------------------------------------------- windows ---- */

/** The Open-Meteo stamp for a given Houston wall-clock hour. */
export function stampFor(houstonWall) {
  return `${houstonWall.slice(0, 13)}:00`;
}

/**
 * Conditions over the span a trip actually occupies, not just the minute it
 * starts. A 90-minute ride that leaves at 4pm finishes in a different hour and
 * often a different heat band, and averaging over the hours it crosses is
 * closer to what the rider experiences than reading the departure hour alone.
 */
export function conditionsOver(conditions, startWall, durationSec) {
  if (!conditions?.hours?.length || !startWall) return null;

  const startStamp = stampFor(startWall);
  const startIndex = conditions.hours.findIndex((x) => x.stamp >= startStamp);
  if (startIndex < 0) return null;

  const span = Math.max(1, Math.ceil((durationSec || 0) / 3600));
  const slice = conditions.hours.slice(startIndex, startIndex + span);
  if (!slice.length) return null;

  const mean = (pick) => {
    const vals = slice.map(pick).filter(Number.isFinite);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const peak = (pick) => {
    const vals = slice.map(pick).filter(Number.isFinite);
    return vals.length ? Math.max(...vals) : null;
  };

  return {
    hours: slice,
    heatIndex: mean((x) => x.heatIndex),
    tempF: mean((x) => x.tempF),
    humidity: mean((x) => x.humidity),
    uv: peak((x) => x.uv),
    rainPct: peak((x) => x.rainPct),
    aqi: peak((x) => x.aqi),
    ozone: peak((x) => x.ozone),
    pm25: peak((x) => x.pm25),
    crossesHours: slice.length > 1,
  };
}

/** The `count` hours from `fromWall` onward, for the picker strip. */
export function hoursFrom(conditions, fromWall, count = 14) {
  if (!conditions?.hours?.length) return [];
  const startStamp = stampFor(fromWall);
  let i = conditions.hours.findIndex((x) => x.stamp >= startStamp);
  if (i < 0) return [];
  // Show a little of the run-up, so "earlier would be better" is visible too.
  i = Math.max(0, i - 2);
  return conditions.hours.slice(i, i + count);
}
