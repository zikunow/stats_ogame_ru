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
