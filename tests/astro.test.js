import test from "node:test";
import assert from "node:assert/strict";
import { sunAltitude, moonAltitude, moonIllumination, phaseName, geomagneticLatitude } from "../js/astro.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test("sun is at the horizon at a published sunset time", () => {
  // Montreal, 2024-06-21 sunset 20:47 EDT = 00:47 UTC; geometric altitude ~ -0.83 deg.
  near(sunAltitude(Date.parse("2024-06-22T00:47:00Z"), 45.5, -73.57), -0.83, 0.3, "sunset altitude");
});

test("sun is nearly overhead at the equator at equinox noon", () => {
  near(sunAltitude(Date.parse("2024-03-20T12:07:00Z"), 0, 0), 90, 0.6, "noon altitude");
});

test("sun is well below the horizon at local midnight in winter", () => {
  assert.ok(sunAltitude(Date.parse("2024-12-21T05:00:00Z"), 45.5, -73.57) < -60);
});

test("moon illumination matches published full and new moons", () => {
  const full = moonIllumination(Date.parse("2024-01-25T17:54:00Z"));
  assert.ok(full.fraction > 0.99, "full");
  near(full.phase, 0.5, 0.03, "full phase");
  const nw = moonIllumination(Date.parse("2024-01-11T11:57:00Z"));
  assert.ok(nw.fraction < 0.01, "new");
  const fq = moonIllumination(Date.parse("2024-01-18T03:53:00Z"));
  near(fq.fraction, 0.5, 0.05, "first quarter lit");
  near(fq.phase, 0.25, 0.03, "first quarter phase");
});

test("moonrise lands within ~15 minutes of the published time", () => {
  // Montreal, full moon 2024-01-25 rises about 16:47 EST (21:47 UTC).
  assert.ok(moonAltitude(Date.parse("2024-01-25T21:32:00Z"), 45.5, -73.57) < 0);
  assert.ok(moonAltitude(Date.parse("2024-01-25T22:02:00Z"), 45.5, -73.57) > 0);
});

test("phase names", () => {
  assert.equal(phaseName(0), "New moon");
  assert.equal(phaseName(0.99), "New moon");
  assert.equal(phaseName(0.25), "First quarter");
  assert.equal(phaseName(0.5), "Full moon");
  assert.equal(phaseName(0.6), "Waning gibbous");
  assert.equal(phaseName(0.9), "Waning crescent");
});

test("geomagnetic latitude: pole is 90, North America sits higher than Europe at the same latitude", () => {
  near(geomagneticLatitude(80.8, -72.6), 90, 0.01, "pole");
  const montreal = geomagneticLatitude(45.5, -73.6);
  const bordeaux = geomagneticLatitude(44.8, -0.6);
  near(montreal, 54.7, 1, "Montreal");
  assert.ok(montreal - bordeaux > 7, "longitude effect");
  assert.ok(geomagneticLatitude(-45, 170) < -45, "south is negative");
});
