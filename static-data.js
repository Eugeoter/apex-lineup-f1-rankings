"use strict";

// Browser-side data engine used by the public, buildless edition of Apex LineUp.
// The local Python app remains the preferred data source; app.js falls back to
// this module when the /api routes are unavailable on static hosting.
(function initialiseStaticDataEngine() {
  const MODERN_START_YEAR = 2023;
  const HISTORICAL_METRIC_KEYS = new Set([
    "championship_points",
    "points_per_start",
    "wins",
    "win_rate",
    "podiums",
    "pole_positions",
    "podium_rate",
    "average_finish_position",
    "average_qualifying_position",
    "average_positions_gained",
    "finish_rate"
  ]);
  const DATA_FILES = {
    history: "./data/merged_rankable_driver_seasons.json",
    profiles: "./data/driver_profiles.json",
    schema: "./data/metric_schema.json?v=3",
    poles: "./data/pole_positions.json",
    quality: "./data/quality_report.json",
    historicalQuality: "./data/historical_quality_report.json"
  };

  let resourcesPromise = null;

  async function readJson(url) {
    const response = await fetch(url, {cache: "force-cache"});
    if (!response.ok) throw new Error(`Static dataset unavailable: ${url}`);
    return response.json();
  }

  function resources() {
    if (!resourcesPromise) {
      resourcesPromise = Promise.all([
        readJson(DATA_FILES.history),
        readJson(DATA_FILES.profiles),
        readJson(DATA_FILES.schema),
        readJson(DATA_FILES.quality),
        readJson(DATA_FILES.historicalQuality),
        readJson(DATA_FILES.poles)
      ]).then(([history, profiles, schema, quality, historicalQuality, poles]) => ({
        history,
        profiles: profiles?.drivers || {},
        schema: schema?.metrics || [],
        poles: poles?.poles_by_driver_season || {},
        quality,
        historicalQuality
      }));
    }
    return resourcesPromise;
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function round(value, digits) {
    if (value === null || value === undefined) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function driverIdentity(driver) {
    const stable = driver.f1db_driver_id || driver.driver_id;
    if (stable) return String(stable);
    return String(driver.full_name || `${driver.first_name || ""} ${driver.last_name || ""}`)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function weightedAverage(rows, field, weightField) {
    const valid = rows
      .map((row) => [numberOrNull(row[field]), numberOrNull(row[weightField])])
      .filter(([value, weight]) => value !== null && weight !== null && weight > 0);
    if (!valid.length) return null;
    const totalWeight = valid.reduce((total, [, weight]) => total + weight, 0);
    return round(valid.reduce((total, [value, weight]) => total + value * weight, 0) / totalWeight, 5);
  }

  function mergeDriverHistory(rows, selection) {
    const latest = [...rows].sort((a, b) =>
      (Number(b.year || 0) - Number(a.year || 0)) ||
      (Number(b.race_entries || 0) - Number(a.race_entries || 0)) ||
      (Number(b.driver_number || 0) - Number(a.driver_number || 0))
    )[0];
    const result = {...latest};
    delete result.normalised;
    const careerYears = rows.map((row) => Number(row.year)).filter(Number.isFinite);
    result.first_year = careerYears.length ? Math.min(...careerYears) : null;
    result.last_year = careerYears.length ? Math.max(...careerYears) : null;
    const additive = [
      "race_entries", "race_starts", "sprint_entries", "sprint_starts", "total_laps",
      "wins", "podiums", "pole_positions", "sprint_wins", "sprint_podiums", "dnf_count", "dns_count",
      "dsq_count", "overtakes", "overtaken"
    ];
    additive.forEach((field) => {
      result[field] = rows.reduce((total, row) => total + Math.trunc(numberOrNull(row[field]) || 0), 0);
    });

    const byYear = new Map();
    rows.forEach((row) => {
      const year = Number(row.year);
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(row);
    });
    const points = [...byYear.values()].map((yearRows) =>
      Math.max(...yearRows.map((row) => numberOrNull(row.championship_points) || 0))
    );
    result.championship_points = points.length ? round(points.reduce((total, value) => total + value, 0), 3) : null;
    const starts = result.race_starts;
    const totalStarts = starts + result.sprint_starts;
    result.points_per_start = starts ? round(result.championship_points / starts, 4) : null;
    result.win_rate = starts ? round(result.wins / starts, 5) : null;
    result.podium_rate = starts ? round(result.podiums / starts, 5) : null;
    result.net_overtakes = result.overtakes - result.overtaken;
    result.overtakes_per_start = totalStarts ? round(result.overtakes / totalStarts, 4) : null;
    result.net_overtakes_per_start = totalStarts ? round(result.net_overtakes / totalStarts, 4) : null;
    ["average_finish_position", "average_grid_position", "average_positions_gained", "finish_rate", "race_pace_score"]
      .forEach((field) => { result[field] = weightedAverage(rows, field, "race_starts"); });
    result.average_qualifying_position = weightedAverage(rows, "average_qualifying_position", "race_entries");
    ["average_sprint_grid_position", "average_sprint_qualifying_position", "average_sprint_finish_position"]
      .forEach((field) => { result[field] = weightedAverage(rows, field, "sprint_entries"); });
    ["lap_time_cv", "lap_consistency_score"]
      .forEach((field) => { result[field] = weightedAverage(rows, field, "total_laps"); });
    const finishes = rows.map((row) => numberOrNull(row.best_finish_position)).filter((value) => value !== null);
    result.best_finish_position = finishes.length ? Math.min(...finishes) : null;
    const championshipPositions = rows
      .map((row) => numberOrNull(row.championship_position))
      .filter((value) => value !== null);
    result.championship_position = selection === "all" || !championshipPositions.length
      ? null
      : Math.min(...championshipPositions);
    result.year = selection;
    return result;
  }

  function normaliseLineup(rows, metrics) {
    rows.forEach((row) => { row.normalised = {}; });
    metrics.forEach((metric) => {
      const values = rows.map((row) => numberOrNull(row[metric.key]));
      const clean = values.filter((value) => value !== null);
      const low = clean.length ? Math.min(...clean) : null;
      const high = clean.length ? Math.max(...clean) : null;
      rows.forEach((row, index) => {
        const value = values[index];
        let scaled = null;
        if (value !== null && low !== null) {
          scaled = low === high ? 1 : (value - low) / (high - low);
          if (!metric.higher_is_better) scaled = 1 - scaled;
        }
        row.normalised[metric.key] = scaled === null ? null : round(scaled, 6);
      });
    });
  }

  function availableYears(history) {
    return [...new Set((history.drivers || []).map((row) => Number(row.year)).filter(Number.isFinite))]
      .sort((a, b) => b - a);
  }

  function resolveSelection(selection, years) {
    if (selection === "all") return years;
    if (selection === "modern") return years.filter((year) => year >= MODERN_START_YEAR);
    const range = String(selection).match(/^(\d{4})-(\d{4})$/);
    if (range) {
      const [start, end] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b);
      return years.filter((year) => year >= start && year <= end);
    }
    const year = Number(selection);
    return years.includes(year) ? [year] : [];
  }

  function qualitySummary(data) {
    const outputs = data.historicalQuality?.outputs || {};
    const f1db = data.historicalQuality?.f1db || {};
    return {
      ok: Boolean(data.quality?.ok) && Boolean(outputs.rankable_unique_drivers),
      coverage_percent: outputs.rankable_unique_drivers ? 100 : data.quality?.coverage_percent,
      selected_sessions: data.quality?.selected_sessions,
      complete_files: data.quality?.complete_files,
      expected_files: data.quality?.expected_files,
      missing_files: (data.quality?.missing_files || []).length,
      empty_optional_files: (data.quality?.empty_optional_files || []).length,
      checked_at: data.quality?.checked_at,
      historical_years: f1db.max_year && f1db.min_year ? Number(f1db.max_year) - Number(f1db.min_year) + 1 : 0,
      historical_drivers: outputs.rankable_unique_drivers,
      historical_rows: outputs.rankable_rows
    };
  }

  async function metadata() {
    const data = await resources();
    const years = availableYears(data.history);
    const rows = data.history.drivers || [];
    const grandPrixCounts = data.history.metadata?.grand_prix_counts || {};
    const seasons = years.map((year) => {
      const drivers = rows.filter((row) => Number(row.year) === year);
      const entries = drivers.map((driver) => numberOrNull(driver.race_entries)).filter((value) => value !== null);
      return {
        year,
        drivers: new Set(drivers.map(driverIdentity)).size,
        grand_prix_count: Number(grandPrixCounts[String(year)] || (entries.length ? Math.max(...entries) : 0))
      };
    });
    const modernYears = new Set(years.filter((year) => year >= MODERN_START_YEAR));
    seasons.unshift(
      {
        year: "all",
        drivers: new Set(rows.map(driverIdentity)).size,
        grand_prix_count: seasons.reduce((total, season) => total + season.grand_prix_count, 0)
      },
      {
        year: "modern",
        drivers: new Set(rows.filter((row) => modernYears.has(Number(row.year))).map(driverIdentity)).size,
        grand_prix_count: seasons.filter((season) => modernYears.has(season.year)).reduce((total, season) => total + season.grand_prix_count, 0)
      }
    );
    return {
      seasons,
      default_year: years.length ? "all" : null,
      quality: qualitySummary(data),
      source: "F1DB + Jolpica validation + OpenF1"
    };
  }

  async function lineup(selection) {
    const data = await resources();
    const years = availableYears(data.history);
    const selected = resolveSelection(selection, years);
    if (!selected.length) throw new Error(`Season dataset not found: ${selection}`);
    const selectedSet = new Set(selected);
    const sourceRows = (data.history.drivers || []).filter((row) => selectedSet.has(Number(row.year)))
      .map((row) => ({...row, pole_positions: data.poles[`${row.driver_id}:${row.year}`] ?? 0}));
    const labels = new Map(data.schema.map((metric) => [metric.key, metric.label]));
    let metrics = (data.history.metrics || [])
      .filter((metric) => metric.key)
      .map((metric) => ({...metric, label: metric.label || labels.get(metric.key) || metric.key}));
    metrics.splice(metrics.findIndex((metric) => metric.key === "podium_rate"), 0,
      {key: "win_rate", label: labels.get("win_rate") || "Grand Prix win rate", higher_is_better: true},
      {key: "podiums", label: labels.get("podiums") || "Grand Prix podiums", higher_is_better: true},
      {key: "pole_positions", label: labels.get("pole_positions") || "Grand Prix pole positions", higher_is_better: true});
    if (Math.min(...selected) < MODERN_START_YEAR) {
      metrics = metrics.filter((metric) => HISTORICAL_METRIC_KEYS.has(metric.key));
    }
    const grouped = new Map();
    sourceRows.forEach((driver) => {
      const identity = driverIdentity(driver);
      if (!grouped.has(identity)) grouped.set(identity, []);
      grouped.get(identity).push(driver);
    });
    const rows = [...grouped.entries()].map(([identity, history]) => {
      const row = history.length > 1 ? mergeDriverHistory(history, selection) : {...history[0]};
      row.driver_id = identity;
      row.win_rate = Number(row.race_starts) > 0 ? round(Number(row.wins || 0) / Number(row.race_starts), 5) : null;
      if (!Number.isFinite(Number(row.first_year))) row.first_year = Number(row.year) || null;
      if (!Number.isFinite(Number(row.last_year))) row.last_year = Number(row.year) || null;
      return row;
    });
    normaliseLineup(rows, metrics);
    rows.forEach((row) => {
      const profile = {...(data.profiles[String(row.driver_id)] || data.profiles[String(row.full_name || "").toLowerCase()] || {})};
      if (!profile.profile_url && row.profile_url) profile.profile_url = row.profile_url;
      row.profile = profile;
    });
    rows.sort((a, b) =>
      (Number(a.championship_position || 999) - Number(b.championship_position || 999)) ||
      String(a.full_name || "").localeCompare(String(b.full_name || ""))
    );
    const grandPrixCounts = data.history.metadata?.grand_prix_counts || {};
    return {
      year: selection,
      mode: selection === "all" || Math.min(...selected) < MODERN_START_YEAR ? "historical" : "modern",
      period_label: selected.length > 1 ? `${Math.min(...selected)}–${Math.max(...selected)}` : String(selected[0]),
      years: [...selected].sort((a, b) => a - b),
      grand_prix_count: selected.reduce((total, year) => total + Number(grandPrixCounts[String(year)] || 0), 0),
      metrics,
      drivers: rows,
      quality: qualitySummary(data)
    };
  }

  window.APEX_STATIC_DATA = {metadata, lineup};
})();
