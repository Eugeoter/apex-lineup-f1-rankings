"""Build driver share of constructor GP points from an F1DB CSV release.

Usage: python scripts/build_team_points_share.py /path/to/f1db-csv.tgz

Only rounds with another starter for the same constructor are comparable. The
site applies a 10-comparable-start minimum when aggregating driver seasons.
"""

import csv
import io
import json
import math
import sys
import tarfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCALE = (25, 18, 15, 12, 10, 8, 6, 4, 2, 1)
FIRST_YEAR = 1958
NOT_STARTED = {"DNS", "DNQ", "DNPQ", "EX", "WD"}
history = json.loads((ROOT / "data/merged_rankable_driver_seasons.json").read_text(encoding="utf-8"))
cutoffs = {int(year): int(rounds) for year, rounds in history["metadata"]["grand_prix_counts"].items()}
known = {(str(row["driver_id"]), int(row["year"])) for row in history["drivers"]}

with tarfile.open(sys.argv[1], "r:gz") as archive:
    stream = io.TextIOWrapper(archive.extractfile("package/data/f1db-races-race-results.csv"), encoding="utf-8")
    rows = [row for row in csv.DictReader(stream)
            if int(row["year"]) >= FIRST_YEAR
            and int(row["year"]) in cutoffs
            and int(row["round"]) <= cutoffs[int(row["year"])]]

winner_laps = {row["raceId"]: int(row["laps"] or 0) for row in rows
               if row["positionNumber"] == "1" and row["positionText"] == "1"}


def current_points(row):
    if not row["positionNumber"].isdigit() or not row["positionText"].isdigit():
        return 0
    position = int(row["positionNumber"])
    if not 1 <= position <= len(SCALE):
        return 0
    retired = row["reasonRetired"].strip()
    laps = int(row["laps"] or 0)
    leader = winner_laps.get(row["raceId"], 0)
    classified = not retired or (leader > 0 and laps >= math.floor(leader * .9))
    if retired.lower() in {"disqualified", "excluded"}:
        classified = False
    return SCALE[position - 1] if classified else 0


groups = defaultdict(list)
for row in rows:
    if (not row["constructorId"] or row["sharedCar"].lower() == "true"
            or row["positionText"] in NOT_STARTED):
        continue
    groups[(int(row["year"]), row["raceId"], row["constructorId"])].append(row)

# Segment values: [constructor id, awarded driver points, awarded constructor
# points, current-scale driver points, current-scale constructor points, starts].
segments = defaultdict(lambda: [0.0, 0.0, 0, 0, 0])
comparable_rounds = 0
for (year, _race_id, constructor), entrants in groups.items():
    if len({row["driverId"] for row in entrants}) < 2:
        continue
    comparable_rounds += 1
    awarded_team = sum(float(row["points"] or 0) for row in entrants)
    current_team = sum(current_points(row) for row in entrants)
    for row in entrants:
        if (row["driverId"], year) not in known:
            continue
        item = segments[(row["driverId"], year, constructor)]
        item[0] += float(row["points"] or 0)
        item[1] += awarded_team
        item[2] += current_points(row)
        item[3] += current_team
        item[4] += 1

by_driver_season = defaultdict(list)
for (driver, year, constructor), values in sorted(segments.items()):
    awarded_driver, awarded_team, current_driver, current_team, starts = values
    by_driver_season[f"{driver}:{year}"].append([
        constructor, round(awarded_driver, 3), round(awarded_team, 3),
        current_driver, current_team, starts
    ])

output = {
    "source": "https://github.com/f1db/f1db/releases/tag/v2026.18.0",
    "method": "GP race-result points within the site's round cutoff, grouped by constructor and by driver-started rounds with at least two distinct starters; shared cars excluded. The current mode uses 25-18-15-12-10-8-6-4-2-1 with the same classification logic as current_points.json. Constructor identity is a proxy for team, especially in early seasons.",
    "first_year": FIRST_YEAR,
    "minimum_comparable_starts": 10,
    "comparable_constructor_rounds": comparable_rounds,
    "by_driver_season": dict(by_driver_season),
}
path = ROOT / "data/team_points_share.json"
path.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{len(by_driver_season)} driver-seasons, {comparable_rounds} comparable constructor-rounds written")
