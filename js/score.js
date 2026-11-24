// Turns an hourly forecast + Kp forecast into scored nights.
// Pure functions, no DOM or network; tested in tests/score.test.js.

import { sunAltitude, moonAltitude, moonIllumination, phaseName, geomagneticLatitude } from "./astro.js";

const HOUR = 3600000;
const MIN = 60000;

const fmtCache = new Map();
function partsFormatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }));
  }
  return fmtCache.get(tz);
}

/** Local calendar date (YYYY-MM-DD) and hour of a timestamp in an IANA zone. */
export function localParts(ms, tz) {
  const p = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(new Date(ms))) p[type] = value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

/** A night is named after the evening it starts on: hours from local noon to the next noon. */
export function nightKey(ms, tz) {
  return localParts(ms - 12 * HOUR, tz).date;
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Effective cloud %: thin high cloud dims stars less than low or mid cloud. */
export function effectiveCloud({ cloud, low, mid, high }) {
  if ([low, mid, high].every(Number.isFinite)) {
    const layered = Math.max(low, mid, 0.7 * high);
    return Math.min(100, Math.max(layered, (Number.isFinite(cloud) ? cloud : 0) - 0.3 * high));
  }
  return Number.isFinite(cloud) ? cloud : 100;
}

/** How dark the sky is from twilight alone: 0 above -12 deg, 0.5 at -12, 1 at -18 and below. */
export function darkness(sunAlt) {
  if (sunAlt >= -12) return 0;
  if (sunAlt <= -18) return 1;
  return 0.5 + ((-12 - sunAlt) / 6) * 0.5;
}

/** Fraction of sky quality lost to moonlight (0 none .. 0.55 full moon high up). */
export function moonPenalty(moonAlt, moonFrac) {
  if (moonAlt <= -0.5) return 0;
  return 0.55 * moonFrac * clamp01((moonAlt + 0.5) / 25);
}

/** Stargazing score 0-100 for one hour. */
export function hourScore({ sunAlt, moonAlt, moonFrac, cloudEff }) {
  const clear = Math.pow(clamp01(1 - cloudEff / 100), 1.3);
  return Math.round(100 * darkness(sunAlt) * clear * (1 - moonPenalty(moonAlt, moonFrac)));
}

export function scoreLabel(score) {
  if (score >= 75) return "Excellent";
  if (score >= 55) return "Good";
  if (score >= 35) return "Fair";
  if (score >= 15) return "Poor";
  return "Clouded out";
}

// ---- Aurora ----
// Rule of thumb from the auroral-oval models NOAA publishes: the oval's
// equatorward edge sits near geomagnetic latitude 66.5 - 2.04*Kp. Aurora at
// 100-300 km can be seen (or photographed) low on the horizon several hundred
// km beyond that edge, which the 5-degree ramp below approximates.
export const ovalEdge = (kp) => 66.5 - 2.04 * kp;
const RAMP = 5;

/** 0..1 geometric chance of seeing aurora at |geomagnetic latitude| for a Kp. */
export function auroraReach(kp, magLat) {
  return clamp01((Math.abs(magLat) - ovalEdge(kp) + RAMP) / RAMP);
}

/** Kp needed for a faint horizon glow (reach 0.3) and for aurora overhead (reach 1). */
export function requiredKp(magLat) {
  const m = Math.abs(magLat);
  return {
    horizon: Math.max(0, (66.5 - RAMP * 0.7 - m) / 2.04),
    overhead: Math.max(0, (66.5 - m) / 2.04),
  };
}

export function auroraLevel(reach, lat) {
  const dir = lat >= 0 ? "north" : "south";
  if (reach >= 0.95) return { key: "overhead", text: "Strong: aurora could be overhead" };
  if (reach >= 0.6) return { key: "likely", text: `Likely low on the ${dir}ern horizon` };
  if (reach >= 0.3) return { key: "possible", text: `Possible: faint glow low in the ${dir} (try a phone camera)` };
  if (reach >= 0.1) return { key: "longshot", text: "Long shot" };
  return { key: "none", text: "Unlikely" };
}

function kpAt(ms, kpList) {
  for (const k of kpList) if (ms >= k.t && ms < k.t + 3 * HOUR) return k;
  return null;
}

// ---- Meteor showers (peak dates vary by about a day year to year) ----
export const SHOWERS = [
  { name: "Quadrantids", month: 1, day: 3, span: 1, zhr: 110, note: "Sharp peak lasting only a few hours." },
  { name: "Lyrids", month: 4, day: 22, span: 2, zhr: 18, note: "Best before dawn." },
  { name: "Eta Aquariids", month: 5, day: 6, span: 3, zhr: 50, note: "Best before dawn; much better south of the equator." },
  { name: "Perseids", month: 8, day: 12, span: 3, zhr: 100, note: "Best after midnight." },
  { name: "Orionids", month: 10, day: 21, span: 3, zhr: 20, note: "Best after midnight." },
  { name: "Leonids", month: 11, day: 17, span: 2, zhr: 15, note: "Best before dawn." },
  { name: "Geminids", month: 12, day: 14, span: 2, zhr: 150, note: "Active all night; the year's best shower." },
  { name: "Ursids", month: 12, day: 22, span: 1, zhr: 10, note: "Modest; best before dawn." },
];

/** Showers within their active span of a night (YYYY-MM-DD of the evening). */
export function showersFor(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  // The night of dateKey also covers the early morning of the next date.
  const night = Date.UTC(y, m - 1, d) + 12 * HOUR;
  const out = [];
  for (const s of SHOWERS) {
    for (const yy of [y - 1, y, y + 1]) {
      const peak = Date.UTC(yy, s.month - 1, s.day);
      const days = Math.abs(night - peak) / (24 * HOUR);
      if (days <= s.span + 0.5) { out.push({ ...s, daysFromPeak: Math.round((night - peak) / (24 * HOUR) - 0.5) }); break; }
    }
  }
  return out;
}

// ---- Nights ----

function scanCrossings(fn, from, to, below) {
  // Intervals (5-min resolution) where fn(t) < below.
  const out = [];
  let start = null;
  for (let t = from; t <= to; t += 5 * MIN) {
    const inside = fn(t) < below;
    if (inside && start === null) start = t;
    if (!inside && start !== null) { out.push([start, t]); start = null; }
  }
  if (start !== null) out.push([start, to]);
  return out;
}

function bestWindow(hours) {
  const cand = hours.filter((h) => h.dark && !h.past);
  if (!cand.length) return null;
  let top = cand[0];
  for (const h of cand) if (h.score > top.score) top = h;
  if (top.score < 1) return null;
  const floor = Math.max(1, top.score - 12);
  const idx = hours.indexOf(top);
  let a = idx;
  let b = idx;
  const ok = (h) => h && h.dark && !h.past && h.score >= floor;
  while (ok(hours[a - 1]) && hours[a].t - hours[a - 1].t === HOUR) a--;
  while (ok(hours[b + 1]) && hours[b + 1].t - hours[b].t === HOUR) b++;
  const win = hours.slice(a, b + 1);
  return {
    start: win[0].t,
    end: win[win.length - 1].t + HOUR,
    score: Math.round(win.reduce((s, h) => s + h.score, 0) / win.length),
    peak: top.score,
    cloud: Math.round(win.reduce((s, h) => s + h.cloudEff, 0) / win.length),
    feels: Math.min(...win.map((h) => (Number.isFinite(h.feels) ? h.feels : Infinity))),
  };
}

/**
 * Score every night in a forecast.
 * forecast: { tz, hours: [{ t, cloud, low, mid, high, temp, feels, wind }] } (t = ms, UTC)
 * kpList:   [{ t, kp, kind }] 3-hour blocks starting at t
 */
export function buildNights(forecast, kpList, { lat, lon, now }) {
  const { tz } = forecast;
  const magLat = geomagneticLatitude(lat, lon);
  const groups = new Map();
  for (const h of forecast.hours) {
    const key = nightKey(h.t, tz);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }

  const nights = [];
  for (const [key, raw] of groups) {
    raw.sort((a, b) => a.t - b.t);
    const hours = raw.map((h) => {
      const sunAlt = sunAltitude(h.t, lat, lon);
      const moonAlt = moonAltitude(h.t, lat, lon);
      const moonFrac = moonIllumination(h.t).fraction;
      const cloudEff = effectiveCloud(h);
      const k = kpAt(h.t, kpList);
      const reach = k ? auroraReach(k.kp, magLat) : null;
      const dark = sunAlt < -12;
      return {
        ...h, sunAlt, moonAlt, moonFrac, cloudEff, dark,
        past: h.t + HOUR <= now,
        score: dark ? hourScore({ sunAlt, moonAlt, moonFrac, cloudEff }) : 0,
        kp: k ? k.kp : null,
        kpKind: k ? k.kind : null,
        auroraReach: reach,
        auroraSeen: reach === null || !dark ? 0 : reach * Math.pow(clamp01(1 - cloudEff / 100), 1.3),
      };
    });

    const darkHours = hours.filter((h) => h.dark);
    // Need a full evening; a fragment at the start or end of the forecast is dropped.
    const complete = hours.length >= 20 || (darkHours.length && hours[0].sunAlt >= -12 && hours[hours.length - 1].sunAlt >= -12);
    if (!complete) continue;
    if (darkHours.length && darkHours.every((h) => h.past)) continue;

    const from = hours[0].t - HOUR;
    const to = hours[hours.length - 1].t + HOUR;
    const sunFn = (t) => sunAltitude(t, lat, lon);
    const nautical = scanCrossings(sunFn, from, to, -12)[0] || null;
    const astro = scanCrossings(sunFn, from, to, -18)[0] || null;
    const mid = nautical ? (nautical[0] + nautical[1]) / 2 : hours[Math.floor(hours.length / 2)].t;
    const illum = moonIllumination(mid);
    const moonUp = nautical ? scanCrossings((t) => -moonAltitude(t, lat, lon), nautical[0], nautical[1], 0.5) : [];

    const live = hours.filter((h) => h.dark && !h.past);
    const kpVals = live.map((h) => h.kp).filter((k) => k !== null);
    const maxKp = kpVals.length ? Math.max(...kpVals) : null;
    const reach = maxKp === null ? null : auroraReach(maxKp, magLat);
    const seen = live.length ? Math.max(...live.map((h) => h.auroraSeen)) : 0;

    nights.push({
      key,
      hours,
      noDark: darkHours.length === 0,
      nautical,
      astro,
      moon: { fraction: illum.fraction, phase: illum.phase, name: phaseName(illum.phase), up: moonUp },
      best: bestWindow(hours),
      aurora: {
        magLat,
        maxKp,
        reach,
        level: reach === null ? null : auroraLevel(reach, lat),
        seen,
        clouded: reach !== null && reach >= 0.3 && seen < 0.15,
      },
      showers: showersFor(key),
    });
  }
  return nights.sort((a, b) => (a.key < b.key ? -1 : 1));
}

// ---- Calendar file ----

function icsEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function icsTime(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Fold a content line at 75 octets without splitting a UTF-8 character. */
export function foldLine(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { out.push(cur); cur = " "; bytes = 1; limit = 75; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

export function makeIcs({ uid, start, end, summary, description, now }) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SkyWindow//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsTime(now)}`,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT30M", `DESCRIPTION:${icsEscape(summary)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// ---- Plain-language summary ----

export const SITES = {
  city: "City centre",
  suburb: "Suburb or town",
  rural: "Countryside",
  dark: "Dark-sky site",
};

function windowHours(n) {
  if (!n.best) return [];
  return n.hours.filter((h) => h.t >= n.best.start && h.t < n.best.end);
}

/** One or two sentences on tonight's sky. */
export function verdict(n) {
  if (n.noDark) return "No real darkness tonight: the sun never gets far enough below the horizon.";
  if (!n.best) return "Clouded out: thick cloud is forecast for every dark hour.";
  const win = windowHours(n);
  const c = n.best.cloud;
  const sky = c < 20 ? "Clear skies" : c < 50 ? "Partly cloudy" : "Mostly cloudy, with gaps";
  const moonUp = win.some((h) => h.moonAlt > 5);
  const pct = Math.round(n.moon.fraction * 100);
  let moon;
  if (moonUp && n.moon.fraction > 0.5) moon = `, but a bright moon (${pct}% lit) washes out faint stars.`;
  else if (moonUp && n.moon.fraction > 0.15) moon = `, with a ${pct}%-lit moon in the sky.`;
  else if (!moonUp && n.moon.fraction > 0.5) moon = ", and the bright moon is below the horizon then.";
  else moon = " and a dark, moonless sky.";
  return sky + moon;
}

/** What's realistically visible in the best window, given the observing site. */
export function whatToSee(n, site) {
  if (!n.best) return [];
  const win = windowHours(n);
  const out = [];
  const pen = Math.max(...win.map((h) => moonPenalty(h.moonAlt, h.moonFrac)));
  const moonUp = win.some((h) => h.moonAlt > 5);
  const s = n.best.score;
  if (s >= 15) out.push("Bright stars, constellations and any planets that are up");
  if (moonUp && n.moon.fraction > 0.08 && n.best.cloud < 60) {
    out.push(n.moon.fraction < 0.9
      ? "The Moon: craters stand out along the shadow line in binoculars"
      : "The full or nearly full Moon (too bright for craters to show much detail)");
  }
  if (s >= 65 && pen < 0.1) {
    if (site === "rural" || site === "dark") out.push("The Milky Way");
    else if (site === "suburb") out.push("Perhaps a faint Milky Way, away from lights");
  }
  if (s >= 60 && site !== "city") out.push("Star clusters and the brightest galaxies in binoculars");
  if (n.aurora.reach !== null && n.aurora.reach >= 0.3 && !n.aurora.clouded) out.push("Possible aurora (see below)");
  return out;
}
