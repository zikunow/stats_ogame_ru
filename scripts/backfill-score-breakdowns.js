import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  HISTORY_DIR,
  addScoreBreakdowns,
  readHistoryIndex,
  readSnapshotStats
} from '../src/data-storage.js';

const REQUIRED_TYPES = ['0', '1', '2', '3', '8', '9', '10', '11', 'fleet', 'defense'];
const index = await readHistoryIndex();

if (!index.snapshots?.length) throw new Error('History index is empty');

async function writeWithRetry(path, contents, attempts = 20) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await writeFile(path, contents, 'utf8');
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
}

for (const snapshotDate of index.snapshots) {
  const stats = await readSnapshotStats(snapshotDate, REQUIRED_TYPES);
  addScoreBreakdowns(stats);
  await writeWithRetry(
    resolve(HISTORY_DIR, snapshotDate, 'stats', '0.json'),
    `${JSON.stringify(stats['0'])}\n`
  );
  console.log(`Updated ${snapshotDate}`);
}

console.log(`Updated ${index.snapshots.length} snapshots`);
