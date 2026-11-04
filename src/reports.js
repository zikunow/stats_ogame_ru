import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  HISTORY_DIR,
  readHistoryIndex,
  readSnapshotStats
} from './data-storage.js';

export const REPORTS_DIR = resolve(HISTORY_DIR, '..', 'reports');
const MONTHLY_DIR = resolve(REPORTS_DIR, 'monthly-attackers');
const WEEKLY_DIR = resolve(REPORTS_DIR, 'weekly-attackers');
const ROLLING_ATTACKERS_DIR = resolve(REPORTS_DIR, 'rolling-attackers');
const DAILY_DIR = resolve(REPORTS_DIR, 'daily-losses');
const ATTACKER_ROLLING_PERIODS = [
  { key: '7d', days: 7, label: '7 дней' },
  { key: '30d', days: 30, label: '30 дней' }
];
const LOSS_PERIODS = [
  { key: '1d', days: 1, label: 'Вчера' },
  { key: '7d', days: 7, label: '7 дней' },
  { key: '30d', days: 30, label: '30 дней' }
];

function toDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function toDateString(value) {
  return value.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const value = toDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return toDateString(value);
}

function enumerateCompleteMonths(snapshots, latestDate) {
  const snapshotSet = new Set(snapshots);
  const earliest = toDate(snapshots[0]);
  const latest = toDate(latestDate);
  const currentMonthStart = new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), 1));
  const cursor = new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), 1));
  const months = [];

  while (cursor < currentMonthStart) {
    const start = toDateString(cursor);
    const endValue = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const end = toDateString(endValue);
    if (snapshotSet.has(start) && snapshotSet.has(end)) {
      months.push({ id: start.slice(0, 7), start, end });
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months.reverse();
}

function getIsoWeek(date) {
  const value = toDate(date);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const isoYear = value.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((value - yearStart) / 86400000) + 1) / 7);
  return { isoYear, week };
}

function enumerateCompleteWeeks(snapshots, latestDate) {
  const snapshotSet = new Set(snapshots);
  const earliest = snapshots[0];
  const earliestValue = toDate(earliest);
  const earliestDay = earliestValue.getUTCDay() || 7;
  let cursor = addDays(earliest, 8 - earliestDay);
  if (earliestDay === 1) cursor = earliest;
  const weeks = [];

  while (addDays(cursor, 7) <= latestDate) {
    const end = addDays(cursor, 7);
    if (snapshotSet.has(cursor) && snapshotSet.has(end)) {
      const { isoYear, week } = getIsoWeek(cursor);
      weeks.push({
        id: `${isoYear}-W${String(week).padStart(2, '0')}`,
        start: cursor,
        end,
        isoYear,
        week
      });
    }
    cursor = end;
  }

  return weeks.reverse();
}

function findSnapshotAtOrAfter(snapshots, targetDate, maximumDate = '') {
  return snapshots
    .filter((date) => date >= targetDate && (!maximumDate || date <= maximumDate))
    .sort()[0] || '';
}

function subtractDays(date, days) {
  return addDays(date, -days);
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
  periodFields = {},
  excludeWhenComparisonGreater = false,
  startDate,
  endDate,
  labelDate
}) {
  const statTypes = [...new Set([
    statType,
    comparisonStatType,
    ...Object.values(periodFields)
  ].filter(Boolean))];
  const [startStats, endStats, startMeta, endMeta] = await Promise.all([
    readSnapshotStats(startDate, statTypes),
    readSnapshotStats(endDate, statTypes),
    readSnapshotMeta(startDate),
    readSnapshotMeta(endDate)
  ]);
  const { rows: baseRows, excludedRows } = buildRows(startStats[statType], endStats[statType], {
    comparisonStartRows: comparisonStatType ? startStats[comparisonStatType] : null,
    comparisonEndRows: comparisonStatType ? endStats[comparisonStatType] : null,
    comparisonField,
    excludeWhenComparisonGreater
  });
  const periodScoreMaps = Object.fromEntries(Object.entries(periodFields).map(([field, type]) => [
    field,
    {
      start: new Map(startStats[type].map((row) => [`${row.universeId}:${row.playerId}`, row.score])),
      end: new Map(endStats[type].map((row) => [`${row.universeId}:${row.playerId}`, row.score]))
    }
  ]));
  const rows = baseRows.map((row) => {
    const key = `${row.universeId}:${row.playerId}`;
    return {
      ...row,
      ...Object.fromEntries(Object.entries(periodScoreMaps).map(([field, scores]) => {
        const startScore = scores.start.get(key);
        const endScore = scores.end.get(key);
        return [field, Number.isFinite(startScore) && Number.isFinite(endScore)
          ? endScore - startScore
          : null];
      }))
    };
  });

  return {
    id,
    kind,
    labelDate,
    startDate,
    endDate,
    startGeneratedAt: startMeta.generatedAt,
    endGeneratedAt: endMeta.generatedAt,
    generatedAt: endMeta.generatedAt,
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

  const completeMonths = enumerateCompleteMonths(snapshots, latestDate);
  const completeWeeks = enumerateCompleteWeeks(snapshots, latestDate);
  if (!completeMonths.length) throw new Error('Нет полностью собранного месяца для отчёта атакеров');
  if (!completeWeeks.length) throw new Error('Нет полностью собранной недели для отчёта атакеров');

  const attackerRollingStarts = Object.fromEntries(ATTACKER_ROLLING_PERIODS.map((period) => {
    const targetDate = subtractDays(latestDate, period.days);
    const startDate = findSnapshotAtOrAfter(snapshots, targetDate, latestDate);
    if (!startDate || startDate >= latestDate) {
      throw new Error(`Недостаточно данных для отчёта атакеров за ${period.label}`);
    }
    return [period.key, startDate];
  }));

  const lossPeriodStarts = Object.fromEntries(LOSS_PERIODS.map((period) => {
    const targetDate = subtractDays(latestDate, period.days);
    const startDate = period.key === '1d'
      ? previousDate
      : findSnapshotAtOrAfter(snapshots, targetDate, latestDate);
    if (!startDate || startDate >= latestDate) {
      throw new Error(`Недостаточно данных для отчёта потерь за ${period.label}`);
    }
    return [period.key, startDate];
  }));

  const attackerOptions = {
    statType: '6',
    comparisonStatType: '4',
    comparisonField: 'periodLostScore',
    excludeWhenComparisonGreater: true
  };
  const [monthReports, weekReports, attackerRollingReports, lossReports] = await Promise.all([
    Promise.all(completeMonths.map((month) => buildReport({
      ...attackerOptions,
      id: month.id,
      kind: 'monthly-attackers',
      startDate: month.start,
      endDate: month.end,
      labelDate: month.start
    }))),
    Promise.all(completeWeeks.map((week) => buildReport({
      ...attackerOptions,
      id: week.id,
      kind: 'weekly-attackers',
      startDate: week.start,
      endDate: week.end,
      labelDate: week.start
    }))),
    Promise.all(ATTACKER_ROLLING_PERIODS.map(async (period) => [
      period.key,
      await buildReport({
        ...attackerOptions,
        id: `${latestDate}-${period.key}`,
        kind: 'rolling-attackers',
        startDate: attackerRollingStarts[period.key],
        endDate: latestDate,
        labelDate: attackerRollingStarts[period.key]
      })
    ])).then(Object.fromEntries),
    Promise.all(LOSS_PERIODS.map(async (period) => [
      period.key,
      await buildReport({
        id: `${latestDate}-${period.key}`,
        kind: 'daily-losses',
        statType: '4',
        comparisonStatType: '6',
        comparisonField: 'periodDestroyedScore',
        periodFields: {
          periodFleetScore: 'fleet',
          periodDefenseScore: 'defense'
        },
        startDate: lossPeriodStarts[period.key],
        endDate: latestDate,
        labelDate: lossPeriodStarts[period.key]
      })
    ])).then(Object.fromEntries)
  ]);
  const monthlyAttackers = monthReports[0];
  const weeklyAttackers = weekReports[0];
  const dailyLosses = lossReports['1d'];

  await Promise.all([
    mkdir(MONTHLY_DIR, { recursive: true }),
    mkdir(WEEKLY_DIR, { recursive: true }),
    mkdir(ROLLING_ATTACKERS_DIR, { recursive: true }),
    mkdir(DAILY_DIR, { recursive: true })
  ]);
  const monthReportFiles = monthReports.map((report) => writeFile(
    resolve(MONTHLY_DIR, `${report.id}.json`),
    `${JSON.stringify(report)}\n`,
    'utf8'
  ));
  const weekReportFiles = weekReports.map((report) => writeFile(
    resolve(WEEKLY_DIR, `${report.id}.json`),
    `${JSON.stringify(report)}\n`,
    'utf8'
  ));
  const attackerRollingReportFiles = ATTACKER_ROLLING_PERIODS.map((period) => {
    const report = attackerRollingReports[period.key];
    return writeFile(
      resolve(ROLLING_ATTACKERS_DIR, `${period.key}.json`),
      `${JSON.stringify(report)}\n`,
      'utf8'
    );
  });
  const lossReportFiles = LOSS_PERIODS.map((period) => {
    const report = lossReports[period.key];
    return writeFile(
      resolve(DAILY_DIR, `${report.id}.json`),
      `${JSON.stringify(report)}\n`,
      'utf8'
    );
  });
  await Promise.all([
    ...monthReportFiles,
    ...weekReportFiles,
    ...attackerRollingReportFiles,
    ...lossReportFiles,
    writeFile(resolve(REPORTS_DIR, 'index.json'), `${JSON.stringify({
      attackers: {
        defaultPeriod: 'month',
        periods: {
          month: {
            latest: monthlyAttackers.id,
            items: monthReports.map((report) => ({
              id: report.id,
              path: `monthly-attackers/${report.id}.json`,
              startDate: report.startDate,
              endDate: report.endDate
            }))
          },
          week: {
            latest: weeklyAttackers.id,
            items: weekReports.map((report) => {
              const week = completeWeeks.find((item) => item.id === report.id);
              return {
                id: report.id,
                path: `weekly-attackers/${report.id}.json`,
                startDate: report.startDate,
                endDate: report.endDate,
                isoYear: week.isoYear,
                week: week.week
              };
            })
          },
          ...Object.fromEntries(ATTACKER_ROLLING_PERIODS.map((period) => {
            const report = attackerRollingReports[period.key];
            return [period.key, {
              label: period.label,
              path: `rolling-attackers/${period.key}.json`,
              startDate: report.startDate,
              endDate: report.endDate
            }];
          }))
        }
      },
      monthlyAttackers: {
        latest: monthlyAttackers.id,
        path: `monthly-attackers/${monthlyAttackers.id}.json`
      },
      dailyLosses: {
        latest: dailyLosses.id,
        path: `daily-losses/${dailyLosses.id}.json`,
        defaultPeriod: '1d',
        periods: Object.fromEntries(LOSS_PERIODS.map((period) => {
          const report = lossReports[period.key];
          return [period.key, {
            label: period.label,
            path: `daily-losses/${report.id}.json`,
            startDate: report.startDate,
            endDate: report.endDate
          }];
        }))
      }
    })}\n`, 'utf8')
  ]);

  return {
    monthlyAttackers,
    weeklyAttackers,
    monthReports,
    weekReports,
    attackerRollingReports,
    dailyLosses,
    lossReports
  };
}
