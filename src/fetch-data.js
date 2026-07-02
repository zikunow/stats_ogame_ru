import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_FILE = resolve(ROOT_DIR, 'data', 'ogame-ru.json');

const UNIVERSES_URL = 'https://s1-ru.ogame.gameforge.com/api/universes.xml';
const HIGHSCORE_TYPES = [
  { id: '0', label: 'Очки' },
  { id: '1', label: 'Экономика' },
  { id: '3', label: 'Флот' },
  { id: '2', label: 'Исследования' },
  { id: '4', label: 'Построено военного' },
  { id: '5', label: 'Уничтожено' },
  { id: '6', label: 'Потеряно' },
  { id: '7', label: 'Очки чести' }
];

const REQUEST_TIMEOUT_MS = 30000;
const UNIVERSE_CONCURRENCY = 4;
const FETCH_RETRIES = 3;
const RETRY_DELAY_MS = 900;

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

  while ((match = pattern.exec(source))) {
    attrs[match[1]] = decodeXml(match[2]);
  }

  return attrs;
}

function parseElements(xml, tagName) {
  const elements = [];
  const pattern = new RegExp(`<${tagName}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${tagName}>)`, 'g');
  let match;

  while ((match = pattern.exec(xml))) {
    elements.push({
      attrs: parseAttributes(match[1]),
      content: match[2] || ''
    });
  }

  return elements;
}

function readTextTag(xml, tagName, fallback = '') {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`);
  const match = xml.match(pattern);
  return match ? decodeXml(match[1].trim()) : fallback;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function fetchXml(url, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ogame-ru-dashboard/1.0' }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    if (attempt < FETCH_RETRIES) {
      await delay(RETRY_DELAY_MS * attempt);
      return fetchXml(url, attempt + 1);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseUniverses(xml) {
  return parseElements(xml, 'universe').map(({ attrs }) => ({
    id: attrs.id,
    href: attrs.href,
    apiBase: `${attrs.href}/api`
  }));
}

function parseServerData(xml, fallbackId, href) {
  const number = readTextTag(xml, 'number', fallbackId);
  const name = readTextTag(xml, 'name', '');
  const speed = toNumber(readTextTag(xml, 'speed', '0'));
  const speedFleetPeaceful = toNumber(readTextTag(xml, 'speedFleetPeaceful', '0'));
  const speedFleetWar = toNumber(readTextTag(xml, 'speedFleetWar', '0'));
  const debrisFactor = toNumber(readTextTag(xml, 'debrisFactor', '0'));

  return {
    id: String(number || fallbackId),
    serverId: parseAttributes(xml.match(/<serverData\b([^>]*)>/)?.[1] || '').serverId || `ru${fallbackId}`,
    name: name || `Universe ${number || fallbackId}`,
    href,
    speed,
    speedFleetPeaceful,
    speedFleetWar,
    debrisFactor,
    debrisPercent: Math.round(debrisFactor * 1000) / 10
  };
}

function parsePlayers(xml) {
  const players = new Map();

  for (const { attrs } of parseElements(xml, 'player')) {
    players.set(attrs.id, {
      id: attrs.id,
      name: attrs.name || `Player ${attrs.id}`,
      status: attrs.status || '',
      allianceId: attrs.alliance || ''
    });
  }

  return players;
}

function parseAlliances(xml) {
  const alliances = new Map();

  for (const { attrs } of parseElements(xml, 'alliance')) {
    alliances.set(attrs.id, {
      id: attrs.id,
      name: attrs.name || '',
      tag: attrs.tag || ''
    });
  }

  return alliances;
}

function parseHighscore(xml) {
  return parseElements(xml, 'player').map(({ attrs }) => ({
    id: attrs.id,
    position: toNumber(attrs.position),
    score: toNumber(attrs.score),
    ships: attrs.ships === undefined ? null : toNumber(attrs.ships)
  }));
}

async function fetchUniverse(universeRef) {
  const base = universeRef.apiBase;
  const serverXml = await fetchXml(`${base}/serverData.xml`);
  const server = parseServerData(serverXml, universeRef.id, universeRef.href);

  const [playersXml, alliancesXml] = await Promise.all([
    fetchXml(`${base}/players.xml`),
    fetchXml(`${base}/alliances.xml`)
  ]);
  const highscoreXmls = [];

  for (const type of HIGHSCORE_TYPES) {
    highscoreXmls.push(await fetchXml(`${base}/highscore.xml?category=1&type=${type.id}`));
    await delay(120);
  }

  const players = parsePlayers(playersXml);
  const alliances = parseAlliances(alliancesXml);
  const stats = {};

  HIGHSCORE_TYPES.forEach((type, index) => {
    stats[type.id] = parseHighscore(highscoreXmls[index]).map((entry) => {
      const player = players.get(entry.id);
      const alliance = player?.allianceId ? alliances.get(player.allianceId) : null;
      const status = player?.status || '';
      const isVacation = status.includes('v');

      return {
        universeId: server.id,
        universeName: server.name,
        playerId: entry.id,
        position: entry.position,
        name: player?.name || `Player ${entry.id}`,
        displayName: `${player?.name || `Player ${entry.id}`}${isVacation ? ' (РО)' : ''}`,
        status,
        isVacation,
        allianceTag: alliance?.tag || '',
        allianceId: player?.allianceId || '',
        score: entry.score,
        ships: entry.ships,
        speed: server.speed,
        speedFleetPeaceful: server.speedFleetPeaceful,
        speedFleetWar: server.speedFleetWar,
        debrisPercent: server.debrisPercent
      };
    });
  });

  return {
    universe: {
      ...server,
      playerCount: players.size,
      allianceCount: alliances.size,
      status: 'ok'
    },
    stats
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function buildDashboardData({ universeLimit = 0 } = {}) {
  const universesXml = await fetchXml(UNIVERSES_URL);
  const allUniverseRefs = parseUniverses(universesXml);
  const universeRefs = universeLimit > 0 ? allUniverseRefs.slice(0, universeLimit) : allUniverseRefs;
  const stats = Object.fromEntries(HIGHSCORE_TYPES.map((type) => [type.id, []]));
  const universes = [];
  const failures = [];

  const results = await mapWithConcurrency(universeRefs, UNIVERSE_CONCURRENCY, async (universeRef) => {
    try {
      return await fetchUniverse(universeRef);
    } catch (error) {
      return {
        universe: {
          id: universeRef.id,
          serverId: `ru${universeRef.id}`,
          name: `Universe ${universeRef.id}`,
          href: universeRef.href,
          status: 'failed',
          error: error.message
        },
        stats: null
      };
    }
  });

  for (const result of results) {
    universes.push(result.universe);

    if (result.universe.status === 'failed') {
      failures.push(result.universe);
      continue;
    }

    for (const type of HIGHSCORE_TYPES) {
      stats[type.id].push(...result.stats[type.id]);
    }
  }

  for (const type of HIGHSCORE_TYPES) {
    stats[type.id].sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      return a.universeName.localeCompare(b.universeName, 'ru');
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    source: {
      universesUrl: UNIVERSES_URL,
      category: 1
    },
    highscoreTypes: HIGHSCORE_TYPES,
    universes,
    failures,
    stats
  };
}

export async function refreshData(options = {}) {
  const data = await buildDashboardData(options);
  await mkdir(dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return data;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const universeLimit = limitArg ? toNumber(limitArg.split('=')[1]) : toNumber(process.env.UNIVERSE_LIMIT || '0');

  refreshData({ universeLimit })
    .then((data) => {
      const okCount = data.universes.filter((universe) => universe.status === 'ok').length;
      console.log(`Saved ${DATA_FILE}`);
      console.log(`Universes: ${okCount}/${data.universes.length} ok`);
      if (data.failures.length > 0) {
        console.log(`Failures: ${data.failures.map((universe) => universe.id).join(', ')}`);
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
