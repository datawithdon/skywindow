// SkyWindow UI. All text goes through textContent / DOM APIs; no innerHTML.
import { fetchForecast, fetchKp, fetchOvation, geocode, roundCoord, validLatLon, cleanText, cleanHours, cleanKp, validTz } from "./api.js";
import { buildNights, scoreLabel, verdict, whatToSee, requiredKp, makeIcs, nightKey, SITES } from "./score.js";

// Refuse to run inside another site's frame (GitHub Pages can't send frame-ancestors).
if (window.top !== window.self) {
  document.body.textContent = "SkyWindow can't run inside another site.";
  throw new Error("framed");
}

const HOUR = 3600000;
const STALE_MS = 30 * 60000;

// ---- Storage (rebuilt from a fixed schema on every read) ----
const KEYS = { loc: "skywindow:loc", prefs: "skywindow:prefs", cache: "skywindow:cache" };
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* full or blocked */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* blocked */ } },
};

function loadLoc() {
  const v = store.get(KEYS.loc);
  if (!v || !validLatLon(v.lat, v.lon)) return null;
  return { name: cleanText(v.name, 80) || "Saved place", lat: roundCoord(v.lat), lon: roundCoord(v.lon) };
}
function loadPrefs() {
  const v = store.get(KEYS.prefs) || {};
  return { site: Object.hasOwn(SITES, v.site) ? v.site : "suburb", units: v.units === "imperial" ? "imperial" : "metric" };
}
function loadCache(loc) {
  const v = store.get(KEYS.cache);
  if (!v || typeof v !== "object" || !loc || v.lat !== loc.lat || v.lon !== loc.lon) return null;
  // Saved data shares an origin with other github.io apps: rebuild it with the same checks as API data.
  const fetchedAt = typeof v.fetchedAt === "number" && v.fetchedAt > 1e12 && v.fetchedAt <= Date.now() + 60000 ? v.fetchedAt : null;
  const hours = cleanHours(v.forecast?.hours);
  if (fetchedAt === null || !hours.length) return null;
  return { fetchedAt, forecast: { tz: validTz(v.forecast.tz) || "UTC", hours }, kp: cleanKp(v.kp), kpError: v.kpError === true };
}

const state = {
  loc: loadLoc(),
  prefs: loadPrefs(),
  data: null,         // { fetchedAt, forecast, kp, kpError }
  nights: [],
  selected: 0,
  loading: false,
  error: null,
  showTable: false,
  ovation: null,      // { here, nearby, forecastTime } | "loading" | "error"
};
state.data = loadCache(state.loc);

// ---- DOM helpers ----
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const SVGNS = "http://www.w3.org/2000/svg";
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  for (const c of kids.flat()) if (c) el.append(c instanceof Node ? c : String(c));
  return el;
}

// ---- Formatting (always in the forecast location's time zone) ----
const tzOf = () => state.data?.forecast.tz || "UTC";
const fmt = (opts) => new Intl.DateTimeFormat(undefined, { timeZone: tzOf(), ...opts });
const timeStr = (ms) => fmt({ hour: "numeric", minute: "2-digit" }).format(ms);
const hourStr = (ms) => fmt({ hour: "numeric" }).format(ms);
const dayStr = (key) => new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(Date.parse(key + "T12:00:00Z"));
const temp = (c) => {
  if (!Number.isFinite(c)) return "–";
  return state.prefs.units === "imperial" ? `${Math.round(c * 9 / 5 + 32)}°F` : `${Math.round(c)}°C`;
};
const speed = (k) => {
  if (!Number.isFinite(k)) return "–";
  return state.prefs.units === "imperial" ? `${Math.round(k / 1.609)} mph` : `${Math.round(k)} km/h`;
};
const range = (a, b) => `${timeStr(a)}–${timeStr(b)}`;

// ---- Data ----
let controller = null;
async function refresh() {
  if (!state.loc) return;
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  state.loading = true;
  state.error = null;
  render();
  const loc = state.loc;
  const [fc, kp] = await Promise.allSettled([fetchForecast(loc.lat, loc.lon, signal), fetchKp(signal)]);
  if (signal.aborted || state.loc !== loc) return;
  state.loading = false;
  if (fc.status === "fulfilled") {
    state.data = {
      fetchedAt: Date.now(),
      forecast: fc.value,
      kp: kp.status === "fulfilled" ? kp.value : (state.data?.kp || []),
      kpError: kp.status !== "fulfilled",
    };
    store.set(KEYS.cache, { lat: loc.lat, lon: loc.lon, ...state.data });
  } else {
    state.error = navigator.onLine === false
      ? "You're offline. Showing the last forecast saved on this device."
      : "Couldn't reach the weather forecast. Try again in a minute.";
  }
  computeNights();
  render();
}

function computeNights() {
  if (!state.data) { state.nights = []; return; }
  const prevKey = state.nights[state.selected]?.key;
  try {
    state.nights = buildNights(state.data.forecast, state.data.kp, { lat: state.loc.lat, lon: state.loc.lon, now: Date.now() });
  } catch {
    // Never leave the app stuck on bad data: drop it and fetch fresh.
    state.nights = [];
    state.data = null;
    store.del(KEYS.cache);
  }
  const idx = state.nights.findIndex((n) => n.key === prevKey);
  state.selected = idx >= 0 ? idx : 0;
}

function setLocation(loc) {
  state.loc = { name: cleanText(loc.name, 80), lat: roundCoord(loc.lat), lon: roundCoord(loc.lon) };
  store.set(KEYS.loc, state.loc);
  state.data = loadCache(state.loc);
  state.ovation = null;
  state.nights = [];
  state.selected = 0;
  computeNights();
  refresh();
}

// ---- Views ----
const view = document.getElementById("view");
const placeEl = document.getElementById("place");

function render() {
  try { renderView(); } catch {
    hideTip();
    view.replaceChildren(h("div", { class: "card" },
      h("p", {}, "Something went wrong showing this forecast."),
      h("div", { class: "btn-row" }, h("button", {
        class: "btn primary", type: "button",
        onclick: () => { Object.values(KEYS).forEach((k) => store.del(k)); location.reload(); },
      }, "Reset SkyWindow"))));
  }
}

function renderView() {
  placeEl.textContent = state.loc ? state.loc.name : "";
  const kids = [];
  if (!state.loc) {
    kids.push(locationCard(true));
  } else {
    if (state.error) kids.push(h("div", { class: "banner error", role: "alert" }, state.error));
    if (!state.data) {
      kids.push(h("div", { class: "card center" }, h("p", { class: "muted" }, state.loading ? "Getting tonight's forecast…" : "No forecast yet.")));
    } else if (!state.nights.length) {
      kids.push(h("div", { class: "card" }, h("p", {}, "No upcoming nights in this forecast. Try refreshing.")));
    } else {
      kids.push(tabs(), ...nightView(state.nights[state.selected]));
    }
    kids.push(settingsCard());
  }
  view.replaceChildren(...kids);
}

function locationCard(first) {
  const results = h("ul", { class: "results" });
  const msg = h("p", { class: "muted small", role: "status" });
  const input = h("input", { type: "search", placeholder: "Town or city", "aria-label": "Search for a town or city", maxlength: 60, autocomplete: "off" });
  const search = async () => {
    const q = input.value.trim();
    if (q.length < 2) return;
    msg.textContent = "Searching…";
    try {
      const list = await geocode(q);
      msg.textContent = list.length ? "" : "No places found. Try a nearby town.";
      results.replaceChildren(...list.map((r) => h("li", {}, h("button", {
        class: "btn", type: "button",
        onclick: () => setLocation({ name: r.region ? `${r.name}, ${r.region.split(", ")[0]}` : r.name, lat: r.lat, lon: r.lon }),
      }, h("span", {}, r.name, " ", h("span", { class: "region" }, r.region))))));
    } catch {
      msg.textContent = "Search failed. Check your connection.";
    }
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
  const geoBtn = h("button", { class: "btn primary", type: "button" }, "Use my location");
  geoBtn.addEventListener("click", () => {
    if (!navigator.geolocation) { msg.textContent = "Location isn't available in this browser. Search instead."; return; }
    geoBtn.disabled = true;
    msg.textContent = "Finding you…";
    navigator.geolocation.getCurrentPosition(
      (p) => setLocation({ name: `Near ${roundCoord(p.coords.latitude).toFixed(2)}, ${roundCoord(p.coords.longitude).toFixed(2)}`, lat: p.coords.latitude, lon: p.coords.longitude }),
      () => { geoBtn.disabled = false; msg.textContent = "Couldn't get your location. Search for a town instead."; },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 3600000 },
    );
  });
  return h("section", { class: "card" },
    h("h2", {}, first ? "Should you go outside tonight?" : "Change location"),
    first ? h("p", { class: "muted" }, "SkyWindow scores the next few nights for stargazing and the northern lights from cloud, moonlight, darkness and aurora forecasts. Pick where you'll be watching from.") : null,
    h("div", { class: "btn-row" }, geoBtn),
    h("div", { class: "field" }, input, h("button", { class: "btn", type: "button", onclick: search }, "Search")),
    msg, results,
    h("p", { class: "muted small" }, "Your location is rounded to about 1 km and kept on this device. Only the rounded coordinates go to the weather service."),
  );
}

function tabs() {
  const today = state.data ? nightKey(Date.now(), tzOf()) : null;
  const list = h("div", { class: "tabs", role: "tablist", "aria-label": "Nights" });
  state.nights.forEach((n, i) => {
    const score = n.best ? n.best.score : 0;
    const name = n.key === today ? "Tonight" : dayStr(n.key);
    list.append(h("button", {
      class: "tab", role: "tab", type: "button", "aria-selected": i === state.selected ? "true" : "false",
      onclick: () => { state.selected = i; render(); },
    }, h("span", { class: "day" }, name), h("span", { class: "val" }, n.noDark ? "–" : score), h("span", { class: "lbl" }, n.noDark ? "No dark" : scoreLabel(score))));
  });
  return list;
}

function moonIcon(phase, fraction, size = 26) {
  const r = size / 2 - 1;
  const c = size / 2;
  const svg = s("svg", { class: "moon-icon", width: size, height: size, viewBox: `0 0 ${size} ${size}`, "aria-hidden": "true" });
  svg.append(s("circle", { class: "dark", cx: c, cy: c, r }));
  if (fraction > 0.01) {
    const waxing = phase < 0.5;
    const rx = Math.abs(1 - 2 * fraction) * r;
    const sweep = fraction > 0.5 ? 1 : 0;
    const d = `M ${c} ${c - r} A ${r} ${r} 0 0 1 ${c} ${c + r} A ${rx} ${r} 0 0 ${sweep} ${c} ${c - r} Z`;
    const flip = (state.loc?.lat ?? 1) < 0 ? waxing : !waxing; // lit side: right when waxing (north)
    svg.append(s("path", { class: "lit", d, transform: flip ? `translate(${size} 0) scale(-1 1)` : null }));
  }
  return svg;
}

function fact(k, v, note) {
  return h("div", { class: "fact" }, h("div", { class: "k" }, k), h("div", { class: "v" }, v), note ? h("div", { class: "n" }, note) : null);
}

function nightView(n) {
  const out = [];
  const stale = state.data && Date.now() - state.data.fetchedAt > 3 * HOUR;
  if (stale) out.push(h("div", { class: "banner" }, `Forecast from ${new Date(state.data.fetchedAt).toLocaleString()}. Refresh for the latest.`));

  // Hero
  const score = n.best ? n.best.score : 0;
  const hero = h("section", { class: "card" },
    h("div", { class: "hero" },
      h("div", { class: "score-num", "aria-label": `Score ${n.noDark ? "not available" : `${score} out of 100`}` }, n.noDark ? "–" : String(score), h("small", {}, n.noDark ? "" : "/100")),
      h("div", {},
        h("div", { class: "score-lbl" }, n.noDark ? "No darkness" : scoreLabel(score)),
        h("div", { class: "window" }, n.best ? `Best window ${range(n.best.start, n.best.end)}` : n.noDark ? "Twilight all night" : "No good window"),
      ),
    ),
    h("p", { class: "verdict" }, verdict(n)),
  );
  const facts = h("div", { class: "facts" });
  if (n.astro) facts.append(fact("Fully dark", range(n.astro[0], n.astro[1])));
  else if (n.nautical) facts.append(fact("Darkest", range(n.nautical[0], n.nautical[1]), "Sky never gets fully dark"));
  const moonNote = !n.nautical ? null : !n.moon.up.length ? "Below the horizon all night"
    : n.moon.up.length === 1 && n.moon.up[0][0] === n.nautical[0] && n.moon.up[0][1] === n.nautical[1] ? "Up all night"
      : `Up ${n.moon.up.map(([a, b]) => range(a, b)).join(", ")}`;
  facts.append(fact("Moon", [moonIcon(n.moon.phase, n.moon.fraction), `${n.moon.name}, ${Math.round(n.moon.fraction * 100)}%`], moonNote));
  if (n.best) {
    facts.append(fact("Cloud in best window", `${n.best.cloud}%`, "Thin high cloud counts for less"));
    facts.append(fact("Feels like", temp(n.best.feels), `Wind ${speed(Math.max(...n.hours.filter((x) => x.t >= n.best.start && x.t < n.best.end).map((x) => x.wind ?? 0)))}`));
  }
  hero.append(facts);
  if (n.best) {
    hero.append(h("div", { class: "btn-row mt" },
      h("button", { class: "btn", type: "button", onclick: () => downloadIcs(n) }, "Add best window to calendar"),
      h("button", { class: "btn", type: "button", onclick: refresh, disabled: state.loading }, state.loading ? "Refreshing…" : "Refresh"),
    ));
  } else {
    hero.append(h("div", { class: "btn-row mt" }, h("button", { class: "btn", type: "button", onclick: refresh, disabled: state.loading }, state.loading ? "Refreshing…" : "Refresh")));
  }
  out.push(hero);

  // What to see
  const see = whatToSee(n, state.prefs.site);
  if (see.length) {
    out.push(h("section", { class: "card" },
      h("h2", {}, "What you might see", h("span", { class: "sub" }, `from a ${SITES[state.prefs.site].toLowerCase()}`)),
      h("ul", { class: "see" }, see.map((x) => h("li", {}, x))),
    ));
  }

  // Meteor showers
  if (n.showers.length) {
    out.push(h("section", { class: "card" },
      h("h2", {}, "Meteor shower"),
      n.showers.map((m) => h("p", {}, h("strong", {}, m.name), ` ${m.daysFromPeak === 0 ? "peaks tonight" : m.daysFromPeak < 0 ? `peaks in ${-m.daysFromPeak} day${m.daysFromPeak === -1 ? "" : "s"}` : `peaked ${m.daysFromPeak} day${m.daysFromPeak === 1 ? "" : "s"} ago`}. Up to about ${m.zhr} meteors an hour under perfect dark skies; expect far fewer from towns or with moonlight. ${m.note}`)),
    ));
  }

  out.push(auroraCard(n));
  out.push(hourlyCard(n));
  return out;
}

function auroraCard(n) {
  const a = n.aurora;
  const need = requiredKp(a.magLat);
  const fmtKp = (k) => (k > 9 ? "above 9 (very rare)" : k.toFixed(1));
  const card = h("section", { class: "card" }, h("h2", {}, "Northern lights", h("span", { class: "sub" }, (state.loc.lat < 0 ? "aurora australis" : "aurora borealis"))));
  if (a.maxKp === null) {
    card.append(h("p", { class: "muted" }, state.data.kpError ? "The NOAA Kp forecast couldn't be loaded." : "NOAA's Kp forecast doesn't reach this night yet (it covers about 3 days)."));
  } else {
    card.append(h("div", { class: `status ${a.level.key}` }, a.level.text));
    if (a.clouded) card.append(h("p", { class: "small" }, "Geomagnetic activity is promising, but forecast cloud would hide it."));
  }
  card.append(h("dl", { class: "kv" },
    a.maxKp !== null ? [h("dt", {}, "Kp forecast"), h("dd", {}, `up to ${a.maxKp.toFixed(1)} during dark hours`)] : null,
    h("dt", {}, "Faint glow on horizon"), h("dd", {}, `needs about Kp ${fmtKp(need.horizon)}`),
    h("dt", {}, "Overhead"), h("dd", {}, `needs about Kp ${fmtKp(need.overhead)}`),
    h("dt", {}, "Your magnetic latitude"), h("dd", {}, `${Math.abs(a.magLat).toFixed(1)}°`),
  ));
  // Live nowcast, only meaningful for tonight.
  const isTonight = n.key === nightKey(Date.now(), tzOf());
  if (isTonight) {
    const o = state.ovation;
    const btn = h("button", { class: "btn", type: "button", disabled: o === "loading" }, o === "loading" ? "Checking…" : "Live check (NOAA OVATION, about 1 MB)");
    btn.addEventListener("click", async () => {
      const loc = state.loc;
      state.ovation = "loading";
      render();
      let result;
      try { result = await fetchOvation(loc.lat, loc.lon); } catch { result = "error"; }
      if (state.loc !== loc) return; // location changed while loading
      state.ovation = result;
      render();
    });
    card.append(h("div", { class: "btn-row mt" }, btn));
    if (o === "error") card.append(h("p", { class: "small muted" }, "The live aurora map couldn't be loaded."));
    else if (o && typeof o === "object") {
      card.append(h("p", { class: "small" },
        `Next 30–90 min${o.forecastTime ? ` (to ${timeStr(o.forecastTime)})` : ""}: ${o.here}% chance of aurora overhead here; up to ${o.nearby}% within about 800 km ${state.loc.lat >= 0 ? "north" : "south"}. Above about 10% nearby, look low toward the ${state.loc.lat >= 0 ? "north" : "south"}ern horizon.`));
    }
  }
  card.append(h("p", { class: "small muted" }, "Rule of thumb from NOAA's auroral-oval models. Kp forecasts more than a day out are rough, and phone cameras pick up aurora your eyes can't."));
  return card;
}

// ---- Hourly chart (single series: score per hour; hover/focus for details) ----
const tip = document.getElementById("tip");
function hourLines(x) {
  return [
    x.dark ? `Score ${x.score} (${scoreLabel(x.score)})` : "Twilight: too bright",
    `Cloud ${x.cloudEff == null ? "–" : Math.round(x.cloudEff)}%`,
    `Moon ${x.moonAlt > 0 ? `up ${Math.round(x.moonAlt)}°` : "down"}`,
    x.kp !== null ? `Kp ${x.kp.toFixed(1)}${x.kpKind === "predicted" ? " (forecast)" : ""}` : null,
    `${temp(x.temp)}, feels ${temp(x.feels)}`,
  ].filter(Boolean);
}
function showTip(x, el) {
  tip.replaceChildren(h("b", {}, timeStr(x.t)), ...hourLines(x).map((l) => h("div", {}, l)));
  tip.classList.remove("hidden");
  const r = el.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const left = Math.min(window.innerWidth - tw - 8, Math.max(8, r.left + r.width / 2 - tw / 2));
  const top = r.top - tip.offsetHeight - 8 < 8 ? r.bottom + 8 : r.top - tip.offsetHeight - 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
function hideTip() { tip.classList.add("hidden"); }

function hourlyCard(n) {
  const hrs = n.hours.filter((x) => x.sunAlt < 0);
  const card = h("section", { class: "card" }, h("h2", {}, "Hour by hour", h("span", { class: "sub" }, "stargazing score")));
  if (!hrs.length) { card.append(h("p", { class: "muted" }, "The sun stays up all night.")); return card; }

  const toggle = h("button", { class: "btn", type: "button", "aria-pressed": state.showTable ? "true" : "false", onclick: () => { state.showTable = !state.showTable; render(); } }, state.showTable ? "Show chart" : "Show table");

  if (state.showTable) {
    const unit = state.prefs.units === "imperial" ? "°F" : "°C";
    card.append(h("div", { class: "table-scroll" }, h("table", { class: "hours" },
      h("thead", {}, h("tr", {}, ["Time", "Score", "Cloud", "Moon", "Kp", `Feels ${unit}`].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", {}, hrs.map((x) => h("tr", {},
        h("td", {}, timeStr(x.t)),
        h("td", {}, x.dark ? x.score : "twilight"),
        h("td", {}, x.cloudEff == null ? "–" : `${Math.round(x.cloudEff)}%`),
        h("td", {}, x.moonAlt > 0 ? `${Math.round(x.moonAlt)}°` : "down"),
        h("td", {}, x.kp === null ? "–" : x.kp.toFixed(1)),
        h("td", {}, temp(x.feels).replace(/°[CF]$/, "°")),
      ))),
    )), h("div", { class: "btn-row mt" }, toggle));
    return card;
  }

  const padL = 30;
  const avail = Math.max(280, (view.clientWidth || 360) - 66);
  const col = Math.max(16, Math.min(40, (avail - padL - 6) / hrs.length));
  const padT = 18;
  const plotH = 120;
  const W = padL + hrs.length * col + 6;
  const H = padT + plotH + 44;
  const y = (v) => padT + plotH - (v / 100) * plotH;
  const svg = s("svg", { class: "chart", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "group", "aria-label": `Hourly stargazing score, ${hrs.length} hours` });

  for (const g of [0, 50, 100]) {
    svg.append(s("line", { class: "grid", x1: padL, x2: W - 4, y1: y(g), y2: y(g) }));
    svg.append(s("text", { class: "axis-t", x: padL - 6, y: y(g) + 4, "text-anchor": "end" }, String(g)));
  }
  if (n.best) {
    const i0 = hrs.findIndex((x) => x.t === n.best.start);
    const i1 = hrs.findIndex((x) => x.t === n.best.end - HOUR);
    if (i0 >= 0 && i1 >= 0) {
      svg.append(s("rect", { class: "band", x: padL + i0 * col, y: padT - 16, width: (i1 - i0 + 1) * col, height: plotH + 16, rx: 6 }));
      svg.append(s("text", { class: "band-t", x: padL + i0 * col + 6, y: padT - 4 }, "Best"));
    }
  }
  hrs.forEach((x, i) => {
    const bw = Math.min(24, col - 4);
    const bx = padL + i * col + (col - bw) / 2;
    if (x.dark && x.score > 0) {
      const top = y(x.score);
      const bh = padT + plotH - top;
      const r = Math.min(4, bh);
      // Rounded data end, square at the baseline.
      const d = `M ${bx} ${padT + plotH} V ${top + r} Q ${bx} ${top} ${bx + r} ${top} H ${bx + bw - r} Q ${bx + bw} ${top} ${bx + bw} ${top + r} V ${padT + plotH} Z`;
      svg.append(s("path", { class: `bar${x.past ? " past" : ""}`, d }));
    } else if (!x.dark) {
      svg.append(s("rect", { class: "twilight", x: bx, y: padT + plotH - 2, width: bw, height: 2, rx: 1 }));
    }
    if (x.moonAlt > 0) svg.append(s("circle", { class: "moonrow", cx: bx + bw / 2, cy: padT + plotH + 13, r: 3 }));
    if (i % (col < 22 ? 3 : 2) === 0) svg.append(s("text", { class: "axis-t", x: bx + bw / 2, y: padT + plotH + 30, "text-anchor": "middle" }, hourStr(x.t).replace(/\s?([AP])\.?M\.?/i, (_, p) => p.toLowerCase())));
    const hit = s("rect", {
      class: "hit", x: padL + i * col, y: padT - 16, width: col, height: plotH + 36, tabindex: 0, role: "img",
      "aria-label": `${timeStr(x.t)}: ${hourLines(x).join(", ")}`,
    });
    const on = () => { svg.querySelectorAll(".hit.on").forEach((e) => e.classList.remove("on")); hit.classList.add("on"); showTip(x, hit); };
    const off = () => { hit.classList.remove("on"); hideTip(); };
    hit.addEventListener("pointerenter", on);
    hit.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") off(); });
    hit.addEventListener("focus", on);
    hit.addEventListener("blur", off);
    hit.addEventListener("keydown", (e) => {
      const sib = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!sib) return;
      e.preventDefault();
      const hits = [...svg.querySelectorAll(".hit")];
      hits[Math.max(0, Math.min(hits.length - 1, hits.indexOf(hit) + sib))].focus();
    });
    svg.append(hit);
  });
  svg.append(s("text", { class: "axis-t", x: padL - 6, y: padT + plotH + 17, "text-anchor": "end" }, "☾"));

  card.append(h("div", { class: "chart-wrap" }, svg));
  card.append(h("p", { class: "legend-note" }, "Bars: score out of 100 for each hour. Dots under the bars: the moon is up. Flat ticks: twilight. Grey bars: hours already past. Times are local to the forecast location."));
  card.append(h("div", { class: "btn-row mt" }, toggle));
  return card;
}

function settingsCard() {
  const siteSel = h("select", { id: "site" }, Object.entries(SITES).map(([k, v]) => h("option", { value: k, selected: k === state.prefs.site }, v)));
  siteSel.addEventListener("change", () => { state.prefs.site = Object.hasOwn(SITES, siteSel.value) ? siteSel.value : "suburb"; store.set(KEYS.prefs, state.prefs); render(); });
  const unitSel = h("select", { id: "units" },
    h("option", { value: "metric", selected: state.prefs.units === "metric" }, "°C, km/h"),
    h("option", { value: "imperial", selected: state.prefs.units === "imperial" }, "°F, mph"));
  unitSel.addEventListener("change", () => { state.prefs.units = unitSel.value === "imperial" ? "imperial" : "metric"; store.set(KEYS.prefs, state.prefs); render(); });
  const details = h("details", { class: "card settings" },
    h("summary", {}, "Location and settings"),
    h("label", { for: "site" }, "Where you'll be watching from"), siteSel,
    h("label", { for: "units" }, "Units"), unitSel,
    locationCard(false),
    h("div", { class: "btn-row" }, h("button", {
      class: "btn", type: "button",
      onclick: () => {
        if (!confirm("Forget the saved location, settings and forecast on this device?")) return;
        controller?.abort();
        Object.values(KEYS).forEach((k) => store.del(k));
        Object.assign(state, { loc: null, prefs: loadPrefs(), data: null, nights: [], selected: 0, ovation: null, error: null });
        render();
      },
    }, "Clear saved data")),
  );
  details.open = settingsOpen;
  details.addEventListener("toggle", () => { settingsOpen = details.open; });
  return details;
}
let settingsOpen = false;

function downloadIcs(n) {
  const desc = [
    verdict(n),
    `Score ${n.best.score}/100 (${scoreLabel(n.best.score)}). Cloud about ${n.best.cloud}%, feels like ${temp(n.best.feels)}.`,
    n.aurora.level ? `Aurora: ${n.aurora.level.text}.` : "",
    "Forecasts change; check SkyWindow again before heading out.",
  ].filter(Boolean).join("\n");
  const ics = makeIcs({
    uid: `${n.key}-${state.loc.lat}-${state.loc.lon}@skywindow`,
    start: n.best.start, end: n.best.end, now: Date.now(),
    summary: `Stargazing window (${scoreLabel(n.best.score)})`,
    description: desc,
  });
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = h("a", { href: url, download: `skywindow-${n.key}.ics` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---- Start ----
// Tooltips: mouse hides on leave; touch keeps the tip until the next tap elsewhere or a scroll gesture.
document.addEventListener("pointerdown", (e) => { if (!e.target.closest?.(".hit")) hideTip(); });
window.addEventListener("wheel", hideTip, { passive: true });
window.addEventListener("touchmove", hideTip, { passive: true });
let lastWidth = window.innerWidth;
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; hideTip(); if (state.nights.length && !state.showTable) render(); } }, 150);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.loc && (!state.data || Date.now() - state.data.fetchedAt > STALE_MS)) refresh();
});

// Trusted Types is enforced by the CSP; this one policy allows exactly one script URL.
const tt = window.trustedTypes?.createPolicy("skywindow", {
  createScriptURL: (u) => { if (u === "sw.js") return u; throw new TypeError("blocked script URL"); },
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register(tt ? tt.createScriptURL("sw.js") : "sw.js").catch(() => {});

computeNights();
render();
if (state.loc && (!state.data || Date.now() - state.data.fetchedAt > STALE_MS)) refresh();
