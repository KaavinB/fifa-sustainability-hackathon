// Where to spend first: high intensity crossed with low walkability.
//
// Deliverable 2b of the GIS brief. Neither half is a finding alone — a busy
// corridor that is already pleasant needs nothing, and a miserable corridor
// nobody walks is not where a limited budget goes. The product of the two is
// the question a city actually has to answer.
//
// Built offline by tools/build-priority-layer.mjs from the 1,000-route demand
// simulation and the GIS team's walkability surface, so this only has to read
// and draw it.

import { PRIORITY_URL } from './config.js';

let sites = null;
let meta = null;

export async function loadPriority() {
  if (sites) return sites;
  try {
    const res = await fetch(PRIORITY_URL);
    if (!res.ok) throw new Error(String(res.status));
    const doc = await res.json();
    meta = { routed: doc.routed, method: doc.method, generated: doc.generated };
    sites = doc.sites || [];
  } catch {
    sites = [];
  }
  return sites;
}

export const priorityMeta = () => meta;

/** Marker radius: area carries priority, so the eye compares fairly. */
export function radiusFor(priority, top) {
  const share = top > 0 ? priority / top : 0;
  return 6 + Math.sqrt(share) * 14;
}

/**
 * Sequential red, because this is the one layer that is genuinely a warning —
 * these are the places the analysis says are worst-served relative to how many
 * people use them. Everything else in the app avoids red for exactly this
 * reason: so that when it appears, it means something.
 */
export function colorFor(priority, top) {
  const share = top > 0 ? priority / top : 0;
  const alpha = 0.35 + 0.5 * share;
  return { fill: `rgba(190, 18, 60, ${alpha.toFixed(2)})`, stroke: '#9f1239' };
}

export function describeSite(site, rank, routed) {
  const share = routed ? Math.round((site.trips / routed) * 100) : null;
  return {
    rank,
    name: site.name || site.coord.map((v) => v.toFixed(4)).join(', '),
    trips: site.trips,
    share,
    cost: site.cost,
    priority: site.priority,
  };
}
