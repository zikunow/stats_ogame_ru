const THEME_STORAGE_KEY = 'ogame-ru-theme';
const UNIVERSE_STORAGE_KEY = 'ogame-ru-universe-v1';
const REPORT_INDEX_URL = new URL('data/reports/index.json', window.location.href);
const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];
const LOSS_PERIOD_LABELS = {
  '1d': { title: 'Топ потерь вчерашнего дня' },
  '7d': { title: 'Топ потерь за 7 дней' },
  '30d': { title: 'Топ потерь за 30 дней' }
};
const ATTACKER_PERIOD_LABELS = {
  month: { column: 'Уничтожено за месяц' },
  week: { column: 'Уничтожено за неделю' },
  '7d': { label: 'Последние 7 дней', column: 'Уничтожено за 7 дней' },
  '30d': { label: 'Последние 30 дней', column: 'Уничтожено за 30 дней' }
};

const state = {
  type: document.body.dataset.report,
  report: null,
  reportIndex: null,
  attackerPeriod: 'month',
  attackerId: '',
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
  fleetHeader: document.querySelector('#fleetHeader'),
  defenseHeader: document.querySelector('#defenseHeader'),
  destroyedHeader: document.querySelector('#destroyedHeader'),
  statusBox: document.querySelector('#statusBox'),
  reportLimitHint: document.querySelector('#reportLimitHint'),
  attackerPeriodToggle: document.querySelector('#attackerPeriodToggle'),
  attackerMonthSelect: document.querySelector('#attackerMonthSelect'),
  attackerWeekSelect: document.querySelector('#attackerWeekSelect'),
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

function formatSignedNumber(value) {
  if (!Number.isFinite(value)) return '—';
  if (value > 0) return `+${formatNumber(value)}`;
  if (value < 0) return `−${formatNumber(Math.abs(value))}`;
  return '0';
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit'
  }).format(new Date(`${value}T00:00:00Z`));
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
  const isAttackers = state.type === 'attackers';
  if (isAttackers) {
    elements.title.textContent = 'Топ атакеры';
    elements.periodHeaderLabel.textContent = ATTACKER_PERIOD_LABELS[state.attackerPeriod].column;
    elements.totalHeaderLabel.textContent = 'Уничтожено всего';
    elements.fleetHeader.hidden = true;
    elements.defenseHeader.hidden = true;
    elements.destroyedHeader.hidden = true;
    elements.reportLimitHint.textContent = 'Все вселенные — топ-30 · одна вселенная — топ-10 · уничтожено не меньше, чем потеряно';
  } else {
    const periodLabels = LOSS_PERIOD_LABELS[state.lossPeriod];
    elements.title.textContent = periodLabels.title;
    elements.periodHeaderLabel.textContent = 'Потеряно';
    elements.totalHeaderLabel.textContent = 'Потеряно всего';
    elements.fleetHeader.hidden = false;
    elements.defenseHeader.hidden = false;
    elements.destroyedHeader.hidden = false;
    elements.reportLimitHint.textContent = 'Все вселенные — топ-30 · одна вселенная — топ-10 · флот и оборона показывают чистое изменение · «Уничтожены» = 0 может означать небоевое списание';
  }

  const selectedPeriod = isAttackers ? getAttackerPeriodLabel() : '';
  elements.metaLine.textContent = `${selectedPeriod ? `${selectedPeriod} · ` : ''}Период: ${formatDateTime(state.report.startGeneratedAt)} — ${formatDateTime(state.report.endGeneratedAt)}`;
  document.title = `${elements.title.textContent} — OGame RU`;
}

function getMonthLabel(item) {
  const value = new Date(`${item.startDate}T00:00:00Z`);
  const month = MONTH_NAMES[value.getUTCMonth()];
  const currentYear = new Date().getFullYear();
  return `Атакер месяца — ${month}${value.getUTCFullYear() === currentYear ? '' : ` ${value.getUTCFullYear()}`}`;
}

function getWeekLabel(item) {
  const lastDay = new Date(`${item.endDate}T00:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  const year = item.isoYear === new Date().getFullYear() ? '' : `, ${item.isoYear}`;
  return `Атакер недели — Неделя ${item.week}${year} · ${formatShortDate(item.startDate)}–${formatShortDate(lastDay.toISOString().slice(0, 10))}`;
}

function getAttackerPeriodLabel() {
  const periods = state.reportIndex.attackers.periods;
  if (state.attackerPeriod === 'month') {
    return getMonthLabel(periods.month.items.find((item) => item.id === state.attackerId));
  }
  if (state.attackerPeriod === 'week') {
    return getWeekLabel(periods.week.items.find((item) => item.id === state.attackerId));
  }
  return ATTACKER_PERIOD_LABELS[state.attackerPeriod].label;
}

function createReportOption(item, label) {
  const option = document.createElement('option');
  option.value = item.id;
  option.textContent = label;
  return option;
}

function renderAttackerPeriodControls() {
  if (!elements.attackerPeriodToggle) return;
  const periods = state.reportIndex.attackers.periods;
  elements.attackerMonthSelect.replaceChildren(...periods.month.items.map((item) => (
    createReportOption(item, getMonthLabel(item))
  )));
  elements.attackerWeekSelect.replaceChildren(...periods.week.items.map((item) => (
    createReportOption(item, getWeekLabel(item))
  )));
  elements.attackerMonthSelect.value = state.attackerPeriod === 'month'
    ? state.attackerId
    : periods.month.latest;
  elements.attackerWeekSelect.value = state.attackerPeriod === 'week'
    ? state.attackerId
    : periods.week.latest;
  elements.attackerMonthSelect.classList.toggle('active', state.attackerPeriod === 'month');
  elements.attackerWeekSelect.classList.toggle('active', state.attackerPeriod === 'week');
  for (const button of elements.attackerPeriodToggle.querySelectorAll('button[data-attacker-period]')) {
    const isActive = button.dataset.attackerPeriod === state.attackerPeriod;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
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
      Number.isFinite(row.periodDestroyedScore) ? '' : 'muted'
    );
    const fleetCell = createCell(
      formatSignedNumber(row.periodFleetScore),
      row.periodFleetScore < 0 ? 'reportNetChange negative' : 'reportNetChange'
    );
    const defenseCell = createCell(
      formatSignedNumber(row.periodDefenseScore),
      row.periodDefenseScore < 0 ? 'reportNetChange negative' : 'reportNetChange'
    );
    const isAttackers = state.type === 'attackers';
    fleetCell.hidden = isAttackers;
    defenseCell.hidden = isAttackers;
    destroyedCell.hidden = isAttackers;
    tr.append(
      createCell(String(index + 1), 'rank'),
      createCell(row.displayName),
      createCell(row.allianceTag || '—', row.allianceTag ? '' : 'muted'),
      createCell(formatNumber(row.periodScore), isAttackers ? 'reportScore' : 'reportLoss'),
      fleetCell,
      defenseCell,
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
    const url = new URL(window.location.href);
    if (state.type === 'dailyLosses') {
      const requestedPeriod = url.searchParams.get('period');
      state.lossPeriod = state.reportIndex.dailyLosses.periods?.[requestedPeriod]
        ? requestedPeriod
        : state.reportIndex.dailyLosses.defaultPeriod || '1d';
    } else if (state.type === 'attackers') {
      const periods = state.reportIndex.attackers.periods;
      const requestedPeriod = url.searchParams.get('period');
      state.attackerPeriod = periods[requestedPeriod]
        ? requestedPeriod
        : state.reportIndex.attackers.defaultPeriod || 'month';
      if (state.attackerPeriod === 'month' || state.attackerPeriod === 'week') {
        const period = periods[state.attackerPeriod];
        const requestedId = url.searchParams.get('id');
        state.attackerId = period.items.some((item) => item.id === requestedId)
          ? requestedId
          : period.latest;
      }
    }
  }

  const baseDescriptor = state.reportIndex[state.type];
  let descriptor = baseDescriptor;
  if (state.type === 'dailyLosses') descriptor = baseDescriptor?.periods?.[state.lossPeriod];
  if (state.type === 'attackers') {
    const period = baseDescriptor?.periods?.[state.attackerPeriod];
    descriptor = state.attackerPeriod === 'month' || state.attackerPeriod === 'week'
      ? period?.items.find((item) => item.id === state.attackerId)
      : period;
  }
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
  renderAttackerPeriodControls();
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
async function selectAttackerPeriod(period, id = '') {
  state.attackerPeriod = period;
  state.attackerId = id;
  const url = new URL(window.location.href);
  url.searchParams.set('period', period);
  if (id) url.searchParams.set('id', id);
  else url.searchParams.delete('id');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  setStatus('Загрузка отчёта...');
  try {
    await loadReport();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

elements.attackerMonthSelect?.addEventListener('change', (event) => {
  selectAttackerPeriod('month', event.target.value);
});
elements.attackerMonthSelect?.addEventListener('focus', (event) => {
  if (state.attackerPeriod !== 'month') selectAttackerPeriod('month', event.target.value);
});
elements.attackerWeekSelect?.addEventListener('change', (event) => {
  selectAttackerPeriod('week', event.target.value);
});
elements.attackerWeekSelect?.addEventListener('focus', (event) => {
  if (state.attackerPeriod !== 'week') selectAttackerPeriod('week', event.target.value);
});
elements.attackerPeriodToggle?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-attacker-period]');
  if (!button || button.dataset.attackerPeriod === state.attackerPeriod) return;
  selectAttackerPeriod(button.dataset.attackerPeriod);
});
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
