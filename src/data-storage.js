import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HISTORY_DIR = resolve(ROOT_DIR, 'data', 'history');
export const HISTORY_INDEX_FILE = resolve(HISTORY_DIR, 'index.json');

export function getSnapshotDirectory(snapshotDate) {
  return resolve(HISTORY_DIR, snapshotDate);
}

export function addScoreDeltas(stats, previousStats = {}) {
  for (const [type, rows] of Object.entries(stats)) {
    const previousScores = new Map(
      (previousStats[type] || []).map((row) => [
        `${row.universeId}:${row.playerId}`,
        row.score
      ])
    );

    stats[type] = rows.map((row) => {
      const previousScore = previousScores.get(`${row.universeId}:${row.playerId}`);
      return {
        ...row,
        scoreDelta: Number.isFinite(previousScore) ? row.score - previousScore : null
      };
    });
  }

  return stats;
}

function toPercent(score, total) {
  return total > 0 ? Math.round((score / total) * 10000) / 100 : 0;
}

export function addScoreBreakdowns(stats) {
  const requiredTypes = ['0', '2', '8', '9', '10', 'fleet', 'defense'];
  if (requiredTypes.some((type) => !Array.isArray(stats[type]))) return stats;

  const scoresByType = Object.fromEntries(requiredTypes.slice(1).map((type) => [
    type,
    new Map(stats[type].map((row) => [`${row.universeId}:${row.playerId}`, row.score]))
  ]));
  stats['0'] = stats['0'].map((row) => {
    const key = `${row.universeId}:${row.playerId}`;
    const total = row.score;
    if (!Number.isFinite(total)) {
      return { ...row, scoreBreakdown: null };
    }

    // OGame omits players with zero points from some category rankings.
    // Treat a missing category row as zero so new players still receive a
    // complete breakdown and cannot block the daily snapshot publication.
    const scoreOrZero = (type) => {
      const score = scoresByType[type].get(key);
      return Number.isFinite(score) ? score : 0;
    };
    const research = scoreOrZero('2');
    const lifeforms = scoreOrZero('8');
    const lifeformBuildings = scoreOrZero('9');
    const lifeformTechnologies = scoreOrZero('10');
    const fleet = scoreOrZero('fleet');
    const defense = scoreOrZero('defense');

    // Official category totals occasionally differ by one point because of rounding.
    // Use the exact remainder so the four displayed segments always equal total score.
    const military = fleet + defense;
    const economy = Math.max(0, total - research - military - lifeforms);
    const adjustedLifeformBuildings = Math.max(0, Math.min(lifeformBuildings, lifeforms));
    const adjustedLifeformTechnologies = Math.max(
      0,
      Math.min(lifeformTechnologies, lifeforms - adjustedLifeformBuildings)
    );
    const artifacts = Math.max(0, lifeforms - adjustedLifeformBuildings - adjustedLifeformTechnologies);

    return {
      ...row,
      scoreBreakdown: {
        economy: { score: economy, percent: toPercent(economy, total) },
        research: { score: research, percent: toPercent(research, total) },
        military: {
          score: military,
          percent: toPercent(military, total),
          fleet,
          fleetPercent: toPercent(fleet, total),
          defense,
          defensePercent: toPercent(defense, total)
        },
        lifeforms: {
          score: lifeforms,
          percent: toPercent(lifeforms, total),
          buildings: adjustedLifeformBuildings,
          buildingsPercent: toPercent(adjustedLifeformBuildings, total),
          technologies: adjustedLifeformTechnologies,
          technologiesPercent: toPercent(adjustedLifeformTechnologies, total),
          artifacts,
          artifactsPercent: toPercent(artifacts, total)
        }
      }
    };
  });

  return stats;
}

export async function readHistoryIndex() {
  try {
    return JSON.parse(await readFile(HISTORY_INDEX_FILE, 'utf8'));
  } catch {
    return { latest: '', snapshots: [] };
  }
}

export async function writeHistoryIndex(index) {
  await mkdir(HISTORY_DIR, { recursive: true });
  await writeFile(HISTORY_INDEX_FILE, `${JSON.stringify(index)}\n`, 'utf8');
}

export async function readSnapshotStats(snapshotDate, types) {
  const statsDirectory = resolve(getSnapshotDirectory(snapshotDate), 'stats');
  const entries = await Promise.all(types.map(async (type) => [
    type,
    JSON.parse(await readFile(resolve(statsDirectory, `${type}.json`), 'utf8'))
  ]));
  return Object.fromEntries(entries);
}

export async function writeSnapshot(data, snapshotDate, comparisonDate = '') {
  const snapshotDirectory = getSnapshotDirectory(snapshotDate);
  const statsDirectory = resolve(snapshotDirectory, 'stats');
  const { stats, ...metadata } = data;
  const meta = { ...metadata, comparisonDate };

  await mkdir(statsDirectory, { recursive: true });
  await Promise.all([
    writeFile(resolve(snapshotDirectory, 'meta.json'), `${JSON.stringify(meta)}\n`, 'utf8'),
    ...Object.entries(stats).map(([type, rows]) => (
      writeFile(resolve(statsDirectory, `${type}.json`), `${JSON.stringify(rows)}\n`, 'utf8')
    ))
  ]);

  return snapshotDirectory;
}
