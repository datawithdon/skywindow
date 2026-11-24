# Security notes

SkyWindow is a static web app with no server, no accounts and no analytics. It talks to three public data hosts and nothing else.

## What's protected and how

| Area | Protection |
|---|---|
| Network | The CSP allows only same-origin scripts, styles, images and workers. `connect-src` allows only `api.open-meteo.com`, `geocoding-api.open-meteo.com` and `services.swpc.noaa.gov`. Requests omit credentials and referrer. |
| Untrusted responses | Every API response is parsed into a fixed shape: numbers are type- and range-checked, array lengths are capped, the time zone must be a valid IANA name, and place names are length-capped and stripped of control, zero-width and bidi-override characters. Responses over a size cap are rejected. |
| Code injection | All text is rendered with `textContent` / DOM APIs, never `innerHTML`. The chart is built from SVG elements. The CSP enforces Trusted Types (`require-trusted-types-for 'script'`), with one policy that allows only `sw.js`. |
| Stored data | The saved location, settings and last forecast are rebuilt from a fixed schema on every load; unknown keys and wrong types are dropped. Keys are prefixed `skywindow:`. |
| Clickjacking | The app refuses to run inside another site's frame. GitHub Pages can't send `frame-ancestors`. |
| Offline cache | The service worker handles only same-origin GET requests inside the app's path, and deletes only its own old caches. API responses are never cached by the service worker. |
| Calendar export | Event text is escaped per RFC 5545 and lines are folded; the file is built locally as a Blob. |

## Privacy

- Location is optional. "Use my location" asks the browser once with low accuracy; coordinates are rounded to 2 decimals (about 1 km) before they are stored or sent.
- Open-Meteo receives the rounded coordinates and your IP address. NOAA receives only your IP address. See [Open-Meteo's terms](https://open-meteo.com/en/terms) and [NOAA's privacy policy](https://www.noaa.gov/protecting-your-privacy).
- **Shared origin.** GitHub Pages serves all of an account's project sites from one origin, so they share browser storage. Nothing SkyWindow stores is sensitive beyond the rounded location.

## Reporting

Please use GitHub's private vulnerability reporting on this repository.
