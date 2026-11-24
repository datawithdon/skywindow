// Network access. Three hosts only (matching the CSP connect-src):
//   api.open-meteo.com          hourly cloud / temperature forecast (gets ~1 km rounded coordinates)
//   geocoding-api.open-meteo.com place search (gets the typed place name)
//   services.swpc.noaa.gov      Kp forecast and OVATION aurora nowcast (gets no location at all)
// Every response is treated as untrusted and rebuilt from a fixed shape.

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const KP = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json";
const OVATION = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";

const MAX_BYTES = { forecast: 400_000, geocode: 100_000, kp: 100_000, ovation: 3_000_000 };

/** Round to 2 decimals (about 1 km): enough for weather, less precise than GPS. */
export const roundCoord = (x) => Math.round(x * 100) / 100;

async function getJson(url, maxBytes, signal) {
  const res = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > maxBytes) throw new Error("response too large");
  return JSON.parse(text);
}

const num = (x, lo, hi) => (typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi ? x : null);

export function cleanText(s, max = 80) {
  if (typeof s !== "string") return "";
  // Drop control, zero-width and bidi-override characters, then cap length.
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").trim().slice(0, max);
}

export function validLatLon(lat, lon) {
  return num(lat, -90, 90) !== null && num(lon, -180, 180) !== null;
}

function validTz(tz) {
  if (typeof tz !== "string" || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+){0,2}$|^GMT$|^UTC$/.test(tz)) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return tz; } catch { return null; }
}

/** Parse an Open-Meteo forecast response (timeformat=unixtime). */
export function parseForecast(j) {
  if (!j || typeof j !== "object" || !j.hourly || typeof j.hourly !== "object") throw new Error("bad forecast");
  const tz = validTz(j.timezone) || "UTC";
  const h = j.hourly;
  const times = Array.isArray(h.time) ? h.time : [];
  if (!times.length || times.length > 24 * 8) throw new Error("bad forecast length");
  const col = (name, lo, hi) => (Array.isArray(h[name]) && h[name].length === times.length ? h[name].map((v) => num(v, lo, hi)) : times.map(() => null));
  const cloud = col("cloud_cover", 0, 100);
  const low = col("cloud_cover_low", 0, 100);
  const mid = col("cloud_cover_mid", 0, 100);
  const high = col("cloud_cover_high", 0, 100);
  const temp = col("temperature_2m", -90, 60);
  const feels = col("apparent_temperature", -100, 70);
  const wind = col("wind_speed_10m", 0, 400);
  const hours = [];
  times.forEach((t, i) => {
    const sec = num(t, 1e9, 1e10);
    if (sec === null) return;
    hours.push({ t: sec * 1000, cloud: cloud[i], low: low[i], mid: mid[i], high: high[i], temp: temp[i], feels: feels[i], wind: wind[i] });
  });
  if (!hours.length) throw new Error("empty forecast");
  return { tz, hours };
}

export async function fetchForecast(lat, lon, signal) {
  const q = new URLSearchParams({
    latitude: String(roundCoord(lat)),
    longitude: String(roundCoord(lon)),
    hourly: "cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,temperature_2m,apparent_temperature,wind_speed_10m",
    timezone: "auto",
    timeformat: "unixtime",
    past_days: "1",
    forecast_days: "4",
    wind_speed_unit: "kmh",
  });
  return parseForecast(await getJson(`${FORECAST}?${q}`, MAX_BYTES.forecast, signal));
}

/** Parse NOAA's Kp forecast: [{time_tag, kp, observed}] (an older format used a header row of arrays). */
export function parseKp(j) {
  if (!Array.isArray(j) || j.length > 500) throw new Error("bad kp");
  const out = [];
  for (const row of j) {
    let tag;
    let kp;
    let kind;
    if (Array.isArray(row)) [tag, kp, kind] = row;
    else if (row && typeof row === "object") ({ time_tag: tag, kp, observed: kind } = row);
    else continue;
    if (typeof kp === "string") kp = Number(kp);
    if (typeof tag !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(tag)) continue;
    const t = Date.parse(tag.replace(" ", "T") + (tag.length === 16 ? ":00Z" : "Z"));
    if (!Number.isFinite(t) || num(kp, 0, 9) === null) continue;
    out.push({ t, kp, kind: ["observed", "estimated", "predicted"].includes(kind) ? kind : "predicted" });
  }
  if (!out.length) throw new Error("empty kp");
  return out.sort((a, b) => a.t - b.t);
}

export async function fetchKp(signal) {
  return parseKp(await getJson(KP, MAX_BYTES.kp, signal));
}

/** Parse place search results. */
export function parseGeocode(j) {
  const list = j && Array.isArray(j.results) ? j.results.slice(0, 8) : [];
  return list.flatMap((r) => {
    if (!r || !validLatLon(r.latitude, r.longitude)) return [];
    const name = cleanText(r.name, 60);
    if (!name) return [];
    const region = [cleanText(r.admin1, 40), cleanText(r.country, 40)].filter(Boolean).join(", ");
    return [{ name, region, lat: r.latitude, lon: r.longitude }];
  });
}

export async function geocode(query, signal) {
  const q = new URLSearchParams({ name: cleanText(query, 60), count: "8", language: "en", format: "json" });
  return parseGeocode(await getJson(`${GEOCODE}?${q}`, MAX_BYTES.geocode, signal));
}

/**
 * Parse the OVATION nowcast and read it at a location.
 * Returns the % chance of aurora overhead here, and the highest value within
 * about 8 degrees of latitude poleward (what you might see low on the horizon).
 */
export function readOvation(j, lat, lon) {
  if (!j || !Array.isArray(j.coordinates) || j.coordinates.length > 100_000) throw new Error("bad ovation");
  const forecastTime = typeof j["Forecast Time"] === "string" ? Date.parse(j["Forecast Time"]) : NaN;
  const grid = new Map();
  for (const c of j.coordinates) {
    if (!Array.isArray(c) || c.length < 3) continue;
    const [x, y, v] = c;
    if (num(x, 0, 360) === null || num(y, -90, 90) === null || num(v, 0, 100) === null) continue;
    grid.set(`${Math.round(x) % 360},${Math.round(y)}`, v);
  }
  if (!grid.size) throw new Error("empty ovation");
  const gx = ((Math.round(lon) % 360) + 360) % 360;
  const gy = Math.round(lat);
  const at = (y) => grid.get(`${gx},${y}`) ?? 0;
  const step = lat >= 0 ? 1 : -1;
  let nearby = 0;
  for (let d = 0; d <= 8; d++) {
    const y = gy + d * step;
    if (y > 90 || y < -90) break;
    for (const dx of [-2, -1, 0, 1, 2]) nearby = Math.max(nearby, grid.get(`${(gx + dx + 360) % 360},${y}`) ?? 0);
  }
  return { here: at(gy), nearby, forecastTime: Number.isFinite(forecastTime) ? forecastTime : null };
}

export async function fetchOvation(lat, lon, signal) {
  return readOvation(await getJson(OVATION, MAX_BYTES.ovation, signal), lat, lon);
}
