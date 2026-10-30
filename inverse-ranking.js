"use strict";

// Find non-negative metric weights whose selected-driver scores follow a chosen order.
window.APEX_INVERSE = (() => {
  let api;
  let selected = [];
  let solution = null;
  const $ = (selector) => document.querySelector(selector);

  function projectSimplex(values) {
    const sorted = [...values].sort((a, b) => b - a);
    let sum = 0;
    let threshold = 0;
    for (let i = 0; i < sorted.length; i += 1) {
      sum += sorted[i];
      const candidate = (sum - 1) / (i + 1);
      if (sorted[i] > candidate) threshold = candidate;
    }
    return values.map((value) => Math.max(0, value - threshold));
  }

  function score(row, keys, weights) {
    let weighted = 0;
    let total = 0;
    keys.forEach((key, index) => {
      const weight = weights[index];
      weighted += Number(row.normalised[key]) * weight;
      total += weight;
    });
    return total ? weighted / total : 0;
  }

  function solveOrder(rows, keys, initialWeights) {
    const gaps = rows.slice(0, -1).map((row, index) => keys.map((key) =>
      Number(row.normalised[key]) - Number(rows[index + 1].normalised[key])
    ));
    const starts = [projectSimplex(initialWeights), Array(keys.length).fill(1 / keys.length)];
    keys.forEach((_, index) => starts.push(keys.map((__, j) => Number(index === j))));
    let best = null;
    let bestMargin = -Infinity;
    for (const start of starts) {
      let weights = [...start];
      for (let pass = 0; pass < 2500; pass += 1) {
        let changed = false;
        for (const gap of gaps) {
          const margin = gap.reduce((sum, value, index) => sum + value * weights[index], 0);
          if (margin >= 0.002) continue;
          const length = gap.reduce((sum, value) => sum + value * value, 0);
          if (length < 1e-12) continue;
          const step = (0.002 - margin) / length;
          weights = projectSimplex(weights.map((value, index) => value + step * gap[index]));
          changed = true;
        }
        const minimum = Math.min(...gaps.map((gap) => gap.reduce((sum, value, index) => sum + value * weights[index], 0)));
        if (minimum > bestMargin) { best = [...weights]; bestMargin = minimum; }
        if (minimum >= 0.002 || !changed) break;
      }
      if (bestMargin >= 0.002) break;
    }
    if (!best) return null;
    const rounded = best.map((value) => Math.round(value * 1000) / 10);
    const ordered = rows.every((row, index) => index === rows.length - 1 ||
      score(row, keys, rounded) > score(rows[index + 1], keys, rounded) + 1e-9);
    return ordered ? rounded : null;
  }

  function availableDrivers() {
    return api.state.dataset?.drivers || [];
  }

  function selectedRows() {
    const byId = new Map(availableDrivers().map((row) => [api.driverKey(row), row]));
    return selected.map((id) => byId.get(id)).filter(Boolean);
  }

  function renderPicker() {
    const options = availableDrivers().filter((row) => !selected.includes(api.driverKey(row)))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
    const picker = $("#inverse-driver");
    const previous = picker.value;
    picker.innerHTML = `<option value="">${api.escapeHTML(api.t("inverseSelect"))}</option>` +
      options.map((row) => `<option value="${api.escapeHTML(api.driverKey(row))}">${api.escapeHTML(row.full_name)}</option>`).join("");
    if (options.some((row) => api.driverKey(row) === previous)) picker.value = previous;
    $("#inverse-add").disabled = selected.length >= 10 || !options.length;
    $("#inverse-solve").disabled = selected.length < 2;
  }

  function renderList() {
    const rows = selectedRows();
    $("#inverse-list").innerHTML = rows.map((row, index) => `<li><span class="inverse-rank">${index + 1}</span><span class="inverse-name">${api.escapeHTML(row.full_name)}<small>${api.escapeHTML(api.t("inverseStarts", {count: row.race_starts || 0}))}</small></span><div class="inverse-actions"><button type="button" data-inverse-action="up" data-index="${index}" ${index === 0 ? "disabled" : ""} aria-label="${api.escapeHTML(api.t("inverseMoveUp", {name: row.full_name}))}">↑</button><button type="button" data-inverse-action="down" data-index="${index}" ${index === rows.length - 1 ? "disabled" : ""} aria-label="${api.escapeHTML(api.t("inverseMoveDown", {name: row.full_name}))}">↓</button><button type="button" data-inverse-action="remove" data-index="${index}" aria-label="${api.escapeHTML(api.t("inverseRemove", {name: row.full_name}))}">×</button></div></li>`).join("");
  }

  function renderResult() {
    const target = $("#inverse-result");
    if (!solution) {
      target.innerHTML = `<p class="inverse-empty">${api.escapeHTML(api.t(selected.length < 2 ? "inverseNeedTwo" : "inverseReady"))}</p>`;
      return;
    }
    if (!solution.success) {
      target.innerHTML = `<p class="inverse-empty">${api.escapeHTML(api.t(solution.reason))}</p>`;
      return;
    }
    const weights = Object.entries(solution.weights).filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]);
    target.innerHTML = `<p class="inverse-success">${api.escapeHTML(api.t("inverseMatched"))}</p><div class="inverse-weight-list">${weights.map(([key, weight]) => `<div><span>${api.escapeHTML(api.metricName(key))}</span><i><b style="width:${weight}%"></b></i><strong>${weight.toFixed(1)}%</strong></div>`).join("")}</div><p class="inverse-hint">${api.escapeHTML(api.t("inverseNotUnique"))}</p><button class="button primary" id="inverse-apply" type="button">${api.escapeHTML(api.t("inverseApply"))}</button>`;
  }

  function render() {
    if (!api) return;
    renderPicker();
    renderList();
    renderResult();
  }

  function invalidate() { solution = null; renderResult(); }

  function reset() {
    selected = [];
    solution = null;
    render();
  }

  function solve() {
    const rows = selectedRows();
    if (rows.length < 2 || rows.length > 10) return;
    const keys = api.state.dataset.metrics.map((metric) => metric.key).filter((key) =>
      rows.every((row) => Number.isFinite(row.normalised?.[key]))
    );
    if (!keys.length) { solution = {success: false, reason: "inverseNoCommon"}; renderResult(); return; }
    const total = keys.reduce((sum, key) => sum + (api.state.enabled[key] === false ? 0 : Number(api.state.weights[key] || 0)), 0);
    const initial = keys.map((key) => total ? (api.state.enabled[key] === false ? 0 : Number(api.state.weights[key] || 0)) / total : 1 / keys.length);
    const found = solveOrder(rows, keys, initial);
    if (!found) { solution = {success: false, reason: "inverseNoMatch"}; renderResult(); return; }
    const weights = Object.fromEntries(api.state.dataset.metrics.map((metric) => [metric.key, 0]));
    keys.forEach((key, index) => { weights[key] = found[index]; });
    const ranked = api.rankDrivers(weights, Object.fromEntries(api.state.dataset.metrics.map((metric) => [metric.key, true])));
    const places = new Map(ranked.map((row, index) => [api.driverKey(row), index]));
    if (!selected.every((id, index) => index === selected.length - 1 || places.get(id) < places.get(selected[index + 1]))) {
      solution = {success: false, reason: "inverseNoMatch"};
    } else solution = {success: true, weights};
    renderResult();
  }

  function init(context) {
    api = context;
    $("#inverse-add").addEventListener("click", () => {
      const id = $("#inverse-driver").value;
      if (!id || selected.includes(id) || selected.length >= 10) return;
      selected.push(id);
      solution = null;
      render();
    });
    $("#inverse-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-inverse-action]");
      if (!button) return;
      const index = Number(button.dataset.index);
      if (button.dataset.inverseAction === "remove") selected.splice(index, 1);
      else {
        const other = index + (button.dataset.inverseAction === "up" ? -1 : 1);
        if (other < 0 || other >= selected.length) return;
        [selected[index], selected[other]] = [selected[other], selected[index]];
      }
      solution = null;
      render();
    });
    $("#inverse-solve").addEventListener("click", solve);
    $("#inverse-result").addEventListener("click", (event) => {
      if (!event.target.closest("#inverse-apply") || !solution?.success) return;
      api.state.weights = {...solution.weights};
      api.state.enabled = Object.fromEntries(api.state.dataset.metrics.map((metric) => [metric.key, true]));
      api.state.activePreset = null;
      api.renderAll();
      $("#lineup").scrollIntoView({behavior: "smooth", block: "start"});
    });
    render();
  }

  return {init, render, reset, invalidate, solveOrder};
})();
