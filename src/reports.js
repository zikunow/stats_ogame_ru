import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  HISTORY_DIR,
  readHistoryIndex,
  readSnapshotStats
} from './data-storage.js';

export const REPORTS_DIR = resolve(HISTORY_DIR, '..', 'reports');
const ARCHIVE_REPORTS_DIR = resolve(REPORTS_DIR, 'archive');
const MERGE_ARCHIVE_DATE = '2026-11-09';
const ACTIVE_UNIVERSE_START_DATES = { '1': '2026-11-13' };
const MERGED_SOURCE_UNIVERSE_IDS = new Set([
  '103', '178', '182', '188', '193', '199', '254', '255', '256',
  '257', '258', '259', '260', '261', '262', '263', '264'
]);
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

function filterReport(report, allowedUniverseIds, universeStartDates = {}) {
  const allowed = allowedUniverseIds instanceof Set
    ? allowedUniverseIds
    : new Set(allowedUniverseIds);
  return {
    ...report,
    universes: report.universes.filter((universe) => allowed.has(String(universe.id))),
    rows: report.rows.filter((row) => (
      allowed.has(String(row.universeId))
      && (!universeStartDates[String(row.universeId)]
        || report.startDate >= universeStartDates[String(row.universeId)])
    ))
  };
}

async function filterActiveReport(report, allowedUniverseIds, universeStartDates, buildOptions) {
  const filtered = filterReport(report, allowedUniverseIds, universeStartDates);
  const effectiveStartDates = {};
  for (const [universeId, baselineDate] of Object.entries(universeStartDates)) {
    if (!allowedUniverseIds.has(universeId) || report.endDate <= baselineDate) continue;
    effectiveStartDates[universeId] = report.startDate < baselineDate
      ? baselineDate
      : report.startDate;
    if (report.startDate >= baselineDate) continue;
    const replacement = await buildReport({
      ...buildOptions,
      id: report.id,
      kind: report.kind,
      startDate: baselineDate,
      endDate: report.endDate,
      labelDate: report.labelDate
    });
    filtered.rows.push(...replacement.rows.filter((row) => String(row.universeId) === universeId));
  }
  filtered.rows.sort((a, b) => (
    b.periodScore - a.periodScore
    || b.totalScore - a.totalScore
    || a.displayName.localeCompare(b.displayName, 'ru')
  ));
  return { ...filtered, universeStartDates: effectiveStartDates };
}

function createReportsIndex({
  monthReports,
  weekReports,
  completeWeeks,
  attackerRollingReports,
  lossReports,
  attackerHallOfFame
}) {
  const monthlyAttackers = monthReports[0];
  const weeklyAttackers = weekReports[0];
  const dailyLosses = lossReports['1d'];
  return {
    attackerHallOfFame: {
      path: 'attacker-hall-of-fame.json',
      generatedAt: attackerHallOfFame.generatedAt
    },
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
  };
}

async function writeReportSet({
  reportsDir,
  monthReports,
  weekReports,
  completeWeeks,
  attackerRollingReports,
  lossReports,
  attackerHallOfFame
}) {
  const monthlyDir = resolve(reportsDir, 'monthly-attackers');
  const weeklyDir = resolve(reportsDir, 'weekly-attackers');
  const rollingDir = resolve(reportsDir, 'rolling-attackers');
  const dailyDir = resolve(reportsDir, 'daily-losses');
  await Promise.all([
    mkdir(monthlyDir, { recursive: true }),
    mkdir(weeklyDir, { recursive: true }),
    mkdir(rollingDir, { recursive: true }),
    mkdir(dailyDir, { recursive: true })
  ]);
  await Promise.all([
    ...monthReports.map((report) => writeFile(resolve(monthlyDir, `${report.id}.json`), `${JSON.stringify(report)}\n`, 'utf8')),
    ...weekReports.map((report) => writeFile(resolve(weeklyDir, `${report.id}.json`), `${JSON.stringify(report)}\n`, 'utf8')),
    ...ATTACKER_ROLLING_PERIODS.map((period) => writeFile(
      resolve(rollingDir, `${period.key}.json`),
      `${JSON.stringify(attackerRollingReports[period.key])}\n`,
      'utf8'
    )),
    ...LOSS_PERIODS.map((period) => {
      const report = lossReports[period.key];
      return writeFile(resolve(dailyDir, `${report.id}.json`), `${JSON.stringify(report)}\n`, 'utf8');
    }),
    writeFile(resolve(reportsDir, 'attacker-hall-of-fame.json'), `${JSON.stringify(attackerHallOfFame)}\n`, 'utf8'),
    writeFile(resolve(reportsDir, 'index.json'), `${JSON.stringify(createReportsIndex({
      monthReports,
      weekReports,
      completeWeeks,
      attackerRollingReports,
      lossReports,
      attackerHallOfFame
    }))}\n`, 'utf8')
  ]);
}

function emptyMedals() {
  return { gold: 0, silver: 0, bronze: 0, podiums: 0, destroyed: 0 };
}

function addHallAward(rows, player, category, medal, endDate) {
  const key = `${player.universeId}:${player.playerId}`;
  let row = rows.get(key);
  if (!row) {
    row = {
      universeId: player.universeId,
      universeName: player.universeName,
      playerId: player.playerId,
      name: player.name,
      displayName: player.displayName,
      allianceTag: player.allianceTag,
      week: emptyMedals(),
      month: emptyMedals(),
      latestAwardEndDate: endDate
    };
    rows.set(key, row);
  }

  row.universeName = player.universeName;
  row.name = player.name;
  row.displayName = player.displayName;
  row.allianceTag = player.allianceTag;
  row.latestAwardEndDate = endDate;
  row[category][medal] += 1;
  row[category].podiums += 1;
  row[category].destroyed += player.periodScore;
}

function buildAttackerHallOfFame(monthReports, weekReports) {
  const universeRows = new Map();
  const globalRows = new Map();
  const medals = ['gold', 'silver', 'bronze'];
  const events = [
    ...monthReports.map((report) => ({ category: 'month', report })),
    ...weekReports.map((report) => ({ category: 'week', report }))
  ].sort((a, b) => a.report.endDate.localeCompare(b.report.endDate));

  for (const { category, report } of events) {
    report.rows.slice(0, 3).forEach((row, index) => {
      addHallAward(globalRows, row, category, medals[index], report.endDate);
    });

    const byUniverse = new Map();
    for (const row of report.rows) {
      if (!byUniverse.has(row.universeId)) byUniverse.set(row.universeId, []);
      byUniverse.get(row.universeId).push(row);
    }
    for (const rows of byUniverse.values()) {
      rows.slice(0, 3).forEach((row, index) => {
        addHallAward(universeRows, row, category, medals[index], report.endDate);
      });
    }
  }

  const latestReport = [...monthReports, ...weekReports]
    .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  return {
    generatedAt: latestReport.endGeneratedAt,
    months: monthReports.map((report) => ({
      id: report.id,
      startDate: report.startDate,
      endDate: report.endDate
    })),
    weeks: weekReports.map((report) => ({
      id: report.id,
      startDate: report.startDate,
      endDate: report.endDate
    })),
    universes: latestReport.universes,
    scopes: {
      universe: [...universeRows.values()],
      global: [...globalRows.values()]
    }
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
  const lossOptions = {
    statType: '4',
    comparisonStatType: '6',
    comparisonField: 'periodDestroyedScore',
    periodFields: {
      periodFleetScore: 'fleet',
      periodDefenseScore: 'defense'
    }
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
        ...lossOptions,
        id: `${latestDate}-${period.key}`,
        kind: 'daily-losses',
        startDate: lossPeriodStarts[period.key],
        endDate: latestDate,
        labelDate: lossPeriodStarts[period.key]
      })
    ])).then(Object.fromEntries)
  ]);
  const latestMeta = await readSnapshotMeta(latestDate);
  const activeUniverseIds = new Set(latestMeta.universes
    .filter((universe) => universe.status === 'ok')
    .map((universe) => String(universe.id)));
  const currentMonthReports = await Promise.all(monthReports.map((report) => filterActiveReport(
    report,
    activeUniverseIds,
    ACTIVE_UNIVERSE_START_DATES,
    attackerOptions
  )));
  const currentWeekReports = await Promise.all(weekReports.map((report) => filterActiveReport(
    report,
    activeUniverseIds,
    ACTIVE_UNIVERSE_START_DATES,
    attackerOptions
  )));
  const currentAttackerRollingReports = Object.fromEntries(await Promise.all(
    Object.entries(attackerRollingReports).map(async ([key, report]) => [
      key,
      await filterActiveReport(report, activeUniverseIds, ACTIVE_UNIVERSE_START_DATES, attackerOptions)
    ])
  ));
  const currentLossReports = Object.fromEntries(await Promise.all(
    Object.entries(lossReports).map(async ([key, report]) => [
      key,
      await filterActiveReport(report, activeUniverseIds, ACTIVE_UNIVERSE_START_DATES, lossOptions)
    ])
  ));
  const attackerHallOfFame = buildAttackerHallOfFame(currentMonthReports, currentWeekReports);

  const archiveSnapshots = snapshots.filter((date) => date <= MERGE_ARCHIVE_DATE);
  const archiveLatestIndex = archiveSnapshots.indexOf(MERGE_ARCHIVE_DATE);
  const archivePreviousDate = archiveLatestIndex > 0 ? archiveSnapshots[archiveLatestIndex - 1] : '';
  if (!archivePreviousDate) throw new Error('Не найден предыдущий снимок архива до слияния');
  const archiveCompleteWeeks = enumerateCompleteWeeks(archiveSnapshots, MERGE_ARCHIVE_DATE);
  const archiveMonthReports = monthReports
    .filter((report) => report.endDate <= MERGE_ARCHIVE_DATE)
    .map((report) => filterReport(report, MERGED_SOURCE_UNIVERSE_IDS));
  const archiveWeekReports = weekReports
    .filter((report) => report.endDate <= MERGE_ARCHIVE_DATE)
    .map((report) => filterReport(report, MERGED_SOURCE_UNIVERSE_IDS));
  const archiveAttackerStarts = Object.fromEntries(ATTACKER_ROLLING_PERIODS.map((period) => [
    period.key,
    findSnapshotAtOrAfter(
      archiveSnapshots,
      subtractDays(MERGE_ARCHIVE_DATE, period.days),
      MERGE_ARCHIVE_DATE
    )
  ]));
  const archiveLossStarts = Object.fromEntries(LOSS_PERIODS.map((period) => [
    period.key,
    period.key === '1d'
      ? archivePreviousDate
      : findSnapshotAtOrAfter(
        archiveSnapshots,
        subtractDays(MERGE_ARCHIVE_DATE, period.days),
        MERGE_ARCHIVE_DATE
      )
  ]));
  const archiveAttackerRollingReports = Object.fromEntries(await Promise.all(
    ATTACKER_ROLLING_PERIODS.map(async (period) => {
      const report = await buildReport({
        ...attackerOptions,
        id: `${MERGE_ARCHIVE_DATE}-${period.key}`,
        kind: 'rolling-attackers',
        startDate: archiveAttackerStarts[period.key],
        endDate: MERGE_ARCHIVE_DATE,
        labelDate: archiveAttackerStarts[period.key]
      });
      return [period.key, filterReport(report, MERGED_SOURCE_UNIVERSE_IDS)];
    })
  ));
  const archiveLossReports = Object.fromEntries(await Promise.all(
    LOSS_PERIODS.map(async (period) => {
      const report = await buildReport({
        ...lossOptions,
        id: `${MERGE_ARCHIVE_DATE}-${period.key}`,
        kind: 'daily-losses',
        startDate: archiveLossStarts[period.key],
        endDate: MERGE_ARCHIVE_DATE,
        labelDate: archiveLossStarts[period.key]
      });
      return [period.key, filterReport(report, MERGED_SOURCE_UNIVERSE_IDS)];
    })
  ));
  const archiveAttackerHallOfFame = buildAttackerHallOfFame(
    archiveMonthReports,
    archiveWeekReports
  );

  await Promise.all([
    writeReportSet({
      reportsDir: REPORTS_DIR,
      monthReports: currentMonthReports,
      weekReports: currentWeekReports,
      completeWeeks,
      attackerRollingReports: currentAttackerRollingReports,
      lossReports: currentLossReports,
      attackerHallOfFame
    }),
    writeReportSet({
      reportsDir: ARCHIVE_REPORTS_DIR,
      monthReports: archiveMonthReports,
      weekReports: archiveWeekReports,
      completeWeeks: archiveCompleteWeeks,
      attackerRollingReports: archiveAttackerRollingReports,
      lossReports: archiveLossReports,
      attackerHallOfFame: archiveAttackerHallOfFame
    })
  ]);

  const monthlyAttackers = currentMonthReports[0];
  const weeklyAttackers = currentWeekReports[0];
  const dailyLosses = currentLossReports['1d'];

  return {
    monthlyAttackers,
    weeklyAttackers,
    monthReports: currentMonthReports,
    weekReports: currentWeekReports,
    attackerRollingReports: currentAttackerRollingReports,
    attackerHallOfFame,
    dailyLosses,
    lossReports: currentLossReports,
    archive: {
      monthReports: archiveMonthReports,
      weekReports: archiveWeekReports,
      attackerRollingReports: archiveAttackerRollingReports,
      attackerHallOfFame: archiveAttackerHallOfFame,
      lossReports: archiveLossReports
    }
  };
}
