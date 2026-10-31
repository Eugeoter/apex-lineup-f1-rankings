"use strict";

// Find non-negative metric weights whose selected-driver scores follow a chosen order.
window.APEX_INVERSE = (() => {
  let api;
  let selected = [];
  let solution = null;
  let draggedIndex = null;
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

  function keepsOrder(rows, keys, weights) {
    return rows.every((row, index) => index === rows.length - 1 ||
      score(row, keys, weights) > score(rows[index + 1], keys, weights) + 1e-9);
  }

  // Vary one coordinate while preserving the proportions of every other weight.
  // The selected drivers share all these metrics, so their score gaps are linear on this slice.
  function rebalanced(weights, index, value) {
    if (weights.length === 1) return [100];
    const chosenTicks = Math.round(value * 10);
    const remainingTicks = 1000 - chosenTicks;
    const otherTotal = weights.reduce((sum, weight, position) => sum + (position === index ? 0 : weight), 0);
    const shares = weights.map((weight, position) => position === index ? null :
      otherTotal > 1e-10 ? weight / otherTotal : 1 / (weights.length - 1));
    const ticks = shares.map((share) => share === null ? chosenTicks : Math.floor(share * remainingTicks));
    let unassigned = 1000 - ticks.reduce((sum, tick) => sum + tick, 0);
    const order = shares.map((share, position) => ({position, fraction: share === null ? -1 : share * remainingTicks - ticks[position]}))
      .sort((a, b) => b.fraction - a.fraction || a.position - b.position);
    for (let i = 0; i < unassigned; i += 1) ticks[order[i].position] += 1;
    return ticks.map((tick) => tick / 10);
  }

  function feasibleRange(rows, keys, weights, index) {
    if (keys.length === 1) return [100, 100];
    const otherTotal = weights.reduce((sum, weight, position) => sum + (position === index ? 0 : weight), 0);
    let lower = 0;
    let upper = 100;
    const margin = 1e-7;
    for (let rowIndex = 0; rowIndex < rows.length - 1; rowIndex += 1) {
      const gaps = keys.map((key) => Number(rows[rowIndex].normalised[key]) - Number(rows[rowIndex + 1].normalised[key]));
      const other = otherTotal > 1e-10
        ? gaps.reduce((sum, gap, position) => sum + (position === index ? 0 : gap * weights[position]), 0) / otherTotal
        : gaps.reduce((sum, gap, position) => sum + (position === index ? 0 : gap), 0) / (keys.length - 1);
      const slope = gaps[index] - other;
      if (slope > 1e-12) lower = Math.max(lower, (margin - 100 * other) / slope);
      else if (slope < -1e-12) upper = Math.min(upper, (margin - 100 * other) / slope);
      else if (100 * other <= margin) return [weights[index], weights[index]];
    }
    const minimumTick = lower <= 0 ? 0 : Math.ceil((lower + 1e-9) * 10);
    const maximumTick = upper >= 100 ? 1000 : Math.floor((upper - 1e-9) * 10);
    const currentTick = Math.round(weights[index] * 10);
    let minTick = currentTick;
    let maxTick = currentTick;
    for (let tick = currentTick - 1; tick >= minimumTick; tick -= 1) {
      if (!keepsOrder(rows, keys, rebalanced(weights, index, tick / 10))) break;
      minTick = tick;
    }
    for (let tick = currentTick + 1; tick <= maximumTick; tick += 1) {
      if (!keepsOrder(rows, keys, rebalanced(weights, index, tick / 10))) break;
      maxTick = tick;
    }
    return [minTick / 10, maxTick / 10];
  }

  function solveOrder(rows, keys, initialWeights) {
    const gaps = rows.slice(0, -1).map((row, index) => keys.map((key) =>
      Number(row.normalised[key]) - Number(rows[index + 1].normalised[key])
    ));
    const uniform = Array(keys.length).fill(1 / keys.length);
    const starts = [uniform, projectSimplex(initialWeights)];
    keys.forEach((_, index) => starts.push(keys.map((__, j) => Number(index === j))));
    let best = null;
    let bestConcentration = Infinity;
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
        if (minimum > 0) {
          // Move as far as possible toward equal weights while retaining every pairwise order.
          // A small remaining margin protects the order after weights are rounded to 0.1%.
          const floor = Math.min(0.0005, minimum / 2);
          let blend = 1;
          for (const gap of gaps) {
            const current = gap.reduce((sum, value, index) => sum + value * weights[index], 0);
            const equal = gap.reduce((sum, value, index) => sum + value * uniform[index], 0);
            if (equal < floor) blend = Math.min(blend, (current - floor) / (current - equal));
          }
          blend = Math.max(0, Math.min(1, blend - 0.001));
          const spread = weights.map((value, index) => (1 - blend) * value + blend * uniform[index]);
          const rounded = spread.map((value) => Math.round(value * 1000) / 10);
          const ordered = keepsOrder(rows, keys, rounded);
          if (ordered) {
            const total = rounded.reduce((sum, value) => sum + value, 0);
            const concentration = rounded.reduce((sum, value) => sum + (value / total) ** 2, 0);
            if (concentration < bestConcentration) { best = rounded; bestConcentration = concentration; }
          }
        }
        if (minimum >= 0.002 || !changed) break;
      }
    }
    return best;
  }

  function availableDrivers() {
    return api.state.dataset?.drivers || [];
  }

  function selectedRows() {
    const byId = new Map(availableDrivers().map((row) => [api.driverKey(row), row]));
    return selected.map((id) => byId.get(id)).filter(Boolean);
  }

  function matchingDrivers() {
    const query = $("#inverse-search").value.trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const options = availableDrivers().filter((row) => !selected.includes(api.driverKey(row)) &&
      row.full_name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(query))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
    return {query, options};
  }

  function closeSuggestions() {
    $("#inverse-suggestions").hidden = true;
    $("#inverse-search").setAttribute("aria-expanded", "false");
  }

  function renderSuggestions() {
    const list = $("#inverse-suggestions");
    if (list.hidden) return;
    const {options} = matchingDrivers();
    list.innerHTML = options.length
      ? options.slice(0, 12).map((row) => `<button type="button" role="option" data-inverse-suggestion="${api.escapeHTML(api.driverKey(row))}">${api.escapeHTML(row.full_name)}</button>`).join("")
      : `<p>${api.escapeHTML(api.t("inverseNoResults"))}</p>`;
  }

  function openSuggestions() {
    if ($("#inverse-search").disabled) return;
    $("#inverse-suggestions").hidden = false;
    $("#inverse-search").setAttribute("aria-expanded", "true");
    renderSuggestions();
  }

  function renderPicker() {
    const {query, options} = matchingDrivers();
    const picker = $("#inverse-driver");
    const previous = picker.value;
    picker.innerHTML = `<option value="">${api.escapeHTML(api.t(options.length ? "inverseSelect" : "inverseNoResults"))}</option>` +
      options.map((row) => `<option value="${api.escapeHTML(api.driverKey(row))}">${api.escapeHTML(row.full_name)}</option>`).join("");
    if (options.some((row) => api.driverKey(row) === previous)) picker.value = previous;
    else if (query && options.length === 1) picker.value = api.driverKey(options[0]);
    $("#inverse-search").disabled = selected.length >= 10;
    if (selected.length >= 10) closeSuggestions();
    picker.disabled = selected.length >= 10 || !options.length;
    $("#inverse-add").disabled = selected.length >= 10 || !options.length;
    $("#inverse-solve").disabled = selected.length < 2;
  }

  function renderList() {
    const rows = selectedRows();
    $("#inverse-list").innerHTML = rows.map((row, index) => `<li draggable="true" data-inverse-index="${index}"><span class="inverse-grip" aria-hidden="true">⋮⋮</span><span class="inverse-rank">${index + 1}</span><span class="inverse-name">${api.escapeHTML(row.full_name)}<small>${api.escapeHTML(api.t("inverseStarts", {count: row.race_starts || 0}))}</small></span><div class="inverse-actions"><button type="button" data-inverse-action="up" data-index="${index}" ${index === 0 ? "disabled" : ""} aria-label="${api.escapeHTML(api.t("inverseMoveUp", {name: row.full_name}))}">↑</button><button type="button" data-inverse-action="down" data-index="${index}" ${index === rows.length - 1 ? "disabled" : ""} aria-label="${api.escapeHTML(api.t("inverseMoveDown", {name: row.full_name}))}">↓</button><button type="button" data-inverse-action="remove" data-index="${index}" aria-label="${api.escapeHTML(api.t("inverseRemove", {name: row.full_name}))}">×</button></div></li>`).join("");
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
    target.innerHTML = `<p class="inverse-success">${api.escapeHTML(api.t("inverseMatched"))}</p><p class="inverse-hint">${api.escapeHTML(api.t("inverseExploreHint"))}</p><div class="inverse-weight-list">${solution.keys.map((key) => `<div class="inverse-weight-row" data-inverse-key="${api.escapeHTML(key)}"><label for="inverse-weight-${api.escapeHTML(key)}">${api.escapeHTML(api.metricName(key))}</label><strong class="inverse-weight-value"></strong><div class="inverse-feasible-track" aria-hidden="true"><i></i><b></b></div><input id="inverse-weight-${api.escapeHTML(key)}" type="range" step="0.1" data-inverse-weight="${api.escapeHTML(key)}" aria-label="${api.escapeHTML(api.t("inverseWeightAria", {name: api.metricName(key)}))}"><small class="inverse-weight-range"></small></div>`).join("")}</div><p class="inverse-hint">${api.escapeHTML(api.t("inverseNotUnique"))}</p><button class="button primary" id="inverse-apply" type="button">${api.escapeHTML(api.t("inverseApply"))}</button>`;
    refreshWeightControls();
  }

  function refreshWeightControls() {
    if (!solution?.success) return;
    const weights = solution.keys.map((key) => solution.weights[key]);
    const controls = new Map([...$("#inverse-result").querySelectorAll(".inverse-weight-row")].map((row) => [row.dataset.inverseKey, row]));
    solution.keys.forEach((key, index) => {
      const row = controls.get(key);
      if (!row) return;
      const [min, max] = feasibleRange(solution.rows, solution.keys, weights, index);
      const slider = row.querySelector("input");
      slider.min = String(min);
      slider.max = String(max);
      slider.value = String(weights[index]);
      slider.disabled = min === max;
      row.querySelector(".inverse-weight-value").textContent = `${weights[index].toFixed(1)}%`;
      row.querySelector(".inverse-weight-range").textContent = api.t("inverseFeasibleRange", {min: min.toFixed(1), max: max.toFixed(1)});
      const track = row.querySelector(".inverse-feasible-track");
      track.style.setProperty("--low", `${min}%`);
      track.style.setProperty("--width", `${Math.max(0, max - min)}%`);
      track.style.setProperty("--current", `${weights[index]}%`);
    });
  }

  function render() {
    if (!api) return;
    renderPicker();
    renderSuggestions();
    renderList();
    renderResult();
  }

  function invalidate() { solution = null; renderResult(); }

  function reset() {
    selected = [];
    solution = null;
    draggedIndex = null;
    $("#inverse-search").value = "";
    closeSuggestions();
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
    const exact = found.map((weight) => weight * 100 / found.reduce((sum, value) => sum + value, 0));
    const quantized = keys.map((_, index) => rebalanced(exact, index, Math.round(exact[index] * 10) / 10))
      .find((candidate) => keepsOrder(rows, keys, candidate));
    if (!quantized) { solution = {success: false, reason: "inverseNoMatch"}; renderResult(); return; }
    keys.forEach((key, index) => { weights[key] = quantized[index]; });
    const ranked = api.rankDrivers(weights, Object.fromEntries(api.state.dataset.metrics.map((metric) => [metric.key, true])));
    const places = new Map(ranked.map((row, index) => [api.driverKey(row), index]));
    if (!selected.every((id, index) => index === selected.length - 1 || places.get(id) < places.get(selected[index + 1]))) {
      solution = {success: false, reason: "inverseNoMatch"};
    } else solution = {success: true, weights, keys, rows};
    renderResult();
  }

  function orderChanged() {
    solution = null;
    render();
    if (selected.length >= 2) solve();
  }

  function clearDragStyles() {
    $("#inverse-list").querySelectorAll("li").forEach((row) =>
      row.classList.remove("is-dragging", "drop-before", "drop-after")
    );
  }

  function clearDropStyles() {
    $("#inverse-list").querySelectorAll("li").forEach((row) =>
      row.classList.remove("drop-before", "drop-after")
    );
  }

  function init(context) {
    api = context;
    $("#inverse-search").addEventListener("focus", openSuggestions);
    $("#inverse-search").addEventListener("click", openSuggestions);
    $("#inverse-search").addEventListener("input", () => { renderPicker(); openSuggestions(); });
    $("#inverse-search").addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeSuggestions();
      if (event.key === "ArrowDown") {
        openSuggestions();
        $("#inverse-suggestions button")?.focus();
        event.preventDefault();
      }
      if (event.key === "Enter" && !$("#inverse-suggestions").hidden) {
        $("#inverse-suggestions button")?.click();
        event.preventDefault();
      }
    });
    $("#inverse-suggestions").addEventListener("click", (event) => {
      const button = event.target.closest("[data-inverse-suggestion]");
      if (!button) return;
      const row = availableDrivers().find((item) => api.driverKey(item) === button.dataset.inverseSuggestion);
      if (!row) return;
      $("#inverse-search").value = row.full_name;
      renderPicker();
      $("#inverse-driver").value = api.driverKey(row);
      closeSuggestions();
    });
    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".inverse-search-wrap")) closeSuggestions();
    });
    $("#inverse-add").addEventListener("click", () => {
      const id = $("#inverse-driver").value;
      if (!id || selected.includes(id) || selected.length >= 10) return;
      selected.push(id);
      $("#inverse-search").value = "";
      closeSuggestions();
      orderChanged();
    });
    $("#inverse-list").addEventListener("dragstart", (event) => {
      const row = event.target.closest("li[data-inverse-index]");
      if (!row) return;
      draggedIndex = Number(row.dataset.inverseIndex);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(draggedIndex));
      row.classList.add("is-dragging");
    });
    $("#inverse-list").addEventListener("dragover", (event) => {
      if (draggedIndex === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      clearDropStyles();
      const row = event.target.closest("li[data-inverse-index]");
      if (!row) return;
      row.classList.add(event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2 ? "drop-after" : "drop-before");
    });
    $("#inverse-list").addEventListener("drop", (event) => {
      if (draggedIndex === null) return;
      event.preventDefault();
      const row = event.target.closest("li[data-inverse-index]");
      const target = row ? Number(row.dataset.inverseIndex) + Number(event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2) : selected.length;
      const insertion = target - Number(draggedIndex < target);
      const from = draggedIndex;
      draggedIndex = null;
      clearDragStyles();
      if (from === insertion) return;
      const [driver] = selected.splice(from, 1);
      selected.splice(insertion, 0, driver);
      orderChanged();
    });
    $("#inverse-list").addEventListener("dragend", () => {
      draggedIndex = null;
      clearDragStyles();
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
      orderChanged();
    });
    $("#inverse-solve").addEventListener("click", solve);
    $("#inverse-result").addEventListener("input", (event) => {
      const slider = event.target.closest("[data-inverse-weight]");
      if (!slider || !solution?.success) return;
      const index = solution.keys.indexOf(slider.dataset.inverseWeight);
      if (index < 0) return;
      const current = solution.keys.map((key) => solution.weights[key]);
      const next = rebalanced(current, index, Number(slider.value));
      if (!keepsOrder(solution.rows, solution.keys, next)) { slider.value = String(current[index]); return; }
      solution.keys.forEach((key, position) => { solution.weights[key] = next[position]; });
      refreshWeightControls();
    });
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

  return {init, render, reset, invalidate, solveOrder, rebalanced, feasibleRange};
})();
