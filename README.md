# Houston Route Comparison

**Not just the fastest way there — the one you'll survive in July.**

Built for the FIFA Sustainability Hackathon. Houston hosts seven FIFA World Cup 26 matches at
NRG Stadium in June and July, when the afternoon heat index regularly clears 105 °F. Every
mapping app in the world will tell a visitor the *fastest* way from Discovery Green to the
stadium. None of them will tell them which way has shade.

This app compares the realistic routes between two Houston points — on foot, by bike, by car, or
on **METRORail and METRO buses** — and scores each one on the things that actually decide whether
a person walks, rides, or gives up and calls a car:

| Signal | What it measures | Source |
| --- | --- | --- |
| **Green space** | share of the route inside or within 60 m of a park, bayou, or green area | OpenStreetMap |
| **Tree canopy** | share of the route under mapped trees, tree rows, or woodland | OpenStreetMap |
| **Away from traffic** | share of route distance on freeways, tollways, and feeder roads | OSRM step data |
| **Directness** | detour vs. the shortest option, plus turns per km | OSRM |
| **Walkability** | the project's walkability cost surface, sampled along the route | GIS team raster |
| **Heat** | the NWS heat index for the hours the trip actually occupies | Open-Meteo, computed here |

Those five combine into a 0–100 **pleasantness score** with weights the user controls live.
Alongside it the app reports the sustainability numbers: CO₂ emitted or avoided versus driving
the same trip solo, the METRO-bus equivalent, calories burned, and — the Houston-specific ones —
**unshaded minutes outdoors** and the **longest stretch without drinking water**.

### Where the impact numbers come from

Every impact figure is a published average applied to the routed distance. None of it is
measured, live, or specific to a given vehicle or person. They live as named constants in
[`js/config.js`](js/config.js) so they are auditable and easy to swap, and the app lists these
same sources under "Trip impact" so provenance travels with the number.

| Figure | Value | Source |
| --- | --- | --- |
| Driving CO₂ | 251 g/km | US EPA typical passenger vehicle, ~404 g CO₂/mile, single occupant |
| Cycling CO₂ | 5 g/km | European Cyclists' Federation lifecycle estimate, manufacturing share only |
| Walking CO₂ | 0 g/km | no vehicle; dietary energy is reported as calories instead |
| Bus CO₂ | 105 g/km | FTA transit averages, local bus at average occupancy (~0.17 kg/passenger-mile) |
| Rail CO₂ | 59 g/km | the bus figure scaled by the FTA's light-rail : bus ratio (0.36 vs 0.64 lb/passenger-mile) |
| Calories | 62 kcal/km walking, 30 cycling | ~100 kcal/mile for a ~70 kg adult |
| Driving cost | $0.42/km | IRS 2024 standard mileage rate, $0.67/mile (fuel, maintenance, insurance, depreciation) |
| Unshaded minutes, green %, water | — | computed here from OSM geometry along the route |

Caveats worth saying out loud: the ECF's full cycling figure is ~21 g/km once the extra food is
counted, and this app reports that part as calories rather than double-counting it as carbon. The
rail figure is derived from the bus one rather than pulled from a second study, so the two sit on
the same methodology instead of quietly mixing them — it is a US light-rail average, not a
measurement of METRORail, which runs on ERCOT grid power and would need Houston's own generation
mix to do properly. A transit trip is charged leg by leg: the walking emits nothing, and each ride
is charged at its own vehicle's rate.
The bike maintenance cost ($0.03/km) is a rough allowance, not a sourced figure. Car CO₂ assumes
a single occupant — carpooling divides it.

### Two scoring scales

The score can be read either way, and the toggle switches between them without re-routing:

| | Absolute | Relative |
| --- | --- | --- |
| **Scale** | fixed 0–1 per component: the real share of the route that is green, shaded, off big roads, plus how close it comes to a straight line | each component normalised across this candidate set |
| **Means** | "this route is 52% green" — the same 60 tomorrow, on any trip | "best of these five" |
| **Good for** | comparing trips, tracking change, reporting a number | ranking near-identical options |
| **Watch out** | nothing scores 100; sparse canopy data compresses the range | the best of five bad routes still scores 100 |

They genuinely disagree, which is the point. On Discovery Green → NRG by bike, absolute picks the
park detour that is 64% green; relative picks the route through The Commons, because it wins on
more components *relative to the field* even though it is less green in absolute terms.

Absolute directness is anchored on crow-flies efficiency (straight-line ÷ actual distance) rather
than "vs. the shortest option we happened to find", which is what makes it trip-independent.

## What makes this more than a route-drawing demo

Standard routing engines only ever offer the two or three fastest options, and in a grid city
those are near-identical. So the app *generates its own candidates*: after loading the green
layer, it finds large parks near the origin–destination corridor that would barely lengthen the
trip, then re-routes through them. The "most pleasant" route is usually one no routing engine
would have offered.

## Picking places

Any point in Texas works. The search is *biased* to Houston rather than restricted to it: an
earlier metro-only bounding box did not return "no results" for out-of-town queries, it returned
confidently wrong ones — "UT Austin" resolved to UT Medical Branch in Galveston, "Texas Tech" to
an A&M building in the medical center. Five ways in:

- **Type anything.** Live suggestions from [Photon](https://photon.komoot.io/), an OSM geocoder
  built for type-ahead. (Nominatim's usage policy forbids autocomplete, so it is kept as a
  one-shot fallback only.) Arrow keys and Enter work.
- **Click the map.** *Set start* / *Set finish*, then click. The point is reverse-geocoded so
  the box shows a real name rather than a coordinate pair.
- **Drag the pins.** Either endpoint can be dragged; the comparison re-runs on drop.
- **Paste coordinates**, or use ◎ for the browser's own location.
- **Type a local abbreviation.** `rga`, `brc`, `hmns`, `tmc tc`, `mda`, `tamu`, `ut austin` and
  ~40 others expand to names the geocoder can actually resolve — see
  [`js/aliases.js`](js/aliases.js). Every expansion was checked against live Photon before being
  added, and ones that resolved to the *wrong* place were left out rather than shipped: TDECU
  Stadium comes back as Shell Energy Stadium, so it is absent by choice.

The World Cup venues and fan sites are still one keystroke away as starred suggestions, but they
are a shortcut, not the menu.

## Taking METRO

Pick **🚌 METRO** and the app plans a real trip on Houston METRO's network: METRORail and the bus
routes, with the numbers, stop names, headsigns and departure times the rider will actually see.

**Nothing about those routes is written down in this app.** There is no route table in the source
to drift out of date and nothing composed from memory. Every route number, route name, line
colour, stop name, stop code, headsign and departure time is read out of METRO's own
[GTFS feed](https://www.transit.land/feeds/f-9vk-metropolitantransitauthorityofharriscounty) —
the agency's published timetable export — routed by [MOTIS](https://github.com/motis-project/motis)
on the free public service run by [Transitous](https://transitous.org/). If METRO reroutes the 56
tomorrow, the app follows on the next feed refresh with no code change. The two things the feed
does *not* contain, the app does not claim: fares (it links to METRO's fare page) and live vehicle
positions (it says "scheduled times" on every result).

### Three searches, not one

Asked for the best way from Discovery Green to NRG, MOTIS returns the optimal set for the
departure window — which in Houston is usually the Red Line, repeated at every headway. True, and
useless for comparing anything. So the app asks three times: unrestricted, bus-only, and rail-only.
Each answer is a real routed trip on the published timetable; together they surface the
alternatives the optimal set hides. Rice → NRG at 5pm comes back as:

```
084          42 min   🚶 0.5 mi › 🚌 084 › 🚶 0.4 mi        85/100   Greenest, Most shaded
056 → 700    37 min   🚶 0.4 mi › 🚌 056 › 🚆 700 › 🚶 0.6 mi 83/100   Fastest
700          38 min   🚶 0.5 mi › 🚆 700 › 🚶 0.6 mi        81/100   Shortest
```

Duplicates are folded by the routes they use, not by time: leaving at a time keeps the earliest
departure of each distinct trip, and **arriving by** a time keeps the latest one that still makes
it. Asked to be at NRG by 7pm, "the 5:17 Red Line, arriving 5:55" is a correct answer to a question
nobody asked — and the timetable window returns a dozen of them.

### A transit trip is scored on the part you are outside for

This is the one place the app's own thesis had to change shape. Averaging shade over a whole
transit trip measures the tree canopy along a rail corridor seen through a window — a number about
nobody's comfort, and one where twelve miles of riding swamps the half-mile walk that actually
decides whether the trip is bearable. So for a METRO trip:

- **Green and shade** are averaged over the walking legs only, and the cards say "Green on foot".
- **Unshaded minutes** counts the walk to the stop *plus the wait at it*, and not the ride. A
  52-minute Red Line trip with a 9-minute walk and a 6-minute wait leaves you in the sun for
  about 11 minutes. Reporting 52 would be the single most misleading number this app could print.
- **Away from traffic** is measured on the walking too. Whether the bus runs down the 288 feeder
  is not a question that applies from inside it.
- **Water stops** are matched against the walking legs, and the longest dry stretch is measured
  within each of them — so the ride between two walks is never counted as a gap between fountains.
- The **route profile** grows a fourth row, `Riding`, so the chart shows where the scored part of
  the trip is rather than reading as twelve miles of unshaded pavement.
- **CO₂** is charged leg by leg: walking emits nothing, and a METRORail car and a bus are charged
  at their own rates.

The map follows the same distinction — rides drawn solid in the line colour from METRO's feed
(the Red Line is red because METRO says it is), walking dashed and grey, with hollow pins at every
boarding and alighting point.

### Step-free routing, and a trap worth documenting

Ticking **♿ Step-free routes only** routes the walk to the stop, every transfer
and the walk off with MOTIS's `WHEELCHAIR` pedestrian profile instead of `FOOT`.

The finding it reports is smaller than the one we first measured, and the
difference is the interesting part. METRO's vehicles are marked accessible
throughout the feed and METRORail has level boarding at every platform, so on
most Houston trips **the step-free route is the same route** — it is simply
walked at about 0.69 m/s instead of 1.03. Rice → NRG: the same Red Line trip,
51 minutes instead of 38. Twelve extra minutes, all of it outdoors, which in a
Houston June is the cost that actually matters.

The trap: MOTIS budgets the first and last walking legs in **seconds** — 900
each by default — so the two profiles do not cover the same *ground*. 900 s is
about 930 m on foot but only about 620 m in a wheelchair, and any trip whose
last leg falls between those is silently dropped from the step-free results
only. Rice → NRG loses METRORail entirely under the defaults, because the 971 m
from Houston Stadium Stn takes 20 minutes at wheelchair pace.

Read naively that looks like a damning accessibility finding about Houston. It
is a unit mismatch. Raise the budget and the Red Line comes straight back, on
the same departure. So each profile is given the budget that buys it the same
~1.2 km of walking (`WALK_BUDGET_S` in [`js/transit.js`](js/transit.js)), and
the comparison means something.

Worth stating plainly because the wrong version of this number is the kind a
demo repeats on stage: *this app can tell you a step-free trip takes longer. It
cannot tell you a path is blocked.* Where no step-free trip is found at all,
the app says so and points at OpenStreetMap's patchy kerb and crossing data
rather than blaming the city.

### When?

Transit is the only mode where the answer depends on the clock, so it gets a **Leave at / Arrive
by** control. Times are Houston's whatever the browser's own zone is: a visitor planning from a
London hotel wants the bus that leaves at 7:16 pm Central, not 1:16 am. There is no library behind
that — the offset is computed from `Intl` for the specific instant, with a second pass for the two
days a year the clocks move.

## The heat you're actually in

For most of this project's life its central claim was unbacked. The app was
built around Houston heat and contained no heat data: `unshaded minutes` was
pure geometry — minutes times the share of the route with no mapped canopy —
and it read exactly the same at 70 °F as at 105 °F.

Now every trip is planned at a time, and the conditions for those hours come
from [Open-Meteo](https://open-meteo.com/) (keyless, no registration). Twenty-three
unshaded minutes stops being an abstraction:

> Feels like **106 °F** (Danger) — air 94 °F at 55% humidity.
> You are outside and unshaded for **44 min** of it, under UV 7.

### The heat index is computed here, not fetched

Open-Meteo returns an `apparent_temperature` and the app deliberately ignores it.
A number this much weight rests on should be one we can show the working for, so
[`js/weather.js`](js/weather.js) computes the **US National Weather Service heat
index** from the measured temperature and humidity — the Rothfusz regression plus
the NWS's own corrections at the dry and humid edges. It agrees with Open-Meteo's
figure to about a degree (89 °F / 73% → 104.9 here, 104 theirs), it is the number
Houstonians hear on the news, and it can be checked line by line.

One caveat the UI repeats because it matters: **the heat index assumes shade.**
In direct sun the real figure runs up to ~15 °F higher — which is the entire
reason this app spends so much effort on where the canopy is.

### The hour strip is a chart *and* a control

```
   ███ ███ ▓▓▓ ███ ███ ███ ▒▒▒ ▒▒▒ ▒▒▒ ░░░ ░░░ ░░░
   12p     2p      3p          6p          9p
   Leaving at 8p is 11°F easier. This trip would feel like
   95°F then, against 106°F now. Same route, same shade —
   different afternoon.
```

Colour encodes the **NWS band**, not a continuous temperature, because the bands
are the part that carries meaning — they are what warnings get issued against.
Five steps of one hue, light to dark, checked with the dataviz validator's
ordinal mode (monotone lightness, every adjacent gap ≥ 0.06, light end clear of
the 2:1 floor, hue spread 10°) rather than picked by eye. The band is always
named in text beside the colour; nothing here is colour-alone.

Clicking an hour re-plans at it — and what that costs depends on the mode, which
is the nice part. Roads don't care what time it is, so walking, cycling and
driving re-read a forecast already in memory and re-render in about **110 ms**
with no re-routing. METRO's timetable very much does care, so that one goes back
to the router.

Both figures in that advice are averaged over the span the trip actually
occupies, not read off the departure hour — otherwise a 90-minute ride gets
compared against a single hour it is only partly in, and the card prints two
different temperatures for the same departure. It did, briefly, before this was
fixed.

The advice only appears when the heat is worth escaping (≥ 90 °F) and the better
hour is within six hours. Unbounded, it degenerates into "travel at night",
which is true of every hot place and helps nobody.

### Driving gets the conditions, not the advice

A driver is not in the weather. Offering them a cooler hour is advice for
somebody else's trip, so in Drive mode the card reports the conditions and stops:

> Feels like 107 °F (Danger) — air 95 °F at 52% humidity. You are in air
> conditioning for all 16 min of it — which is what the CO₂ below buys.

### Ozone

Houston's signature pollutant peaks on hot, still afternoons — exactly the
conditions this app is about — and it matters most to the people breathing
hardest, which is cyclists. AQI and ozone ride along in the heat card's source
line, and air quality takes a slot in *Trip impact* only when it crosses the
EPA's "Unhealthy for sensitive groups" line **and** the mode is one you breathe
hard in. It is modelled (CAMS via Open-Meteo), not a reading from a monitor down
the road, and the UI says so.

## Nothing searches on its own

A comparison is expensive: an OSRM call, an Overpass download over the whole
corridor, and for METRO three timetable queries on top. It used to fire by
itself from seven places — picking a suggestion, clicking the map, dragging a
pin, swapping ends, geolocating, switching mode, moving the departure time — so
setting up a trip could kick off four searches before you had finished
describing it, on public instances that take tens of seconds when they are busy.

**Only the button searches now.** Everything else says what changed:

> Mode changed to Bike. The routes below are from your last search — hit
> **Compare routes** to update them.

The results stay on screen rather than vanishing, because flipping to another
mode to look and flipping back should not cost a re-search — but they carry an
`outdated` chip and the button takes a ring, so a stale list can never pass for
a current one.

The line between the two is whether an answer needs the network:

| Action | What happens |
| --- | --- |
| Weight sliders, absolute ↔ relative | re-scored from data already in memory, instantly |
| Picking an hour on walk / bike / drive | re-read of a forecast already loaded — ~50 ms, no request |
| Picking an hour on METRO | marked stale; the timetable genuinely differs by hour |
| Endpoints, mode, swap, step-free | marked stale |
| **Compare routes**, or Enter in a search box | searches |

Enter still works, because pressing it in a search box is someone asking for a
search, not the app deciding to run one.

## Water stops

Drinking fountains (`amenity=drinking_water`, `water_point`, `drinking_water=yes`) within 120 m
of the route are pulled from the same Overpass round-trip, pinned on the map, listed in order
with how far along the route they sit, and flagged on the individual turn they belong to.

The headline number is not how many fountains exist but **the longest stretch without one** —
the question that actually matters at 100 °F. Decorative fountains (`amenity=fountain`) are
deliberately excluded: they are not potable, and pointing someone at one in that heat is worse
than saying nothing.

Two findings from the Houston data, both worth stating plainly:

- Buffalo Bayou Park → Discovery Green on foot: **6 refill points**, longest dry stretch 1.0 km.
- Rice University or Hermann Park → NRG Stadium on foot: **zero** mapped water within 120 m of
  any route, for the whole ~5 km. Fountains exist in Hermann Park, but not along the corridor
  people actually walk to the stadium.

That second result is either a genuine gap in Houston's pedestrian infrastructure or a gap in
OpenStreetMap's coverage of it. Both are worth knowing before a World Cup summer, and the app
says which it can and cannot tell.

## Route profile

Percentages say *how much*; they cannot say *where*. The profile answers where —
an elevation profile for thematic layers rather than terrain, with distance
along the route on the x-axis:

```
Green  ███████████████████████░░░░░░░███
Shade  ░░░░████████░░░░░░░░░░░░░░░░░████
Busy   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
       0                0.5 mi     1.0 mi
```

Water stops sit above the rows and turns tick below, on the same axis, so the
chart carries route context that a standalone profile cannot. Hovering reads
out the conditions at that point; clicking flies the map there, which makes the
profile a scrubber for the route.

It is drawn from the *same* 75 m samples the score is averaged from, so the
chart and the headline number cannot disagree — a test asserts the two match.

The series are binary today because they come from OSM geometry: a sample is
inside a canopy polygon or it is not, which is why the rows read as blocks. The
renderer takes a value per sample, so continuous canopy-cover and land-surface
-temperature rasters turn the same rows into gradients without changing the
chart. That swap is the single biggest accuracy upgrade available to this app.

Colours were chosen by running the palette through the validator in the
`dataviz` skill rather than by eye: worst adjacent pair ΔE 25.5 under deuteranopia
and 33.6 with normal vision, all six checks passing against the card surface.
Amber marks where the route *is* busy rather than where it is calm, both because
amber already means "busy road" on the direction chips and because the stretches
to avoid are the ones worth finding.

## Walkability surface

It carries 20% of the default weight — below green and shade deliberately,
because it is a composite that already folds in road context, and giving it
more would quietly count traffic twice. Where the surface has no coverage the
component drops out and the remaining weights are renormalised, so a route is
never punished for leaving the study area; the score stays comparable, it just
rests on less evidence.


The first row on the profile drawn from a real raster rather than from OSM
geometry, and the first that is continuous rather than binary — which is the
upgrade the binary green and shade rows were always waiting for.

The source is a 53 MB float32 GeoTIFF at 30 m in EPSG:3857, produced by the
project's GIS team. It ships as a **173 KB** grid: resampled to 150 m in plain
lat/lon (so a lookup is two divisions, no projection maths at runtime) and
quantised to a byte a cell. Rebuild with
[`tools/build-walkability-grid.py`](tools/build-walkability-grid.py). Verified
against the original at known landmarks — worst disagreement 0.22 index units,
which is 150 m resampling rather than error.

**It is a cost surface: a higher index means harder to walk.** That was worth
checking rather than assuming, because an inverted scale would flip every
recommendation the app makes while looking perfectly confident:

```
KNOWN WALKABLE                  KNOWN NOT WALKABLE
  Montrose Westheimer   2.43      Tollway interchange   4.59
  Rice Village          2.48      Katy Mills big-box    6.01
  Downtown core         2.98      Ship channel          9.39
  ── mean 2.62 ──                 ── mean 7.37 ──
```

Zero overlap between the two groups. The grid therefore stores the **original**
index with `"polarity": "higher-is-worse"` recorded alongside it, and
[`js/walkability.js`](js/walkability.js) inverts in exactly one function. A
reader that silently flipped the numbers would be impossible to audit later.

About 43% of the source is nodata, so coverage is patchy outside the core. A
gap is drawn as a gap and reported as `null`, never as zero — "no data here"
and "bad here" are different claims and the UI must not conflate them.

## Turn-by-turn directions

Selecting a route produces exact directions built from OSRM's step data — with the shade layer
carried through to each individual instruction:

```
→ Turn right onto Crawford Street Bikeway     480 ft   green
← Turn left onto Austin Street Bikeway        600 ft
↖ Bear left onto Brays Bayou Greenway         370 ft   shaded, green
◎ Arrive at NRG Stadium, on your right         10 ft
```

Clicking any instruction zooms the map to that maneuver and highlights the stretch of road it
covers. Steps under 25 m and "continue" steps that restate the current road are folded into the
previous instruction, so a walking route reads as ~50 usable steps instead of 75 noisy ones.

A detail that is easy to get wrong: OSRM's `name` is *the way along which travel proceeds* for
that step — the road the maneuver puts you **onto**, not the one you are leaving. Houston's OSM
sidewalk network is largely unnamed, and there the bare turn word is more honest than inventing
a street name.

## On a phone

Below 900px the sidebar becomes a bottom sheet over a full-screen map, with
three snap points — peek, half, full — dragged by the handle. Dragging is
confined to the handle so it never competes with the list scrolling inside it;
a press cycles sizes and the arrow keys work. Minimised, the sheet shows the
trip and the headline result, and nothing else.

The subtlety worth knowing if you touch it: the sheet is taller than the
screen and slides down into place, so the part below the viewport is
off-screen rather than scrolled. The scrolling area is therefore sized to
whatever is visible at the current snap point, and the snap points are
re-measured whenever the handle's contents change height.

Selecting a route, a turn, or a water stop frames it against the *visible*
part of the map rather than the centre of the element — with the sheet at half
height that is a ~170px difference, which is the difference between seeing
your route and seeing the sheet on top of it.

## Bringing your own data

The loader accepts a **GeoJSON FeatureCollection**, so collaborators can hand
over what their GIS tools already export — `ogr2ogr -f GeoJSON out.geojson
in.shp` covers a shapefile in one command. Point, MultiPoint, LineString,
MultiLineString, Polygon and MultiPolygon are all read; polygon holes are
ignored, since the scorer's inside-test does not model them and parks rarely
have them. Feature `properties` are read as OSM-style tags, so `{"leisure":
"park"}` or `{"amenity": "drinking_water"}` classify a feature exactly as the
live data would.

The trap worth stating plainly: **GeoJSON is `[lon, lat]` and everything inside
this app is `[lat, lon]`.** Getting that backwards puts Houston in the Indian
Ocean without erroring. The reader flips it; a test asserts the result still
lands in Texas.

Drop the file at [`data/houston-green.json`](data/houston-green.json) or point
`FALLBACK_DATA_URL` in [`js/config.js`](js/config.js) at it. The compact bundle
format that the built-in extract uses is still read too — the loader detects
which one it has.

## Map styling

Two keyless basemaps: **Streets** (OpenStreetMap's own tiles) and **Plain** (the
HOT style from OSM France), switched with the 🗺 button. Both show parks and
water in natural colour, which matters here — the green space the app scores on
should be visible under the routes.

This used to be CARTO's Voyager. CARTO began requiring an API key and now paints
**"API KEY REQUIRED" into otherwise valid tiles**, returning HTTP 200 with the
watermark baked into the image. That is worth knowing because it defeats the
obvious defence: the app falls back to another provider after ten `tileerror`
events, and a watermarked tile raises no error at all. No handler can see it.
The fix was not a better detector, it was removing the dependency.

Ten tile failures still switch providers automatically, which covers an outage
or throttling. At demo scale OSM's tile policy is fine; a deployment with real
traffic would need its own tiles or a keyed provider — an Esri key would slot
into `BASEMAPS` in [`js/config.js`](js/config.js) as a third entry with the key
as a query parameter, and nothing else in the app would need to change.

## Running it

It is a static site with no build step and no API keys.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## How it works

```
origin, destination, mode
   │   (typed, clicked, dragged, or geolocated — Photon geocodes either way)
   │
   ├─ walk / bike / drive ──────────────────────┐
   │     OSRM (FOSSGIS public instances) ───────┴─► 1–3 fastest alternatives
   │
   ├─ METRO ────────────────────────────────────┐
   │     MOTIS via Transitous, over METRO's own │
   │     GTFS feed — three searches (any, bus   │
   │     only, rail only), deduped by the routes┴─► real timetabled trips
   │     they use
   │
   ├─ Overpass API over the route corridor ─────► parks, woods, trees, fountains
   │      └─ falls back to data/houston-green.json when Overpass rate-limits
   │
   ├─ pick large parks near the corridor ───────► re-route through each
   │
   ├─ sample every route at 75 m, test each sample against a grid-indexed
   │  green layer ─────────────────────────────► green %, shade %, big-road %
   │     (a transit trip is measured over its       → weighted 0–100 score
   │      walking legs only — see below)
   │
   ├─ re-sample each OSRM step at 20 m ─────────► per-instruction shade / green
   │                                               → turn-by-turn directions
   │
   └─ match fountains within 120 m of the line ─► water stops in route order
                                                   → longest dry stretch
```

### Files

| File | Role |
| --- | --- |
| [`js/config.js`](js/config.js) | endpoints, emission factors, default weights, Houston presets |
| [`js/geo.js`](js/geo.js) | haversine, local projection, path resampling, point-in-polygon, grid index |
| [`js/routing.js`](js/routing.js) | OSRM calls, green-detour candidate generation |
| [`js/transit.js`](js/transit.js) | METRO trip planning: the MOTIS call, polyline decoding, itinerary → route |
| [`js/places.js`](js/places.js) | type-ahead search, reverse geocoding, geolocation |
| [`js/aliases.js`](js/aliases.js) | local abbreviations expanded to resolvable place names |
| [`js/sheet.js`](js/sheet.js) | the draggable mobile bottom sheet and its snap points |
| [`js/directions.js`](js/directions.js) | turn-by-turn instructions, per-step shade scoring |
| [`js/water.js`](js/water.js) | drinking-water matching along a route, longest dry stretch |
| [`js/weather.js`](js/weather.js) | hourly conditions, the NWS heat index, heat and AQI bands |
| [`js/greenspace.js`](js/greenspace.js) | Overpass query, caching, offline fallback, spatial indexing |
| [`js/scoring.js`](js/scoring.js) | route metrics, normalisation, composite score, badges |
| [`js/app.js`](js/app.js) | map, form, sliders, rendering |
| [`data/houston-green.json`](data/houston-green.json) | prebuilt inner-loop green extract (offline fallback) |

## Honest limitations

- **Tree canopy is only as good as OpenStreetMap.** Houston has ~2,000 individually mapped
  trees inside the loop, which under-reports real canopy. A production version would use the
  City of Houston / NAIP canopy raster or Landsat land-surface-temperature tiles instead.
- **Absolute scores are compressed by data sparsity.** Because canopy is under-mapped, absolute
  shade rarely exceeds 20%, which drags the absolute composite into the 50s even for genuinely
  pleasant routes. Better canopy data moves this number, not a change to the formula.
- **METRO times are scheduled, not live.** Transitous skips METRO's GTFS-Realtime feed because it
  needs an API key, so a bus running ten minutes late still shows on time. The UI says so on every
  transit result rather than implying a precision it does not have.
- **No fares.** METRO's feed ships no fare products, so the app shows no fare figure and links to
  METRO's own fare page instead of printing a number it cannot source.
- **The forecast is a forecast.** It runs about a week out; METRO's timetable runs a year. Ask
  for a trip beyond the forecast horizon and the heat card quietly stands down rather than
  guessing. Air quality is modelled for the area, not measured nearby.
- **Step-free routing measures pace, not access.** The wheelchair profile walks the same
  OpenStreetMap network more slowly; where it refuses a path, that is as likely to be a missing
  kerb tag as a real barrier. The app reports the time difference and declines to explain it.
- Public OSRM and Overpass instances are rate-limited and occasionally unavailable; the bundled
  extract covers the inner loop so a live demo still works when they are.

## Data and attribution

Full provenance — including what went into the walkability index, who built
each layer, and the literature the weights rest on — is in
[SOURCES.md](SOURCES.md).


Walking, cycling and driving routed by [OSRM](https://project-osrm.org/) via the FOSSGIS public
instances. METRORail and METRO bus trips routed by [MOTIS](https://github.com/motis-project/motis)
on the free public service run by [Transitous](https://transitous.org/), over
[Houston METRO](https://www.ridemetro.org/)'s own GTFS feed
([Transitland](https://www.transit.land/feeds/f-9vk-metropolitantransitauthorityofharriscounty)).
Map data
© [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, queried through
[Overpass](https://overpass-api.de/). Weather and air quality from
[Open-Meteo](https://open-meteo.com/); the heat index is computed from it here with the
[US National Weather Service](https://www.weather.gov/safety/heat-index) equation. Basemap tiles © [CARTO](https://carto.com/attributions).
Emission factors from the US EPA (average light-duty vehicle, 404 g CO₂/mile) and FTA transit
averages.

## Licence

The application code carries no licence, which means default copyright: it is ours, and nobody
else may reuse it without permission. That is deliberate until the hackathon's terms are read —
if they require the work to be open-sourced under a particular licence, or assign IP to the
organisers, that decides it. Adding a licence later is a one-file change.

One obligation is not ours to choose. [`data/houston-green.json`](data/houston-green.json) is a
database extracted from OpenStreetMap, and OSM's [ODbL 1.0](data/LICENSE.md) share-alike terms
travel with it: anyone redistributing that file must attribute OpenStreetMap contributors and
keep it under ODbL. Rendered output — a map image, a route — is a Produced Work and needs only
attribution, which is why the app credits OSM in the footer and on the map.
