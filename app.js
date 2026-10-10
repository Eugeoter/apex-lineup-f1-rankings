"use strict";

const LOCALES = window.APEX_I18N.locales;
const METRIC_KEYS = window.APEX_I18N.metricKeys;
const LANGUAGE_STORAGE_KEY = "apex-lineup-language-v2";
const WEIGHT_MAX = 100;
const WEIGHT_STEP = 0.1;

const PRESETS = {
  balanced: {
    label: "均衡车手",
    weights: {championship_points: 14, points_per_start: 8, wins: 8, podium_rate: 10, average_finish_position: 10, average_qualifying_position: 8, average_positions_gained: 8, finish_rate: 8, race_pace_score: 10, lap_consistency_score: 6, overtakes_per_start: 5, net_overtakes_per_start: 5}
  },
  pace: {
    label: "纯粹速度",
    weights: {championship_points: 8, points_per_start: 8, wins: 7, podium_rate: 6, average_finish_position: 10, average_qualifying_position: 18, average_positions_gained: 4, finish_rate: 4, race_pace_score: 24, lap_consistency_score: 8, overtakes_per_start: 2, net_overtakes_per_start: 1}
  },
  racecraft: {
    label: "赛道缠斗",
    weights: {championship_points: 7, points_per_start: 7, wins: 5, podium_rate: 5, average_finish_position: 8, average_qualifying_position: 2, average_positions_gained: 19, finish_rate: 8, race_pace_score: 8, lap_consistency_score: 6, overtakes_per_start: 13, net_overtakes_per_start: 12}
  },
  reliability: {
    label: "稳定完赛",
    weights: {championship_points: 9, points_per_start: 8, wins: 3, podium_rate: 7, average_finish_position: 13, average_qualifying_position: 5, average_positions_gained: 7, finish_rate: 25, race_pace_score: 6, lap_consistency_score: 14, overtakes_per_start: 1, net_overtakes_per_start: 2}
  }
};

const SCENARIO_COLORS = ["#f00827", "#43d5ff", "#c7ff38", "#ffb020", "#ba75ff", "#ff6fb1"];
const METRIC_COLORS = ["#fa4e55", "#ff8b4d", "#ffc24b", "#a6d665", "#43c4a7", "#49b9dd", "#667fe0", "#a37ce2", "#e783c5", "#d7aa68", "#88bfd0", "#b7c85e"];
const COUNTRY_REGIONS = {NED: "NL", USA: "US", GBR: "GB", FRA: "FR", MEX: "MX", ESP: "ES", MON: "MC", CAN: "CA", DEN: "DK", JPN: "JP", THA: "TH", CHN: "CN", GER: "DE", FIN: "FI", AUS: "AU"};

const state = {
  metadata: null,
  dataset: null,
  weights: {},
  enabled: {},
  language: LOCALES[localStorage.getItem(LANGUAGE_STORAGE_KEY)] ? localStorage.getItem(LANGUAGE_STORAGE_KEY) : "en",
  activePreset: "balanced",
  ranked: [],
  scenarios: [],
  compact: false,
  search: "",
  view: "stacked",
  zoom: {lineup: 1, compare: 1},
  previousRanks: new Map(),
  expandedDrivers: new Set()
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
  const allOption = $("#season-select option[value='all']");
  if (allOption) allOption.textContent = t("allSeasons");
  const modernOption = $("#season-select option[value='modern']");
  if (modernOption) modernOption.textContent = t("modernSeasons");
  const rangeOption = $("#season-select option[data-custom-range]");
  if (rangeOption) rangeOption.textContent = t("customRange", {range: rangeOption.value.replace("-", "–")});
  if (state.dataset) {
    updateSeasonNote(state.dataset.year);
    renderQuality();
    renderAll();
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

function displayValue(key, value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const numeric = Number(value);
  if (["podium_rate", "finish_rate"].includes(key)) return `${Math.round(numeric * 100)}%`;
  if (["race_pace_score", "lap_consistency_score"].includes(key)) return `${(numeric * 100).toFixed(1)}%`;
  if (["wins", "championship_points"].includes(key)) return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
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

function driverDetail(driver, filtered = "") {
  const expanded = state.expandedDrivers.has(driverKey(driver));
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
  return `<section class="driver-detail ${expanded ? "is-open" : ""} ${filtered}" data-detail-driver="${driverKey(driver)}" aria-label="${escapeHTML(t("profileHeading"))}">
    <div class="driver-detail-inner" style="--team:#${escapeHTML((driver.team_colour || "777777").replace("#", ""))}">
      <div class="detail-identity">${driverPortrait(driver, true)}<div><span class="detail-kicker">${escapeHTML(t("profileHeading"))}${carNumber}</span><h4>${escapeHTML(driver.full_name)}</h4><p>${escapeHTML(countryName(driver.country_code))} · ${escapeHTML(driver.team_name || t("teamFallback"))}</p></div></div>
      <div class="detail-copy"><p lang="${bio ? "en" : escapeHTML(state.language)}">${escapeHTML(shortBio || t("profileUnavailable"))}</p>${profileUrl ? `<a href="${escapeHTML(profileUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(t("visitProfile"))}</a>` : ""}<small>${bio ? `${escapeHTML(t("profileSource"))} · ` : ""}${escapeHTML(portraitSource)}</small></div>
      <div class="detail-stats">${stats.map(([label, value]) => `<div><strong>${escapeHTML(value ?? "—")}</strong><span>${escapeHTML(t(label))}</span></div>`).join("")}<small>${escapeHTML(t("profileSnapshot", {year: state.dataset.period_label || state.dataset.year}))}</small></div>
    </div></section>`;
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
  const payload = JSON.stringify({v: 2, year: state.dataset?.year, weights: state.weights, enabled: Object.keys(state.enabled).filter((key) => state.enabled[key])});
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
  renderAll({preserveWeightDOM: true});
  return true;
}

function resetMetric(key) {
  if (!state.dataset.metrics.some((metric) => metric.key === key)) return;
  state.weights[key] = Number(PRESETS.balanced.weights[key] || 0);
  state.activePreset = null;
  renderAll({preserveWeightDOM: true});
}

function renderLineUp() {
  if (!state.dataset) return;
  const table = $("#lineup-table");
  const previousPositions = new Map([...table.querySelectorAll(".lineup-row[data-driver]")].map((row) => [row.dataset.driver, row.getBoundingClientRect().top]));
  const previousRanks = state.previousRanks;
  state.ranked = rankDrivers(state.weights);
  const metrics = state.dataset.metrics;
  const rowInfo = (driver, index) => {
    const previousRank = previousRanks.get(driverKey(driver));
    const change = previousRank === undefined ? 0 : previousRank - index - 1;
    const changeClass = change > 0 ? "rank-up" : change < 0 ? "rank-down" : "";
    const searchText = `${driver.full_name} ${driver.team_name} ${driver.name_acronym}`.toLowerCase();
    const filtered = state.search && !searchText.includes(state.search) ? "is-filtered" : "";
    const team = `#${(driver.team_colour || "777777").replace("#", "")}`;
    return {change, changeClass, filtered, team};
  };
  if (state.view === "stacked") {
    const totalWeight = Math.max(1, metrics.reduce((sum, metric) => sum + (state.enabled[metric.key] === false ? 0 : Number(state.weights[metric.key] || 0)), 0));
    const histograms = metrics.map((metric, index) => {
      const active = state.enabled[metric.key] !== false;
      const bins = Array(8).fill(0);
      state.dataset.drivers.forEach((driver) => {
        const value = driver.normalised?.[metric.key];
        if (Number.isFinite(Number(value)) && value !== null) bins[Math.min(7, Math.floor(Number(value) * 8))]++;
      });
      const max = Math.max(1, ...bins);
      const spark = bins.map((count) => `<i style="height:${Math.max(8, count / max * 100)}%;--segment:${METRIC_COLORS[index % METRIC_COLORS.length]}"></i>`).join("");
      return `<button class="metric-mini ${active ? "" : "is-disabled"}" type="button" data-toggle-metric="${metric.key}" aria-pressed="${active}" aria-label="${escapeHTML(t(active ? "disableMetric" : "enableMetric", {name: metricName(metric.key)}))}" title="${escapeHTML(metricDescription(metric.key))}"><span><i style="--segment:${METRIC_COLORS[index % METRIC_COLORS.length]}"></i>${escapeHTML(metricName(metric.key))}</span><strong>${active ? `${Math.round((Number(state.weights[metric.key] || 0) / totalWeight) * 100)}%` : escapeHTML(t("metricOff"))}</strong><span class="metric-hist">${spark}</span></button>`;
    }).join("");
    const header = `<div class="stacked-header"><div class="stacked-title"><span>${escapeHTML(t("rankDriver"))}</span><strong>${escapeHTML(t("combinedScore"))}</strong><span>0 — 100</span></div><div class="metric-mini-row">${histograms}</div></div>`;
    const rows = state.ranked.map((driver, index) => {
      const info = rowInfo(driver, index);
      return `<div class="lineup-row stacked-row ${index < 3 ? "podium-row" : ""} ${info.filtered} ${info.changeClass}" data-driver="${driverKey(driver)}" style="--team:${info.team}"><div class="rank-cell">${String(index + 1).padStart(2, "0")}</div>${driverCell(driver)}<div class="stack-cell">${stackedBar(driver, state.weights, state.enabled)}</div><div class="stack-score"><strong>${(driver.score * 100).toFixed(1)}</strong><small>${info.change > 0 ? `▲${info.change}` : info.change < 0 ? `▼${-info.change}` : " /100"}</small></div></div>${driverDetail(driver, info.filtered)}`;
    }).join("");
    table.innerHTML = header + rows;
  } else {
    const maxWeight = Math.max(1, ...metrics.map((metric) => state.enabled[metric.key] === false ? 0 : Number(state.weights[metric.key] || 0)));
    const columns = metrics.map((metric) => `${Math.round(92 + 76 * ((state.enabled[metric.key] === false ? 0 : Number(state.weights[metric.key] || 0)) / maxWeight))}px`);
    const template = `52px 196px 132px ${columns.join(" ")}`;
    const header = `<div class="lineup-row header" style="grid-template-columns:${template}"><div>#</div><div>${escapeHTML(t("driverTeamColumn"))}</div><div>${escapeHTML(t("scoreColumn"))}</div>${metrics.map((metric) => `<div class="${state.enabled[metric.key] === false ? "metric-disabled" : ""}" title="${escapeHTML(metricDescription(metric.key))}">${escapeHTML(metricName(metric.key))} · ${escapeHTML(t("weightPrefix"))}${state.enabled[metric.key] === false ? escapeHTML(t("metricOff")) : formatWeight(state.weights[metric.key] || 0)}</div>`).join("")}</div>`;
    const rows = state.ranked.map((driver, index) => {
      const info = rowInfo(driver, index);
      return `<div class="lineup-row ${index < 3 ? "podium-row" : ""} ${info.filtered} ${info.changeClass}" data-driver="${driverKey(driver)}" style="grid-template-columns:${template};--team:${info.team}"><div class="rank-cell">${String(index + 1).padStart(2, "0")}</div>${driverCell(driver)}<div class="score-cell"><strong>${(driver.score * 100).toFixed(1)}</strong><small>/100</small><span class="score-track"><i style="--score:${(driver.score * 100).toFixed(2)}%"></i></span></div>${metrics.map((metric) => { const normalized = driver.normalised?.[metric.key]; const bar = normalized == null ? 0 : Number(normalized) * 100; const opacity = .2 + .8 * (Number(state.weights[metric.key] || 0) / maxWeight); return `<div class="metric-cell ${state.enabled[metric.key] === false ? "metric-disabled" : ""}" title="${escapeHTML(metricDescription(metric.key))}"><span>${displayValue(metric.key, driver[metric.key])}</span><span class="metric-track"><i style="--bar:${bar.toFixed(2)}%;--opacity:${opacity.toFixed(2)}"></i></span></div>`; }).join("")}</div>${driverDetail(driver, info.filtered)}`;
    }).join("");
    table.innerHTML = header + rows;
  }
  table.classList.toggle("stacked-mode", state.view === "stacked");
  table.classList.toggle("compact", state.compact);
  table.style.zoom = String(state.zoom.lineup);
  state.previousRanks = new Map(state.ranked.map((driver, index) => [driverKey(driver), index + 1]));
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && previousPositions.size) {
    table.querySelectorAll(".lineup-row[data-driver]:not(.is-filtered)").forEach((row) => {
      const before = previousPositions.get(row.dataset.driver);
      if (before === undefined) return;
      const offset = before - row.getBoundingClientRect().top;
      if (Math.abs(offset) > 1 && Math.abs(offset) < 1600) row.animate([{transform: `translateY(${offset}px)`, zIndex: 2}, {transform: "translateY(0)", zIndex: 1}], {duration: 500, easing: "cubic-bezier(.22,.7,.2,1)"});
    });
  }
}

function frozenScenario(name, weights, colorIndex, enabled = state.enabled, presetKey = null) {
  return {id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, name, presetKey, weights: {...weights}, enabled: {...enabled}, color: SCENARIO_COLORS[colorIndex % SCENARIO_COLORS.length]};
}

function scenarioName(scenario) { return scenario.presetKey ? presetLabel(scenario.presetKey) : scenario.name; }

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
    const top = rankDrivers(scenario.weights, scenario.enabled)[0];
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
      renderComparison();
    });
  });
}

function svgElement(name, attributes = {}, text = null) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  if (text !== null) element.textContent = text;
  return element;
}

function renderComparison() {
  const container = $("#comparison-chart");
  if (!state.dataset || state.scenarios.length < 2) {
    container.innerHTML = `<div class="empty-chart">${escapeHTML(t("comparisonNeedTwo"))}</div>`;
    return;
  }
  $("#comparison-metric-legend").innerHTML = state.dataset.metrics.map((metric, index) => `<span class="metric-legend" title="${escapeHTML(metricDescription(metric.key))}"><i style="--segment:${METRIC_COLORS[index % METRIC_COLORS.length]}"></i>${escapeHTML(metricName(metric.key))}</span>`).join("");
  const rankings = state.scenarios.map((scenario) => rankDrivers(scenario.weights, scenario.enabled));
  const columnWidth = 350;
  const gap = 76;
  const headerHeight = 88;
  const rowHeight = state.compact ? 26 : 31;
  const width = state.scenarios.length * columnWidth + (state.scenarios.length - 1) * gap;
  const height = headerHeight + rowHeight * state.dataset.drivers.length;
  const columns = rankings.map((ranking, scenarioIndex) => {
    const scenario = state.scenarios[scenarioIndex];
    const name = scenarioName(scenario);
    const rows = ranking.map((driver, rankIndex) => `<div class="compare-row" data-flow-driver="${driverKey(driver)}" style="--team:#${(driver.team_colour || "777777").replace("#", "")}" title="${escapeHTML(t("comparisonRowTooltip", {name: driver.full_name, rank: rankIndex + 1, score: (driver.score * 100).toFixed(1)}))}"><span class="compare-rank">${rankIndex + 1}</span><span class="compare-driver">${escapeHTML(driver.name_acronym || driver.driver_number)}</span>${stackedBar(driver, scenario.weights, scenario.enabled, {small: true})}<strong>${(driver.score * 100).toFixed(1)}</strong></div>`).join("");
    return `<section class="comparison-column" style="left:${scenarioIndex * (columnWidth + gap)}px;--scenario:${scenario.color}" aria-label="${escapeHTML(t("comparisonRankAria", {name}))}"><div class="comparison-column-head"><div><span>SETUP ${String(scenarioIndex + 1).padStart(2, "0")}</span><strong>${escapeHTML(name)}</strong></div><small>${escapeHTML(t("scenarioSummary", {driver: ranking[0]?.name_acronym || "—", score: (ranking[0]?.score * 100 || 0).toFixed(1)}))}</small></div>${rows}</section>`;
  }).join("");
  const rankMaps = rankings.map((ranking) => new Map(ranking.map((driver, index) => [driverKey(driver), index])));
  const svg = svgElement("svg", {viewBox: `0 0 ${width} ${height}`, width, height, class: "comparison-links", role: "img", "aria-label": t("comparisonFlowAria")});
  state.dataset.drivers.forEach((driver) => {
    const color = `#${(driver.team_colour || "777777").replace("#", "")}`;
    for (let index = 0; index < state.scenarios.length - 1; index += 1) {
      const start = (index + 1) * columnWidth + index * gap;
      const end = start + gap;
      const y1 = headerHeight + (rankMaps[index].get(driverKey(driver)) + .5) * rowHeight;
      const y2 = headerHeight + (rankMaps[index + 1].get(driverKey(driver)) + .5) * rowHeight;
      const path = svgElement("path", {d: `M ${start} ${y1} C ${start + gap * .42} ${y1}, ${end - gap * .42} ${y2}, ${end} ${y2}`, class: "driver-flow", style: `--flow:${color}`, "data-flow-driver": driverKey(driver)});
      svg.appendChild(path);
    }
  });
  container.innerHTML = `<div class="comparison-board" style="width:${width}px;height:${height}px;--compare-row-height:${rowHeight}px"></div>`;
  const board = container.firstElementChild;
  board.appendChild(svg);
  board.insertAdjacentHTML("beforeend", columns);
  board.style.zoom = String(state.zoom.compare);
  board.querySelectorAll(".compare-row").forEach((row) => {
    row.addEventListener("mouseenter", () => focusFlow(row.dataset.flowDriver, true));
    row.addEventListener("mouseleave", () => focusFlow(row.dataset.flowDriver, false));
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

function renderAll({preserveWeightDOM = false} = {}) {
  renderPresets();
  if (preserveWeightDOM) renderWeightValuesOnly();
  else renderWeights();
  renderLineUp();
  renderCode();
  if (!preserveWeightDOM) {
    renderScenarios();
    renderComparison();
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
  state.previousRanks.clear();
  applyPreset("balanced", {render: false});
  if (resetScenarios) initialiseScenarios();
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

function bindEvents() {
  $("#language-select").addEventListener("change", (event) => applyLanguage(event.target.value));
  $("#share-site").addEventListener("click", shareSite);
  $("#reset-weights").addEventListener("click", () => applyPreset("balanced"));
  $("#view-stacked").addEventListener("click", () => setView("stacked"));
  $("#view-table").addEventListener("click", () => setView("table"));
  bindViewport("lineup");
  bindViewport("compare");
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
      $("#lineup-table").querySelector(`[data-detail-driver="${key}"]`)?.classList.toggle("is-open", open);
    }
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
    state.search = event.target.value.trim().toLowerCase();
    renderLineUp();
  });
  $("#compact-toggle").addEventListener("click", (event) => {
    state.compact = !state.compact;
    event.currentTarget.setAttribute("aria-pressed", String(state.compact));
    renderLineUp();
  });
  $("#copy-code").addEventListener("click", copyCode);
  $("#import-code").addEventListener("click", importCode);
  $("#season-select").addEventListener("change", (event) => loadSeason(event.target.value));
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
    renderComparison();
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
