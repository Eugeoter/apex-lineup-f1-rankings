# Apex LineUp — F1 Driver Ranking Lab

An interactive Formula 1 driver ranking tool. Explore how the order changes when you choose a season or year range, adjust the importance of different performance metrics, and compare multiple ranking setups side by side.

## Features

- Rank drivers using 13 adjustable metrics, including wins, win rate (wins divided by Grand Prix starts), podium rate, qualifying position, race pace, and consistency.
- Use presets or set your own metric weights.
- Switch between historical championship points and points recalculated under today's Grand Prix scale.
- Filter by season, year range, team, nationality, era, and minimum starts.
- Choose and order 2–10 drivers, then find metric weights that reproduce that order when possible.
- Save up to six ranking setups for side-by-side comparison and share weights with a code.
- Switch between English, 简体中文, 日本語, Français, 한국어, and हिन्दी.

## Run locally

This is a static website with no build step. Serve the repository directory with a local web server, then open the address it prints:

```bash
python -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000). Opening `index.html` directly as a file may prevent the browser from loading the JSON data.

## Data and interpretation

The bundled data combines historical F1DB records with OpenF1 data for recent seasons. The ranking view normalizes metrics and applies the selected weights; changing the metrics or time range can change the result. Some telemetry-based metrics are unavailable for older seasons, so cross-era comparisons should be read with the displayed data coverage in mind.

Data and field definitions are in `data/`, including `metric_schema.json` and the quality reports. F1DB: https://github.com/f1db/f1db · OpenF1: https://openf1.org

The **Current-rules points** switch applies 25–18–15–12–10–8–6–4–2–1 to each eligible Grand Prix result, then updates total points and points per start. Sprint and fastest-lap points are excluded, as are historical shared-car drives. Results after the site's existing race cutoff are ignored. The source is [F1DB v2026.18.0](https://github.com/f1db/f1db/releases/tag/v2026.18.0); `data/current_points.json` is generated from its CSV archive by `scripts/build_current_points.py`. This changes the scoring scale, but does not equalize car performance, reliability, or the number of races.

This project is an exploratory visualization, not an official Formula 1 ranking.
