"""Build driver-season Grand Prix pole counts from an F1DB CSV release.

Usage: python scripts/build_pole_positions.py /path/to/f1db-csv.tgz
Sprint qualifying poles are not included. Each year uses the race cutoff in
the site's bundled season snapshot.
"""
import csv
import io
import json
import sys
import tarfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
history = json.loads((ROOT / 'data/merged_rankable_driver_seasons.json').read_text(encoding='utf-8'))
cutoff = {int(year): int(count) for year, count in history['metadata']['grand_prix_counts'].items()}
keys = {(str(row['driver_id']), int(row['year'])) for row in history['drivers']}

poles = defaultdict(int)
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    source = archive.extractfile('package/data/f1db-races-race-results.csv')
    rows = csv.DictReader(io.TextIOWrapper(source, encoding='utf-8'))
    for row in rows:
        year = int(row['year'])
        key = (row['driverId'], year)
        if key in keys and int(row['round']) <= cutoff[year] and row['polePosition'].lower() == 'true':
            poles[key] += 1

output = {
    'source': 'https://github.com/f1db/f1db/releases/tag/v2026.18.0',
    'method': 'Grand Prix polePosition flag in F1DB race results; sprint qualifying poles excluded. '
              'Each year stops at the race count in the site snapshot.',
    'poles_by_driver_season': {f'{driver}:{year}': poles[driver, year] for driver, year in sorted(keys)},
}
path = ROOT / 'data/pole_positions.json'
path.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f'{len(keys)} driver-seasons written; {sum(poles.values())} Grand Prix poles')
