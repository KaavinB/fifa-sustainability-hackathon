// The route profile: what the route is like, metre by metre.
//
// An elevation profile answers "where are the hills". This answers "where is
// the shade", "where does it run beside a park", and "where does it put me on
// a feeder road" — the same question, different raster.
//
// The series are binary today because they come from OSM geometry: a sample is
// inside a canopy polygon or it is not. When the team's canopy and land-surface
// -temperature rasters land, `values` becomes a 0..1 float per sample and the
// same rows render as a continuous gradient. Nothing else here has to change.

import { formatDistance } from './scoring.js';

// Validated against the light chart surface with scripts/validate_palette.js:
// worst adjacent pair ΔE 25.5 (deutan), 33.6 (normal vision), all six checks pass.
export const PROFILE_SERIES = [
  { key: 'green', label: 'Green', color: '#1f7a4d', description: 'beside a park, bayou or green space' },
  { key: 'shade', label: 'Shade', color: '#7c3aed', description: 'under mapped tree canopy' },
  // Amber already means "busy road" on the direction chips, and where the
  // traffic *is* is more useful than where it is not.
  { key: 'busy', label: 'Busy', color: '#b45309', description: 'along a freeway, tollway or feeder' },
];

// Only drawn for a trip that has a ride in it. Slate reads as "not one of the
// three things being scored", which is exactly what it is: the stretch where
// green, shade and traffic all stop applying because you are inside a bus.
const RIDING = {
  key: 'ride',
  label: 'Riding',
  color: '#475569',
  description: 'on board a METRO bus or train — out of the sun, and not scored',
};

// The first row drawn from a real raster rather than from OSM geometry, and
// the first that is continuous rather than binary. A sequential encoding — one
// hue whose strength carries the value — identified by its label, not by being
// told apart from the categorical hues. Indigo sits clear of all three of those
// and of the cyan water markers.
//
// It is a COST surface: higher means harder. walkability.js does the inversion
// once, so `walk` here is already 0..1 with 1 meaning easiest.
const WALKING = {
  key: 'walk',
  label: 'Walk',
  color: '#1e40af',
  continuous: true,
  description: 'walkability surface — stronger means easier on foot',
};

/**
 * The rows to draw for one route. A walk has three; a transit trip has a
 * fourth showing where it is on board, because without it the profile reads as
 * twelve miles of unshaded pavement. A fifth appears wherever the walkability
 * surface covers the route.
 */
export function seriesFor(route) {
  const rows = route?.profile?.hasRide ? [...PROFILE_SERIES, RIDING] : [...PROFILE_SERIES];
  const walk = route?.profile?.walk;
  if (Array.isArray(walk) && walk.some((v) => v !== null && v !== undefined)) rows.push(WALKING);
  return rows;
}

const W = 320; // internal coordinate width; the SVG scales to its container
const LABEL_W = 40;
const ROW_H = 13;
const ROW_GAP = 5;
const TOP = 14; // room for water markers
const AXIS_H = 16;

const plotWidth = W - LABEL_W - 6;
const heightFor = (rows) => TOP + rows * (ROW_H + ROW_GAP) + AXIS_H;

const escape = (text) =>
  String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Contiguous runs of a binary series, so we draw a few rects instead of hundreds. */
function runs(series, distances, total) {
  const out = [];
  let start = null;
  for (let i = 0; i < series.length; i++) {
    if (series[i] && start === null) start = i;
    if ((!series[i] || i === series.length - 1) && start !== null) {
      const end = series[i] ? i : i - 1;
      out.push([distances[start] / total, Math.max(distances[end] / total, distances[start] / total + 0.004)]);
      start = null;
    }
  }
  return out;
}

/**
 * Render the profile for one route. `marks` carries the things worth finding
 * again — water stops and turns — on the same axis as the series.
 */
export function renderProfile(route, { water = [], turns = [] } = {}) {
  const profile = route?.profile;
  if (!profile || !profile.distances?.length) return '';

  const { distances, total } = profile;
  const x = (fraction) => LABEL_W + fraction * plotWidth;
  const bands = seriesFor(route);
  const chartHeight = heightFor(bands.length);

  const rows = bands.map((series, index) => {
    const y = TOP + index * (ROW_H + ROW_GAP);

    // A continuous row is one band per sample, its strength carrying the
    // value. A gap in the surface is drawn as a gap and never as a zero:
    // "no data here" and "bad here" are different claims.
    const bars = series.continuous
      ? profile[series.key]
          .map((value, i) => {
            if (value === null || value === undefined) return '';
            const from = distances[i] / total;
            const to = i + 1 < distances.length ? distances[i + 1] / total : from + 0.004;
            const width = Math.max(1.2, (to - from) * plotWidth);
            return `<rect x="${x(from).toFixed(1)}" y="${y}" width="${width.toFixed(1)}" height="${ROW_H}"
                          fill="${series.color}" fill-opacity="${(0.15 + 0.85 * value).toFixed(2)}" />`;
          })
          .join('')
      : runs(profile[series.key], distances, total)
          .map(
            ([from, to]) =>
              `<rect x="${x(from).toFixed(1)}" y="${y}" width="${Math.max(1.5, (to - from) * plotWidth).toFixed(1)}"
                     height="${ROW_H}" rx="2" fill="${series.color}" />`,
          )
          .join('');

    return `
      <g>
        <text class="profile-label" x="0" y="${y + ROW_H - 3}">${series.label}</text>
        <rect class="profile-track" x="${LABEL_W}" y="${y}" width="${plotWidth}" height="${ROW_H}" rx="2" />
        ${bars}
      </g>`;
  }).join('');

  // Water stops sit above the rows; turns tick below them.
  const waterMarks = water
    .map((stop) => {
      const cx = x(Math.min(1, stop.distanceFromStart / total));
      return `<circle class="profile-water" cx="${cx.toFixed(1)}" cy="${TOP - 6}" r="3.2" />`;
    })
    .join('');

  const turnY = TOP + bands.length * (ROW_H + ROW_GAP) - ROW_GAP + 2;
  const turnMarks = turns
    .map((turn) => {
      const cx = x(Math.min(1, turn.distanceFromStart / total));
      return `<line class="profile-turn" x1="${cx.toFixed(1)}" y1="${turnY}" x2="${cx.toFixed(1)}" y2="${turnY + 3}" />`;
    })
    .join('');

  const axisY = chartHeight - 4;
  const ticks = [0, 0.5, 1]
    .map((fraction) => {
      const anchor = fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle';
      return `<text class="profile-tick" x="${x(fraction).toFixed(1)}" y="${axisY}" text-anchor="${anchor}">${
        fraction === 0 ? '0' : formatDistance(total * fraction)
      }</text>`;
    })
    .join('');

  return `
    <svg class="profile-svg" viewBox="0 0 ${W} ${chartHeight}" role="img"
         aria-label="Route profile: where this route is green, shaded and beside traffic">
      ${rows}
      ${waterMarks}
      ${turnMarks}
      ${ticks}
      <line class="profile-cursor" x1="0" y1="${TOP - 10}" x2="0" y2="${turnY + 4}" style="display:none" />
      <rect class="profile-hit" x="${LABEL_W}" y="0" width="${plotWidth}" height="${chartHeight - AXIS_H + 6}" />
    </svg>`;
}

/** Which sample sits at a given 0..1 position along the route. */
export function sampleAt(profile, fraction) {
  const target = fraction * profile.total;
  let index = 0;
  while (index < profile.distances.length - 1 && profile.distances[index + 1] < target) index++;
  return index;
}

/** Legend text for one point on the route, used by the hover tooltip. */
export function describeSample(profile, index) {
  const rows = profile.hasRide ? [...PROFILE_SERIES, RIDING] : PROFILE_SERIES;
  const active = rows.filter((series) => profile[series.key]?.[index]);

  // Continuous, so it cannot be filtered on truthiness like the binary rows —
  // and 0 is a real value here, meaning "as hard as it gets", not "absent".
  const walk = profile.walk?.[index];
  if (walk !== null && walk !== undefined) {
    active.push({
      key: 'walk',
      color: WALKING.color,
      label: walk > 0.66 ? 'easy on foot' : walk > 0.33 ? 'fair on foot' : 'hard on foot',
    });
  }
  return {
    distance: formatDistance(profile.distances[index]),
    parts: active.length
      ? active
          .map(
            (series) =>
              `<span class="profile-key"><i style="background:${series.color}"></i>${escape(series.label)}</span>`,
          )
          .join(' ')
      : '<span class="profile-none">open pavement</span>',
    coord: profile.coords[index],
  };
}
