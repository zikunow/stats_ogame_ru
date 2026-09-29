import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  HISTORY_DIR,
  readHistoryIndex,
  readSnapshotStats
} from '../src/data-storage.js';

const index = await readHistoryIndex();
if (!index.latest || !index.snapshots?.length) throw new Error('History index is empty');

let previousStats = {};

for (const snapshotDate of [...index.snapshots].sort()) {
  const directory = resolve(HISTORY_DIR, snapshotDate);
  const meta = JSON.parse(await readFile(resolve(directory, 'meta.json'), 'utf8'));
  const types = meta.highscoreTypes?.map((type) => type.id) || [];
  if (!meta.generatedAt || types.length === 0) throw new Error(`Invalid metadata for ${snapshotDate}`);

  const stats = await readSnapshotStats(snapshotDate, types);
  for (const type of types) {
    if (!Array.isArray(stats[type])) throw new Error(`Invalid ${snapshotDate}/${type}`);
    const previousScores = new Map(
      (previousStats[type] || []).map((row) => [`${row.universeId}:${row.playerId}`, row.score])
    );

    for (const row of stats[type]) {
      const previousScore = previousScores.get(`${row.universeId}:${row.playerId}`);
      const expectedDelta = Number.isFinite(previousScore) ? row.score - previousScore : null;
      if (row.scoreDelta !== expectedDelta) {
        throw new Error(`Invalid score delta for ${snapshotDate}/${type}/${row.universeId}:${row.playerId}`);
      }
    }
  }

  previousStats = stats;
}

const latestMeta = JSON.parse(
  await readFile(resolve(HISTORY_DIR, index.latest, 'meta.json'), 'utf8')
);
const requiredTypes = ['0', '1', '2', '3', '8', 'fleet', 'defense', 'ships'];
const latestStats = await readSnapshotStats(index.latest, requiredTypes);
const scores = Object.fromEntries(requiredTypes.map((type) => [
  type,
  new Map(latestStats[type].map((row) => [`${row.universeId}:${row.playerId}`, row]))
]));

for (const militaryRow of latestStats['3']) {
  const key = `${militaryRow.universeId}:${militaryRow.playerId}`;
  const total = scores['0'].get(key)?.score;
  const economy = scores['1'].get(key)?.score;
  const research = scores['2'].get(key)?.score;
  const lifeforms = scores['8'].get(key)?.score;
  if ([total, economy, research, lifeforms].some((score) => score === undefined)) continue;

  const defense = Math.max(0, economy + research + militaryRow.score + lifeforms - total);
  const fleet = Math.max(0, militaryRow.score - defense);
  if (scores.defense.get(key)?.score !== defense) throw new Error(`Invalid defense for ${key}`);
  if (scores.fleet.get(key)?.score !== fleet) throw new Error(`Invalid fleet for ${key}`);
  if (Number.isFinite(militaryRow.ships) && scores.ships.get(key)?.score !== militaryRow.ships) {
    throw new Error(`Invalid ships for ${key}`);
  }
}

console.log(`Snapshots: ${index.snapshots.length}`);
console.log(`Latest: ${index.latest}`);
console.log(`Universes: ${latestMeta.universes.length}`);
console.log('Data checks passed');
