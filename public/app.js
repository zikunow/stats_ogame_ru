const state = {
  data: null,
  activeType: '0',
  universe: 'all',
  columnFilters: {
    speed: 'all',
    speedFleetPeaceful: 'all',
    speedFleetWar: 'all',
    debrisPercent: 'all'
  },
  limit: '100',
  playerStatus: 'all',
  query: '',
  sortKey: 'score',
  sortDirection: 'desc',
  historyDate: 'latest',
  deltaPeriod: '1d',
  periodComparison: null,
  historyIndex: null,
  snapshotDate: '',
  universeSelectionInitialized: false
};

const HISTORY_INDEX_URL = new URL('data/history/index.json', window.location.href);
const statCache = new Map();
const comparisonCache = new Map();
const TAB_ORDER = ['0', '1', '2', 'fleet', 'ships', 'defense', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
const TAB_LABELS = {
  0: 'Очки',
  1: 'Экономика',
  2: 'Исследования',
  3: 'Боевая мощь',
  defense: 'Оборона',
  fleet: 'Очки флота',
  ships: 'Количество кораблей',
  4: 'Потеряно',
  5: 'Построено',
  6: 'Уничтожены',
  7: 'Очки чести',
  8: 'Формы жизни',
  9: 'Здания ФЖ',
  10: 'Технологии ФЖ',
  11: 'Артефакты'
};
const STAT_GROUPS = [
  { id: '0', label: 'Очки' },
  { id: '1', label: 'Экономика' },
  { id: '2', label: 'Исследования' },
  { label: 'Флот', types: ['fleet', 'ships'] },
  { id: 'defense', label: 'Оборона' },
  { label: 'Боевая мощь', types: ['3', '5', '6', '4'] },
  { id: '7', label: 'Очки чести' },
  { label: 'Формы жизни', types: ['8', '9', '10', '11'] }
];
const COLUMN_STORAGE_KEY = 'ogame-ru-visible-columns-v3';
const THEME_STORAGE_KEY = 'ogame-ru-theme';
const UNIVERSE_STORAGE_KEY = 'ogame-ru-universe-v1';
const TABLE_COLUMNS = [
  { key: 'rank', label: 'Место' },
  { key: 'displayName', label: 'Ник' },
  { key: 'allianceTag', label: 'Альянс' },
  { key: 'score', label: 'Очки' },
  { key: 'scoreDelta', label: 'Изменение' },
  { key: 'scoreBreakdown', label: 'Состав очков' },
  { key: 'universeName', label: 'Вселенная' },
  { key: 'position', label: 'Топ вселенной' },
  { key: 'speed', label: 'Eco' },
  { key: 'speedFleetPeaceful', label: 'Мирный флот' },
  { key: 'speedFleetWar', label: 'Боевой флот' },
  { key: 'debrisPercent', label: 'Лом' }
];
const DEFAULT_VISIBLE_COLUMNS = TABLE_COLUMNS.map((column) => column.key);

const elements = {
  metaLine: document.querySelector('#metaLine'),
  themeToggle: document.querySelector('#themeToggle'),
  themeToggleIcon: document.querySelector('#themeToggleIcon'),
  themeToggleLabel: document.querySelector('#themeToggleLabel'),
  columnSettingsButton: document.querySelector('#columnSettingsButton'),
  columnSettingsPanel: document.querySelector('#columnSettingsPanel'),
  columnSettings: document.querySelector('#columnSettings'),
  universeFilter: document.querySelector('#universeFilter'),
  columnFilterHeaders: document.querySelectorAll('.columnFilterHeader'),
  limitFilter: document.querySelector('#limitFilter'),
  timeframeFilter: document.querySelector('#timeframeFilter'),
  archiveDatePicker: document.querySelector('#archiveDatePicker'),
  playerStatusFilter: document.querySelector('#playerStatusFilter'),
  searchInput: document.querySelector('#searchInput'),
  tabs: document.querySelector('#tabs'),
  statusBox: document.querySelector('#statusBox'),
  tableBody: document.querySelector('#tableBody'),
  scoreHeader: document.querySelector('#scoreHeader'),
  scoreHeaderLabel: document.querySelector('#scoreHeaderLabel'),
  scoreSortButton: document.querySelector('#scoreSortButton'),
  scoreSortIndicator: document.querySelector('#scoreSortIndicator'),
  scoreDeltaHeader: document.querySelector('#scoreDeltaHeader'),
  scoreDeltaSortButton: document.querySelector('#scoreDeltaSortButton'),
  scoreDeltaHeaderLabel: document.querySelector('#scoreDeltaHeaderLabel'),
  positionHeader: document.querySelector('#positionHeader')
};

state.visibleColumns = loadVisibleColumns();
updateThemeToggle();

function updateThemeToggle() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  elements.themeToggle.setAttribute('aria-pressed', String(isDark));
  elements.themeToggle.setAttribute('aria-label', isDark ? 'Включить светлую тему' : 'Включить тёмную тему');
  elements.themeToggle.title = isDark ? 'Включить светлую тему' : 'Включить тёмную тему';
  elements.themeToggleIcon.textContent = isDark ? '☀' : '☾';
  elements.themeToggleLabel.textContent = isDark ? 'Светлая' : 'Тёмная';
}

function toggleTheme() {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {}
  updateThemeToggle();
}

function formatNumber(value) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatDate(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function setStatus(message, type = 'info') {
  if (!message) {
    elements.statusBox.hidden = true;
    elements.statusBox.textContent = '';
    elements.statusBox.className = 'status';
    return;
  }

  elements.statusBox.hidden = false;
  elements.statusBox.textContent = message;
  elements.statusBox.className = `status${type === 'error' ? ' error' : ''}`;
}

function loadVisibleColumns() {
  try {
    const savedColumns = JSON.parse(localStorage.getItem(COLUMN_STORAGE_KEY) || '[]');
    const allowedColumns = new Set(TABLE_COLUMNS.map((column) => column.key));
    const visibleColumns = savedColumns.filter((column) => allowedColumns.has(column));
    return visibleColumns.length > 0 ? visibleColumns : DEFAULT_VISIBLE_COLUMNS;
  } catch {
    return DEFAULT_VISIBLE_COLUMNS;
  }
}

function saveVisibleColumns() {
  localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(state.visibleColumns));
}

function normalizeUniverseSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function findUniverse(value) {
  const rawValue = String(value || '').trim();
  const normalizedValue = normalizeUniverseSlug(rawValue);
  if (!normalizedValue || normalizedValue === 'all') return null;

  return state.data.universes.find((universe) => (
    String(universe.id) === rawValue
    || String(universe.serverId).toLowerCase() === rawValue.toLowerCase()
    || normalizeUniverseSlug(universe.name) === normalizedValue
  )) || null;
}

function saveUniverseSelection() {
  try {
    localStorage.setItem(UNIVERSE_STORAGE_KEY, state.universe);
  } catch {}
}

function syncUniverseUrl() {
  const url = new URL(window.location.href);
  const universe = findUniverse(state.universe);

  if (universe) {
    url.searchParams.set('universe', normalizeUniverseSlug(universe.name));
  } else {
    url.searchParams.delete('universe');
  }

  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function initializeUniverseSelection() {
  if (state.universeSelectionInitialized) return;

  const url = new URL(window.location.href);
  const hasUniverseParameter = url.searchParams.has('universe');
  let requestedUniverse = hasUniverseParameter ? url.searchParams.get('universe') : 'all';

  if (!hasUniverseParameter) {
    try {
      requestedUniverse = localStorage.getItem(UNIVERSE_STORAGE_KEY) || 'all';
    } catch {}
  }

  state.universe = findUniverse(requestedUniverse)?.id || 'all';
  state.universeSelectionInitialized = true;
  saveUniverseSelection();
  syncUniverseUrl();
}

async function loadData(historyDate = state.historyDate) {
  await loadHistoryIndex();
  const snapshotDate = historyDate === 'latest' ? state.historyIndex.latest : historyDate;
  if (!snapshotDate) throw new Error('Нет доступных снимков данных');

  const response = await fetch(
    new URL(`data/history/${snapshotDate}/meta.json`, window.location.href)
  );
  if (!response.ok) throw new Error('Не удалось загрузить данные');
  const payload = await response.json();

  state.historyDate = historyDate;
  state.snapshotDate = snapshotDate;
  state.data = { ...payload, stats: {} };
  state.periodComparison = null;
  initializeUniverseSelection();
  await loadStatData(state.activeType);
  await loadPeriodComparison(state.activeType);
  renderStaticControls();
  render();
}

async function loadHistoryIndex() {
  if (state.historyIndex) return;

  try {
    const response = await fetch(HISTORY_INDEX_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error('Не удалось загрузить список снимков');
    state.historyIndex = await response.json();
  } catch {
    state.historyIndex = { latest: '', snapshots: [] };
  }
}

async function loadStatData(type) {
  const cacheKey = `${state.snapshotDate}:${type}`;
  let request = statCache.get(cacheKey);

  if (!request) {
    request = fetch(
      new URL(`data/history/${state.snapshotDate}/stats/${type}.json`, window.location.href)
    ).then(async (response) => {
      if (!response.ok) throw new Error('Не удалось загрузить рейтинг');
      return response.json();
    }).catch((error) => {
      statCache.delete(cacheKey);
      throw error;
    });
    statCache.set(cacheKey, request);
  }

  state.data.stats[type] = await request;
}

async function loadPeriodComparison(type = state.activeType) {
  const period = getEffectiveDeltaPeriod();
  const comparisonDate = getPeriodComparisonDate(period);

  if (period === '1d' || !comparisonDate) {
    state.periodComparison = {
      snapshotDate: state.snapshotDate,
      comparisonDate,
      period,
      type,
      scores: null
    };
    return;
  }

  if (period === 'all') {
    const firstSnapshots = state.historyIndex?.universeFirstSnapshots || {};
    const universeDates = Object.fromEntries(state.data.universes.map((universe) => [
      universe.id,
      firstSnapshots[universe.id] || getUniverseFirstSnapshot(universe.id)
    ]));
    const comparisonDates = [...new Set(Object.values(universeDates).filter(Boolean))];
    const scoreMaps = new Map(await Promise.all(comparisonDates.map(async (date) => [
      date,
      await loadComparisonScores(date, type)
    ])));
    const scores = new Map();

    for (const [date, scoreMap] of scoreMaps) {
      for (const [key, score] of scoreMap) {
        const universeId = key.slice(0, key.indexOf(':'));
        if (universeDates[universeId] === date) scores.set(key, score);
      }
    }

    state.periodComparison = {
      snapshotDate: state.snapshotDate,
      comparisonDate,
      comparisonDates: universeDates,
      period,
      type,
      scores
    };
    return;
  }

  state.periodComparison = {
    snapshotDate: state.snapshotDate,
    comparisonDate,
    period,
    type,
    scores: await loadComparisonScores(comparisonDate, type)
  };
}

async function loadComparisonScores(comparisonDate, type) {
  const cacheKey = `${comparisonDate}:${type}`;
  let request = comparisonCache.get(cacheKey);
  if (!request) {
    request = fetch(
      new URL(`data/history/${comparisonDate}/stats/${type}.json`, window.location.href)
    ).then(async (response) => {
      if (!response.ok) throw new Error('Не удалось загрузить данные для сравнения');
      const rows = await response.json();
      return new Map(rows.map((row) => [
        `${row.universeId}:${row.playerId}`,
        row.score
      ]));
    }).catch((error) => {
      comparisonCache.delete(cacheKey);
      throw error;
    });
    comparisonCache.set(cacheKey, request);
  }
  return request;
}

function renderStaticControls() {
  const availableTypes = new Set((state.data.highscoreTypes || []).map((type) => type.id));
  elements.tabs.innerHTML = STAT_GROUPS
    .map((group) => renderStatControl(group, availableTypes))
    .join('');

  const universeOptions = [
    '<option value="all">Все вселенные</option>',
    ...state.data.universes.map((universe) => {
      const label = universe.status === 'ok'
        ? `${universe.name} (${universe.serverId})`
        : `${universe.name} (${universe.serverId}, ошибка)`;
      return `<option value="${universe.id}">${escapeHtml(label)}</option>`;
    })
  ].join('');

  elements.universeFilter.innerHTML = universeOptions;
  renderTimeframeFilter();
  renderColumnSettings();
  renderColumnFilterMenus();
}

function renderStatControl(group, availableTypes) {
  if (group.id) {
    if (!availableTypes.has(group.id)) return '';
    return `<button class="tab" type="button" data-type="${group.id}">${TAB_LABELS[group.id] || group.label}</button>`;
  }

  const types = group.types.filter((type) => availableTypes.has(type));
  if (types.length === 0) return '';
  const isActive = types.includes(state.activeType);
  const activeLabel = isActive ? `${group.label} / ${TAB_LABELS[state.activeType]}` : group.label;

  return `
    <div class="statGroup">
      <button class="tab statGroupButton${isActive ? ' active' : ''}" type="button" aria-expanded="false">
        <span>${escapeHtml(activeLabel)}</span>
        <span class="settingsChevron" aria-hidden="true">▾</span>
      </button>
      <div class="statMenu" hidden>
        ${types.map((type) => `
          <button class="statOption${type === state.activeType ? ' selected' : ''}" type="button" data-type="${type}">
            ${escapeHtml(TAB_LABELS[type])}
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function parseSnapshotDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function subtractDays(value, days) {
  const date = parseSnapshotDate(value);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function findSnapshotAtOrBefore(targetDate, snapshotDate = state.snapshotDate) {
  return (state.historyIndex?.snapshots || [])
    .filter((date) => date < snapshotDate && date <= targetDate)
    .sort()
    .at(-1) || '';
}

function getLongPeriod(snapshotDate = state.snapshotDate) {
  const thirtyDayDate = findSnapshotAtOrBefore(subtractDays(snapshotDate, 30), snapshotDate);
  if (thirtyDayDate) return { value: '30d', label: '30 дней', days: 30 };

  const fourteenDayDate = findSnapshotAtOrBefore(subtractDays(snapshotDate, 14), snapshotDate);
  return fourteenDayDate ? { value: '14d', label: '14 дней', days: 14 } : null;
}

function getDeltaPeriodOptions(snapshotDate = state.snapshotDate) {
  const options = [{ value: '1d', label: '1 день' }];
  if (findSnapshotAtOrBefore(subtractDays(snapshotDate, 7), snapshotDate)) {
    options.push({ value: '7d', label: '7 дней', days: 7 });
  }
  const longPeriod = getLongPeriod(snapshotDate);
  if (longPeriod) options.push(longPeriod);
  if ((state.historyIndex?.snapshots || []).some((date) => date < snapshotDate)) {
    options.push({ value: 'all', label: getAllTimeOptionLabel() });
  }
  return options;
}

function getUniverseFirstSnapshot(universeId) {
  const firstSnapshots = state.historyIndex?.universeFirstSnapshots || {};
  if (universeId && universeId !== 'all' && firstSnapshots[universeId]) {
    return firstSnapshots[universeId];
  }

  return [...(state.historyIndex?.snapshots || [])].sort()[0] || '';
}

function getAllTimeOptionLabel() {
  if (state.universe === 'all') return 'Всё время (с начала каждой вселенной)';
  const firstSnapshot = getUniverseFirstSnapshot(state.universe);
  return firstSnapshot
    ? `Всё время (с ${formatHistoryDate(firstSnapshot)})`
    : 'Всё время';
}

function getEffectiveDeltaPeriod() {
  return state.historyDate === 'latest' ? state.deltaPeriod : '1d';
}

function getPeriodComparisonDate(period = getEffectiveDeltaPeriod()) {
  if (period === '1d') return state.data.comparisonDate || '';
  if (period === 'all') return getUniverseFirstSnapshot(state.universe);

  const days = Number.parseInt(period, 10);
  return findSnapshotAtOrBefore(subtractDays(state.snapshotDate, days));
}

function getDeltaPeriodLabel(period = getEffectiveDeltaPeriod()) {
  if (period === '7d') return 'За 7 дней';
  if (period === '14d') return 'За 14 дней';
  if (period === '30d') return 'За 30 дней';
  if (period === 'all') return 'За всё время';
  return 'За день';
}

function getDeltaComparisonTitle() {
  const comparison = state.periodComparison;
  if (!comparison?.comparisonDate) return 'Предыдущий снимок недоступен';

  if (comparison.period === 'all') {
    if (state.universe !== 'all') {
      const date = comparison.comparisonDates?.[state.universe] || comparison.comparisonDate;
      return `Изменение с первого снимка вселенной: ${formatHistoryDate(date)}`;
    }

    const dates = [...new Set(Object.values(comparison.comparisonDates || {}).filter(Boolean))].sort();
    const range = dates.length > 1
      ? ` (${formatHistoryDate(dates[0])}–${formatHistoryDate(dates.at(-1))})`
      : dates[0] ? ` (${formatHistoryDate(dates[0])})` : '';
    return `Для каждой вселенной изменение считается с её первого снимка${range}`;
  }

  return `Изменение относительно ${formatHistoryDate(comparison.comparisonDate)}`;
}

function renderTimeframeFilter() {
  const latestDate = state.historyIndex.latest;
  const periodOptions = getDeltaPeriodOptions(latestDate);
  if (!periodOptions.some((option) => option.value === state.deltaPeriod)) {
    state.deltaPeriod = '1d';
  }

  const archiveOption = state.historyDate === 'latest'
    ? []
    : [`<option value="archive:${state.snapshotDate}">${formatHistoryDate(state.snapshotDate)} (архив)</option>`];
  elements.timeframeFilter.innerHTML = [
    ...archiveOption,
    `<option value="latest:1d">${formatHistoryDate(latestDate)} (актуальная)</option>`,
    ...periodOptions.filter((option) => option.value !== '1d').map((option) => (
      `<option value="latest:${option.value}">${escapeHtml(option.label)}</option>`
    )),
    '<option disabled>──────────</option>',
    '<option value="choose-date">Выбрать точную дату…</option>'
  ].join('');
  elements.timeframeFilter.value = state.historyDate === 'latest'
    ? `latest:${state.deltaPeriod}`
    : `archive:${state.snapshotDate}`;

  const snapshots = [...(state.historyIndex?.snapshots || [])].sort();
  elements.archiveDatePicker.min = snapshots[0] || '';
  elements.archiveDatePicker.max = latestDate || '';
  elements.archiveDatePicker.value = state.snapshotDate || latestDate || '';
}

function formatHistoryDate(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date(`${value}T00:00:00`));
}

function renderColumnSettings() {
  const visibleSet = new Set(state.visibleColumns);
  const checkedCount = state.visibleColumns.length;

  elements.columnSettings.innerHTML = TABLE_COLUMNS.map((column) => {
    const checked = visibleSet.has(column.key) ? ' checked' : '';
    const disabled = checkedCount === 1 && visibleSet.has(column.key) ? ' disabled' : '';
    return `
      <label>
        <input type="checkbox" value="${column.key}"${checked}${disabled}>
        <span>${escapeHtml(column.label)}</span>
      </label>
    `;
  }).join('');
}

renderColumnSettings();

function escapeHtml(value = '') {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getVisibleRows() {
  const query = state.query.trim().toLowerCase();
  let rows = state.data.stats[state.activeType] || [];

  const period = getEffectiveDeltaPeriod();
  const comparison = state.periodComparison;
  if (
    period !== '1d'
    && comparison?.snapshotDate === state.snapshotDate
    && comparison?.period === period
    && comparison?.type === state.activeType
    && comparison.scores
  ) {
    rows = rows.map((row) => {
      const previousScore = comparison.scores.get(`${row.universeId}:${row.playerId}`);
      const isNew = !Number.isFinite(previousScore);
      return {
        ...row,
        scoreDelta: isNew ? null : row.score - previousScore,
        scoreDeltaIsNew: isNew
      };
    });
  } else {
    const hasComparison = Boolean(state.data.comparisonDate);
    rows = rows.map((row) => ({
      ...row,
      scoreDeltaIsNew: hasComparison && !Number.isFinite(row.scoreDelta)
    }));
  }

  if (state.universe !== 'all') {
    rows = rows.filter((row) => row.universeId === state.universe);
  }

  rows = rows.filter((row) => matchesPlayerStatus(row.status));

  for (const [key, value] of Object.entries(state.columnFilters)) {
    if (value === 'all') continue;
    rows = rows.filter((row) => String(row[key]) === value);
  }

  const rankByPlayer = new Map(
    [...rows]
      .sort(compareTopRankRows)
      .map((row, index) => [`${row.universeId}:${row.playerId}`, index + 1])
  );

  rows = rows.map((row, index) => ({
    ...row,
    rank: rankByPlayer.get(`${row.universeId}:${row.playerId}`) || index + 1
  }));

  if (query) {
    rows = rows.filter((row) => (
      row.displayName.toLowerCase().includes(query)
      || row.allianceTag.toLowerCase().includes(query)
      || row.universeName.toLowerCase().includes(query)
    ));
  }

  rows = [...rows].sort((a, b) => compareRows(a, b));

  if (state.limit !== 'all') {
    rows = rows.slice(0, Number(state.limit));
  }

  return rows;
}

function compareTopRankRows(a, b) {
  if (a.score !== b.score) return b.score - a.score;
  if (a.position !== b.position) return a.position - b.position;
  return a.universeName.localeCompare(b.universeName, 'ru');
}

function compareRows(a, b) {
  const direction = state.sortDirection === 'asc' ? 1 : -1;
  const left = a[state.sortKey];
  const right = b[state.sortKey];

  if (left === null || left === undefined) return right === null || right === undefined ? 0 : 1;
  if (right === null || right === undefined) return -1;

  if (typeof left === 'number' && typeof right === 'number') {
    return (left - right) * direction;
  }

  return String(left ?? '').localeCompare(String(right ?? ''), 'ru') * direction;
}

function render() {
  if (!state.data) return;

  normalizeColumnFilters();
  const rows = getVisibleRows();
  const totalRows = state.data.stats[state.activeType]?.length || 0;
  const okUniverses = state.data.universes.filter((universe) => universe.status === 'ok').length;
  const failedUniverses = state.data.failures?.length || 0;

  elements.metaLine.textContent = `Обновлено ${formatDate(state.data.generatedAt)} · вселенных ${okUniverses}/${state.data.universes.length} · строк ${formatNumber(totalRows)}`;
  setStatus(failedUniverses > 0 ? `Не удалось скачать ${failedUniverses} вселенных. Остальные данные доступны.` : '');
  const scoreLabel = TAB_LABELS[state.activeType] || 'Очки';
  const scoreSortActive = state.sortKey === 'score';
  elements.scoreHeaderLabel.textContent = scoreLabel;
  elements.scoreSortIndicator.textContent = scoreSortActive ? '↓' : '';
  elements.scoreSortButton.setAttribute('aria-pressed', String(scoreSortActive));
  elements.scoreSortButton.setAttribute('aria-label', `Сортировать «${scoreLabel}» от большего к меньшему`);
  const deltaPeriodLabel = getDeltaPeriodLabel();
  elements.scoreDeltaHeaderLabel.textContent = deltaPeriodLabel;
  elements.scoreDeltaHeader.title = getDeltaComparisonTitle();
  const deltaSortActive = state.sortKey === 'scoreDelta';
  elements.scoreDeltaSortButton.querySelector('.sortIndicator').textContent = deltaSortActive
    ? (state.sortDirection === 'desc' ? '↓' : '↑')
    : '';
  elements.scoreDeltaSortButton.setAttribute('aria-pressed', String(deltaSortActive));
  elements.scoreDeltaSortButton.setAttribute(
    'aria-label',
    `Сортировать: ${deltaPeriodLabel.toLowerCase()}${deltaSortActive ? `, сейчас ${state.sortDirection === 'desc' ? 'по убыванию' : 'по возрастанию'}` : ''}`
  );
  elements.positionHeader.textContent = 'Топ в своей вселенной';

  elements.tabs.querySelectorAll('.tab[data-type]').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.type === state.activeType);
  });

  elements.universeFilter.value = state.universe;
  renderColumnFilterMenus();
  updateColumnFilterMenus();

  elements.tableBody.innerHTML = rows.map((row) => `
    <tr>
      <td class="rank" data-column="rank">${formatNumber(row.rank)}</td>
      <td data-column="displayName" class="${row.isVacation ? 'vacation' : ''}">${escapeHtml(row.displayName)}</td>
      <td data-column="allianceTag">${row.allianceTag ? escapeHtml(row.allianceTag) : '<span class="muted">-</span>'}</td>
      <td data-column="score">${formatNumber(row.score)}</td>
      <td data-column="scoreDelta" class="scoreDelta ${getScoreDeltaClass(row.scoreDelta, row.scoreDeltaIsNew)}">${formatScoreDelta(row.scoreDelta, row.scoreDeltaIsNew)}</td>
      <td data-column="scoreBreakdown" class="scoreBreakdownCell">${renderScoreBreakdown(row.scoreBreakdown)}</td>
      <td data-column="universeName">${escapeHtml(row.universeName)}</td>
      <td data-column="position">${formatNumber(row.position)}</td>
      <td data-column="speed">${formatNumber(row.speed)}x</td>
      <td data-column="speedFleetPeaceful">${formatNumber(row.speedFleetPeaceful)}x</td>
      <td data-column="speedFleetWar">${formatNumber(row.speedFleetWar)}x</td>
      <td data-column="debrisPercent">${formatNumber(row.debrisPercent)}%</td>
    </tr>
  `).join('');
  updateColumnVisibility();
}

function matchesPlayerStatus(status = '') {
  const isVacation = status.includes('v');
  const isInactive = status.includes('i') || status.includes('I');

  switch (state.playerStatus) {
    case 'active-only':
      return !isVacation && !isInactive;
    case 'exclude-vacation':
      return !isVacation;
    case 'exclude-inactive':
      return !isInactive;
    default:
      return true;
  }
}

function formatScoreDelta(value, isNew = false) {
  if (isNew) return 'Новый';
  if (!Number.isFinite(value)) return '—';
  if (value > 0) return `+${formatNumber(value)}`;
  if (value < 0) return `−${formatNumber(Math.abs(value))}`;
  return '0';
}

function getScoreDeltaClass(value, isNew = false) {
  if (isNew) return 'new';
  if (!Number.isFinite(value) || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}

function formatPercent(value) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)}%`;
}

function formatBreakdownTooltip(title, score, percent, details = []) {
  return [
    `${title}: ${formatPercent(percent)} · ${formatNumber(score)}`,
    ...details.map(({ label, value, detailPercent }) => (
      `${label}: ${formatPercent(detailPercent)} · ${formatNumber(value)}`
    ))
  ].join('\n');
}

function renderScoreBreakdown(breakdown) {
  if (!breakdown) return '<span class="muted">—</span>';

  const segments = [
    {
      key: 'economy',
      label: 'Эко',
      ...breakdown.economy
    },
    {
      key: 'research',
      label: 'Исследования',
      ...breakdown.research
    },
    {
      key: 'military',
      label: 'Военная мощь',
      ...breakdown.military,
      details: [
        { label: 'Флот', value: breakdown.military.fleet, detailPercent: breakdown.military.fleetPercent },
        { label: 'Оборона', value: breakdown.military.defense, detailPercent: breakdown.military.defensePercent }
      ]
    },
    {
      key: 'lifeforms',
      label: 'ФЖ',
      ...breakdown.lifeforms,
      details: [
        { label: 'Постройки ФЖ', value: breakdown.lifeforms.buildings, detailPercent: breakdown.lifeforms.buildingsPercent },
        { label: 'Технологии ФЖ', value: breakdown.lifeforms.technologies, detailPercent: breakdown.lifeforms.technologiesPercent },
        { label: 'Артефакты', value: breakdown.lifeforms.artifacts, detailPercent: breakdown.lifeforms.artifactsPercent }
      ]
    }
  ];

  const ariaLabel = segments
    .map((segment) => `${segment.label} ${formatPercent(segment.percent)}`)
    .join(', ');

  return `
    <div class="scoreBreakdown" role="img" aria-label="${escapeHtml(ariaLabel)}">
      ${segments.map((segment) => `
        <span
          class="scoreBreakdownSegment ${segment.key}"
          style="--segment-share: ${segment.percent}"
          title="${escapeHtml(formatBreakdownTooltip(
            segment.label,
            segment.score,
            segment.percent,
            segment.details || []
          ))}"
        >
          ${segment.percent >= 8 ? `<span>${Math.round(segment.percent)}%</span>` : ''}
        </span>
      `).join('')}
    </div>
  `;
}

elements.columnSettingsButton.addEventListener('click', (event) => {
  event.stopPropagation();
  setColumnSettingsOpen(elements.columnSettingsPanel.hidden);
  closeStatMenus();
  closeColumnMenus();
});

elements.columnSettingsPanel.addEventListener('click', (event) => {
  event.stopPropagation();
});

elements.tabs.addEventListener('click', (event) => {
  const groupButton = event.target.closest('.statGroupButton');
  if (groupButton) {
    event.stopPropagation();
    const group = groupButton.closest('.statGroup');
    const menu = group.querySelector('.statMenu');
    setStatMenuOpen(group, menu.hidden);
    setColumnSettingsOpen(false);
    closeColumnMenus();
    return;
  }

  const option = event.target.closest('.statOption');
  if (option) {
    event.stopPropagation();
    applyStatType(option.dataset.type);
    closeStatMenus();
    return;
  }

  const tab = event.target.closest('.tab');
  if (!tab) return;
  applyStatType(tab.dataset.type);
});

elements.universeFilter.addEventListener('change', (event) => {
  applyUniverseFilter(event.target.value);
});

document.addEventListener('click', (event) => {
  const filterButton = event.target.closest('.columnFilterButton');
  if (filterButton) {
    event.stopPropagation();
    setColumnSettingsOpen(false);
    const header = filterButton.closest('.columnFilterHeader');
    const menu = header.querySelector('.columnFilterMenu');
    setColumnMenuOpen(header, menu.hidden);
    closeStatMenus();
    return;
  }

  const option = event.target.closest('.columnFilterOption');
  if (option) {
    event.stopPropagation();
    const header = option.closest('.columnFilterHeader');
    applyColumnFilter(header.dataset.filterKey, option.dataset.value);
    setColumnMenuOpen(header, false);
    header.querySelector('.columnFilterButton').focus();
    return;
  }

  if (event.target.closest('.columnFilter')) return;
  setColumnSettingsOpen(false);
  closeColumnMenus();
  closeStatMenus();
});

elements.columnFilterHeaders.forEach((header) => {
  const button = header.querySelector('.columnFilterButton');
  const menu = header.querySelector('.columnFilterMenu');
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setColumnMenuOpen(header, true);
    menu.querySelector('.columnFilterOption')?.focus();
  });

  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    setColumnMenuOpen(header, false);
    button.focus();
  });
});

elements.limitFilter.addEventListener('change', (event) => {
  state.limit = event.target.value;
  render();
});

elements.themeToggle.addEventListener('click', toggleTheme);

elements.scoreDeltaSortButton.addEventListener('click', () => {
  if (state.sortKey === 'scoreDelta') {
    state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
  } else {
    state.sortKey = 'scoreDelta';
    state.sortDirection = 'desc';
  }
  render();
});

elements.scoreSortButton.addEventListener('click', () => {
  state.sortKey = 'score';
  state.sortDirection = 'desc';
  render();
});

elements.timeframeFilter.addEventListener('change', async (event) => {
  const choice = event.target.value;
  if (choice === 'choose-date') {
    renderTimeframeFilter();
    elements.archiveDatePicker.hidden = false;
    elements.archiveDatePicker.focus();
    try {
      elements.archiveDatePicker.showPicker();
    } catch {}
    return;
  }
  if (!choice.startsWith('latest:')) return;

  const previousPeriod = state.deltaPeriod;
  state.deltaPeriod = choice.slice('latest:'.length);
  elements.timeframeFilter.disabled = true;
  setStatus(`Загружаю сравнение «${getDeltaPeriodLabel().toLowerCase()}»...`);

  try {
    if (state.historyDate === 'latest') {
      await loadPeriodComparison();
    } else {
      await loadData('latest');
    }
    renderTimeframeFilter();
    render();
    setStatus('');
  } catch (error) {
    state.deltaPeriod = previousPeriod;
    if (state.historyDate === 'latest') await loadPeriodComparison();
    renderTimeframeFilter();
    render();
    setStatus(error.message, 'error');
  } finally {
    elements.timeframeFilter.disabled = false;
  }
});

elements.archiveDatePicker.addEventListener('change', async (event) => {
  const snapshotDate = event.target.value;
  const snapshots = state.historyIndex?.snapshots || [];
  if (!snapshots.includes(snapshotDate)) {
    setStatus('Для выбранной даты нет сохранённого снимка', 'error');
    return;
  }

  elements.archiveDatePicker.hidden = true;
  elements.timeframeFilter.disabled = true;
  state.deltaPeriod = '1d';
  setStatus('Загружаю снимок данных...');
  try {
    await loadData(snapshotDate === state.historyIndex.latest ? 'latest' : snapshotDate);
    setStatus('');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    elements.timeframeFilter.disabled = false;
  }
});

elements.archiveDatePicker.addEventListener('blur', () => {
  setTimeout(() => {
    elements.archiveDatePicker.hidden = true;
  }, 150);
});

elements.playerStatusFilter.addEventListener('change', (event) => {
  state.playerStatus = event.target.value;
  render();
});

elements.searchInput.addEventListener('input', (event) => {
  state.query = event.target.value;
  render();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    setColumnSettingsOpen(false);
    closeColumnMenus();
    closeStatMenus();
  }
});

elements.columnSettings.addEventListener('change', (event) => {
  const checkbox = event.target.closest('input[type="checkbox"]');
  if (!checkbox) return;

  const visibleColumns = new Set(state.visibleColumns);
  if (checkbox.checked) {
    visibleColumns.add(checkbox.value);
  } else if (visibleColumns.size > 1) {
    visibleColumns.delete(checkbox.value);
  }

  state.visibleColumns = TABLE_COLUMNS
    .map((column) => column.key)
    .filter((key) => visibleColumns.has(key));
  saveVisibleColumns();
  renderColumnSettings();
  updateColumnVisibility();
});

function setColumnSettingsOpen(isOpen) {
  elements.columnSettingsPanel.hidden = !isOpen;
  elements.columnSettingsButton.setAttribute('aria-expanded', String(isOpen));
}

function updateColumnVisibility() {
  const visibleColumns = new Set(state.visibleColumns);
  document.querySelectorAll('[data-column]').forEach((cell) => {
    const pointsOnlyColumn = cell.dataset.column === 'scoreBreakdown';
    cell.hidden = !visibleColumns.has(cell.dataset.column) || (pointsOnlyColumn && state.activeType !== '0');
  });
}

function applyUniverseFilter(universeId) {
  state.universe = universeId;
  saveUniverseSelection();
  syncUniverseUrl();
  normalizeColumnFilters();
  renderTimeframeFilter();
  render();
}

function applyColumnFilter(key, value) {
  state.columnFilters[key] = value;
  normalizeColumnFilters(key);
  render();
}

async function applyStatType(type) {
  if (!type || type === state.activeType) return;
  const previousType = state.activeType;
  const previousComparison = state.periodComparison;
  state.activeType = type;
  renderStaticControls();
  setStatus(`Загружаю рейтинг «${TAB_LABELS[type] || type}»...`);

  try {
    await loadStatData(type);
    await loadPeriodComparison(type);
    render();
  } catch (error) {
    state.activeType = previousType;
    state.periodComparison = previousComparison;
    renderStaticControls();
    render();
    setStatus(error.message, 'error');
  }
}

function renderColumnFilterMenus() {
  elements.columnFilterHeaders.forEach((header) => {
    const key = header.dataset.filterKey;
    const values = getColumnFilterValues(key);
    const allLabel = getColumnFilterAllLabel(key);

    header.querySelector('.columnFilterMenu').innerHTML = [
      `<button class="columnFilterOption" type="button" role="option" data-value="all">${allLabel}</button>`,
      ...values.map((value) => (
        `<button class="columnFilterOption" type="button" role="option" data-value="${value}">${formatColumnFilterValue(key, value)}</button>`
      ))
    ].join('');
  });
}

function getColumnFilterValues(key) {
  const values = new Set(
    getFilteredUniverses(key)
      .map((universe) => universe[key])
      .filter((value) => value !== undefined && value !== null)
      .map((value) => String(value))
  );

  return [...values].sort((a, b) => Number(a) - Number(b));
}

function getFilteredUniverses(ignoredFilterKey = '') {
  return state.data.universes.filter((universe) => {
    if (universe.status !== 'ok') return false;
    if (state.universe !== 'all' && universe.id !== state.universe) return false;

    return Object.entries(state.columnFilters).every(([key, value]) => {
      if (key === ignoredFilterKey || value === 'all') return true;
      return String(universe[key]) === value;
    });
  });
}

function normalizeColumnFilters(preferredKey = '') {
  const keys = Object.keys(state.columnFilters);
  const orderedKeys = preferredKey
    ? [...keys.filter((key) => key !== preferredKey), preferredKey]
    : keys;

  let changed = true;
  let safety = 0;

  while (changed && safety < keys.length) {
    changed = false;
    safety += 1;

    for (const key of orderedKeys) {
      const selectedValue = state.columnFilters[key];
      if (selectedValue === 'all') continue;

      if (!getColumnFilterValues(key).includes(selectedValue)) {
        state.columnFilters[key] = 'all';
        changed = true;
      }
    }
  }
}

function getColumnFilterAllLabel(key) {
  const labels = {
    speed: 'Все Eco',
    speedFleetPeaceful: 'Весь мирный флот',
    speedFleetWar: 'Весь боевой флот',
    debrisPercent: 'Любой лом'
  };

  return labels[key] || 'Все';
}

function formatColumnFilterValue(key, value) {
  if (key === 'debrisPercent') return `${formatNumber(Number(value))}%`;
  return `${formatNumber(Number(value))}x`;
}

function getColumnFilterBaseLabel(key) {
  const labels = {
    speed: 'Eco',
    speedFleetPeaceful: 'Мирный флот',
    speedFleetWar: 'Боевой флот',
    debrisPercent: 'Лом'
  };

  return labels[key] || key;
}

function setColumnMenuOpen(activeHeader, isOpen) {
  elements.columnFilterHeaders.forEach((header) => {
    const shouldOpen = header === activeHeader && isOpen;
    const menu = header.querySelector('.columnFilterMenu');
    const button = header.querySelector('.columnFilterButton');
    menu.hidden = !shouldOpen;
    button.setAttribute('aria-expanded', String(shouldOpen));
  });
}

function closeColumnMenus() {
  elements.columnFilterHeaders.forEach((header) => setColumnMenuOpen(header, false));
}

function setStatMenuOpen(activeGroup, isOpen) {
  document.querySelectorAll('.statGroup').forEach((group) => {
    const shouldOpen = group === activeGroup && isOpen;
    const menu = group.querySelector('.statMenu');
    const button = group.querySelector('.statGroupButton');
    menu.hidden = !shouldOpen;
    button.setAttribute('aria-expanded', String(shouldOpen));
  });
}

function closeStatMenus() {
  document.querySelectorAll('.statGroup').forEach((group) => setStatMenuOpen(group, false));
}

function updateColumnFilterMenus() {
  elements.columnFilterHeaders.forEach((header) => {
    const key = header.dataset.filterKey;
    const selectedValue = state.columnFilters[key];
    const baseLabel = getColumnFilterBaseLabel(key);
    const button = header.querySelector('.columnFilterButton');

    button.textContent = selectedValue === 'all'
      ? `${baseLabel} ▾`
      : `${baseLabel}: ${formatColumnFilterValue(key, selectedValue)} ▾`;

    header.querySelectorAll('.columnFilterOption').forEach((option) => {
      const isSelected = option.dataset.value === selectedValue;
      option.classList.toggle('selected', isSelected);
      option.setAttribute('aria-selected', String(isSelected));
    });
  });
}

loadData().catch((error) => {
  elements.metaLine.textContent = 'Данные не загружены';
  setStatus(error.message, 'error');
});
