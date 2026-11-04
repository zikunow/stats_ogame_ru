const THEME_STORAGE_KEY = 'ogame-ru-theme';
const UNIVERSE_STORAGE_KEY = 'ogame-ru-universe-v1';
const REPORT_INDEX_URL = new URL('data/reports/index.json', window.location.href);

const state = {
  hall: null,
  scope: 'universe',
  category: 'all',
  universe: 'all'
};

const elements = {
  metaLine: document.querySelector('#metaLine'),
  themeToggle: document.querySelector('#themeToggle'),
  themeToggleIcon: document.querySelector('#themeToggleIcon'),
  themeToggleLabel: document.querySelector('#themeToggleLabel'),
  scopeToggle: document.querySelector('#scopeToggle'),
  categoryToggle: document.querySelector('#categoryToggle'),
  universeControl: document.querySelector('#hallUniverseControl'),
  universeFilter: document.querySelector('#universeFilter'),
  hallHint: document.querySelector('#hallHint'),
  statusBox: document.querySelector('#statusBox'),
  tableBody: document.querySelector('#tableBody')
};

function formatNumber(value) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function pluralize(value, one, few, many) {
  const lastTwo = value % 100;
  const last = value % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
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
  return state.hall.universes.find((universe) => (
    String(universe.id) === rawValue
    || String(universe.serverId).toLowerCase() === rawValue.toLowerCase()
    || normalizeUniverseSlug(universe.name) === normalizedValue
  )) || null;
}

function updateThemeToggle() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  elements.themeToggle.setAttribute('aria-pressed', String(isDark));
  elements.themeToggle.setAttribute('aria-label', isDark ? 'Включить светлую тему' : 'Включить тёмную тему');
  elements.themeToggleIcon.textContent = isDark ? '☀' : '☾';
  elements.themeToggleLabel.textContent = isDark ? 'Светлая' : 'Тёмная';
}

function toggleTheme() {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch {}
  updateThemeToggle();
}

function setStatus(message, type = 'info') {
  elements.statusBox.hidden = !message;
  elements.statusBox.textContent = message;
  elements.statusBox.className = `status${type === 'error' ? ' error' : ''}`;
}

function getMedals(row) {
  if (state.category !== 'all') return row[state.category];
  return {
    gold: row.week.gold + row.month.gold,
    silver: row.week.silver + row.month.silver,
    bronze: row.week.bronze + row.month.bronze,
    podiums: row.week.podiums + row.month.podiums,
    destroyed: row.week.destroyed + row.month.destroyed
  };
}

function createCell(text, className = '') {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

function renderTable() {
  const rows = state.hall.scopes[state.scope]
    .filter((row) => state.scope === 'global' || state.universe === 'all' || row.universeId === state.universe)
    .map((row) => ({ row, medals: getMedals(row) }))
    .filter(({ medals }) => medals.podiums > 0)
    .sort((a, b) => (
      b.medals.gold - a.medals.gold
      || b.medals.silver - a.medals.silver
      || b.medals.bronze - a.medals.bronze
      || b.medals.destroyed - a.medals.destroyed
      || a.row.displayName.localeCompare(b.row.displayName, 'ru')
    ));

  const tableRows = rows.map(({ row, medals }, index) => {
    const tr = document.createElement('tr');
    tr.append(
      createCell(String(index + 1), 'rank'),
      createCell(row.displayName),
      createCell(row.allianceTag || '—', row.allianceTag ? '' : 'muted'),
      createCell(row.universeName),
      createCell(formatNumber(medals.gold), 'medalCount gold'),
      createCell(formatNumber(medals.silver), 'medalCount silver'),
      createCell(formatNumber(medals.bronze), 'medalCount bronze'),
      createCell(formatNumber(medals.podiums), 'podiumCount'),
      createCell(formatNumber(medals.destroyed))
    );
    return tr;
  });

  elements.tableBody.replaceChildren(...tableRows);
  setStatus(rows.length ? '' : 'Для выбранного режима пока нет наград.');
}

function renderControls() {
  for (const button of elements.scopeToggle.querySelectorAll('button[data-scope]')) {
    const active = button.dataset.scope === state.scope;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  for (const button of elements.categoryToggle.querySelectorAll('button[data-category]')) {
    const active = button.dataset.category === state.category;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  elements.universeControl.hidden = state.scope === 'global';
  elements.hallHint.textContent = state.scope === 'universe'
    ? 'Медали за первые три места отдельно внутри каждой вселенной'
    : 'Медали за первые три места общего рейтинга среди всех вселенных';
}

function renderUniverseFilter() {
  const options = [{ id: 'all', name: 'Все вселенные' }, ...state.hall.universes]
    .map((universe) => {
      const option = document.createElement('option');
      option.value = universe.id;
      option.textContent = universe.id === 'all'
        ? universe.name
        : `${universe.name} (${universe.serverId})`;
      return option;
    });
  elements.universeFilter.replaceChildren(...options);
  elements.universeFilter.value = state.universe;
}

function syncUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('scope', state.scope);
  url.searchParams.set('awards', state.category);
  const universe = findUniverse(state.universe);
  if (state.scope === 'universe' && universe) {
    url.searchParams.set('universe', normalizeUniverseSlug(universe.name));
  } else {
    url.searchParams.delete('universe');
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function initializeState() {
  const url = new URL(window.location.href);
  const requestedScope = url.searchParams.get('scope');
  const requestedCategory = url.searchParams.get('awards');
  if (['universe', 'global'].includes(requestedScope)) state.scope = requestedScope;
  if (['all', 'week', 'month'].includes(requestedCategory)) state.category = requestedCategory;

  let requestedUniverse = url.searchParams.get('universe') || '';
  if (!requestedUniverse) {
    try { requestedUniverse = localStorage.getItem(UNIVERSE_STORAGE_KEY) || ''; } catch {}
  }
  state.universe = findUniverse(requestedUniverse)?.id || 'all';
}

function updateView() {
  try { localStorage.setItem(UNIVERSE_STORAGE_KEY, state.universe); } catch {}
  syncUrl();
  renderControls();
  renderTable();
}

async function loadHall() {
  const indexResponse = await fetch(REPORT_INDEX_URL, { cache: 'no-cache' });
  if (!indexResponse.ok) throw new Error('Не удалось загрузить список отчётов');
  const index = await indexResponse.json();
  const descriptor = index.attackerHallOfFame;
  if (!descriptor?.path) throw new Error('Зал славы пока недоступен');

  const hallResponse = await fetch(
    new URL(`data/reports/${descriptor.path}`, window.location.href),
    { cache: 'no-cache' }
  );
  if (!hallResponse.ok) throw new Error('Не удалось загрузить Зал славы');
  state.hall = await hallResponse.json();
  initializeState();
  renderUniverseFilter();
  elements.metaLine.textContent = `${state.hall.months.length} ${pluralize(state.hall.months.length, 'месяц', 'месяца', 'месяцев')} · ${state.hall.weeks.length} ${pluralize(state.hall.weeks.length, 'неделя', 'недели', 'недель')} · сортировка по золоту, серебру и бронзе`;
  updateView();
}

elements.themeToggle.addEventListener('click', toggleTheme);
elements.scopeToggle.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-scope]');
  if (!button || button.dataset.scope === state.scope) return;
  state.scope = button.dataset.scope;
  updateView();
});
elements.categoryToggle.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-category]');
  if (!button || button.dataset.category === state.category) return;
  state.category = button.dataset.category;
  updateView();
});
elements.universeFilter.addEventListener('change', (event) => {
  state.universe = event.target.value;
  updateView();
});

updateThemeToggle();
loadHall().catch((error) => setStatus(error.message, 'error'));
