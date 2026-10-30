"""Build season-level points under the current 25–18–…–1 Grand Prix scale.

Usage: python scripts/build_current_points.py /path/to/f1db-csv.tgz
The input is an official F1DB CSV release. Sprint and fastest-lap points are omitted.
"""
import csv
import io
import json
import math
import sys
import tarfile
from collections import defaultdict
from pathlib import Path

SCALE = (25, 18, 15, 12, 10, 8, 6, 4, 2, 1)
ROOT = Path(__file__).resolve().parents[1]
history = json.loads((ROOT / 'data/merged_rankable_driver_seasons.json').read_text(encoding='utf-8'))
limit = {int(y): int(n) for y, n in history['metadata']['grand_prix_counts'].items()}
keys = {(str(row['driver_id']), int(row['year'])) for row in history['drivers']}

with tarfile.open(sys.argv[1], 'r:gz') as archive:
    stream = io.TextIOWrapper(archive.extractfile('package/data/f1db-races-race-results.csv'), encoding='utf-8')
    results = [row for row in csv.DictReader(stream)
               if int(row['year']) in limit and int(row['round']) <= limit[int(row['year'])]]

winner_laps = {}
for row in results:
    if row['positionNumber'] == '1' and row['positionText'] == '1':
        winner_laps[row['raceId']] = int(row['laps'] or 0)

points = defaultdict(int)
excluded_shared = 0
for row in results:
    key = (row['driverId'], int(row['year']))
    if key not in keys:
        continue
    if row['sharedCar'].lower() == 'true':
        excluded_shared += 1
        continue  # Modern rules have no equivalent for a shared-car drive.
    if not row['positionNumber'].isdigit() or not row['positionText'].isdigit():
        continue
    position = int(row['positionNumber'])
    if not 1 <= position <= len(SCALE):
        continue
    retired = row['reasonRetired'].strip()
    laps = int(row['laps'] or 0)
    leader = winner_laps.get(row['raceId'], 0)
    # A retired driver can still be classified after completing at least 90%
    # of the winner's distance. An explicit disqualification never scores.
    classified = not retired or (leader > 0 and laps >= math.floor(leader * .9))
    if retired.lower() in {'disqualified', 'excluded'}:
        classified = False
    if classified:
        points[key] += SCALE[position - 1]

rows = {f'{driver}:{year}': points[driver, year] for driver, year in sorted(keys)}
output = {
    'source': 'https://github.com/f1db/f1db/releases/tag/v2026.18.0',
    'scale': list(SCALE),
    'method': 'Grand Prix result positions only; no sprint, fastest-lap or shared-car points. '
              'Classified retirements require 90% of winner laps. Each season is cut to the '
              'race count present in the site snapshot.',
    'excluded_shared_car_rows': excluded_shared,
    'points_by_driver_season': rows,
}
path = ROOT / 'data/current_points.json'
path.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f'{len(rows)} driver-seasons written; {excluded_shared} shared-car rows excluded')

