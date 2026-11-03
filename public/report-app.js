const THEME_STORAGE_KEY = 'ogame-ru-theme';
const UNIVERSE_STORAGE_KEY = 'ogame-ru-universe-v1';
const REPORT_INDEX_URL = new URL('data/reports/index.json', window.location.href);
const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];
const LOSS_PERIOD_LABELS = {
  '1d': { title: 'Топ потерь вчерашнего дня', column: 'Потеряно за сутки' },
  '7d': { title: 'Топ потерь за 7 дней', column: 'Потеряно за 7 дней' },
  '30d': { title: 'Топ потерь за 30 дней', column: 'Потеряно за 30 дней' }
};

const state = {
  type: document.body.dataset.report,
  report: null,
  reportIndex: null,
  lossPeriod: '1d',
  universe: 'all',
  sortKey: 'periodScore',
  sortDirection: 'desc'
};

const elements = {
  title: document.querySelector('#reportTitle'),
  metaLine: document.querySelector('#metaLine'),
  themeToggle: document.querySelector('#themeToggle'),
  themeToggleIcon: document.querySelector('#themeToggleIcon'),
  themeToggleLabel: document.querySelector('#themeToggleLabel'),
  universeFilter: document.querySelector('#universeFilter'),
  periodHeaderLabel: document.querySelector('#periodHeaderLabel'),
  totalHeaderLabel: document.querySelector('#totalHeaderLabel'),
  periodSortButton: document.querySelector('#periodSortButton'),
  totalSortButton: document.querySelector('#totalSortButton'),
  periodSortIndicator: document.querySelector('#periodSortIndicator'),
  totalSortIndicator: document.querySelector('#totalSortIndicator'),
  destroyedHeader: document.querySelector('#destroyedHeader'),
  statusBox: document.querySelector('#statusBox'),
  reportLimitHint: document.querySelector('#reportLimitHint'),
  lossPeriodToggle: document.querySelector('#lossPeriodToggle'),
  tableBody: document.querySelector('#tableBody')
};

function formatNumber(value) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
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

  return state.report.universes.find((universe) => (
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
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {}
  updateThemeToggle();
}

function setStatus(message, type = 'info') {
  elements.statusBox.hidden = !message;
  elements.statusBox.textContent = message;
  elements.statusBox.className = `status${type === 'error' ? ' error' : ''}`;
}

function initializeUniverse() {
  const url = new URL(window.location.href);
  let requested = url.searchParams.get('universe') || '';
  if (!requested) {
    try {
      requested = localStorage.getItem(UNIVERSE_STORAGE_KEY) || 'all';
    } catch {}
  }
  state.universe = findUniverse(requested)?.id || 'all';
}

function syncUniverseSelection() {
  try {
    localStorage.setItem(UNIVERSE_STORAGE_KEY, state.universe);
  } catch {}

  const url = new URL(window.location.href);
  const universe = findUniverse(state.universe);
  if (universe) url.searchParams.set('universe', normalizeUniverseSlug(universe.name));
  else url.searchParams.delete('universe');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function renderUniverseFilter() {
  const options = [{ id: 'all', name: 'Все вселенные' }, ...state.report.universes]
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

function renderHeading() {
  const isMonthly = state.type === 'monthlyAttackers';
  if (isMonthly) {
    const month = new Date(`${state.report.labelDate}T00:00:00Z`).getUTCMonth();
    elements.title.textContent = `Топ атакеров месяца — ${MONTH_NAMES[month]}`;
    elements.periodHeaderLabel.textContent = 'Уничтожено за месяц';
    elements.totalHeaderLabel.textContent = 'Уничтожено всего';
    elements.destroyedHeader.hidden = true;
    elements.reportLimitHint.textContent = 'Все вселенные — топ-30 · одна вселенная — топ-10 · уничтожено не меньше, чем потеряно';
  } else {
    const periodLabels = LOSS_PERIOD_LABELS[state.lossPeriod];
    elements.title.textContent = periodLabels.title;
    elements.periodHeaderLabel.textContent = periodLabels.column;
    elements.totalHeaderLabel.textContent = 'Потеряно всего';
    elements.destroyedHeader.hidden = false;
    elements.reportLimitHint.textContent = 'Все вселенные — топ-30 · одна вселенная — топ-10 · Military destroyed = 0 может указывать на небоевое списание';
  }

  elements.metaLine.textContent = `Период: ${formatDateTime(state.report.startGeneratedAt)} — ${formatDateTime(state.report.endGeneratedAt)}`;
  document.title = `${elements.title.textContent} — OGame RU`;
}

function renderLossPeriodToggle() {
  if (!elements.lossPeriodToggle) return;
  for (const button of elements.lossPeriodToggle.querySelectorAll('button[data-period]')) {
    const isActive = button.dataset.period === state.lossPeriod;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
}

function updateSortIndicators() {
  elements.periodSortIndicator.textContent = state.sortKey === 'periodScore'
    ? (state.sortDirection === 'desc' ? '↓' : '↑')
    : '';
  elements.totalSortIndicator.textContent = state.sortKey === 'totalScore'
    ? (state.sortDirection === 'desc' ? '↓' : '↑')
    : '';
}

function createCell(text, className = '') {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

function renderTable() {
  const limit = state.universe === 'all' ? 30 : 10;
  const direction = state.sortDirection === 'asc' ? 1 : -1;
  const rows = state.report.rows
    .filter((row) => state.universe === 'all' || row.universeId === state.universe)
    .sort((a, b) => (
      direction * (a[state.sortKey] - b[state.sortKey])
      || b.periodScore - a.periodScore
      || a.displayName.localeCompare(b.displayName, 'ru')
    ))
    .slice(0, limit);

  const tableRows = rows.map((row, index) => {
    const tr = document.createElement('tr');
    const destroyedCell = createCell(
      Number.isFinite(row.periodDestroyedScore) ? formatNumber(row.periodDestroyedScore) : '—',
      row.periodDestroyedScore > 0 ? 'reportDestroyed' : 'muted'
    );
    destroyedCell.hidden = state.type === 'monthlyAttackers';
    tr.append(
      createCell(String(index + 1), 'rank'),
      createCell(row.displayName),
      createCell(row.allianceTag || '—', row.allianceTag ? '' : 'muted'),
      createCell(formatNumber(row.periodScore), 'reportScore'),
      destroyedCell,
      createCell(formatNumber(row.totalScore)),
      createCell(row.universeName),
      createCell(`${row.speed}x`),
      createCell(`${row.speedFleetPeaceful}x`),
      createCell(`${row.speedFleetWar}x`),
      createCell(`${row.debrisPercent}%`)
    );
    return tr;
  });

  elements.tableBody.replaceChildren(...tableRows);
  setStatus(rows.length ? '' : 'Для выбранной вселенной нет данных за этот период.');
  updateSortIndicators();
}

function setSort(sortKey) {
  if (state.sortKey === sortKey) {
    state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
  } else {
    state.sortKey = sortKey;
    state.sortDirection = 'desc';
  }
  renderTable();
}

async function loadReport() {
  if (!state.reportIndex) {
    const indexResponse = await fetch(REPORT_INDEX_URL, { cache: 'no-cache' });
    if (!indexResponse.ok) throw new Error('Не удалось загрузить список отчётов');
    state.reportIndex = await indexResponse.json();
    if (state.type === 'dailyLosses') {
      const requestedPeriod = new URL(window.location.href).searchParams.get('period');
      state.lossPeriod = state.reportIndex.dailyLosses.periods?.[requestedPeriod]
        ? requestedPeriod
        : state.reportIndex.dailyLosses.defaultPeriod || '1d';
    }
  }

  const baseDescriptor = state.reportIndex[state.type];
  const descriptor = state.type === 'dailyLosses'
    ? baseDescriptor?.periods?.[state.lossPeriod]
    : baseDescriptor;
  if (!descriptor?.path) throw new Error('Отчёт пока недоступен');

  const reportResponse = await fetch(
    new URL(`data/reports/${descriptor.path}`, window.location.href),
    { cache: 'no-cache' }
  );
  if (!reportResponse.ok) throw new Error('Не удалось загрузить отчёт');
  const hadReport = Boolean(state.report);
  state.report = await reportResponse.json();
  if (!hadReport) initializeUniverse();
  syncUniverseSelection();
  renderUniverseFilter();
  renderHeading();
  renderLossPeriodToggle();
  renderTable();
}

elements.themeToggle.addEventListener('click', toggleTheme);
elements.universeFilter.addEventListener('change', (event) => {
  state.universe = event.target.value;
  syncUniverseSelection();
  renderTable();
});
elements.periodSortButton.addEventListener('click', () => setSort('periodScore'));
elements.totalSortButton.addEventListener('click', () => setSort('totalScore'));
elements.lossPeriodToggle?.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-period]');
  if (!button || button.dataset.period === state.lossPeriod) return;
  state.lossPeriod = button.dataset.period;
  const url = new URL(window.location.href);
  url.searchParams.set('period', state.lossPeriod);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  setStatus('Загрузка отчёта...');
  try {
    await loadReport();
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

updateThemeToggle();
loadReport().catch((error) => setStatus(error.message, 'error'));
