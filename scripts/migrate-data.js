import { readdir, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HISTORY_DIR,
  addScoreDeltas,
  writeSnapshot
} from '../src/data-storage.js';

const ROOT_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CURRENT_DATA_FILE = resolve(ROOT_DIR, 'data', 'ogame-ru.json');
const snapshotFiles = (await readdir(HISTORY_DIR))
  .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
  .sort();

if (snapshotFiles.length === 0) {
  throw new Error('No monolithic history snapshots found');
}

let previousStats = {};

for (const fileName of snapshotFiles) {
  const snapshotDate = basename(fileName, '.json');
  const data = JSON.parse(await readFile(resolve(HISTORY_DIR, fileName), 'utf8'));
  const comparisonDate = previousStats && Object.keys(previousStats).length > 0
    ? basename(snapshotFiles[snapshotFiles.indexOf(fileName) - 1], '.json')
    : '';

  addScoreDeltas(data.stats, previousStats);
  await writeSnapshot(data, snapshotDate, comparisonDate);
  previousStats = data.stats;
  console.log(`Converted ${snapshotDate}`);
}

const currentData = JSON.parse(await readFile(CURRENT_DATA_FILE, 'utf8'));
const latestDate = basename(snapshotFiles.at(-1), '.json');
if (currentData.generatedAt.slice(0, 10) !== latestDate) {
  throw new Error('Current data does not match the latest history snapshot');
}

console.log(`Converted ${snapshotFiles.length} snapshots; latest is ${latestDate}`);
