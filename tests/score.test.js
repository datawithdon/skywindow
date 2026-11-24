import test from "node:test";
import assert from "node:assert/strict";
import {
  nightKey, effectiveCloud, darkness, moonPenalty, hourScore, scoreLabel, auroraReach, requiredKp,
  auroraLevel, showersFor, buildNights, makeIcs, foldLine,
} from "../js/score.js";

const HOUR = 3600000;
const MTL = { lat: 45.5, lon: -73.6 };

function forecast(startIso, n, fill) {
  const t0 = Date.parse(startIso);
  return {
    tz: "America/Toronto",
    hours: Array.from({ length: n }, (_, i) => ({ t: t0 + i * HOUR, ...fill(i, t0 + i * HOUR) })),
  };
}
const clear = () => ({ cloud: 0, low: 0, mid: 0, high: 0, temp: -5, feels: -10, wind: 5 });

test("night key names the evening a night starts on", () => {
  assert.equal(nightKey(Date.parse("2026-11-24T03:00:00Z"), "America/Toronto"), "2026-11-23"); // 22:00 local
  assert.equal(nightKey(Date.parse("2026-11-24T09:00:00Z"), "America/Toronto"), "2026-11-23"); // 04:00 local
  assert.equal(nightKey(Date.parse("2026-11-24T18:00:00Z"), "America/Toronto"), "2026-11-24"); // 13:00 local
});

test("effective cloud discounts thin high cloud", () => {
  assert.equal(effectiveCloud({ cloud: 100, low: 0, mid: 0, high: 100 }), 70);
  assert.equal(effectiveCloud({ cloud: 80, low: 80, mid: 0, high: 0 }), 80);
  assert.equal(effectiveCloud({ cloud: 40, low: null, mid: null, high: null }), 40);
  assert.equal(effectiveCloud({ cloud: null, low: null, mid: null, high: null }), 100);
});

test("darkness and moon penalty ramps", () => {
  assert.equal(darkness(-5), 0);
  assert.equal(darkness(-15), 0.75);
  assert.equal(darkness(-30), 1);
  assert.equal(moonPenalty(-10, 1), 0);
  assert.ok(Math.abs(moonPenalty(60, 1) - 0.55) < 1e-9);
  assert.equal(moonPenalty(60, 0), 0);
});

test("hour score: perfect sky 100, full cloud 0, bright moon roughly halves it", () => {
  assert.equal(hourScore({ sunAlt: -40, moonAlt: -20, moonFrac: 0, cloudEff: 0 }), 100);
  assert.equal(hourScore({ sunAlt: -40, moonAlt: -20, moonFrac: 0, cloudEff: 100 }), 0);
  assert.equal(hourScore({ sunAlt: -40, moonAlt: 50, moonFrac: 1, cloudEff: 0 }), 45);
  assert.equal(hourScore({ sunAlt: 5, moonAlt: -20, moonFrac: 0, cloudEff: 0 }), 0);
  assert.equal(scoreLabel(80), "Excellent");
  assert.equal(scoreLabel(10), "Clouded out");
});

test("aurora reach grows with Kp and latitude; required Kp is consistent", () => {
  const mag = 54.7; // Montreal
  assert.equal(auroraReach(0, mag), 0);
  assert.ok(auroraReach(5, mag) > auroraReach(4, mag));
  assert.equal(auroraReach(9, mag), 1);
  const need = requiredKp(mag);
  assert.ok(need.horizon > 3.5 && need.horizon < 4.5, `horizon ${need.horizon}`);
  assert.ok(Math.abs(auroraReach(need.horizon, mag) - 0.3) < 1e-9);
  assert.ok(Math.abs(auroraReach(need.overhead, mag) - 1) < 1e-9);
  assert.equal(requiredKp(70).overhead, 0);
  assert.equal(auroraReach(3, -mag), auroraReach(3, mag), "hemisphere symmetric");
  assert.match(auroraLevel(0.7, -40).text, /southern/);
  assert.equal(auroraLevel(0.05, 45).key, "none");
});

test("meteor showers near peak, across a year boundary", () => {
  assert.deepEqual(showersFor("2026-12-13").map((s) => s.name), ["Geminids"]);
  assert.deepEqual(showersFor("2027-01-02").map((s) => s.name), ["Quadrantids"]);
  assert.deepEqual(showersFor("2026-06-15"), []);
});

test("buildNights: a clear, moonless winter night scores high with a long best window", () => {
  // 2026-12-08 is close to new moon (2026-12-09). Forecast: Dec 7 00:00 local + 4 days.
  const f = forecast("2026-12-07T05:00:00Z", 96, clear);
  const kp = [{ t: Date.parse("2026-12-08T00:00:00Z"), kp: 5, kind: "predicted" }];
  for (let i = 1; i < 12; i++) kp.push({ t: kp[0].t + i * 3 * HOUR, kp: 5, kind: "predicted" });
  const nights = buildNights(f, kp, { ...MTL, now: Date.parse("2026-12-07T12:00:00Z") });
  assert.deepEqual(nights.map((n) => n.key), ["2026-12-07", "2026-12-08", "2026-12-09"]);
  const n = nights[1];
  assert.ok(n.best.score >= 90, `score ${n.best.score}`);
  assert.ok(n.best.end - n.best.start >= 8 * HOUR, "long window");
  assert.ok(n.moon.fraction < 0.05);
  assert.ok(n.astro[0] > n.nautical[0] && n.astro[1] < n.nautical[1], "astro dark inside nautical");
  assert.equal(n.aurora.maxKp, 5);
  assert.ok(n.aurora.reach > 0.3 && n.aurora.reach < 1);
  assert.equal(n.aurora.clouded, false);
  assert.deepEqual(n.showers, [], "Geminids peak is a week later");
  assert.equal(nights[2].aurora.maxKp, null, "no Kp beyond the forecast");
});

test("buildNights: clouds before midnight, clear after, picks the late window", () => {
  const f = forecast("2026-12-07T05:00:00Z", 96, (i, t) => {
    const localHour = new Date(t - 5 * HOUR).getUTCHours();
    const c = localHour >= 17 || localHour < 1 ? 100 : 0;
    return { ...clear(), cloud: c, low: c };
  });
  const n = buildNights(f, [], { ...MTL, now: Date.parse("2026-12-07T12:00:00Z") }).find((x) => x.key === "2026-12-08");
  const startLocal = new Date(n.best.start - 5 * HOUR).getUTCHours();
  assert.equal(startLocal, 1);
  assert.ok(n.best.score > 80);
  assert.equal(n.aurora.maxKp, null);
});

test("buildNights: overcast all night gives no best window; past nights are dropped", () => {
  const f = forecast("2026-12-07T05:00:00Z", 96, () => ({ ...clear(), cloud: 100, low: 100 }));
  const nights = buildNights(f, [], { ...MTL, now: Date.parse("2026-12-08T14:00:00Z") });
  assert.equal(nights[0].key, "2026-12-08", "night of the 7th is over");
  assert.equal(nights[0].best, null);
});

test("buildNights: no darkness in a high-latitude summer", () => {
  const f = { tz: "America/Yellowknife", hours: Array.from({ length: 96 }, (_, i) => ({ t: Date.parse("2026-06-20T06:00:00Z") + i * HOUR, ...clear() })) };
  const nights = buildNights(f, [], { lat: 62.45, lon: -114.37, now: Date.parse("2026-06-20T06:00:00Z") });
  assert.ok(nights.length >= 1);
  assert.ok(nights.every((n) => n.noDark && n.best === null));
});

test("ics: escaped, CRLF, folded at 75 octets without splitting characters", () => {
  const ics = makeIcs({
    uid: "x@skywindow", start: Date.parse("2026-12-08T03:00:00Z"), end: Date.parse("2026-12-08T07:00:00Z"),
    summary: "Stargazing; Montréal, QC", description: "Line one\nLine two ".repeat(10), now: 0,
  });
  assert.ok(ics.includes("SUMMARY:Stargazing\\; Montréal\\, QC"));
  assert.ok(ics.includes("DTSTART:20261208T030000Z"));
  const enc = new TextEncoder();
  for (const line of ics.split("\r\n")) assert.ok(enc.encode(line).length <= 75, line);
  const folded = foldLine("X:" + "é".repeat(60));
  assert.ok(folded.split("\r\n").every((l) => enc.encode(l).length <= 75));
  assert.equal(folded.replace(/\r\n /g, ""), "X:" + "é".repeat(60));
});

test("verdict and whatToSee follow the moon and the site", async () => {
  const { verdict, whatToSee } = await import("../js/score.js");
  const f = forecast("2026-12-07T05:00:00Z", 96, clear);
  const n = buildNights(f, [], { ...MTL, now: Date.parse("2026-12-07T12:00:00Z") })[1];
  assert.match(verdict(n), /^Clear skies and a dark, moonless sky\.$/);
  assert.ok(whatToSee(n, "dark").includes("The Milky Way"));
  assert.ok(!whatToSee(n, "city").some((x) => /Milky Way/.test(x)));
  // Full moon night: 2026-11-24.
  const g = forecast("2026-11-23T05:00:00Z", 96, clear);
  const m = buildNights(g, [], { ...MTL, now: Date.parse("2026-11-23T12:00:00Z") })[1];
  assert.match(verdict(m), /bright moon \(\d+% lit\)/);
  assert.ok(!whatToSee(m, "dark").includes("The Milky Way"));
  assert.match(verdict({ noDark: true }), /No real darkness/);
  assert.match(verdict({ noDark: false, best: null }), /Clouded out/);
});
