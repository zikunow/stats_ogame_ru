import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  HISTORY_DIR,
  readHistoryIndex,
  readSnapshotStats
} from './data-storage.js';

export const REPORTS_DIR = resolve(HISTORY_DIR, '..', 'reports');
const MONTHLY_DIR = resolve(REPORTS_DIR, 'monthly-attackers');
const DAILY_DIR = resolve(REPORTS_DIR, 'daily-losses');

function getMonthBoundaries(latestDate) {
  const latest = new Date(`${latestDate}T00:00:00Z`);
  const end = new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
  return {
    id: start.toISOString().slice(0, 7),
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

function findSnapshotAtOrAfter(snapshots, targetDate, maximumDate = '') {
  return snapshots
    .filter((date) => date >= targetDate && (!maximumDate || date <= maximumDate))
    .sort()[0] || '';
}

async function readSnapshotMeta(snapshotDate) {
  return JSON.parse(await readFile(resolve(HISTORY_DIR, snapshotDate, 'meta.json'), 'utf8'));
}

function buildRows(startRows, endRows, {
  comparisonStartRows = null,
  comparisonEndRows = null,
  comparisonField = '',
  excludeWhenComparisonGreater = false
} = {}) {
  const startScores = new Map(startRows.map((row) => [
    `${row.universeId}:${row.playerId}`,
    row.score
  ]));
  const comparisonStartScores = comparisonStartRows
    ? new Map(comparisonStartRows.map((row) => [`${row.universeId}:${row.playerId}`, row.score]))
    : null;
  const comparisonEndScores = comparisonEndRows
    ? new Map(comparisonEndRows.map((row) => [`${row.universeId}:${row.playerId}`, row.score]))
    : null;
  let excludedRows = 0;

  const rows = endRows
    .flatMap((row) => {
      const key = `${row.universeId}:${row.playerId}`;
      const startScore = startScores.get(key);
      if (!Number.isFinite(startScore)) return [];
      const periodScore = row.score - startScore;
      if (periodScore <= 0) return [];

      let comparisonPeriodScore = null;
      if (comparisonStartScores && comparisonEndScores) {
        const comparisonStartScore = comparisonStartScores.get(key);
        const comparisonEndScore = comparisonEndScores.get(key);
        if (!Number.isFinite(comparisonStartScore) || !Number.isFinite(comparisonEndScore)) return [];
        comparisonPeriodScore = comparisonEndScore - comparisonStartScore;
        if (excludeWhenComparisonGreater && comparisonPeriodScore > periodScore) {
          excludedRows += 1;
          return [];
        }
      }

      return [{
        universeId: row.universeId,
        universeName: row.universeName,
        playerId: row.playerId,
        name: row.name,
        displayName: row.displayName,
        allianceTag: row.allianceTag,
        periodScore,
        ...(comparisonField && Number.isFinite(comparisonPeriodScore)
          ? { [comparisonField]: comparisonPeriodScore }
          : {}),
        totalScore: row.score,
        speed: row.speed,
        speedFleetPeaceful: row.speedFleetPeaceful,
        speedFleetWar: row.speedFleetWar,
        debrisPercent: row.debrisPercent
      }];
    })
    .sort((a, b) => (
      b.periodScore - a.periodScore
      || b.totalScore - a.totalScore
      || a.displayName.localeCompare(b.displayName, 'ru')
    ));

  return { rows, excludedRows };
}

async function buildReport({
  id,
  kind,
  statType,
  comparisonStatType = '',
  comparisonField = '',
  excludeWhenComparisonGreater = false,
  startDate,
  endDate,
  labelDate
}) {
  const statTypes = [...new Set([statType, comparisonStatType].filter(Boolean))];
  const [startStats, endStats, startMeta, endMeta] = await Promise.all([
    readSnapshotStats(startDate, statTypes),
    readSnapshotStats(endDate, statTypes),
    readSnapshotMeta(startDate),
    readSnapshotMeta(endDate)
  ]);
  const { rows, excludedRows } = buildRows(startStats[statType], endStats[statType], {
    comparisonStartRows: comparisonStatType ? startStats[comparisonStatType] : null,
    comparisonEndRows: comparisonStatType ? endStats[comparisonStatType] : null,
    comparisonField,
    excludeWhenComparisonGreater
  });

  return {
    id,
    kind,
    labelDate,
    startDate,
    endDate,
    startGeneratedAt: startMeta.generatedAt,
    endGeneratedAt: endMeta.generatedAt,
    generatedAt: new Date().toISOString(),
    universes: endMeta.universes.filter((universe) => universe.status === 'ok'),
    filter: excludeWhenComparisonGreater
      ? { rule: 'destroyed-not-less-than-lost', excludedRows }
      : null,
    rows
  };
}

export async function generateReports(historyIndex = null) {
  const index = historyIndex || await readHistoryIndex();
  const snapshots = [...(index.snapshots || [])].sort();
  if (snapshots.length < 2 || !index.latest) {
    throw new Error('Недостаточно снимков для построения отчётов');
  }

  const latestDate = index.latest;
  const latestIndex = snapshots.indexOf(latestDate);
  const previousDate = latestIndex > 0 ? snapshots[latestIndex - 1] : '';
  if (!previousDate) throw new Error('Не найден предыдущий снимок');

  const month = getMonthBoundaries(latestDate);
  const monthStartDate = findSnapshotAtOrAfter(snapshots, month.start, month.end);
  const monthEndDate = findSnapshotAtOrAfter(snapshots, month.end, latestDate);
  if (!monthStartDate || !monthEndDate || monthStartDate >= monthEndDate) {
    throw new Error(`Недостаточно данных для отчёта за ${month.id}`);
  }

  const [monthlyAttackers, dailyLosses] = await Promise.all([
    buildReport({
      id: month.id,
      kind: 'monthly-attackers',
      statType: '6',
      comparisonStatType: '4',
      comparisonField: 'periodLostScore',
      excludeWhenComparisonGreater: true,
      startDate: monthStartDate,
      endDate: monthEndDate,
      labelDate: month.start
    }),
    buildReport({
      id: previousDate,
      kind: 'daily-losses',
      statType: '4',
      comparisonStatType: '6',
      comparisonField: 'periodDestroyedScore',
      startDate: previousDate,
      endDate: latestDate,
      labelDate: previousDate
    })
  ]);

  await Promise.all([
    mkdir(MONTHLY_DIR, { recursive: true }),
    mkdir(DAILY_DIR, { recursive: true })
  ]);
  await Promise.all([
    writeFile(
      resolve(MONTHLY_DIR, `${monthlyAttackers.id}.json`),
      `${JSON.stringify(monthlyAttackers)}\n`,
      'utf8'
    ),
    writeFile(
      resolve(DAILY_DIR, `${dailyLosses.id}.json`),
      `${JSON.stringify(dailyLosses)}\n`,
      'utf8'
    ),
    writeFile(resolve(REPORTS_DIR, 'index.json'), `${JSON.stringify({
      monthlyAttackers: {
        latest: monthlyAttackers.id,
        path: `monthly-attackers/${monthlyAttackers.id}.json`
      },
      dailyLosses: {
        latest: dailyLosses.id,
        path: `daily-losses/${dailyLosses.id}.json`
      }
    })}\n`, 'utf8')
  ]);

  return { monthlyAttackers, dailyLosses };
}
