# Data sources and provenance

Every layer this app scores on, where it came from, and who produced it. The
project is Track 4 of the Rice University Urban Sustainability Hackathon —
*High Intensity Corridors & Future Growth Districts*.

## The Multidimensional Walkability Index

The walkability cost surface this app samples is a composite built by the GIS
team, not a single measurement:

| Component | Weight in MWI | Source | Produced by |
| --- | --- | --- | --- |
| Raw walkability | **50%** | [EPA Smart Location / National Walkability Index](https://www.epa.gov/smartgrowth/smart-location-mapping) · [EPA Data Commons](https://edg.epa.gov/EPADataCommons/public/OA) | Daniel Jennings |
| Urban heat island | **15%** | Land surface temperature, peak summer | Saebyeok Keum |
| Stops for rest/water | **15%** | Convenience stores, benches, seating | Min Choi |
| Tree canopy | **10%** | LiDAR point cloud · LANDSAT | Saebyeok Keum (LiDAR), Min Choi (LANDSAT) |
| Sidewalk density | **10%** | [Pedestrian Infrastructure Classification](https://www.arcgis.com/home/item.html?id=c0d520baa30d4b47ab36232231c17875) · [Overpass](https://overpass-turbo.eu/) | Daniel Jennings |

Delivered as `WalkabilityCS_MRD_Full_nodataset.tif` — 4030 × 2992 float32 at
30 m, EPSG:3857, nodata 0. **A cost surface: higher means harder to walk.**

### Known overlap with this app's own scoring

Stated plainly because it affects how the score should be read: **40% of the
MWI measures things this app also scores independently.** Tree canopy and UHI
(25% of the index) overlap the *Shade* component; rest and water stops (15%)
overlap the water-stop metric.

They are not identical measurements. The MWI components are area-level, from
block-group and raster data; this app samples OSM geometry every 75 m along
the actual path walked. A block group can be well-shaded on average while the
specific sidewalk you are on has no canopy at all. But the signals do overlap,
and weighting both heavily counts canopy twice — which is why walkability
carries 20% here rather than the larger share its breadth might suggest.

## Tree canopy

- [USA Legacy NLCD Tree Canopy Cover](https://www.mrlc.gov/)
- HGAC Urban Forest GIS Tool
- USA NAIP Imagery: NDVI
- LiDAR point cloud analysis

A finding from the team's own analysis, on the 15-minute walk buffers around
Houston METRO stations: **higher tree canopy is associated with lower surface
temperature**, a clear downward trend across canopy classes. That relationship
is the reason shade is scored here at all.

## Walkability literature the weights rest on

- **Walk Score** — [methodology](https://www.walkscore.com/methodology.shtml) ·
  [Houston](https://www.walkscore.com/score/houston-tx) ·
  [validation study](https://www.mdpi.com/1660-4601/8/11/4160)
- **Tsiompras & Photis (2017)**, GIS-based walkability index —
  [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2352146517308414)

  > Walkability = [0.22 Connectivity + 0.26 Land-Use Mix + 0.38 Proximity +
  > 0.14 Population Density] − [0.10 × (0.41 Width<1m + 0.24 Bad Condition +
  > 0.35 Obstacles)]

- Reported weight ranges across that literature: connectivity 22–40%, population
  and household density 16–26%, commercial density 16.7–25%, land-use mix and
  rest/water 16–26%, sidewalk quality as a penalty of −24% to −41%.

## Why this project exists

[Kinder Institute — urban tree distribution reveals neighbourhood inequalities
within cities, including Houston](https://kinder.rice.edu/urbanedge/urban-tree-distribution-reveals-neighborhood-inequalities-within-cities-including-houston)

## Other datasets referenced

- City of Houston boundary — [HCAD GIS downloads](https://hcad.org/pdata/pdata-gis-downloads.html)
- [Healthy Sustainable Cities global indicators](https://github.com/healthysustainablecities/global-indicators)
- Population — [GHSL GHS-POP R2023A](https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/)
- Transport PM2.5 — [GHS-UCDB emissions theme R2024A](https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_UCDB_GLOBE_R2024A/)
- [city2graph](https://city2graph.net/latest/#features)
- Harris County business directory — commercial licence, used aggregated only.
  Columns carrying named individuals and their demographics are dropped at
  import; see [`tools/xlsx-to-csv.py`](tools/xlsx-to-csv.py).

## What this app adds on top

Routing, per-route sampling and the trip-level layers are this app's own, from
open sources:

- Routing — [OSRM](https://project-osrm.org/) via FOSSGIS public instances
- Green space, canopy geometry, drinking fountains — [OpenStreetMap](https://www.openstreetmap.org/copyright)
  via [Overpass](https://overpass-api.de/), ODbL
- Transit — METRO GTFS
- Basemaps — [OpenFreeMap](https://openfreemap.org/) / OpenMapTiles
- Emission and energy factors — US EPA, FTA, IRS; itemised in the app under
  *Trip impact*
