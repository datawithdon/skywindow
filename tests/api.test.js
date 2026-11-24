import test from "node:test";
import assert from "node:assert/strict";
import { parseForecast, parseKp, parseGeocode, readOvation, cleanText, roundCoord, validLatLon } from "../js/api.js";

test("parseForecast keeps valid hours, nulls out bad values, rejects bad time zones", () => {
  const f = parseForecast({
    timezone: "America/Toronto",
    hourly: {
      time: [1795000000, 1795003600, "x"],
      cloud_cover: [10, 500, 0],
      cloud_cover_low: [0, 1, 2],
      temperature_2m: [-5, -6, -7],
    },
  });
  assert.equal(f.tz, "America/Toronto");
  assert.equal(f.hours.length, 2);
  assert.equal(f.hours[0].t, 1795000000000);
  assert.equal(f.hours[1].cloud, null);
  assert.equal(f.hours[0].mid, null, "missing column");
  assert.equal(parseForecast({ timezone: "<script>", hourly: { time: [1795000000] } }).tz, "UTC");
  assert.equal(parseForecast({ timezone: "Mars/Olympus", hourly: { time: [1795000000] } }).tz, "UTC");
  assert.throws(() => parseForecast({}));
  assert.throws(() => parseForecast({ hourly: { time: new Array(1000).fill(1795000000) } }));
});

test("parseKp reads the object format and the older array format", () => {
  const objs = parseKp([
    { time_tag: "2026-11-24T03:00:00", kp: 4.33, observed: "predicted", noaa_scale: null },
    { time_tag: "2026-11-24T00:00:00", kp: 2, observed: "estimated", noaa_scale: null },
    { time_tag: "bad", kp: 3, observed: "observed" },
    { time_tag: "2026-11-24T06:00:00", kp: 12, observed: "predicted" },
  ]);
  assert.equal(objs.length, 2);
  assert.equal(objs[0].t, Date.parse("2026-11-24T00:00:00Z"));
  assert.equal(objs[1].kind, "predicted");
  const arrs = parseKp([["time_tag", "kp", "observed", "noaa_scale"], ["2026-11-24 00:00:00", "3.67", "observed", null]]);
  assert.deepEqual(arrs, [{ t: Date.parse("2026-11-24T00:00:00Z"), kp: 3.67, kind: "observed" }]);
  assert.throws(() => parseKp({}));
  assert.throws(() => parseKp([]));
});

test("parseGeocode sanitizes names and drops invalid entries", () => {
  const r = parseGeocode({ results: [
    { name: "Montr\u202eéal", admin1: "Quebec", country: "Canada", latitude: 45.5, longitude: -73.6 },
    { name: "Nowhere", latitude: 200, longitude: 0 },
    { name: "", latitude: 1, longitude: 1 },
  ] });
  assert.deepEqual(r, [{ name: "Montréal", region: "Quebec, Canada", lat: 45.5, lon: -73.6 }]);
  assert.deepEqual(parseGeocode({}), []);
});

test("readOvation finds the local value and the strongest poleward value", () => {
  const coords = [];
  for (let x = 0; x < 360; x++) for (let y = -90; y <= 90; y++) coords.push([x, y, y >= 52 && y <= 60 && x === 286 ? (y - 50) * 5 : 0]);
  const o = readOvation({ "Forecast Time": "2026-11-24T01:13:00Z", coordinates: coords }, 45.5, -73.6);
  assert.equal(o.here, 0);
  assert.equal(o.nearby, 20, "rounded lat 46 + 8 = 54 -> 20");
  assert.equal(o.forecastTime, Date.parse("2026-11-24T01:13:00Z"));
  assert.throws(() => readOvation({ coordinates: [["a"]] }, 0, 0));
});

test("helpers", () => {
  assert.equal(roundCoord(45.50884), 45.51);
  assert.equal(roundCoord(-73.58781), -73.59);
  assert.equal(cleanText("a\u0000b\u200bc  ", 2), "ab");
  assert.equal(validLatLon(91, 0), false);
  assert.equal(validLatLon(45, -73), true);
});

test("cleanHours / cleanKp rebuild saved data and drop out-of-range values", async () => {
  const { cleanHours, cleanKp } = await import("../js/api.js");
  const h = cleanHours([
    { t: 1e20, cloud: 5 }, { t: "x" }, null,
    { t: 1795003600000, cloud: 1e308, temp: -5, extra: "<b>" },
    { t: 1795000000000, cloud: 50 }, { t: 1795000000000, cloud: 60 },
  ]);
  assert.deepEqual(h.map((x) => x.t), [1795000000000, 1795003600000], "sorted, deduped, bad times dropped");
  assert.equal(h[1].cloud, null);
  assert.equal(h[1].extra, undefined);
  assert.equal(cleanHours(new Array(5000).fill({ t: 1795000000000 })).length, 1);
  assert.deepEqual(cleanHours("nope"), []);
  assert.deepEqual(cleanKp([{ t: 1795000000000, kp: 3, kind: "<x>" }, { t: 1795000000000, kp: 1e9 }, { t: 1e20, kp: 2 }]),
    [{ t: 1795000000000, kp: 3, kind: "predicted" }]);
});
