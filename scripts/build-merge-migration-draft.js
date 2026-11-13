import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const MERGE_DIR = path.join(ROOT, 'data', 'merge-2026');
const SOURCE_DIR = path.join(MERGE_DIR, 'pre-merge-planets');
const AS_OF_DATE = process.env.MERGE_AS_OF_DATE || '2026-11-13';
const HARD_MERGE_DATE = '2026-11-12';
const TARGETS = [
  { id: '1', name: 'Universe 1' },
  { id: '272', name: 'Quasi-Stellar' },
  { id: '273', name: 'Regulus' },
  { id: '274', name: 'Scorpius' }
];
const HISTORY_DATES = [
  '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08',
  '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'
].filter((date) => date <= AS_OF_DATE);

function decodeXml(value = '') {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function parseAttributes(source = '') {
  const attrs = {};
  const pattern = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = pattern.exec(source))) attrs[match[1]] = decodeXml(match[2]);
  return attrs;
}

function parseElements(xml, tagName) {
  const elements = [];
  const pattern = new RegExp(`<${tagName}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${tagName}>)`, 'g');
  let match;
  while ((match = pattern.exec(xml))) {
    elements.push({ attrs: parseAttributes(match[1]), content: match[2] || '' });
  }
  return elements;
}

function readTextTag(xml, tagName, fallback = '') {
  const match = xml.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`));
  return match ? decodeXml(match[1].trim()) : fallback;
}

function normalizeName(value = '') {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
}

async function fetchXml(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'ogame-ru-dashboard/merge-audit' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function fetchTarget(target) {
  const apiBase = `https://s${target.id}-ru.ogame.gameforge.com/api`;
  const [universeXml, playersXml, alliancesXml, serverDataXml] = await Promise.all([
    fetchXml(`${apiBase}/universe.xml`),
    fetchXml(`${apiBase}/players.xml`),
    fetchXml(`${apiBase}/alliances.xml`),
    fetchXml(`${apiBase}/serverData.xml`)
  ]);
  const alliances = new Map(parseElements(alliancesXml, 'alliance').map(({ attrs }) => [attrs.id, attrs]));
  const playersMeta = new Map(parseElements(playersXml, 'player').map(({ attrs }) => [attrs.id, attrs]));
  const universeAttrs = parseAttributes(universeXml.match(/<universe\b([^>]*)>/)?.[1] || '');
  const planetsByPlayer = new Map();
  for (const { attrs, content } of parseElements(universeXml, 'planet')) {
    const moon = parseElements(content, 'moon')[0]?.attrs || null;
    const planets = planetsByPlayer.get(attrs.player) || [];
    planets.push({
      planetId: attrs.id || '',
      name: attrs.name || '',
      coordinates: attrs.coords || '',
      moon: moon ? { moonId: moon.id || '', name: moon.name || '', size: Number(moon.size || 0) } : null
    });
    planetsByPlayer.set(attrs.player, planets);
  }
  const players = [...playersMeta.values()].map((meta) => {
    const alliance = alliances.get(meta.alliance || '') || {};
    const planets = planetsByPlayer.get(meta.id) || [];
    return {
      universeId: target.id,
      universeName: readTextTag(serverDataXml, 'name', target.name),
      playerId: meta.id,
      name: meta.name || `Player ${meta.id}`,
      status: meta.status || '',
      allianceId: meta.alliance || '',
      allianceTag: alliance.tag || '',
      allianceName: alliance.name || '',
      planets,
      planetCount: planets.length,
      moonCount: planets.filter((planet) => planet.moon).length
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    apiTimestamp: new Date(Number(universeAttrs.timestamp || 0) * 1000).toISOString(),
    universeId: target.id,
    universeName: readTextTag(serverDataXml, 'name', target.name),
    apiBase,
    playerCount: players.length,
    planetCount: players.reduce((sum, player) => sum + player.planetCount, 0),
    moonCount: players.reduce((sum, player) => sum + player.moonCount, 0),
    players
  };
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function latestRow(rows, universeId, playerId) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index].data.find((entry) => String(entry.universeId) === universeId && String(entry.playerId) === playerId);
    if (row) return { date: rows[index].date, row };
  }
  return null;
}

function firstTargetAppearances(history, targetPlayer, sourcePlayer) {
  const exact = [];
  const byName = [];
  const names = new Set([normalizeName(targetPlayer?.name), normalizeName(sourcePlayer.name)].filter(Boolean));
  for (const snapshot of history) {
    for (const row of snapshot.data) {
      if (!TARGETS.some((target) => target.id === String(row.universeId))) continue;
      if (targetPlayer && String(row.universeId) === targetPlayer.universeId && String(row.playerId) === targetPlayer.playerId) {
        exact.push({ date: snapshot.date, universeId: String(row.universeId), universeName: row.universeName, playerId: String(row.playerId), name: row.name, score: row.score });
      }
      if (names.has(normalizeName(row.name))) {
        byName.push({ date: snapshot.date, universeId: String(row.universeId), universeName: row.universeName, playerId: String(row.playerId), name: row.name, score: row.score });
      }
    }
  }
  const combined = [...exact, ...byName]
    .filter((value, index, list) => list.findIndex((item) => item.date === value.date && item.universeId === value.universeId && item.playerId === value.playerId) === index)
    .sort((a, b) => a.date.localeCompare(b.date) || a.universeId.localeCompare(b.universeId));
  return combined;
}

function transferLabel(firstSeenDate) {
  if (!firstSeenDate) return 'Не определён';
  return firstSeenDate < HARD_MERGE_DATE
    ? 'Самостоятельно до hard merge'
    : 'Hard merge (сам не переходил)';
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  const columns = [
    ['matchStatus', 'Статус сопоставления'], ['confidence', 'Уверенность'], ['transferType', 'Способ переноса'],
    ['firstSeenInTarget', 'Первое появление в цели'], ['sourceUniverse', 'Откуда'], ['sourcePlayerId', 'Старый PlayerID'],
    ['sourceName', 'Старый ник'], ['sourceAlliance', 'Старый альянс'], ['targetUniverse', 'Куда'],
    ['targetPlayerId', 'Новый PlayerID'], ['targetName', 'Текущий ник'], ['targetAlliance', 'Текущий альянс'],
    ['sourceScore', 'Очки до'], ['sourceScoreDate', 'Дата очков до'], ['targetScore', 'Очки сейчас'],
    ['targetPosition', 'Место сейчас'], ['matchedPlanets', 'Совпало планет'], ['sourcePlanetCount', 'Планет до'],
    ['targetPlanetCount', 'Планет после'], ['zeroScore', 'Нулевые очки'], ['journey', 'Цепочка целей'],
    ['matchMethod', 'Метод сопоставления'], ['note', 'Примечание']
  ];
  return [
    columns.map(([, label]) => csvEscape(label)).join(';'),
    ...rows.map((row) => columns.map(([key]) => csvEscape(row[key])).join(';'))
  ].join('\r\n');
}

const sourceIndex = await readJson(path.join(SOURCE_DIR, 'index.json'));
if (!sourceIndex) throw new Error('Не найден pre-merge-planets/index.json');

const targetSnapshots = await Promise.all(TARGETS.map(fetchTarget));
const targetDir = path.join(MERGE_DIR, 'target-planets', AS_OF_DATE);
await fs.mkdir(targetDir, { recursive: true });
await Promise.all(targetSnapshots.map((snapshot) => fs.writeFile(
  path.join(targetDir, `ru${snapshot.universeId}.json`),
  `${JSON.stringify(snapshot)}\n`
)));

const sourcePlayers = [];
for (const universe of sourceIndex.universes) {
  const snapshot = await readJson(path.join(SOURCE_DIR, universe.path));
  for (const player of snapshot.players) {
    sourcePlayers.push({ ...player, universeId: snapshot.universeId, universeName: snapshot.universeName });
  }
}
const history = [];
for (const date of HISTORY_DATES) {
  const data = await readJson(path.join(ROOT, 'data', 'history', date, 'stats', '0.json'), []);
  if (data) history.push({ date, data });
}
const currentRows = history.find((snapshot) => snapshot.date === AS_OF_DATE)?.data || [];
const currentByKey = new Map(currentRows.map((row) => [`${row.universeId}:${row.playerId}`, row]));
const targetApiByKey = new Map(targetSnapshots.flatMap((snapshot) => snapshot.players.map((player) => [
  `${player.universeId}:${player.playerId}`,
  player
])));
const targetPlayers = currentRows
  .filter((row) => TARGETS.some((target) => target.id === String(row.universeId)))
  .map((row) => {
    const apiPlayer = targetApiByKey.get(`${row.universeId}:${row.playerId}`);
    return {
      universeId: String(row.universeId),
      universeName: row.universeName,
      playerId: String(row.playerId),
      name: row.name,
      status: row.status || '',
      allianceId: row.allianceId || '',
      allianceTag: row.allianceTag || '',
      allianceName: '',
      planets: apiPlayer?.planets || [],
      planetCount: apiPlayer?.planetCount ?? null,
      moonCount: apiPlayer?.moonCount ?? null
    };
  });

const targetsByPlanet = new Map();
for (const targetPlayer of targetPlayers) {
  for (const planet of targetPlayer.planets) {
    if (!planet.planetId) continue;
    const matches = targetsByPlanet.get(planet.planetId) || [];
    matches.push(targetPlayer);
    targetsByPlanet.set(planet.planetId, matches);
  }
}
const targetByName = new Map();
for (const targetPlayer of targetPlayers) {
  const key = normalizeName(targetPlayer.name);
  const values = targetByName.get(key) || [];
  values.push(targetPlayer);
  targetByName.set(key, values);
}

const historyMaps = history.map((snapshot) => ({
  date: snapshot.date,
  map: new Map(snapshot.data.map((row) => [`${row.universeId}:${row.playerId}`, row]))
}));
const sourceScoreByKey = new Map();
for (const sourcePlayer of sourcePlayers) {
  const key = `${sourcePlayer.universeId}:${sourcePlayer.playerId}`;
  for (let index = historyMaps.length - 1; index >= 0; index -= 1) {
    const row = historyMaps[index].map.get(key);
    if (row) {
      sourceScoreByKey.set(key, { date: historyMaps[index].date, row });
      break;
    }
  }
}
const firstTargetByKey = new Map();
for (const snapshot of history) {
  for (const row of snapshot.data) {
    const key = `${row.universeId}:${row.playerId}`;
    if (TARGETS.some((target) => target.id === String(row.universeId)) && !firstTargetByKey.has(key)) {
      firstTargetByKey.set(key, { date: snapshot.date, row });
    }
  }
}
const matchesBySourceKey = new Map();
const usedTargetKeys = new Set();
const sourcePlanetOwners = new Map();
for (const sourcePlayer of sourcePlayers) {
  const ownerKey = `${sourcePlayer.universeId}:${sourcePlayer.playerId}`;
  for (const planet of sourcePlayer.planets) {
    const owners = sourcePlanetOwners.get(planet.planetId) || new Set();
    owners.add(ownerKey);
    sourcePlanetOwners.set(planet.planetId, owners);
  }
}

// Сначала используем неизменные ID планет, если координатный API цели уже обновился.
for (const sourcePlayer of sourcePlayers) {
  const sourceKey = `${sourcePlayer.universeId}:${sourcePlayer.playerId}`;
  const candidateCounts = new Map();
  for (const planet of sourcePlayer.planets) {
    // В разных старых вселенных системные и ранние ID могут совпадать; такие ID не являются доказательством переноса.
    if ((sourcePlanetOwners.get(planet.planetId)?.size || 0) !== 1) continue;
    for (const candidate of targetsByPlanet.get(planet.planetId) || []) {
      candidateCounts.set(candidate, (candidateCounts.get(candidate) || 0) + 1);
    }
  }
  const candidates = [...candidateCounts.entries()].sort((a, b) => b[1] - a[1]);
  if (candidates.length && (!candidates[1] || candidates[0][1] > candidates[1][1])) {
    const [targetPlayer, matchedPlanets] = candidates[0];
    const targetKey = `${targetPlayer.universeId}:${targetPlayer.playerId}`;
    matchesBySourceKey.set(sourceKey, { targetPlayer, matchedPlanets, confidence: 'Высокая', matchMethod: 'ID планет', matchStatus: 'Подтверждён' });
    usedTargetKeys.add(targetKey);
  }
}

// Затем — уникальное точное совпадение ника.
for (const sourcePlayer of sourcePlayers) {
  const sourceKey = `${sourcePlayer.universeId}:${sourcePlayer.playerId}`;
  if (matchesBySourceKey.has(sourceKey)) continue;
  const candidates = (targetByName.get(normalizeName(sourcePlayer.name)) || [])
    .filter((candidate) => !usedTargetKeys.has(`${candidate.universeId}:${candidate.playerId}`));
  if (candidates.length === 1) {
    const [targetPlayer] = candidates;
    matchesBySourceKey.set(sourceKey, { targetPlayer, matchedPlanets: 0, confidence: 'Средняя', matchMethod: 'Уникальный точный ник', matchStatus: 'Предварительно сопоставлен' });
    usedTargetKeys.add(`${targetPlayer.universeId}:${targetPlayer.playerId}`);
  }
}

// В последнюю очередь — практически неизменившиеся очки между последним старым и первым новым срезом.
for (const sourcePlayer of sourcePlayers) {
  const sourceKey = `${sourcePlayer.universeId}:${sourcePlayer.playerId}`;
  if (matchesBySourceKey.has(sourceKey)) continue;
  const sourceScoreInfo = sourceScoreByKey.get(sourceKey);
  if (!sourceScoreInfo?.row.score) continue;
  const tolerance = Math.max(1000, Math.round(sourceScoreInfo.row.score * 0.00001));
  const candidates = targetPlayers
    .filter((candidate) => !usedTargetKeys.has(`${candidate.universeId}:${candidate.playerId}`))
    .map((candidate) => ({ candidate, first: firstTargetByKey.get(`${candidate.universeId}:${candidate.playerId}`) }))
    .filter(({ first }) => first && first.date >= sourceScoreInfo.date)
    .map(({ candidate, first }) => ({ candidate, difference: Math.abs(first.row.score - sourceScoreInfo.row.score) }))
    .filter(({ difference }) => difference <= tolerance)
    .sort((a, b) => a.difference - b.difference);
  if (candidates.length === 1 || (candidates.length > 1 && candidates[0].difference * 5 < candidates[1].difference)) {
    const targetPlayer = candidates[0].candidate;
    matchesBySourceKey.set(sourceKey, { targetPlayer, matchedPlanets: 0, confidence: 'Низкая', matchMethod: `Очки ±${tolerance}`, matchStatus: 'Требует ручной проверки' });
    usedTargetKeys.add(`${targetPlayer.universeId}:${targetPlayer.playerId}`);
  }
}

const rows = [];
for (const sourcePlayer of sourcePlayers) {
  const sourceKey = `${sourcePlayer.universeId}:${sourcePlayer.playerId}`;
  const match = matchesBySourceKey.get(sourceKey);
  const targetPlayer = match?.targetPlayer || null;
  const matchedPlanets = match?.matchedPlanets || 0;
  const confidence = match?.confidence || 'Нет';
  const matchMethod = match?.matchMethod || 'Не найден';
  const matchStatus = match?.matchStatus || 'Не найден в целевых вселенных';
  const sourceScoreInfo = sourceScoreByKey.get(sourceKey) || null;

  const targetCurrent = targetPlayer ? currentByKey.get(`${targetPlayer.universeId}:${targetPlayer.playerId}`) : null;
  const appearances = targetPlayer ? firstTargetAppearances(history, targetPlayer, sourcePlayer) : [];
  const firstSeen = appearances[0]?.date || '';
  const journey = appearances
    .filter((entry, index, list) => index === 0 || entry.universeId !== list[index - 1].universeId || entry.playerId !== list[index - 1].playerId)
    .map((entry) => `${entry.date}: ${entry.universeName} (${entry.playerId})`)
    .join(' → ');
  const zeroScore = Boolean(targetPlayer && (!targetCurrent || targetCurrent.score === 0));
  let note = '';
  if (zeroScore) note = [note, 'В актуальном рейтинге нет очков или указано 0'].filter(Boolean).join('; ');
  if (appearances.some((entry) => targetPlayer && entry.universeId !== targetPlayer.universeId)) {
    note = [note, 'Обнаружена промежуточная целевая вселенная; возможен перенос оператором'].filter(Boolean).join('; ');
  }
  if (sourcePlayer.universeName === 'Capella' && sourcePlayer.name === 'Zero Day') {
    note = [
      note,
      'По информации владельца: после hard merge аккаунт был перенесён оператором в Scorpius; промежуточная цель не попала в суточные снимки'
    ].filter(Boolean).join('; ');
  }

  rows.push({
    matchStatus,
    confidence,
    transferType: targetPlayer ? transferLabel(firstSeen) : 'Не определён',
    firstSeenInTarget: firstSeen,
    sourceUniverse: sourcePlayer.universeName,
    sourceUniverseId: sourcePlayer.universeId,
    sourcePlayerId: sourcePlayer.playerId,
    sourceName: sourcePlayer.name,
    sourceAlliance: sourcePlayer.allianceTag || '',
    targetUniverse: targetPlayer?.universeName || '',
    targetUniverseId: targetPlayer?.universeId || '',
    targetPlayerId: targetPlayer?.playerId || '',
    targetName: targetPlayer?.name || '',
    targetAlliance: targetPlayer?.allianceTag || '',
    sourceScore: sourceScoreInfo?.row.score ?? null,
    sourceScoreDate: sourceScoreInfo?.date || '',
    targetScore: targetCurrent?.score ?? null,
    targetPosition: targetCurrent?.position ?? null,
    matchedPlanets,
    sourcePlanetCount: sourcePlayer.planetCount,
    targetPlanetCount: targetPlayer?.planetCount ?? null,
    zeroScore: zeroScore ? 'Да' : 'Нет',
    journey,
    matchMethod,
    note
  });
}

rows.sort((a, b) => a.sourceUniverse.localeCompare(b.sourceUniverse, 'ru') || (b.sourceScore || 0) - (a.sourceScore || 0));
const summary = {
  totalSourcePlayers: rows.length,
  confirmedByPlanets: rows.filter((row) => row.matchMethod === 'ID планет').length,
  matchedByName: rows.filter((row) => row.matchMethod === 'Уникальный точный ник').length,
  matchedByScoreNeedsReview: rows.filter((row) => row.matchMethod.startsWith('Очки')).length,
  notFound: rows.filter((row) => row.matchStatus === 'Не найден в целевых вселенных').length,
  voluntaryBeforeHardMerge: rows.filter((row) => row.transferType === 'Самостоятельно до hard merge').length,
  hardMerge: rows.filter((row) => row.transferType === 'Hard merge (сам не переходил)').length,
  zeroScore: rows.filter((row) => row.zeroScore === 'Да').length
};
const output = {
  generatedAt: new Date().toISOString(),
  asOfDate: AS_OF_DATE,
  hardMergeDate: HARD_MERGE_DATE,
  sourceSnapshotGeneratedAt: sourceIndex.generatedAt,
  targetSnapshots: targetSnapshots.map((snapshot) => ({
    universeId: snapshot.universeId,
    universeName: snapshot.universeName,
    apiTimestamp: snapshot.apiTimestamp,
    playerCount: snapshot.playerCount,
    coordinateApiCurrent: snapshot.apiTimestamp.slice(0, 10) >= HARD_MERGE_DATE
  })),
  classificationRules: {
    confirmed: 'Совпадение хотя бы одного неизменного ID планеты (если координатный API цели обновлён)',
    voluntary: `Первое появление в целевой вселенной раньше ${HARD_MERGE_DATE}`,
    hardMerge: `Первое появление в целевой вселенной ${HARD_MERGE_DATE} или позже`,
    review: 'Совпадение только по нику или очкам следует перепроверить в финальной версии'
  },
  summary,
  rows
};

await fs.writeFile(path.join(MERGE_DIR, `migration-draft-${AS_OF_DATE}.json`), `${JSON.stringify(output, null, 2)}\n`);
await fs.writeFile(path.join(MERGE_DIR, `migration-draft-${AS_OF_DATE}.csv`), `\uFEFF${toCsv(rows)}\r\n`);
await fs.writeFile(path.join(MERGE_DIR, `MIGRATION-DRAFT-${AS_OF_DATE}.md`), `# Черновик переходов игроков на ${AS_OF_DATE}\n\n` +
  `Это промежуточная сверка слияния OGame RU. Финальную версию следует пересобрать после завершения ручных переносов операторами и обновления API координат.\n\n` +
  `- Исходных аккаунтов: **${summary.totalSourcePlayers}**\n` +
  `- Найдено в целевых вселенных: **${summary.totalSourcePlayers - summary.notFound}**\n` +
  `- Самостоятельно перешли до hard merge: **${summary.voluntaryBeforeHardMerge}**\n` +
  `- Появились во время/после hard merge: **${summary.hardMerge}**\n` +
  `- Требуют проверки по очкам: **${summary.matchedByScoreNeedsReview}**\n` +
  `- С нулевыми очками: **${summary.zeroScore}**\n` +
  `- Пока не найдены: **${summary.notFound}**\n\n` +
  `Файлы: [CSV](migration-draft-${AS_OF_DATE}.csv) · [JSON](migration-draft-${AS_OF_DATE}.json) · [снимки API целей](target-planets/${AS_OF_DATE}/).\n\n` +
  `## Как определялся способ переноса\n\n` +
  `Первое появление в целевой вселенной до ${HARD_MERGE_DATE} помечается как самостоятельный переход. Появление ${HARD_MERGE_DATE} или позже — как hard merge (игрок сам не переходил).\n\n` +
  `## Ограничение черновика\n\n` +
  `Координатные API Quasi-Stellar, Regulus и Scorpius на момент сборки всё ещё отдавали снимки от 06.11.2026. Поэтому точные совпадения по ID планет доступны главным образом для Universe 1; остальные аккаунты предварительно сопоставлены по уникальному нику и очкам.\n`);
await fs.writeFile(path.join(targetDir, 'index.json'), `${JSON.stringify({
  generatedAt: output.generatedAt,
  asOfDate: AS_OF_DATE,
  universes: output.targetSnapshots
}, null, 2)}\n`);

console.log(JSON.stringify({ asOfDate: AS_OF_DATE, summary }, null, 2));
