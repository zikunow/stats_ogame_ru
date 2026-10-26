import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  HISTORY_DIR,
  readHistoryIndex,
  writeHistoryIndex
} from '../src/data-storage.js';

const index = await readHistoryIndex();
if (!index.snapshots?.length) throw new Error('History index is empty');

const universeFirstSnapshots = {};
for (const snapshotDate of [...index.snapshots].sort()) {
  const meta = JSON.parse(await readFile(
    resolve(HISTORY_DIR, snapshotDate, 'meta.json'),
    'utf8'
  ));

  for (const universe of meta.universes || []) {
    if (universe.status !== 'failed' && !universeFirstSnapshots[universe.id]) {
      universeFirstSnapshots[universe.id] = snapshotDate;
    }
  }
}

await writeHistoryIndex({ ...index, universeFirstSnapshots });
console.log(`Recorded first snapshots for ${Object.keys(universeFirstSnapshots).length} universes`);
