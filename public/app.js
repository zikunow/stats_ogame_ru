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
  dataSource: 'api'
};

const API_BASE = new URL('api/', window.location.href);
const STATIC_DATA_URL = new URL('data/ogame-ru.json', window.location.href);
const TAB_ORDER = ['0', '1', '3', '2', '4', '5', '6', '7'];
const TAB_LABELS = {
  0: 'Очки',
  1: 'Экономика',
  2: 'Исследования',
  3: 'Флот',
  4: 'Построено военного',
  5: 'Уничтожено',
  6: 'Потеряно',
  7: 'Очки чести'
};

const elements = {
  metaLine: document.querySelector('#metaLine'),
  refreshButton: document.querySelector('#refreshButton'),
  universeFilter: document.querySelector('#universeFilter'),
  columnFilterHeaders: document.querySelectorAll('.columnFilterHeader'),
  limitFilter: document.querySelector('#limitFilter'),
  searchInput: document.querySelector('#searchInput'),
  tabs: document.querySelector('#tabs'),
  statusBox: document.querySelector('#statusBox'),
  tableBody: document.querySelector('#tableBody'),
  headers: document.querySelectorAll('th[data-sort]')
};

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

async function loadData() {
  let response = await fetch(new URL('data', API_BASE), { cache: 'no-store' });

  if (!response.ok) {
    response = await fetch(STATIC_DATA_URL, { cache: 'no-store' });
    state.dataSource = 'static';
  } else {
    state.dataSource = 'api';
  }

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Не удалось загрузить данные');
  }

  state.data = payload;
  renderStaticControls();
  render();
}

function renderStaticControls() {
  const orderedTypes = [...state.data.highscoreTypes].sort((a, b) => {
    return TAB_ORDER.indexOf(a.id) - TAB_ORDER.indexOf(b.id);
  });

  elements.tabs.innerHTML = orderedTypes
    .map((type) => `<button class="tab" type="button" data-type="${type.id}">${TAB_LABELS[type.id] || type.label}</button>`)
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
  renderColumnFilterMenus();
}

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

  return rows.map((row, index) => ({
    ...row,
    rank: rankByPlayer.get(`${row.universeId}:${row.playerId}`) || index + 1
  }));
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

  elements.tabs.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.type === state.activeType);
  });

  elements.universeFilter.value = state.universe;
  elements.refreshButton.hidden = state.dataSource === 'static';
  renderColumnFilterMenus();
  updateColumnFilterMenus();

  elements.headers.forEach((header) => {
    const marker = header.dataset.sort === state.sortKey
      ? (state.sortDirection === 'asc' ? ' ↑' : ' ↓')
      : '';
    header.textContent = `${header.dataset.originalLabel || header.textContent.replace(/[ ↑↓]+$/, '')}${marker}`;
    header.dataset.originalLabel = header.dataset.originalLabel || header.textContent.replace(/[ ↑↓]+$/, '');
  });

  elements.tableBody.innerHTML = rows.map((row) => `
    <tr>
      <td class="rank">${formatNumber(row.rank)}</td>
      <td class="${row.isVacation ? 'vacation' : ''}">${escapeHtml(row.displayName)}</td>
      <td>${row.allianceTag ? escapeHtml(row.allianceTag) : '<span class="muted">-</span>'}</td>
      <td>${formatNumber(row.score)}</td>
      <td>${escapeHtml(row.universeName)}</td>
      <td>${formatNumber(row.speed)}x</td>
      <td>${formatNumber(row.speedFleetPeaceful)}x</td>
      <td>${formatNumber(row.speedFleetWar)}x</td>
      <td>${formatNumber(row.debrisPercent)}%</td>
    </tr>
  `).join('');
}

elements.tabs.addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (!tab) return;
  state.activeType = tab.dataset.type;
  state.sortKey = 'score';
  state.sortDirection = 'desc';
  render();
});

elements.universeFilter.addEventListener('change', (event) => {
  applyUniverseFilter(event.target.value);
});

document.addEventListener('click', (event) => {
  const filterButton = event.target.closest('.columnFilterButton');
  if (filterButton) {
    event.stopPropagation();
    const header = filterButton.closest('.columnFilterHeader');
    const menu = header.querySelector('.columnFilterMenu');
    setColumnMenuOpen(header, menu.hidden);
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
  closeColumnMenus();
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

elements.searchInput.addEventListener('input', (event) => {
  state.query = event.target.value;
  render();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeColumnMenus();
  }
});

function applyUniverseFilter(universeId) {
  state.universe = universeId;
  normalizeColumnFilters();
  state.sortKey = 'score';
  state.sortDirection = 'desc';
  render();
}

function applyColumnFilter(key, value) {
  state.columnFilters[key] = value;
  normalizeColumnFilters(key);
  state.sortKey = 'score';
  state.sortDirection = 'desc';
  render();
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

elements.headers.forEach((header) => {
  header.dataset.originalLabel = header.textContent;
  header.addEventListener('click', () => {
    const nextKey = header.dataset.sort;
    if (state.sortKey === nextKey) {
      state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortKey = nextKey;
      state.sortDirection = ['score', 'speed', 'speedFleetPeaceful', 'speedFleetWar', 'debrisPercent'].includes(nextKey) ? 'desc' : 'asc';
    }
    render();
  });
});

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
