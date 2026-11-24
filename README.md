# SkyWindow

**Should you go outside tonight?** SkyWindow scores the next few nights for stargazing and the northern lights at your location, and tells you the best window to look.

**Live:** https://datawithdon.github.io/skywindow/

## Why

A clear-sky forecast alone doesn't answer the question. A clear night under a full moon washes out the Milky Way. A moonless night is useless if the clouds roll in at 9 pm. And aurora apps alert you to Kp 5 storms without saying whether Kp 5 reaches *your* latitude, or whether you'll see anything through the overcast. SkyWindow puts cloud, moonlight, darkness and geomagnetic activity together into one score per hour.

## What it shows

- **A score out of 100 for each night**, plus the **best window** (for example "9:00 PM–2:00 AM") and a one-line verdict: "Clear skies, but a bright moon (98% lit) washes out faint stars."
- **When it's fully dark** (astronomical twilight), **the moon's phase**, and when the moon is up.
- **What you might realistically see** from your kind of site (city, suburb, countryside, dark-sky site): bright stars and planets, Moon detail, the Milky Way, star clusters.
- **Northern lights odds**: the Kp forecast for the night, the Kp your location needs for a faint horizon glow or an overhead display, and whether forecast cloud would hide it. A **live check** reads NOAA's 30–90 minute OVATION aurora nowcast for your spot.
- **Meteor showers** near their peak (Geminids, Perseids, Quadrantids and five more).
- **Hour-by-hour chart** with hover or keyboard tooltips and a table view.
- **Add the best window to your calendar** (.ics with a 30-minute reminder).
- °C/°F, light and dark mode, installable PWA, and the last forecast stays readable offline.

## How the score works

For each hour in the forecast:

| Factor | Effect |
|---|---|
| Darkness | 0 while the sun is above −12° (nautical twilight), rising to full credit at −18° (astronomical darkness) |
| Cloud | `(1 − cloud)^1.3`. Thin high cloud counts at 70% of low or mid cloud |
| Moonlight | Up to −55% for a full moon high in the sky, scaled by phase and altitude; nothing once it has set |

The night's score is the average over its best window: the top hour plus neighbouring hours within 12 points of it.

**Aurora:** SkyWindow converts your location to geomagnetic latitude (a dipole approximation using the IGRF-14 2025 pole). It then compares that with the equatorward edge of the auroral oval for the forecast Kp, roughly `66.5° − 2.04 × Kp`, allowing a few degrees for aurora seen low on the horizon. It's a rule of thumb: Kp forecasts more than a day out are rough, and real displays don't follow a neat oval.

Sun and moon positions are computed on your device with low-precision formulas from Meeus, *Astronomical Algorithms*. The tests check them against published sunset, moonrise and moon-phase times.

## Data sources

| Source | What | What it receives |
|---|---|---|
| [Open-Meteo](https://open-meteo.com) forecast API | Hourly cloud cover (total/low/mid/high), temperature, wind | Your coordinates, rounded to about 1 km |
| [Open-Meteo](https://open-meteo.com) geocoding API | Place search | The place name you type |
| [NOAA SWPC](https://www.swpc.noaa.gov) | 3-day planetary Kp forecast and OVATION aurora nowcast | Nothing about you (same file for everyone) |

No API keys, accounts, analytics or cookies. Weather data by Open-Meteo.com, licensed CC BY 4.0.

## Run locally

```sh
npm start        # serves on http://127.0.0.1:8000
npm test         # unit tests (Node 20+)
```

No build step and no dependencies.

## Project layout

| Path | What |
|---|---|
| `index.html` | App shell, strict CSP |
| `js/astro.js` | Sun and moon positions, moon phase, geomagnetic latitude (tested) |
| `js/score.js` | Night grouping, hourly score, best window, aurora odds, meteor showers, verdict, .ics (tested) |
| `js/api.js` | All network code, with response validation (tested) |
| `js/app.js` | UI and the hourly chart |
| `sw.js` | Offline app shell |

## Limits

- Cloud forecasts are the weakest link. Check again before heading out.
- Light pollution isn't measured; the site setting only changes what's listed as visible.
- Planets aren't computed individually.

MIT licensed. Not affiliated with Open-Meteo or NOAA.
