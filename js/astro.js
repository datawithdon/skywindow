// Sun and moon positions, moon phase and geomagnetic latitude.
// Low-precision formulas from Jean Meeus, "Astronomical Algorithms", good to
// well under a degree for 1950-2050: plenty for "is it dark / is the moon up".
// Pure functions, no DOM; tested in tests/astro.test.js.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

/** Days since J2000.0 for a timestamp in ms. */
export function toDays(ms) {
  return ms / DAY_MS - 0.5 + J1970 - J2000;
}

function rightAscension(l, b) {
  return Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
}

function declination(l, b) {
  return Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
}

function siderealTime(d, lw) {
  return RAD * (280.16 + 360.9856235 * d) - lw;
}

function altitudeOf(H, phi, dec) {
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
}

function sunCoords(d) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

function moonCoords(d) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

/** Sun altitude in degrees (geometric, no refraction). */
export function sunAltitude(ms, lat, lon) {
  const d = toDays(ms);
  const c = sunCoords(d);
  const H = siderealTime(d, RAD * -lon) - c.ra;
  return altitudeOf(H, RAD * lat, c.dec) / RAD;
}

/** Moon altitude in degrees, corrected for parallax (about 1 degree). */
export function moonAltitude(ms, lat, lon) {
  const d = toDays(ms);
  const c = moonCoords(d);
  const H = siderealTime(d, RAD * -lon) - c.ra;
  const h = altitudeOf(H, RAD * lat, c.dec);
  const parallax = Math.asin(6378.14 / c.dist) * Math.cos(h);
  return (h - parallax) / RAD;
}

/**
 * Moon illumination at a time.
 * fraction: 0 (new) .. 1 (full). phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter.
 */
export function moonIllumination(ms) {
  const d = toDays(ms);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const SUN_DIST = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(SUN_DIST * Math.sin(phi), m.dist - SUN_DIST * Math.cos(phi));
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra),
  );
  return {
    fraction: (1 + Math.cos(inc)) / 2,
    phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI,
  };
}

export function phaseName(phase) {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.03 || p >= 0.97) return "New moon";
  if (p < 0.22) return "Waxing crescent";
  if (p < 0.28) return "First quarter";
  if (p < 0.47) return "Waxing gibbous";
  if (p < 0.53) return "Full moon";
  if (p < 0.72) return "Waning gibbous";
  if (p < 0.78) return "Last quarter";
  return "Waning crescent";
}

// North geomagnetic (dipole) pole, IGRF-14 epoch 2025. It drifts about
// 0.1 degree a year, which doesn't matter at this precision.
const POLE_LAT = 80.8;
const POLE_LON = -72.6;

/** Geomagnetic latitude in degrees (centred dipole approximation). */
export function geomagneticLatitude(lat, lon) {
  const p = RAD * POLE_LAT;
  const f = RAD * lat;
  return Math.asin(Math.sin(f) * Math.sin(p) + Math.cos(f) * Math.cos(p) * Math.cos(RAD * (lon - POLE_LON))) / RAD;
}
