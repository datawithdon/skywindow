# Security notes

SkyWindow is a static web app with no server, no accounts and no analytics. It talks to three public data hosts and nothing else.

## What's protected and how

| Area | Protection |
|---|---|
| Network | The CSP allows only same-origin scripts, styles, images and workers. `connect-src` allows only `api.open-meteo.com`, `geocoding-api.open-meteo.com` and `services.swpc.noaa.gov`. Requests omit credentials and referrer. |
| Untrusted responses | Every API response is parsed into a fixed shape: numbers are type- and range-checked, array lengths are capped, the time zone must be a valid IANA name, and place names are length-capped and stripped of control, zero-width and bidi-override characters. Bodies are read as a stream and abandoned once they pass a per-endpoint size cap. Redirects are refused. |
| Code injection | All text is rendered with `textContent` / DOM APIs, never `innerHTML`. The chart is built from SVG elements. The CSP enforces Trusted Types (`require-trusted-types-for 'script'`), with one policy that allows only `sw.js`. |
| Stored data | The saved location, settings and last forecast are rebuilt on every load with the same range checks as live API data, since other apps on the shared origin could write to them. If anything still fails to render, the app offers a one-tap reset instead of hanging. Keys are prefixed `skywindow:`. |
| Clickjacking | The app refuses to run inside another site's frame. GitHub Pages can't send `frame-ancestors`. |
| Offline cache | The service worker handles only same-origin GET requests inside the app's path, caches only query-free URLs, and deletes only its own old caches. API responses are never cached by the service worker. |
| Calendar export | Event text is escaped per RFC 5545 and lines are folded; the file is built locally as a Blob. |

## Privacy

- Location is optional. "Use my location" asks the browser once with low accuracy; coordinates are rounded to 2 decimals (about 1 km) before they are stored or sent.
- Open-Meteo receives the rounded coordinates and your IP address. NOAA receives only your IP address. See [Open-Meteo's terms](https://open-meteo.com/en/terms) and [NOAA's privacy policy](https://www.noaa.gov/protecting-your-privacy).
- **Shared origin.** GitHub Pages serves all of an account's project sites from one origin, so they share browser storage. Nothing SkyWindow stores is sensitive beyond the rounded location.

## Audit log

**2026-11-23, full audit.** No critical, high or medium findings. Checked: CSP and Trusted Types enforcement in a real browser (HTML sinks, foreign scripts, rogue policies, eval and other hosts all blocked), the frame guard, 3,000+ fuzzed API responses through the parsers and scorer, poisoned localStorage, .ics injection, and a full-history scan for secrets and personal data. Fixed:

- Low: an out-of-range timestamp planted in saved data crashed rendering and left the app stuck on "Loading…". Saved data now goes through the API validators, and rendering has a reset fallback.
- Low: response size caps were checked only after the whole body was buffered. Bodies are now streamed with the cap enforced as they arrive.
- Low: a live aurora check could finish after you changed location and show the old location's numbers. Results for a stale location are now discarded, and "Clear saved data" aborts in-flight requests.
- Info: the service worker cached every `?query` variant of a page, and `img-src` allowed `data:` URLs it didn't need. Both are now tightened.

## Reporting

Please use GitHub's private vulnerability reporting on this repository.
