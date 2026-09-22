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
  query: '',
  sortKey: 'score',
  sortDirection: 'desc',
  dataSource: 'api',
  historyDate: 'latest',
  historyIndex: null
};

const API_BASE = new URL('api/', window.location.href);
const STATIC_DATA_URL = new URL('data/ogame-ru.json', window.location.href);
const HISTORY_INDEX_URL = new URL('data/history/index.json', window.location.href);
const TAB_ORDER = ['0', '1', '2', '3', 'fleet', 'defense', '4', '5', '6', '7', '8', '9', '10', '11'];
const TAB_LABELS = {
  0: 'Очки',
  1: 'Экономика',
  2: 'Исследования',
  3: 'Боевая мощь',
  defense: 'Оборона',
  fleet: 'Флот',
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
  { label: 'Боевая мощь', types: ['3', '5', '6', '4'] },
  { id: 'fleet', label: 'Флот' },
  { id: 'defense', label: 'Оборона' },
  { id: '7', label: 'Очки чести' },
  { label: 'Формы жизни', types: ['8', '9', '10', '11'] }
];
const COLUMN_STORAGE_KEY = 'ogame-ru-visible-columns';
const TABLE_COLUMNS = [
  { key: 'rank', label: 'Место' },
  { key: 'displayName', label: 'Ник' },
  { key: 'allianceTag', label: 'Альянс' },
  { key: 'score', label: 'Очки' },
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
  refreshButton: document.querySelector('#refreshButton'),
  columnSettingsButton: document.querySelector('#columnSettingsButton'),
  columnSettingsPanel: document.querySelector('#columnSettingsPanel'),
  columnSettings: document.querySelector('#columnSettings'),
  universeFilter: document.querySelector('#universeFilter'),
  columnFilterHeaders: document.querySelectorAll('.columnFilterHeader'),
  limitFilter: document.querySelector('#limitFilter'),
  historyFilter: document.querySelector('#historyFilter'),
  searchInput: document.querySelector('#searchInput'),
  tabs: document.querySelector('#tabs'),
  statusBox: document.querySelector('#statusBox'),
  tableBody: document.querySelector('#tableBody'),
  scoreHeader: document.querySelector('#scoreHeader'),
  positionHeader: document.querySelector('#positionHeader')
};

state.visibleColumns = loadVisibleColumns();

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

async function loadData(historyDate = state.historyDate) {
  let response;

  if (historyDate !== 'latest') {
    response = await fetch(new URL(`data/history/${historyDate}.json`, window.location.href), { cache: 'no-store' });
    state.dataSource = 'static';
  } else {
    response = await fetch(new URL('data', API_BASE), { cache: 'no-store' });
  }

  if (historyDate === 'latest' && !response.ok) {
    response = await fetch(STATIC_DATA_URL, { cache: 'no-store' });
    state.dataSource = 'static';
  } else if (historyDate === 'latest') {
    state.dataSource = 'api';
  }

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Не удалось загрузить данные');
  }

  state.historyDate = historyDate;
  state.data = addDerivedStats(payload);
  await loadHistoryIndex();
  renderStaticControls();
  render();
}

async function loadHistoryIndex() {
  if (state.historyIndex) return;

  try {
    const response = await fetch(HISTORY_INDEX_URL, { cache: 'no-store' });
    if (response.ok) {
      state.historyIndex = await response.json();
    }
  } catch {
    state.historyIndex = { latest: '', snapshots: [] };
  }
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
  renderHistoryFilter();
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

function renderHistoryFilter() {
  const snapshots = state.historyIndex?.snapshots || [];
  elements.historyFilter.innerHTML = [
    '<option value="latest">Актуальные</option>',
    ...snapshots.map((snapshot) => (
      `<option value="${snapshot}">${formatHistoryDate(snapshot)}</option>`
    ))
  ].join('');
  elements.historyFilter.value = state.historyDate;
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

  if (state.universe !== 'all') {
    rows = rows.filter((row) => row.universeId === state.universe);
  }

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
  elements.scoreHeader.textContent = TAB_LABELS[state.activeType] || 'Очки';
  elements.positionHeader.textContent = 'Топ в своей вселенной';

  elements.tabs.querySelectorAll('.tab[data-type]').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.type === state.activeType);
  });

  elements.universeFilter.value = state.universe;
  elements.refreshButton.hidden = state.dataSource === 'static';
  renderColumnFilterMenus();
  updateColumnFilterMenus();

  elements.tableBody.innerHTML = rows.map((row) => `
    <tr>
      <td class="rank" data-column="rank">${formatNumber(row.rank)}</td>
      <td data-column="displayName" class="${row.isVacation ? 'vacation' : ''}">${escapeHtml(row.displayName)}</td>
      <td data-column="allianceTag">${row.allianceTag ? escapeHtml(row.allianceTag) : '<span class="muted">-</span>'}</td>
      <td data-column="score">${formatNumber(row.score)}</td>
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

elements.historyFilter.addEventListener('change', async (event) => {
  elements.historyFilter.disabled = true;
  setStatus('Загружаю снимок данных...');
  try {
    await loadData(event.target.value);
    setStatus('');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    elements.historyFilter.disabled = false;
  }
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
    cell.hidden = !visibleColumns.has(cell.dataset.column);
  });
}

function applyUniverseFilter(universeId) {
  state.universe = universeId;
  normalizeColumnFilters();
  render();
}

function applyColumnFilter(key, value) {
  state.columnFilters[key] = value;
  normalizeColumnFilters(key);
  render();
}

function applyStatType(type) {
  if (!type || type === state.activeType) return;
  state.activeType = type;
  renderStaticControls();
  render();
}

function addDerivedStats(payload) {
  const requiredTypes = ['0', '1', '2', '3', '8'];
  if (!requiredTypes.every((type) => Array.isArray(payload.stats?.[type]))) {
    return payload;
  }

  const scoresByType = Object.fromEntries(requiredTypes.map((type) => [
    type,
    new Map(payload.stats[type].map((row) => [playerKey(row), row.score]))
  ]));
  const defenseRows = [];
  const fleetRows = [];

  for (const militaryRow of payload.stats['3']) {
    const key = playerKey(militaryRow);
    const total = scoresByType['0'].get(key);
    const economy = scoresByType['1'].get(key);
    const research = scoresByType['2'].get(key);
    const lifeforms = scoresByType['8'].get(key);

    if ([total, economy, research, lifeforms].some((score) => score === undefined)) continue;

    const defense = Math.max(0, economy + research + militaryRow.score + lifeforms - total);
    const fleet = Math.max(0, militaryRow.score - defense);
    defenseRows.push({ ...militaryRow, score: defense });
    fleetRows.push({ ...militaryRow, score: fleet });
  }

  payload.stats.defense = rankDerivedRows(defenseRows);
  payload.stats.fleet = rankDerivedRows(fleetRows);

  const highscoreTypes = payload.highscoreTypes || [];
  const availableTypes = new Set(highscoreTypes.map((type) => type.id));
  for (const type of [
    { id: 'fleet', label: TAB_LABELS.fleet },
    { id: 'defense', label: TAB_LABELS.defense }
  ]) {
    if (!availableTypes.has(type.id)) highscoreTypes.push(type);
  }
  payload.highscoreTypes = highscoreTypes;

  return payload;
}

function playerKey(row) {
  return `${row.universeId}:${row.playerId}`;
}

function rankDerivedRows(rows) {
  const rowsByUniverse = new Map();

  for (const row of rows) {
    const universeRows = rowsByUniverse.get(row.universeId) || [];
    universeRows.push(row);
    rowsByUniverse.set(row.universeId, universeRows);
  }

  for (const universeRows of rowsByUniverse.values()) {
    universeRows.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName, 'ru'));
    universeRows.forEach((row, index) => {
      row.position = index + 1;
    });
  }

  return rows;
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

elements.refreshButton.addEventListener('click', async () => {
  elements.refreshButton.disabled = true;
  elements.refreshButton.textContent = 'Обновление...';
  setStatus('Скачиваю свежие данные OGame API...');

  try {
    const response = await fetch(new URL('refresh', API_BASE), { method: 'POST' });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Обновление не удалось');
    }

    await loadData();
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    elements.refreshButton.disabled = false;
    elements.refreshButton.textContent = 'Обновить';
  }
});

loadData().catch((error) => {
  elements.metaLine.textContent = 'Данные не загружены';
  setStatus(error.message, 'error');
});
