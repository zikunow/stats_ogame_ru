import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  HISTORY_DIR,
  readHistoryIndex,
  readSnapshotStats
} from '../src/data-storage.js';
import { REPORTS_DIR } from '../src/reports.js';

function validateScoreBreakdowns(rows, snapshotDate, requireAll) {
  for (const row of rows) {
    const key = `${row.universeId}:${row.playerId}`;
    const breakdown = row.scoreBreakdown;
    if (!breakdown) {
      if (requireAll) throw new Error(`Missing score breakdown for ${snapshotDate}/${key}`);
      continue;
    }

    const breakdownTotal = breakdown.economy.score
      + breakdown.research.score
      + breakdown.military.score
      + breakdown.lifeforms.score;
    if (breakdownTotal !== row.score) {
      throw new Error(`Invalid score breakdown total for ${snapshotDate}/${key}`);
    }
    if (breakdown.military.fleet + breakdown.military.defense !== breakdown.military.score) {
      throw new Error(`Invalid military breakdown for ${snapshotDate}/${key}`);
    }
    if (
      breakdown.lifeforms.buildings
        + breakdown.lifeforms.technologies
        + breakdown.lifeforms.artifacts
      !== breakdown.lifeforms.score
    ) {
      throw new Error(`Invalid lifeform breakdown for ${snapshotDate}/${key}`);
    }
  }
}

const index = await readHistoryIndex();
if (!index.latest || !index.snapshots?.length) throw new Error('History index is empty');

let previousStats = {};
const observedUniverseFirstSnapshots = {};

for (const snapshotDate of [...index.snapshots].sort()) {
  const directory = resolve(HISTORY_DIR, snapshotDate);
  const meta = JSON.parse(await readFile(resolve(directory, 'meta.json'), 'utf8'));
  const types = meta.highscoreTypes?.map((type) => type.id) || [];
  if (!meta.generatedAt || types.length === 0) throw new Error(`Invalid metadata for ${snapshotDate}`);
  for (const universe of meta.universes || []) {
    if (universe.status !== 'failed' && !observedUniverseFirstSnapshots[universe.id]) {
      observedUniverseFirstSnapshots[universe.id] = snapshotDate;
    }
  }

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

  validateScoreBreakdowns(stats['0'], snapshotDate, snapshotDate === index.latest);

  previousStats = stats;
}

for (const [universeId, snapshotDate] of Object.entries(observedUniverseFirstSnapshots)) {
  if (index.universeFirstSnapshots?.[universeId] !== snapshotDate) {
    throw new Error(`Invalid first snapshot for universe ${universeId}`);
  }
}

const latestMeta = JSON.parse(
  await readFile(resolve(HISTORY_DIR, index.latest, 'meta.json'), 'utf8')
);
const requiredTypes = ['0', '1', '2', '3', '8', '9', '10', '11', 'fleet', 'defense', 'ships'];
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

const reportsIndex = JSON.parse(await readFile(resolve(REPORTS_DIR, 'index.json'), 'utf8'));
for (const reportType of ['monthlyAttackers', 'dailyLosses']) {
  const descriptor = reportsIndex[reportType];
  if (!descriptor?.latest || !descriptor.path) throw new Error(`Missing ${reportType} report`);
  const report = JSON.parse(await readFile(resolve(REPORTS_DIR, descriptor.path), 'utf8'));
  if (!Array.isArray(report.rows) || !Array.isArray(report.universes)) {
    throw new Error(`Invalid ${reportType} report`);
  }
  if (!report.startDate || !report.endDate || report.startDate >= report.endDate) {
    throw new Error(`Invalid ${reportType} period`);
  }
  if (report.rows.some((row) => !Number.isFinite(row.periodScore) || row.periodScore <= 0)) {
    throw new Error(`Invalid ${reportType} score`);
  }
  if (
    reportType === 'monthlyAttackers'
    && report.rows.some((row) => (
      !Number.isFinite(row.periodLostScore) || row.periodLostScore > row.periodScore
    ))
  ) {
    throw new Error('Monthly attackers filter was not applied');
  }
  if (
    reportType === 'dailyLosses'
    && report.rows.some((row) => !Number.isFinite(row.periodDestroyedScore))
  ) {
    throw new Error('Missing Military Destroyed value in daily losses');
  }
}

console.log(`Snapshots: ${index.snapshots.length}`);
console.log(`Latest: ${index.latest}`);
console.log(`Universes: ${latestMeta.universes.length}`);
console.log(`Reports: ${reportsIndex.monthlyAttackers.latest}, ${reportsIndex.dailyLosses.latest}`);
console.log('Data checks passed');
