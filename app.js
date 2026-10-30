"use strict";

const LOCALES = window.APEX_I18N.locales;
const METRIC_KEYS = window.APEX_I18N.metricKeys;
const LANGUAGE_STORAGE_KEY = "apex-lineup-language-v2";
const WEIGHT_MAX = 100;
const WEIGHT_STEP = 0.1;
const INITIAL_RENDER_LIMIT = 100;
const RENDER_BATCH = 100;

const PRESETS = {
  balanced: {
    label: "均衡车手",
    weights: {championship_points: 13, race_starts: 10, points_per_start: 6, wins: 5, win_rate: 6, podiums: 5, pole_positions: 3, podium_rate: 6, average_finish_position: 8, average_qualifying_position: 6, average_positions_gained: 4, finish_rate: 7, race_pace_score: 7, lap_consistency_score: 6, overtakes_per_start: 4, net_overtakes_per_start: 4}
  },
  pace: {
    label: "纯粹速度",
    weights: {championship_points: 0, race_starts: 5, points_per_start: 5, wins: 0, win_rate: 3, podiums: 0, pole_positions: 7, podium_rate: 2, average_finish_position: 8, average_qualifying_position: 26, average_positions_gained: 0, finish_rate: 2, race_pace_score: 28, lap_consistency_score: 14, overtakes_per_start: 0, net_overtakes_per_start: 0}
  },
  racecraft: {
    label: "赛道缠斗",
    weights: {championship_points: 10, race_starts: 10, points_per_start: 5, wins: 5, win_rate: 2, podiums: 6, pole_positions: 2, podium_rate: 3, average_finish_position: 10, average_qualifying_position: 2, average_positions_gained: 13, finish_rate: 8, race_pace_score: 2, lap_consistency_score: 2, overtakes_per_start: 10, net_overtakes_per_start: 10}
  },
  reliability: {
    label: "稳定完赛",
    weights: {championship_points: 10, race_starts: 10, points_per_start: 8, wins: 3, win_rate: 2, podiums: 6, pole_positions: 1, podium_rate: 7, average_finish_position: 10, average_qualifying_position: 2, average_positions_gained: 3, finish_rate: 25, race_pace_score: 3, lap_consistency_score: 10, overtakes_per_start: 0, net_overtakes_per_start: 0}
  }
};

const SCENARIO_COLORS = ["#f00827", "#43d5ff", "#c7ff38", "#ffb020", "#ba75ff", "#ff6fb1"];
const METRIC_COLORS = ["#fa4e55", "#86d9ff", "#ff8b4d", "#ffc24b", "#fae065", "#d2a7ff", "#ff6c9b", "#a6d665", "#43c4a7", "#49b9dd", "#667fe0", "#a37ce2", "#e783c5", "#d7aa68", "#88bfd0", "#b7c85e"];
const COUNTRY_REGIONS = {NED: "NL", USA: "US", GBR: "GB", FRA: "FR", MEX: "MX", ESP: "ES", MON: "MC", CAN: "CA", DEN: "DK", JPN: "JP", THA: "TH", CHN: "CN", GER: "DE", FIN: "FI", AUS: "AU"};

const state = {
  metadata: null,
  dataset: null,
  weights: {},
  enabled: {},
  language: LOCALES[localStorage.getItem(LANGUAGE_STORAGE_KEY)] ? localStorage.getItem(LANGUAGE_STORAGE_KEY) : "en",
  activePreset: "balanced",
  pointsMode: "historical",
  currentPoints: null,
  ranked: [],
  scenarios: [],
  compact: false,
  search: "",
  filters: {team: "all", country: "all", era: "all", achievement: "all", minStarts: 0},
  view: "stacked",
  zoom: {lineup: 1, compare: 1},
  previousRanks: new Map(),
  expandedDrivers: new Set(),
  visibleLimit: INITIAL_RENDER_LIMIT,
  filteredRanked: [],
  metricHistograms: new Map(),
  interactiveFrame: 0,
  filterTimer: 0,
  comparisonVisible: false,
  comparisonDirty: true,
  comparisonTask: 0
};

const $ = (selector) => document.querySelector(selector);
const driverKey = (driver) => String(driver.driver_id || driver.full_name || driver.driver_number).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function t(key, values = {}) {
  const template = LOCALES[state.language]?.ui[key] ?? LOCALES.en.ui[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

function applyLanguage(language) {
  state.language = LOCALES[language] ? language : "en";
  localStorage.setItem(LANGUAGE_STORAGE_KEY, state.language);
  document.documentElement.lang = state.language === "zh" ? "zh-CN" : state.language;
  $("#language-select").value = state.language;
  document.title = `${t("workspaceTitle")} — Apex LineUp`;
  document.querySelector('meta[name="description"]').content = t("methodTitle");
  document.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => { element.placeholder = t(element.dataset.i18nPlaceholder); });
  document.querySelectorAll("[data-i18n-aria]").forEach((element) => { element.setAttribute("aria-label", t(element.dataset.i18nAria)); });
  document.querySelectorAll("[data-i18n-title]").forEach((element) => { element.title = t(element.dataset.i18nTitle); });
  $("#points-mode-note").hidden = state.pointsMode !== "current";
  const allOption = $("#season-select option[value='all']");
  if (allOption) allOption.textContent = t("allSeasons");
  const modernOption = $("#season-select option[value='modern']");
  if (modernOption) modernOption.textContent = t("modernSeasons");
  const rangeOption = $("#season-select option[data-custom-range]");
  if (rangeOption) rangeOption.textContent = t("customRange", {range: rangeOption.value.replace("-", "–")});
  if (state.dataset) {
    updateSeasonNote(state.dataset.year);
    renderQuality();
    populateFilterOptions();
    renderAll();
    window.APEX_INVERSE.render();
  }
}

function seasonOptionLabel(year) {
  if (String(year) === "all") return t("allSeasons");
  if (String(year) === "modern") return t("modernSeasons");
  return String(year);
}

function updateSeasonNote(year) {
  const note = $("#season-note");
  let key = "";
  if (String(year) === "all") key = "allSeasonNote";
  else if (String(year) === "modern") key = "modernSeasonNote";
  else if (/^\d{4}-\d{4}$/.test(String(year))) key = Number(String(year).slice(0, 4)) < 2023 ? "historicalRangeNote" : "modernRangeNote";
  else if (Number(year) < 2023) key = "historicalYearNote";
  note.hidden = !key;
  if (key) note.textContent = t(key);
}

function rescalePointsMetrics() {
  for (const key of ["championship_points", "points_per_start"]) {
    const values = state.dataset.drivers.map((driver) => driver[key]).filter((value) => Number.isFinite(value));
    const low = Math.min(...values);
    const high = Math.max(...values);
    state.dataset.drivers.forEach((driver) => {
      const value = driver[key];
      driver.normalised[key] = Number.isFinite(value) ? (low === high ? 1 : (value - low) / (high - low)) : null;
    });
  }
}

function applyPointsMode() {
  if (!state.dataset) return;
  const years = state.dataset.years || [];
  for (const driver of state.dataset.drivers) {
    driver._historicalPoints ??= {
      championship_points: driver.championship_points,
      points_per_start: driver.points_per_start,
      normalised_points: driver.normalised.championship_points,
      normalised_per_start: driver.normalised.points_per_start
    };
    if (state.pointsMode === "current") {
      const total = years.reduce((sum, year) => sum + (state.currentPoints.points_by_driver_season[`${driver.driver_id}:${year}`] || 0), 0);
      driver.championship_points = total;
      driver.points_per_start = driver.race_starts > 0 ? total / driver.race_starts : null;
    } else {
      driver.championship_points = driver._historicalPoints.championship_points;
      driver.points_per_start = driver._historicalPoints.points_per_start;
      driver.normalised.championship_points = driver._historicalPoints.normalised_points;
      driver.normalised.points_per_start = driver._historicalPoints.normalised_per_start;
    }
  }
  if (state.pointsMode === "current") rescalePointsMetrics();
  $("#points-mode").checked = state.pointsMode === "current";
  $("#points-mode-note").hidden = state.pointsMode !== "current";
}

async function setPointsMode(enabled) {
  if (enabled && !state.currentPoints) {
    const response = await fetch("./data/current_points.json");
    if (!response.ok) throw new Error("Current-rules points data is unavailable");
    state.currentPoints = await response.json();
  }
  state.pointsMode = enabled ? "current" : "historical";
  applyPointsMode();
  window.APEX_INVERSE.invalidate();
  if (state.dataset) {
    state.previousRanks.clear();
    state.comparisonDirty = true;
    renderAll();
  }
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function metricName(key) {
  const index = METRIC_KEYS.indexOf(key);
  return LOCALES[state.language]?.metrics[index]?.[0] || key;
}

function metricDescription(key) {
  const index = METRIC_KEYS.indexOf(key);
  return LOCALES[state.language]?.metrics[index]?.[1] || "";
}

function presetLabel(key) { return LOCALES[state.language]?.presets[key] || key; }

function formatWeight(value) { return String(Math.round(Number(value) * 10) / 10); }

function normaliseWeight(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(clamp(parsed, 0, WEIGHT_MAX) * 10) / 10 : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rankDrivers(weights, enabled = state.enabled) {
  if (!state.dataset) return [];
  return state.dataset.drivers.map((driver) => {
    let weighted = 0;
    let availableWeight = 0;
    state.dataset.metrics.forEach((metric) => {
      if (enabled[metric.key] === false) return;
      const value = driver.normalised?.[metric.key];
      const weight = Number(weights[metric.key] || 0);
      if (value !== null && value !== undefined && Number.isFinite(Number(value)) && weight > 0) {
        weighted += Number(value) * weight;
        availableWeight += weight;
      }
    });
    return {...driver, score: availableWeight ? weighted / availableWeight : 0, availableWeight};
  }).sort((a, b) => b.score - a.score || (a.championship_position ?? 99) - (b.championship_position ?? 99) || a.full_name.localeCompare(b.full_name));
}

function normaliseSearchText(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function prepareDataset() {
  state.metricHistograms = new Map();
  state.dataset.drivers.forEach((driver) => {
    driver._searchIndex = normaliseSearchText(`${driver.full_name} ${driver.team_name || ""} ${driver.name_acronym || ""} ${driver.country_code || ""}`);
    if (!Number.isFinite(Number(driver.first_year))) driver.first_year = Number(driver.year) || null;
    if (!Number.isFinite(Number(driver.last_year))) driver.last_year = Number(driver.year) || null;
  });
  state.dataset.metrics.forEach((metric) => {
    const bins = Array(8).fill(0);
    state.dataset.drivers.forEach((driver) => {
      const value = driver.normalised?.[metric.key];
      if (value !== null && value !== undefined && Number.isFinite(Number(value))) bins[Math.min(7, Math.floor(Number(value) * 8))] += 1;
    });
    state.metricHistograms.set(metric.key, bins);
  });
}

function resetDriverFilters({render = true} = {}) {
  state.search = "";
  state.filters = {team: "all", country: "all", era: "all", achievement: "all", minStarts: 0};
  state.visibleLimit = INITIAL_RENDER_LIMIT;
  if ($("#driver-search")) $("#driver-search").value = "";
  if ($("#team-filter")) $("#team-filter").value = "all";
  if ($("#country-filter")) $("#country-filter").value = "all";
  if ($("#era-filter")) $("#era-filter").value = "all";
  if ($("#achievement-filter")) $("#achievement-filter").value = "all";
  if ($("#min-starts-filter")) $("#min-starts-filter").value = "0";
  if (render && state.dataset) {
    renderLineUp({animate: false});
    requestComparisonRender();
  }
}

function populateFilterOptions({preserve = true} = {}) {
  if (!state.dataset) return;
  const selected = preserve ? {...state.filters} : {team: "all", country: "all", era: "all", achievement: "all", minStarts: 0};
  const teams = [...new Set(state.dataset.drivers.map((driver) => String(driver.team_name || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const countries = [...new Set(state.dataset.drivers.map((driver) => String(driver.country_code || "").trim()).filter(Boolean))].sort((a, b) => countryName(a).localeCompare(countryName(b)));
  $("#team-filter").innerHTML = `<option value="all">${escapeHTML(t("filterAllTeams"))}</option>${teams.map((team) => `<option value="${escapeHTML(team)}">${escapeHTML(team)}</option>`).join("")}`;
  $("#country-filter").innerHTML = `<option value="all">${escapeHTML(t("filterAllCountries"))}</option>${countries.map((country) => `<option value="${escapeHTML(country)}">${escapeHTML(countryName(country))}</option>`).join("")}`;
  $("#era-filter").innerHTML = `<option value="all">${escapeHTML(t("filterAllEras"))}</option><option value="1950">${escapeHTML(t("era1950"))}</option><option value="1980">${escapeHTML(t("era1980"))}</option><option value="2000">${escapeHTML(t("era2000"))}</option><option value="2020">${escapeHTML(t("era2020"))}</option>`;
  $("#achievement-filter").innerHTML = `<option value="all">${escapeHTML(t("achievementAll"))}</option><option value="winner">${escapeHTML(t("achievementWinner"))}</option><option value="podium">${escapeHTML(t("achievementPodium"))}</option><option value="points">${escapeHTML(t("achievementPoints"))}</option>`;
  state.filters.team = teams.includes(selected.team) ? selected.team : "all";
  state.filters.country = countries.includes(selected.country) ? selected.country : "all";
  state.filters.era = ["all", "1950", "1980", "2000", "2020"].includes(selected.era) ? selected.era : "all";
  state.filters.achievement = ["all", "winner", "podium", "points"].includes(selected.achievement) ? selected.achievement : "all";
  state.filters.minStarts = Math.max(0, Math.trunc(Number(selected.minStarts) || 0));
  $("#team-filter").value = state.filters.team;
  $("#country-filter").value = state.filters.country;
  $("#era-filter").value = state.filters.era;
  $("#achievement-filter").value = state.filters.achievement;
  $("#min-starts-filter").value = String(state.filters.minStarts);
}

function driverMatchesFilters(driver) {
  if (state.search && !driver._searchIndex.includes(normaliseSearchText(state.search))) return false;
  if (state.filters.team !== "all" && driver.team_name !== state.filters.team) return false;
  if (state.filters.country !== "all" && driver.country_code !== state.filters.country) return false;
  if (Number(driver.race_starts || 0) < state.filters.minStarts) return false;
  if (state.filters.achievement === "winner" && Number(driver.wins || 0) <= 0) return false;
  if (state.filters.achievement === "podium" && Number(driver.podiums || 0) <= 0) return false;
  if (state.filters.achievement === "points" && Number(driver.championship_points || 0) <= 0) return false;
  if (state.filters.era !== "all") {
    const ranges = {"1950": [1950, 1979], "1980": [1980, 1999], "2000": [2000, 2019], "2020": [2020, 9999]};
    const [start, end] = ranges[state.filters.era];
    const first = Number(driver.first_year || driver.year || 0);
    const last = Number(driver.last_year || driver.year || 0);
    if (!first || !last || last < start || first > end) return false;
  }
  return true;
}

function filteredRanking(ranking) {
  return ranking.filter(driverMatchesFilters);
}

function activeFilterCount() {
  return Number(Boolean(state.search)) + Number(state.filters.team !== "all") + Number(state.filters.country !== "all") + Number(state.filters.era !== "all") + Number(state.filters.achievement !== "all") + Number(state.filters.minStarts > 0);
}

function updateFilterStatus(total, shown) {
  $("#filter-summary").textContent = t("resultsShown", {shown, total});
  const count = activeFilterCount();
  const badge = $("#active-filter-count");
  badge.textContent = String(count);
  badge.hidden = count === 0;
  $("#filter-toggle").classList.toggle("active", count > 0);
}

function displayValue(key, value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const numeric = Number(value);
  if (["win_rate", "podium_rate", "finish_rate"].includes(key)) return `${(numeric * 100).toFixed(1)}%`;
  if (["race_pace_score", "lap_consistency_score"].includes(key)) return `${(numeric * 100).toFixed(1)}%`;
  if (["race_starts", "wins", "podiums", "pole_positions", "championship_points"].includes(key)) return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
  return numeric.toFixed(1);
}

function safeExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch (_) { return ""; }
}

function countryName(code) {
  const region = COUNTRY_REGIONS[code];
  if (!region) return code || "—";
  try { return new Intl.DisplayNames([state.language], {type: "region"}).of(region); }
  catch (_) { return code || "—"; }
}

function driverPortrait(driver, detail = false) {
  const profile = driver.profile || {};
  const local = profile.portrait_url;
  const localSource = /^\/assets\/drivers\/[a-z0-9-]+\.(?:png|jpg|webp|svg)$/.test(local || "")
    ? new URL(String(local).replace(/^\//, ""), document.baseURI).href
    : "";
  const wikiSource = safeExternalUrl(profile.wiki_thumbnail_url);
  const source = profile.portrait_source_name === "Generated F1 helmet avatar" && wikiSource ? wikiSource : localSource || safeExternalUrl(driver.headshot_url) || wikiSource;
  const fallback = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M9 36c1-15 5-25 16-27 11 1 16 10 15 25l-6 6H14z" fill="currentColor"/><path d="M13 23c8-6 16-7 24-3l-3 9-20 1z" fill="#090c10" stroke="#fff" stroke-width="1.5"/></svg>`;
  return `<span class="driver-portrait ${detail ? "portrait-large" : ""}"><span class="portrait-fallback">${fallback}</span>${source ? `<img src="${escapeHTML(source)}" alt="" loading="lazy" decoding="async">` : ""}</span>`;
}

function driverCell(driver) {
  const expanded = state.expandedDrivers.has(driverKey(driver));
  const profileUrl = safeExternalUrl(driver.profile?.profile_url);
  const name = escapeHTML(driver.full_name);
  const link = profileUrl ? `<a href="${escapeHTML(profileUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHTML(t("openProfile", {name: driver.full_name}))}">${name}<span aria-hidden="true">↗</span></a>` : name;
  return `<div class="driver-cell"><button class="driver-expand" type="button" data-expand-driver="${driverKey(driver)}" aria-expanded="${expanded}" aria-label="${escapeHTML(t(expanded ? "collapseDriver" : "expandDriver", {name: driver.full_name}))}"><span aria-hidden="true">▾</span></button>${driverPortrait(driver)}<span class="driver-info"><strong>${link}</strong><small>${escapeHTML(driver.team_name || t("teamFallback"))}</small></span></div>`;
}

function driverDetailContent(driver) {
  const profile = driver.profile || {};
  const bio = String(profile.biography || "").trim();
  const shortBio = bio.length > 400 ? `${bio.slice(0, 397).replace(/\s+\S*$/, "")}…` : bio;
  const profileUrl = safeExternalUrl(profile.profile_url);
  const stats = [
    ["profileRaceStarts", driver.race_starts], ["profilePoints", displayValue("championship_points", driver.championship_points)],
    ["profileWins", driver.wins], ["profilePodiums", driver.podiums],
    ["profileFinishRate", displayValue("finish_rate", driver.finish_rate)],
    ["profileQualifying", displayValue("average_qualifying_position", driver.average_qualifying_position)]
  ];
  const usesWikimedia = profile.portrait_source_name === "Wikimedia" || profile.portrait_source_name === "Generated F1 helmet avatar" && profile.wiki_thumbnail_url;
  const portraitSource = t(usesWikimedia ? "portraitSourceWikimedia" : profile.portrait_source_name === "Generated F1 helmet avatar" ? "portraitSourceGenerated" : "portraitSource");
  const carNumber = driver.driver_number !== null && driver.driver_number !== undefined ? ` / #${escapeHTML(driver.driver_number)}` : "";
  return `<div class="driver-detail-inner" style="--team:#${escapeHTML((driver.team_colour || "777777").replace("#", ""))}">
      <div class="detail-identity">${driverPortrait(driver, true)}<div><span class="detail-kicker">${escapeHTML(t("profileHeading"))}${carNumber}</span><h4>${escapeHTML(driver.full_name)}</h4><p>${escapeHTML(countryName(driver.country_code))} · ${escapeHTML(driver.team_name || t("teamFallback"))}</p></div></div>
      <div class="detail-copy"><p lang="${bio ? "en" : escapeHTML(state.language)}">${escapeHTML(shortBio || t("profileUnavailable"))}</p>${profileUrl ? `<a href="${escapeHTML(profileUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(t("visitProfile"))}</a>` : ""}<small>${bio ? `${escapeHTML(t("profileSource"))} · ` : ""}${escapeHTML(portraitSource)}</small></div>
      <div class="detail-stats">${stats.map(([label, value]) => `<div><strong>${escapeHTML(value ?? "—")}</strong><span>${escapeHTML(t(label))}</span></div>`).join("")}<small>${escapeHTML(t("profileSnapshot", {year: state.dataset.period_label || state.dataset.year}))}</small></div>
    </div>`;
}

function driverDetail(driver) {
  const expanded = state.expandedDrivers.has(driverKey(driver));
  return `<section class="driver-detail ${expanded ? "is-open" : ""}" data-detail-driver="${driverKey(driver)}" aria-label="${escapeHTML(t("profileHeading"))}">${expanded ? driverDetailContent(driver) : ""}</section>`;
}

function attributeContribution(driver, metric, weights) {
  const normalised = driver.normalised?.[metric.key];
  const weight = Number(weights[metric.key] || 0);
  if (normalised === null || normalised === undefined || !Number.isFinite(Number(normalised)) || weight <= 0) return 0;
  const denominator = Number(driver.availableWeight) || 0;
  return denominator > 0 ? Number(normalised) * weight / denominator : 0;
}

function stackedBar(driver, weights, enabled = state.enabled, {small = false} = {}) {
  const rankedDriver = Number.isFinite(driver.availableWeight) ? driver : rankDrivers(weights, enabled).find((item) => driverKey(item) === driverKey(driver));
  const segments = state.dataset.metrics.map((metric, index) => {
    if (enabled[metric.key] === false) return "";
    const contribution = attributeContribution(rankedDriver, metric, weights) * 100;
    if (contribution <= 0) return "";
    const raw = displayValue(metric.key, driver[metric.key]);
    const title = t("contributionTooltip", {name: metricName(metric.key), raw, weight: formatWeight(weights[metric.key] || 0), points: contribution.toFixed(1)});
    return `<span class="stack-segment" style="width:${contribution.toFixed(3)}%;--segment:${METRIC_COLORS[index % METRIC_COLORS.length]}" title="${escapeHTML(title)}" aria-label="${escapeHTML(title)}"></span>`;
  }).join("");
  const score = clamp(rankedDriver.score * 100, 0, 100).toFixed(2);
  const car = small ? "" : `<span class="race-car" style="--car-position:${score}%" aria-hidden="true"><svg viewBox="0 0 44 22" focusable="false"><path d="M2 6h6l3 5-3 5H2V6Zm10 3h13l5-4h8v3h-6l-3 3 3 3h6v3h-8l-5-4H12l-3-2 3-2Z" fill="currentColor"/><path d="M16 6h6v3h-6zm0 7h6v3h-6zM32 2h6v5h-6zm0 13h6v5h-6z" fill="#14171b"/><path d="M11 10h16" stroke="#14171b" stroke-width="1.2"/></svg></span>`;
  return `<span class="stack-track ${small ? "small" : ""}" role="img" aria-label="${escapeHTML(t("stackAria", {name: driver.full_name, score: (rankedDriver.score * 100).toFixed(1)}))}">${segments}${car}<span class="finish-flag" aria-hidden="true"></span></span>`;
}

function encodeWeightCode() {
  const payload = JSON.stringify({v: 2, year: state.dataset?.year, pointsMode: state.pointsMode, weights: state.weights, enabled: Object.keys(state.enabled).filter((key) => state.enabled[key])});
  const bytes = new TextEncoder().encode(payload);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return `AL2-${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
}

function decodeWeightCode(code) {
  const trimmed = code.trim();
  if (!/^AL[12]-/.test(trimmed)) throw new Error(t("importInvalid"));
  let encoded = trimmed.slice(4).replaceAll("-", "+").replaceAll("_", "/");
  encoded += "=".repeat((4 - encoded.length % 4) % 4);
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const payload = JSON.parse(new TextDecoder().decode(bytes));
  if (![1, 2].includes(payload.v) || payload.weights === null || typeof payload.weights !== "object" || Array.isArray(payload.weights)) throw new Error(t("importVersion"));
  if (Number(trimmed[2]) !== payload.v) throw new Error(t("importVersion"));
  if (payload.v === 2 && !Array.isArray(payload.enabled)) throw new Error(t("importVersion"));
  return payload;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2300);
}

function applyPreset(key, {render = true} = {}) {
  const preset = PRESETS[key];
  if (!preset || !state.dataset) return;
  state.weights = Object.fromEntries(state.dataset.metrics.map((metric) => [metric.key, Number(preset.weights[metric.key] || 0)]));
  state.enabled = Object.fromEntries(state.dataset.metrics.map((metric) => [metric.key, true]));
  state.activePreset = key;
  if (render) renderAll();
}

function renderPresets() {
  $("#preset-row").innerHTML = Object.entries(PRESETS).map(([key, preset]) => (
    `<button class="preset-chip ${state.activePreset === key ? "active" : ""}" data-preset="${key}" type="button">${escapeHTML(presetLabel(key))}</button>`
  )).join("");
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });
}

function renderWeights() {
  if (!state.dataset) return;
  $("#weight-list").innerHTML = state.dataset.metrics.map((metric) => {
    const value = formatWeight(state.weights[metric.key] || 0);
    const active = state.enabled[metric.key] !== false;
    const name = escapeHTML(metricName(metric.key));
    return `<div class="weight-control ${active ? "" : "is-disabled"}" data-control-metric="${metric.key}">
      <div class="weight-label"><button class="weight-enable" type="button" data-toggle-metric="${metric.key}" aria-pressed="${active}" aria-label="${escapeHTML(t(active ? "disableMetric" : "enableMetric", {name: metricName(metric.key)}))}" title="${escapeHTML(t(active ? "disableMetric" : "enableMetric", {name: metricName(metric.key)}))}" style="--segment:${METRIC_COLORS[state.dataset.metrics.indexOf(metric) % METRIC_COLORS.length]}">${active ? "✓" : "+"}</button><label for="weight-number-${metric.key}">${name}</label><input id="weight-number-${metric.key}" data-weight-input="${metric.key}" type="number" min="0" max="${WEIGHT_MAX}" step="${WEIGHT_STEP}" inputmode="decimal" value="${value}" aria-label="${escapeHTML(t("weightInputAria", {name: metricName(metric.key)}))}"><button class="weight-reset" type="button" data-reset-metric="${metric.key}" aria-label="${escapeHTML(t("resetMetric", {name: metricName(metric.key), value: formatWeight(PRESETS.balanced.weights[metric.key] || 0)}))}" title="${escapeHTML(t("resetMetric", {name: metricName(metric.key), value: formatWeight(PRESETS.balanced.weights[metric.key] || 0)}))}">↺</button></div>
      <small>${escapeHTML(metricDescription(metric.key))}</small>
      <input id="weight-${metric.key}" data-weight="${metric.key}" type="range" min="0" max="${WEIGHT_MAX}" step="${WEIGHT_STEP}" value="${value}" aria-label="${escapeHTML(t("weightAria", {name: metricName(metric.key)}))}">
    </div>`;
  }).join("");
  renderWeightValuesOnly();
}

function renderWeightValuesOnly() {
  const total = Object.entries(state.weights).reduce((sum, [key, value]) => sum + (state.enabled[key] === false ? 0 : Number(value || 0)), 0);
  $("#weight-total").textContent = formatWeight(total);
  $("#weight-gauge").parentElement.style.setProperty("--gauge", `${clamp(total / (Math.max(1, state.dataset.metrics.length) * WEIGHT_MAX) * 100, 0, 100)}%`);
  $("#weight-help").textContent = Object.values(state.enabled).some(Boolean) ? t("weightHelp") : t("noActiveMetrics");
  document.querySelectorAll("[data-weight]").forEach((input) => {
    const key = input.dataset.weight;
    const control = input.closest(".weight-control");
    const value = formatWeight(state.weights[key] || 0);
    const active = state.enabled[key] !== false;
    if (document.activeElement !== input) input.value = value;
    const numberInput = control.querySelector("[data-weight-input]");
    if (document.activeElement !== numberInput) numberInput.value = value;
    control.classList.toggle("is-disabled", !active);
    const toggle = control.querySelector("[data-toggle-metric]");
    toggle.setAttribute("aria-pressed", String(active));
    toggle.setAttribute("aria-label", t(active ? "disableMetric" : "enableMetric", {name: metricName(key)}));
    toggle.title = toggle.getAttribute("aria-label");
    toggle.textContent = active ? "✓" : "+";
  });
}

function toggleMetric(key) {
  if (!state.dataset.metrics.some((metric) => metric.key === key)) return;
  state.enabled[key] = state.enabled[key] === false;
  state.activePreset = null;
  renderAll({preserveWeightDOM: true});
}

function updateWeight(key, rawValue) {
  const value = normaliseWeight(rawValue);
  if (value === null || !state.dataset.metrics.some((metric) => metric.key === key)) return false;
  state.weights[key] = value;
  state.activePreset = null;
  renderWeightValuesOnly();
  document.querySelectorAll("[data-preset]").forEach((button) => button.classList.remove("active"));
  scheduleInteractiveRender();
  return true;
}

function resetMetric(key) {
  if (!state.dataset.metrics.some((metric) => metric.key === key)) return;
  state.weights[key] = Number(PRESETS.balanced.weights[key] || 0);
  state.activePreset = null;
  renderAll({preserveWeightDOM: true});
}

function renderLineUp({animate = true} = {}) {
  if (!state.dataset) return;
  const table = $("#lineup-table");
  const previousPositions = animate ? new Map([...table.querySelectorAll(".lineup-row[data-driver]")].map((row) => [row.dataset.driver, row.getBoundingClientRect().top])) : new Map();
  const previousRanks = state.previousRanks;
  state.ranked = rankDrivers(state.weights);
  state.filteredRanked = filteredRanking(state.ranked);
  const visibleDrivers = state.filteredRanked.slice(0, state.visibleLimit);
  const rankPositions = new Map(state.ranked.map((driver, index) => [driverKey(driver), index + 1]));
  const metrics = state.dataset.metrics;
  const rowInfo = (driver) => {
    const rank = rankPositions.get(driverKey(driver));
    const previousRank = previousRanks.get(driverKey(driver));
    const change = previousRank === undefined ? 0 : previousRank - rank;
    const changeClass = change > 0 ? "rank-up" : change < 0 ? "rank-down" : "";
    const team = `#${(driver.team_colour || "777777").replace("#", "")}`;
    return {rank, change, changeClass, team};
  };
  let header = "";
  let rows = "";
  if (state.view === "stacked") {
    const totalWeight = Math.max(1, metrics.reduce((sum, metric) => sum + (state.enabled[metric.key] === false ? 0 : Number(state.weights[metric.key] || 0)), 0));
    const histograms = metrics.map((metric, index) => {
      const active = state.enabled[metric.key] !== false;
      const bins = state.metricHistograms.get(metric.key) || Array(8).fill(0);
      const max = Math.max(1, ...bins);
      const spark = bins.map((count) => `<i style="height:${Math.max(8, count / max * 100)}%;--segment:${METRIC_COLORS[index % METRIC_COLORS.length]}"></i>`).join("");
      return `<button class="metric-mini ${active ? "" : "is-disabled"}" type="button" data-toggle-metric="${metric.key}" aria-pressed="${active}" aria-label="${escapeHTML(t(active ? "disableMetric" : "enableMetric", {name: metricName(metric.key)}))}" title="${escapeHTML(metricDescription(metric.key))}"><span><i style="--segment:${METRIC_COLORS[index % METRIC_COLORS.length]}"></i>${escapeHTML(metricName(metric.key))}</span><strong>${active ? `${Math.round((Number(state.weights[metric.key] || 0) / totalWeight) * 100)}%` : escapeHTML(t("metricOff"))}</strong><span class="metric-hist">${spark}</span></button>`;
    }).join("");
    header = `<div class="stacked-header"><div class="stacked-title"><span>${escapeHTML(t("rankDriver"))}</span><strong>${escapeHTML(t("combinedScore"))}</strong><span>0 — 100</span></div><div class="metric-mini-row">${histograms}</div></div>`;
    rows = visibleDrivers.map((driver) => {
      const info = rowInfo(driver);
      return `<div class="lineup-row stacked-row ${info.rank <= 3 ? "podium-row" : ""} ${info.changeClass}" data-driver="${driverKey(driver)}" style="--team:${info.team}"><div class="rank-cell">${String(info.rank).padStart(2, "0")}</div>${driverCell(driver)}<div class="stack-cell">${stackedBar(driver, state.weights, state.enabled)}</div><div class="stack-score"><strong>${(driver.score * 100).toFixed(1)}</strong><small>${info.change > 0 ? `▲${info.change}` : info.change < 0 ? `▼${-info.change}` : " /100"}</small></div></div>${driverDetail(driver)}`;
    }).join("");
  } else {
    const maxWeight = Math.max(1, ...metrics.map((metric) => state.enabled[metric.key] === false ? 0 : Number(state.weights[metric.key] || 0)));
    const columns = metrics.map((metric) => `${Math.round(92 + 76 * ((state.enabled[metric.key] === false ? 0 : Number(state.weights[metric.key] || 0)) / maxWeight))}px`);
    const template = `52px 196px 132px ${columns.join(" ")}`;
    header = `<div class="lineup-row header" style="grid-template-columns:${template}"><div>#</div><div>${escapeHTML(t("driverTeamColumn"))}</div><div>${escapeHTML(t("scoreColumn"))}</div>${metrics.map((metric) => `<div class="${state.enabled[metric.key] === false ? "metric-disabled" : ""}" title="${escapeHTML(metricDescription(metric.key))}">${escapeHTML(metricName(metric.key))} · ${escapeHTML(t("weightPrefix"))}${state.enabled[metric.key] === false ? escapeHTML(t("metricOff")) : formatWeight(state.weights[metric.key] || 0)}</div>`).join("")}</div>`;
    rows = visibleDrivers.map((driver) => {
      const info = rowInfo(driver);
      return `<div class="lineup-row ${info.rank <= 3 ? "podium-row" : ""} ${info.changeClass}" data-driver="${driverKey(driver)}" style="grid-template-columns:${template};--team:${info.team}"><div class="rank-cell">${String(info.rank).padStart(2, "0")}</div>${driverCell(driver)}<div class="score-cell"><strong>${(driver.score * 100).toFixed(1)}</strong><small>/100</small><span class="score-track"><i style="--score:${(driver.score * 100).toFixed(2)}%"></i></span></div>${metrics.map((metric) => { const normalized = driver.normalised?.[metric.key]; const bar = normalized == null ? 0 : Number(normalized) * 100; const opacity = .2 + .8 * (Number(state.weights[metric.key] || 0) / maxWeight); return `<div class="metric-cell ${state.enabled[metric.key] === false ? "metric-disabled" : ""}" title="${escapeHTML(metricDescription(metric.key))}"><span>${displayValue(metric.key, driver[metric.key])}</span><span class="metric-track"><i style="--bar:${bar.toFixed(2)}%;--opacity:${opacity.toFixed(2)}"></i></span></div>`; }).join("")}</div>${driverDetail(driver)}`;
    }).join("");
  }
  const remaining = Math.max(0, state.filteredRanked.length - visibleDrivers.length);
  const loadMore = remaining ? `<div class="lineup-load-more"><span>${escapeHTML(t("resultsShown", {shown: visibleDrivers.length, total: state.filteredRanked.length}))}</span><button type="button" data-load-more>${escapeHTML(t("loadMore", {count: Math.min(RENDER_BATCH, remaining)}))}</button></div>` : `<div class="lineup-load-more complete"><span>${escapeHTML(t("resultsShown", {shown: visibleDrivers.length, total: state.filteredRanked.length}))}</span></div>`;
  table.innerHTML = header + rows + loadMore;
  table.classList.toggle("stacked-mode", state.view === "stacked");
  table.classList.toggle("compact", state.compact);
  table.style.zoom = String(state.zoom.lineup);
  updateFilterStatus(state.filteredRanked.length, visibleDrivers.length);
  state.previousRanks = rankPositions;
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && previousPositions.size) {
    requestAnimationFrame(() => table.querySelectorAll(".lineup-row[data-driver]").forEach((row) => {
      const before = previousPositions.get(row.dataset.driver);
      if (before === undefined) return;
      const offset = before - row.getBoundingClientRect().top;
      if (Math.abs(offset) > 1 && Math.abs(offset) < 1600) row.animate([{transform: `translateY(${offset}px)`, zIndex: 2}, {transform: "translateY(0)", zIndex: 1}], {duration: 500, easing: "cubic-bezier(.22,.7,.2,1)"});
    }));
  }
}

function frozenScenario(name, weights, colorIndex, enabled = state.enabled, presetKey = null) {
  return {id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, name, presetKey, weights: {...weights}, enabled: {...enabled}, color: SCENARIO_COLORS[colorIndex % SCENARIO_COLORS.length], ranking: null};
}

function scenarioName(scenario) { return scenario.presetKey ? presetLabel(scenario.presetKey) : scenario.name; }

function scenarioRanking(scenario) {
  if (!scenario.ranking) scenario.ranking = rankDrivers(scenario.weights, scenario.enabled);
  return scenario.ranking;
}

function initialiseScenarios() {
  state.scenarios = [
    frozenScenario("", PRESETS.balanced.weights, 0, state.enabled, "balanced"),
    frozenScenario("", PRESETS.pace.weights, 1, state.enabled, "pace"),
    frozenScenario("", PRESETS.racecraft.weights, 2, state.enabled, "racecraft")
  ];
}

function renderScenarios() {
  const list = $("#scenario-list");
  list.innerHTML = state.scenarios.map((scenario, index) => {
    const top = scenarioRanking(scenario)[0];
    const name = scenarioName(scenario);
    return `<article class="scenario-card" style="--scenario:${scenario.color}">
      <strong>${escapeHTML(name)}</strong>
      <small>${escapeHTML(t("scenarioSummary", {driver: top?.name_acronym || "—", score: (top?.score * 100 || 0).toFixed(1)}))}</small>
      <button data-remove-scenario="${escapeHTML(scenario.id)}" type="button" aria-label="${escapeHTML(t("scenarioRemove", {name}))}">×</button>
    </article>`;
  }).join("");
  document.querySelectorAll("[data-remove-scenario]").forEach((button) => {
    button.addEventListener("click", () => {
      state.scenarios = state.scenarios.filter((scenario) => scenario.id !== button.dataset.removeScenario);
      renderScenarios();
      requestComparisonRender();
    });
  });
}

function svgElement(name, attributes = {}, text = null) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  if (text !== null) element.textContent = text;
  return element;
}

function requestComparisonRender({force = false} = {}) {
  state.comparisonDirty = true;
  if (!state.comparisonVisible && !force) return;
  if (state.comparisonTask) {
    if ("cancelIdleCallback" in window) window.cancelIdleCallback(state.comparisonTask);
    else clearTimeout(state.comparisonTask);
  }
  const run = () => {
    state.comparisonTask = 0;
    if (!state.comparisonDirty) return;
    renderComparison();
    state.comparisonDirty = false;
  };
  state.comparisonTask = "requestIdleCallback" in window ? window.requestIdleCallback(run, {timeout: 350}) : window.setTimeout(run, 30);
}

function renderComparison() {
  const container = $("#comparison-chart");
  if (!state.dataset || state.scenarios.length < 2) {
    container.innerHTML = `<div class="empty-chart">${escapeHTML(t("comparisonNeedTwo"))}</div>`;
    return;
  }
  $("#comparison-metric-legend").innerHTML = state.dataset.metrics.map((metric, index) => `<span class="metric-legend" title="${escapeHTML(metricDescription(metric.key))}"><i style="--segment:${METRIC_COLORS[index % METRIC_COLORS.length]}"></i>${escapeHTML(metricName(metric.key))}</span>`).join("");
  const rankings = state.scenarios.map(scenarioRanking);
  const filteredRankings = rankings.map(filteredRanking);
  if (!filteredRankings[0].length) {
    container.innerHTML = `<div class="empty-chart">${escapeHTML(t("resultsShown", {shown: 0, total: 0}))}</div>`;
    return;
  }
  const columnWidth = 350;
  const gap = 76;
  const headerHeight = 88;
  const rowHeight = state.compact ? 26 : 31;
  const width = state.scenarios.length * columnWidth + (state.scenarios.length - 1) * gap;
  const height = headerHeight + rowHeight * filteredRankings[0].length;
  const rankMaps = rankings.map((ranking) => new Map(ranking.map((driver, index) => [driverKey(driver), index])));
  const columns = filteredRankings.map((ranking, scenarioIndex) => {
    const scenario = state.scenarios[scenarioIndex];
    const name = scenarioName(scenario);
    const rows = ranking.map((driver) => { const rank = rankMaps[scenarioIndex].get(driverKey(driver)) + 1; return `<div class="compare-row" data-flow-driver="${driverKey(driver)}" style="--team:#${(driver.team_colour || "777777").replace("#", "")}" title="${escapeHTML(t("comparisonRowTooltip", {name: driver.full_name, rank, score: (driver.score * 100).toFixed(1)}))}"><span class="compare-rank">${rank}</span><span class="compare-driver">${escapeHTML(driver.name_acronym || driver.driver_number)}</span>${stackedBar(driver, scenario.weights, scenario.enabled, {small: true})}<strong>${(driver.score * 100).toFixed(1)}</strong></div>`; }).join("");
    return `<section class="comparison-column" style="left:${scenarioIndex * (columnWidth + gap)}px;--scenario:${scenario.color}" aria-label="${escapeHTML(t("comparisonRankAria", {name}))}"><div class="comparison-column-head"><div><span>SETUP ${String(scenarioIndex + 1).padStart(2, "0")}</span><strong>${escapeHTML(name)}</strong></div><small>${escapeHTML(t("scenarioSummary", {driver: ranking[0]?.name_acronym || "—", score: (ranking[0]?.score * 100 || 0).toFixed(1)}))}</small></div>${rows}</section>`;
  }).join("");
  const displayMaps = filteredRankings.map((ranking) => new Map(ranking.map((driver, index) => [driverKey(driver), index])));
  const svg = svgElement("svg", {viewBox: `0 0 ${width} ${height}`, width, height, class: "comparison-links", role: "img", "aria-label": t("comparisonFlowAria")});
  filteredRankings[0].forEach((driver) => {
    const color = `#${(driver.team_colour || "777777").replace("#", "")}`;
    for (let index = 0; index < state.scenarios.length - 1; index += 1) {
      const start = (index + 1) * columnWidth + index * gap;
      const end = start + gap;
      const y1 = headerHeight + (displayMaps[index].get(driverKey(driver)) + .5) * rowHeight;
      const y2 = headerHeight + (displayMaps[index + 1].get(driverKey(driver)) + .5) * rowHeight;
      const path = svgElement("path", {d: `M ${start} ${y1} C ${start + gap * .42} ${y1}, ${end - gap * .42} ${y2}, ${end} ${y2}`, class: "driver-flow", style: `--flow:${color}`, "data-flow-driver": driverKey(driver)});
      svg.appendChild(path);
    }
  });
  container.innerHTML = `<div class="comparison-board" style="width:${width}px;height:${height}px;--compare-row-height:${rowHeight}px"></div>`;
  const board = container.firstElementChild;
  board.appendChild(svg);
  board.insertAdjacentHTML("beforeend", columns);
  board.style.zoom = String(state.zoom.compare);
  board.addEventListener("mouseover", (event) => {
    const row = event.target.closest(".compare-row");
    if (row && !row.contains(event.relatedTarget)) focusFlow(row.dataset.flowDriver, true);
  });
  board.addEventListener("mouseout", (event) => {
    const row = event.target.closest(".compare-row");
    if (row && !row.contains(event.relatedTarget)) focusFlow(row.dataset.flowDriver, false);
  });
}

function focusFlow(driverNumber, active) {
  const board = $("#comparison-chart .comparison-board");
  if (!board) return;
  board.classList.toggle("has-focus", active);
  board.querySelectorAll("[data-flow-driver]").forEach((element) => element.classList.toggle("active", active && element.dataset.flowDriver === String(driverNumber)));
}

function renderCode() {
  $("#weight-code").value = encodeWeightCode();
}

function scheduleInteractiveRender() {
  if (state.interactiveFrame) return;
  state.interactiveFrame = requestAnimationFrame(() => {
    state.interactiveFrame = 0;
    renderLineUp();
    renderCode();
  });
}

function renderAll({preserveWeightDOM = false} = {}) {
  renderPresets();
  if (preserveWeightDOM) renderWeightValuesOnly();
  else renderWeights();
  renderLineUp();
  renderCode();
  if (!preserveWeightDOM) {
    renderScenarios();
    requestComparisonRender();
  }
}

function renderQuality() {
  const quality = state.metadata?.quality || {};
  const coverage = Number(quality.coverage_percent || 0);
  $("#coverage-value").textContent = `${coverage.toFixed(1)}%`;
  $("#coverage-bar").style.width = `${clamp(coverage, 0, 100)}%`;
  const notice = $("#data-notice");
  notice.classList.toggle("complete", Boolean(quality.ok));
  notice.querySelector("strong").textContent = quality.ok ? t("dataComplete") : t("dataSnapshot", {coverage: coverage.toFixed(2)});
  notice.querySelector("p").textContent = quality.ok
    ? t("dataCompleteDetail", {sessions: quality.selected_sessions || 0, drivers: quality.historical_drivers || 0})
    : t("dataSnapshotDetail", {missing: quality.missing_files || 0});
}

function availableYears() {
  return (state.metadata?.seasons || [])
    .map((season) => Number(season.year))
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
}

function selectionBounds(selection) {
  const years = availableYears();
  if (!years.length) return null;
  const value = String(selection);
  if (/^\d{4}-\d{4}$/.test(value)) {
    const [first, second] = value.split("-").map(Number);
    return [Math.min(first, second), Math.max(first, second)];
  }
  if (value === "modern") return [Math.max(2023, years[0]), years.at(-1)];
  if (value === "all") return [years[0], years.at(-1)];
  const year = Number(value);
  return Number.isInteger(year) ? [year, year] : [years[0], years.at(-1)];
}

function syncPeriodControls(selection) {
  const select = $("#season-select");
  select.querySelector("option[data-custom-range]")?.remove();
  const value = String(selection);
  if (/^\d{4}-\d{4}$/.test(value)) {
    const option = document.createElement("option");
    option.value = value;
    option.dataset.customRange = "true";
    option.textContent = t("customRange", {range: value.replace("-", "–")});
    select.append(option);
  }
  select.value = value;
  const bounds = selectionBounds(value);
  if (bounds) {
    $("#year-from").value = String(bounds[0]);
    $("#year-to").value = String(bounds[1]);
  }
}

async function applyYearRange() {
  let start = Number($("#year-from").value);
  let end = Number($("#year-to").value);
  if (start > end) [start, end] = [end, start];
  const selection = start === end ? String(start) : `${start}-${end}`;
  await loadSeason(selection);
}

async function loadSeason(year, {resetScenarios = true} = {}) {
  const table = $("#lineup-table");
  table.innerHTML = `<div class="loading">${escapeHTML(t("loadSeason", {year}))}</div>`;
  try {
    const response = await fetch(`./api/lineup?year=${encodeURIComponent(year)}`);
    if (!response.ok) throw new Error(t("loadSeasonFailed", {year}));
    state.dataset = await response.json();
  } catch (apiError) {
    if (!window.APEX_STATIC_DATA) throw apiError;
    state.dataset = await window.APEX_STATIC_DATA.lineup(year);
  }
  state.expandedDrivers.clear();
  window.APEX_INVERSE.reset();
  state.previousRanks.clear();
  state.visibleLimit = INITIAL_RENDER_LIMIT;
  applyPointsMode();
  prepareDataset();
  populateFilterOptions();
  applyPreset("balanced", {render: false});
  if (resetScenarios) initialiseScenarios();
  state.comparisonDirty = true;
  const seasonInfo = state.metadata.seasons.find((season) => String(season.year) === String(year));
  $("#driver-count").textContent = state.dataset.drivers.length;
  $("#race-count").textContent = seasonInfo?.grand_prix_count ?? state.dataset.grand_prix_count ?? "—";
  $("#metric-count").textContent = state.dataset.metrics.length;
  $("#season-value").textContent = state.dataset.period_label || year;
  syncPeriodControls(year);
  updateSeasonNote(year);
  renderAll();
}

async function importCode() {
  const message = $("#code-message");
  try {
    const payload = decodeWeightCode($("#weight-code").value);
    if (payload.year && String(payload.year) !== String(state.dataset.year)) {
      const option = [...$("#season-select").options].find((item) => item.value === String(payload.year));
      const range = /^\d{4}-\d{4}$/.test(String(payload.year));
      if (!option && !range) throw new Error(t("importNoSeason", {year: payload.year}));
      await loadSeason(payload.year);
    }
    await setPointsMode(payload.pointsMode === "current");
    const validKeys = new Set(state.dataset.metrics.map((metric) => metric.key));
    const imported = {};
    Object.entries(payload.weights).forEach(([key, value]) => {
      if (validKeys.has(key)) {
        const weight = normaliseWeight(value);
        if (weight !== null) imported[key] = weight;
      }
    });
    if (!Object.keys(imported).length) throw new Error(t("importNoMetrics"));
    state.weights = Object.fromEntries(state.dataset.metrics.map((metric) => [metric.key, imported[metric.key] ?? 0]));
    state.enabled = Object.fromEntries(state.dataset.metrics.map((metric) => [metric.key, payload.v === 1 || payload.enabled.includes(metric.key)]));
    state.activePreset = null;
    renderAll();
    message.textContent = t("codeApplied");
    message.style.color = "";
    showToast(t("codeImported"));
  } catch (error) {
    message.textContent = error.message;
    message.style.color = "#ff6b7c";
  }
}

async function copyCode() {
  const code = $("#weight-code").value;
  try {
    await navigator.clipboard.writeText(code);
  } catch (_) {
    $("#weight-code").select();
    document.execCommand("copy");
  }
  $("#code-message").textContent = t("codeCopied");
  $("#code-message").style.color = "";
  showToast(t("codeCopied"));
}

async function shareSite() {
  const url = `${window.location.origin}${window.location.pathname}`;
  const shareData = {title: document.title, text: t("shareSiteText"), url};
  try {
    if (navigator.share) {
      await navigator.share(shareData);
      showToast(t("siteShared"));
      return;
    }
    await navigator.clipboard.writeText(url);
    showToast(t("siteLinkCopied"));
  } catch (error) {
    if (error?.name === "AbortError") return;
    const input = document.createElement("input");
    input.value = url;
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
    showToast(t("siteLinkCopied"));
  }
}

function setView(view) {
  state.view = view;
  $("#view-stacked").classList.toggle("active", view === "stacked");
  $("#view-table").classList.toggle("active", view === "table");
  $("#view-stacked").setAttribute("aria-pressed", String(view === "stacked"));
  $("#view-table").setAttribute("aria-pressed", String(view === "table"));
  renderLineUp();
}

function setZoom(which, value) {
  state.zoom[which] = clamp(Math.round(value * 10) / 10, .6, 2.4);
  const surface = which === "lineup" ? $("#lineup-table") : $("#comparison-chart .comparison-board");
  if (surface) surface.style.zoom = String(state.zoom[which]);
  document.querySelector(`[data-zoom-controls="${which}"] [data-zoom-value]`).textContent = `${Math.round(state.zoom[which] * 100)}%`;
}

function bindViewport(which) {
  const scroll = which === "lineup" ? $("#lineup-scroll") : $("#comparison-chart");
  const controls = document.querySelector(`[data-zoom-controls="${which}"]`);
  let dragging = null;
  controls.querySelectorAll("[data-zoom]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.zoom;
    setZoom(which, action === "reset" ? 1 : state.zoom[which] + (action === "in" ? .2 : -.2));
  }));
  const panButton = controls.querySelector("[data-pan-toggle]");
  panButton.addEventListener("click", () => {
    const active = panButton.getAttribute("aria-pressed") !== "true";
    panButton.setAttribute("aria-pressed", String(active));
    scroll.classList.toggle("pan-active", active);
  });
  scroll.addEventListener("wheel", (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setZoom(which, state.zoom[which] + (event.deltaY < 0 ? .1 : -.1));
  }, {passive: false});
  scroll.addEventListener("pointerdown", (event) => {
    if (event.button !== 1 && !scroll.classList.contains("pan-active")) return;
    dragging = {x: event.clientX, y: event.clientY, left: scroll.scrollLeft, top: scroll.scrollTop};
    scroll.setPointerCapture(event.pointerId);
    scroll.classList.add("is-panning");
    event.preventDefault();
  });
  scroll.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    scroll.scrollLeft = dragging.left - (event.clientX - dragging.x);
    scroll.scrollTop = dragging.top - (event.clientY - dragging.y);
  });
  const finishPan = () => { dragging = null; scroll.classList.remove("is-panning"); };
  scroll.addEventListener("pointerup", finishPan);
  scroll.addEventListener("pointercancel", finishPan);
}

function applyDriverFiltersFromControls() {
  state.search = normaliseSearchText($("#driver-search").value.trim());
  state.filters.team = $("#team-filter").value;
  state.filters.country = $("#country-filter").value;
  state.filters.era = $("#era-filter").value;
  state.filters.achievement = $("#achievement-filter").value;
  state.filters.minStarts = Math.max(0, Math.trunc(Number($("#min-starts-filter").value) || 0));
  state.visibleLimit = INITIAL_RENDER_LIMIT;
  renderLineUp({animate: false});
  requestComparisonRender();
}

function scheduleFilterUpdate() {
  clearTimeout(state.filterTimer);
  state.filterTimer = window.setTimeout(applyDriverFiltersFromControls, 90);
}

function loadMoreDrivers() {
  if (state.visibleLimit >= state.filteredRanked.length) return;
  state.visibleLimit = Math.min(state.filteredRanked.length, state.visibleLimit + RENDER_BATCH);
  renderLineUp({animate: false});
}

function setupComparisonObserver() {
  const section = $("#compare");
  if (!("IntersectionObserver" in window)) {
    state.comparisonVisible = true;
    requestComparisonRender({force: true});
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    state.comparisonVisible = true;
    requestComparisonRender({force: true});
    observer.disconnect();
  // Keep the expensive multi-column comparison out of the initial render.
  // A small lead-in still lets it finish just before the user reaches it.
  }, {rootMargin: "120px 0px"});
  observer.observe(section);
}

function bindEvents() {
  window.APEX_INVERSE.init({state, t, escapeHTML, driverKey, rankDrivers, renderAll, metricName});
  $("#language-select").addEventListener("change", (event) => applyLanguage(event.target.value));
  $("#share-site").addEventListener("click", shareSite);
  $("#reset-weights").addEventListener("click", () => applyPreset("balanced"));
  $("#view-stacked").addEventListener("click", () => setView("stacked"));
  $("#view-table").addEventListener("click", () => setView("table"));
  $("#filter-toggle").addEventListener("click", (event) => {
    const open = event.currentTarget.getAttribute("aria-expanded") !== "true";
    event.currentTarget.setAttribute("aria-expanded", String(open));
    $("#filter-drawer").hidden = !open;
  });
  $("#reset-filters").addEventListener("click", () => resetDriverFilters());
  ["#team-filter", "#country-filter", "#era-filter", "#achievement-filter"].forEach((selector) => $(selector).addEventListener("change", applyDriverFiltersFromControls));
  $("#min-starts-filter").addEventListener("input", scheduleFilterUpdate);
  bindViewport("lineup");
  bindViewport("compare");
  setupComparisonObserver();
  $("#weight-list").addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-toggle-metric]");
    if (toggle) toggleMetric(toggle.dataset.toggleMetric);
    const reset = event.target.closest("[data-reset-metric]");
    if (reset) resetMetric(reset.dataset.resetMetric);
  });
  $("#lineup-table").addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-toggle-metric]");
    if (toggle) toggleMetric(toggle.dataset.toggleMetric);
    const expand = event.target.closest("[data-expand-driver]");
    if (expand) {
      const key = expand.dataset.expandDriver;
      if (state.expandedDrivers.has(key)) state.expandedDrivers.delete(key);
      else state.expandedDrivers.add(key);
      const open = state.expandedDrivers.has(key);
      expand.setAttribute("aria-expanded", String(open));
      const driver = state.dataset.drivers.find((item) => driverKey(item) === key);
      expand.setAttribute("aria-label", t(open ? "collapseDriver" : "expandDriver", {name: driver?.full_name || key}));
      const detail = $("#lineup-table").querySelector(`[data-detail-driver="${key}"]`);
      if (detail && open && !detail.firstElementChild && driver) detail.innerHTML = driverDetailContent(driver);
      detail?.classList.toggle("is-open", open);
    }
    if (event.target.closest("[data-load-more]")) loadMoreDrivers();
  });
  $("#lineup-table").addEventListener("error", (event) => {
    if (event.target.matches(".driver-portrait img")) event.target.closest(".driver-portrait").classList.add("no-photo");
  }, true);
  $("#weight-list").addEventListener("input", (event) => {
    const slider = event.target.closest("[data-weight]");
    if (slider) updateWeight(slider.dataset.weight, slider.value);
    const number = event.target.closest("[data-weight-input]");
    if (number && number.value !== "") updateWeight(number.dataset.weightInput, number.value);
  });
  $("#weight-list").addEventListener("change", (event) => {
    const number = event.target.closest("[data-weight-input]");
    if (!number) return;
    if (!updateWeight(number.dataset.weightInput, number.value)) number.value = formatWeight(state.weights[number.dataset.weightInput] || 0);
    number.value = formatWeight(state.weights[number.dataset.weightInput] || 0);
  });
  $("#weight-list").addEventListener("focusout", (event) => {
    const number = event.target.closest("[data-weight-input]");
    if (number) number.value = formatWeight(state.weights[number.dataset.weightInput] || 0);
  });
  $("#driver-search").addEventListener("input", (event) => {
    scheduleFilterUpdate();
  });
  let scrollFrame = 0;
  $("#lineup-scroll").addEventListener("scroll", (event) => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      const viewport = event.currentTarget;
      if (viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 260) loadMoreDrivers();
    });
  }, {passive: true});
  $("#compact-toggle").addEventListener("click", (event) => {
    state.compact = !state.compact;
    event.currentTarget.setAttribute("aria-pressed", String(state.compact));
    renderLineUp();
  });
  $("#copy-code").addEventListener("click", copyCode);
  $("#import-code").addEventListener("click", importCode);
  $("#season-select").addEventListener("change", (event) => loadSeason(event.target.value));
  $("#points-mode").addEventListener("change", async (event) => {
    event.target.disabled = true;
    try { await setPointsMode(event.target.checked); }
    catch (error) { event.target.checked = state.pointsMode === "current"; showToast(error.message); }
    finally { event.target.disabled = false; }
  });
  $("#year-range-filter").addEventListener("submit", (event) => {
    event.preventDefault();
    applyYearRange();
  });
  $("#reset-year-range").addEventListener("click", () => loadSeason("all"));
  $("#save-scenario").addEventListener("click", () => {
    const input = $("#scenario-name");
    const name = input.value.trim() || t("customScenario", {number: state.scenarios.length + 1});
    state.scenarios.push(frozenScenario(name, state.weights, state.scenarios.length, state.enabled));
    if (state.scenarios.length > 6) state.scenarios.shift();
    input.value = "";
    renderScenarios();
    requestComparisonRender();
    showToast(t("savedScenario", {name}));
  });
}

async function initialise() {
  applyLanguage(state.language);
  bindEvents();
  try {
    try {
      const response = await fetch("./api/seasons");
      if (!response.ok) throw new Error(t("fetchUnavailable"));
      state.metadata = await response.json();
    } catch (apiError) {
      if (!window.APEX_STATIC_DATA) throw apiError;
      state.metadata = await window.APEX_STATIC_DATA.metadata();
    }
    const select = $("#season-select");
    select.innerHTML = state.metadata.seasons.map((season) => `<option value="${season.year}">${escapeHTML(seasonOptionLabel(season.year))}</option>`).join("");
    const years = availableYears();
    const yearOptions = years.map((year) => `<option value="${year}">${year}</option>`).join("");
    $("#year-from").innerHTML = yearOptions;
    $("#year-to").innerHTML = yearOptions;
    if (!state.metadata.default_year) throw new Error(t("noSeasons"));
    select.value = String(state.metadata.default_year);
    renderQuality();
    await loadSeason(state.metadata.default_year);
  } catch (error) {
    $("#lineup-table").innerHTML = `<div class="loading">${escapeHTML(error.message)}</div>`;
    $("#data-notice").querySelector("strong").textContent = t("dataFailed");
    $("#data-notice").querySelector("p").textContent = error.message;
  }
}

initialise();
