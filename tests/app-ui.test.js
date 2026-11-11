const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

class FakeElement {
  constructor({ dataset = {}, className = '' } = {}) {
    this.dataset = dataset;
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.parentNode = null;
    this.style = {};
    this.classes = new Set(className.split(/\s+/).filter(Boolean));
    this.classList = {
      contains: name => this.classes.has(name),
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.classes.has(name) : force;
        if (enabled) this.classes.add(name);
        else this.classes.delete(name);
        return enabled;
      }
    };
    Object.defineProperty(this, 'className', {
      get: () => [...this.classes].join(' '),
      set: value => {
        this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
      }
    });
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  append(...elements) {
    for (const element of elements) {
      element.parentNode = this;
      this.children.push(element);
    }
  }

  prepend(element) {
    element.parentNode = this;
    this.children.unshift(element);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(element => element !== this);
    this.parentNode = null;
  }

  click() {
    for (const listener of this.listeners.get('click') || []) {
      listener({ target: this, preventDefault() {} });
    }
  }

  closest(selector) {
    return this.ancestors?.[selector] || null;
  }

  querySelector(selector) {
    return this.descendants?.[selector] || null;
  }
}

function createEnvironment() {
  let nextTimerId = 1;
  const timers = new Map();
  const app = new FakeElement();
  const tabs = ['dashboard', 'extra', 'goals', 'loans', 'assistant', 'settings']
    .map(mobileTab => new FakeElement({ dataset: { mobileTab }, className: 'mobile-nav-item' }));
  const quickExpense = new FakeElement({ className: 'mobile-nav-item nav-action-btn' });
  const mobileNav = new FakeElement({ className: 'mobile-nav' });
  const loading = new FakeElement();
  const expenseForm = new FakeElement();
  const incomeForm = new FakeElement();
  const amountInput = new FakeElement();
  const incomeAmount = new FakeElement();
  const expenseEntry = new FakeElement();
  const incomeEntry = new FakeElement();
  const periodHistory = new FakeElement();
  const showHistory = new FakeElement();
  const settingsButton = new FakeElement();
  let scrollCount = 0;
  let focusCount = 0;
  expenseForm.scrollIntoView = () => { scrollCount += 1; };
  incomeForm.scrollIntoView = () => { scrollCount += 1; };
  periodHistory.scrollIntoView = () => { scrollCount += 1; };
  amountInput.focus = () => { focusCount += 1; };
  incomeAmount.focus = () => { focusCount += 1; };

  const elements = new Map([
    ['app', app],
    ['loading', loading],
    ['mobileNav', mobileNav],
    ['quickExpense', quickExpense],
    ['openSettings', settingsButton],
    ['expenseEntry', expenseEntry],
    ['incomeEntry', incomeEntry],
    ['periodHistory', periodHistory],
    ['showHistory', showHistory],
    ['expForm', expenseForm],
    ['expAmount', amountInput],
    ['incForm', incomeForm],
    ['incAmount', incomeAmount]
  ]);
  const document = {
    readyState: 'loading',
    addEventListener() {},
    createElement() {
      return new FakeElement();
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-mobile-tab]') return tabs;
      if (selector === '.mobile-nav-item') return [...tabs, quickExpense];
      return [];
    }
  };
  const window = {
    isSecureContext: false,
    addEventListener() {}
  };
  const context = {
    window,
    document,
    navigator: {},
    console,
    Date,
    Math,
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  };
  vm.createContext(context);
  vm.runInContext(appSource, context, { filename: 'app.js' });

  return {
    app,
    context,
    tabs,
    mobileNav,
    quickExpense,
    settingsButton,
    expenseEntry,
    incomeEntry,
    periodHistory,
    showHistory,
    timers,
    fireTimer(id) {
      const timer = timers.get(id);
      assert.ok(timer, `timer ${id} exists`);
      timers.delete(id);
      timer.callback();
    },
    fireCallback(callback) {
      callback();
    },
    get scrollCount() {
      return scrollCount;
    },
    get focusCount() {
      return focusCount;
    }
  };
}

test('notices deduplicate, replace older notices, and ignore stale timers', () => {
  const environment = createEnvironment();
  const { app, context, timers } = environment;

  vm.runInContext('showNotice("Aviso de prueba", "alert warn")', context);
  assert.equal(app.children.length, 1);
  const firstNotice = app.children[0];
  const firstTimer = [...timers.values()][0];
  assert.equal(firstTimer.delay, 5000);

  vm.runInContext('showNotice("Aviso de prueba", "alert warn")', context);
  assert.equal(app.children.length, 1);
  assert.equal(app.children[0], firstNotice);
  assert.equal(timers.size, 1);

  vm.runInContext('showNotice("Aviso nuevo", "alert danger")', context);
  const currentNotice = app.children[0];
  assert.notEqual(currentNotice, firstNotice);
  environment.fireCallback(firstTimer.callback);
  assert.equal(app.children[0], currentNotice);

  currentNotice.children[1].click();
  assert.equal(app.children.length, 0);
  assert.equal(timers.size, 0);
});

test('notice timeout removes the visible notice', () => {
  const environment = createEnvironment();
  vm.runInContext('showNotice("Aviso temporal")', environment.context);
  const timerId = [...environment.timers.keys()][0];
  environment.fireTimer(timerId);
  assert.equal(environment.app.children.length, 0);
});

test('mobile navigation switches every section and the quick action focuses the expense form', () => {
  const environment = createEnvironment();
  const { context, tabs, quickExpense, timers } = environment;
  context.renderCalls = 0;
  vm.runInContext('render = function(){ renderCalls += 1; updateMobileNav(); }', context);

  for (const button of tabs) {
    button.click();
    assert.equal(vm.runInContext('currentTab', context), button.dataset.mobileTab);
    assert.equal(button.classList.contains('active'), true);
    assert.equal(button.getAttribute('aria-current'), 'page');
    assert.equal(tabs.filter(item => item.classList.contains('active')).length, 1);
  }

  quickExpense.click();
  assert.equal(vm.runInContext('currentTab', context), 'dashboard');
  const quickActionTimer = [...timers.entries()].find(([, timer]) => timer.delay === 100);
  assert.ok(quickActionTimer);
  environment.fireTimer(quickActionTimer[0]);
  assert.equal(environment.scrollCount, 1);
  assert.equal(environment.focusCount, 1);
  assert.equal(environment.expenseEntry.open, true);

  environment.settingsButton.click();
  assert.equal(vm.runInContext('currentTab', context), 'settings');
});

test('quick income action opens and focuses the income form', () => {
  const environment = createEnvironment();
  environment.context.render = () => {};
  environment.context.window.abrirModalIngresoRapido();
  const quickActionTimer = [...environment.timers.entries()].find(([, timer]) => timer.delay === 100);
  assert.ok(quickActionTimer);
  environment.fireTimer(quickActionTimer[0]);
  assert.equal(environment.incomeEntry.open, true);
  assert.equal(environment.scrollCount, 1);
  assert.equal(environment.focusCount, 1);
});

test('history shortcut opens the complete history section', () => {
  const environment = createEnvironment();
  vm.runInContext('bindDashboard()', environment.context);
  environment.showHistory.click();
  assert.equal(environment.periodHistory.open, true);
  assert.equal(environment.scrollCount, 1);
});

test('dashboard renders the cycle balance, recent movements, quick access, and archived summaries', () => {
  const environment = createEnvironment();
  const { context } = environment;
  context.fmt = amount => `COP ${amount}`;
  context.escapeHtml = value => String(value);
  context.transactionDateLabel = item => item.occurredOnLocal || 'Hoy';
  context.getAllocations = () => ({ fijos: 50000, libre: 60000 });
  vm.runInContext(`
    state = {
      salary: 100000,
      payFrequency: 'mensual',
      fijosMensual: 50000,
      variablesMensual: 60000,
      loans: [],
      currentPeriod: {
        key: '2026-11-M',
        incomes: [{ id: 'income-1', amount: 20000, note: 'Pago', occurredAt: '2026-11-10T12:00:00Z' }],
        expenses: [{ id: 'expense-1', amount: 3000, note: 'Café', category: 'Comida', bucket: 'libre', occurredAt: '2026-11-11T12:00:00Z' }],
        extraExpenses: [],
        spent: { fijos: 0, libre: 3000, extra: 0 }
      },
      history: [{ key: '2026-10-M', label: 'octubre 2026', ingresoExtra: 100000, fijosSpent: 5000, libreSpent: 2500, extraSpent: 0 }]
    };
  `, context);

  const html = vm.runInContext('renderDashboard({label: "noviembre 2026", remaining: 10, elapsed: 11, totalDays: 30})', context);
  assert.match(html, /Balance estimado del ciclo/);
  assert.match(html, /COP 117000/);
  assert.ok(html.indexOf('Café') < html.indexOf('Pago'));
  assert.match(html, /Base configurada, no confirmada/);
  assert.match(html, /no saldo bancario/);
  assert.match(html, /id="quickAddExpense"/);
  assert.match(html, /id="quickAddIncome"/);
  assert.match(html, /id="periodHistory"/);
  assert.match(html, /aria-valuenow="37"/);
  assert.match(html, /octubre 2026/);
});

test('archived periods are queried lazily when the history is opened', async () => {
  const environment = createEnvironment();
  const { context } = environment;
  context.fmt = amount => `COP ${amount}`;
  context.escapeHtml = value => String(value);
  context.transactionDateLabel = () => 'Fecha por confirmar';
  context.getAllocations = () => ({ fijos: 0, libre: 0 });
  vm.runInContext(`
    state = {
      salary: 0,
      payFrequency: 'mensual',
      currentPeriod: { key: 'current', incomes: [], expenses: [], extraExpenses: [], spent: { fijos: 0, libre: 0, extra: 0 } },
      history: []
    };
    archivedPeriodsCache = null;
  `, context);

  let queries = 0;
  context.FinanceDB = {
    getArchivedPeriods: async () => {
      queries += 1;
      return [{ id: 'archive', status: 'closed', label: 'Ciclo guardado', summary: {} }];
    }
  };
  vm.runInContext('renderDashboard({label: "ciclo actual", remaining: 1, elapsed: 1, totalDays: 30})', context);
  assert.equal(queries, 0);

  const container = new FakeElement();
  context.archiveContainer = container;
  await vm.runInContext('loadArchivedPeriods(archiveContainer)', context);
  await vm.runInContext('loadArchivedPeriods(archiveContainer)', context);
  assert.equal(queries, 1);
  assert.match(container.innerHTML, /Ciclo guardado/);
});

test('cycle estimate separates configured salary, registered income, and all expense buckets', () => {
  const environment = createEnvironment();
  const { context } = environment;
  vm.runInContext(`
    state = {
      salary: 100000,
      payFrequency: 'mensual',
      fijosMensual: 40000,
      variablesMensual: 20000,
      loans: [{ pending: 8000, status: 'Pendiente' }],
      currentPeriod: {
        incomes: [{ id: 'income', amount: 20000 }],
        expenses: [{ id: 'fixed', amount: 10000, bucket: 'fijos' }, { id: 'flex', amount: 5000, bucket: 'libre' }],
        extraExpenses: [{ id: 'extra', amount: 3000 }],
        spent: { fijos: 10000, libre: 5000, extra: 3000 }
      }
    };
  `, context);

  const summary = vm.runInContext('calculateWalletSummary({})', context);
  assert.equal(summary.configuredIncome, 100000);
  assert.equal(summary.registeredIncome, 20000);
  assert.equal(summary.estimatedIncome, 120000);
  assert.equal(summary.periodExpenses, 18000);
  assert.equal(summary.estimatedBalance, 102000);
  assert.equal(summary.freeMoney, 49000);
});

test('independent cycle estimate uses registered income only', () => {
  const environment = createEnvironment();
  const { context } = environment;
  vm.runInContext(`
    state = {
      salary: 0,
      payFrequency: 'independiente',
      fijosMensual: 0,
      variablesMensual: 0,
      loans: [],
      currentPeriod: {
        incomes: [{ id: 'income', amount: 25000 }],
        expenses: [],
        extraExpenses: [],
        spent: { fijos: 0, libre: 0, extra: 0 }
      }
    };
  `, context);

  const summary = vm.runInContext('calculateWalletSummary({})', context);
  assert.equal(summary.configuredIncome, 0);
  assert.equal(summary.registeredIncome, 25000);
  assert.equal(summary.estimatedBalance, 25000);
});

test('dashboard does not turn inconsistent totals or invalid pending loans into zero', () => {
  const environment = createEnvironment();
  const { context } = environment;
  context.fmt = amount => `COP ${amount}`;
  context.escapeHtml = value => String(value);
  context.transactionDateLabel = () => 'Fecha por confirmar';
  context.getAllocations = () => ({ fijos: 0, libre: 0 });
  vm.runInContext(`
    state = {
      salary: 10000,
      payFrequency: 'mensual',
      loans: [{ status: 'Pendiente', pending: 'dato inválido' }],
      currentPeriod: {
        key: 'current',
        incomes: [],
        expenses: [],
        extraExpenses: [],
        spent: { fijos: 1000, libre: 0, extra: 0 }
      },
      history: []
    };
  `, context);

  const html = vm.runInContext('renderDashboard({label: "ciclo", remaining: 1, elapsed: 1, totalDays: 30})', context);
  assert.match(html, /wallet-balance-amount[^>]*>Revisar registros/);
  assert.match(html, /movimientos y los totales guardados no coinciden/);
  assert.match(html, /wallet-free-card[\s\S]*>Revisar registros</);

  vm.runInContext('state.currentPeriod.spent.fijos = 0', context);
  const invalidLoanHtml = vm.runInContext('renderDashboard({label: "ciclo", remaining: 1, elapsed: 1, totalDays: 30})', context);
  assert.match(invalidLoanHtml, /wallet-free-card[\s\S]*>Revisar compromisos</);
  assert.doesNotMatch(invalidLoanHtml.match(/<section class="wallet-free-card"[\s\S]*?<\/section>/)[0], /COP 0/);
});

test('current movement list includes extraordinary expenses and sorts every movement newest first', () => {
  const environment = createEnvironment();
  const { context } = environment;
  context.escapeHtml = value => String(value);
  context.fmt = amount => `COP ${amount}`;
  context.transactionDateLabel = item => item.occurredOnLocal || 'Fecha por confirmar';
  vm.runInContext(`
    state = {
      currentPeriod: {
        key: '2026-11-M',
        expenses: [
          { id: 'fixed', amount: 10000, bucket: 'fijos', category: 'Servicios', note: 'Factura', occurredAt: '2026-11-01T10:00:00Z' },
          { id: 'free', amount: 5000, bucket: 'libre', category: 'Comida', note: 'Almuerzo', occurredAt: '2026-11-02T10:00:00Z' }
        ],
        extraExpenses: [{ id: 'extra', amount: 3000, note: 'Reparación', occurredAt: '2026-11-03T10:00:00Z' }],
        incomes: [{ id: 'income', amount: 20000, note: 'Pago recibido', occurredAt: '2026-11-04T10:00:00Z' }]
      }
    };
  `, context);

  const movements = vm.runInContext('getCurrentPeriodMovements({label: "noviembre", key: "2026-11-M"})', context);
  assert.deepEqual(JSON.parse(JSON.stringify(movements.map(item => [item.id, item.type, item.typeLabel]))), [
    ['income', 'income', 'Ingreso'],
    ['extra', 'expense', 'Gasto extraordinario'],
    ['free', 'expense', 'Gasto libre'],
    ['fixed', 'expense', 'Gasto fijo']
  ]);
  const html = vm.runInContext('renderMovementList(getCurrentPeriodMovements({label: "noviembre", key: "2026-11-M"}), "vacío")', context);
  assert.match(html, /Reparación/);
  assert.match(html, /Dinero libre/);
  assert.match(html, /noviembre/);
  assert.match(html, /Fecha por confirmar/);
});

test('movement identity prevents duplicates within a period but keeps distinct types', () => {
  const environment = createEnvironment();
  const { context } = environment;
  vm.runInContext(`
    state = {
      currentPeriod: {
        key: '2026-11-M',
        expenses: [{ id: 'same', amount: 400, bucket: 'extra', note: 'Duplicado', occurredAt: '2026-11-04T10:00:00Z' }],
        extraExpenses: [{ id: 'same', amount: 400, note: 'Duplicado', occurredAt: '2026-11-04T10:00:00Z' }],
        incomes: [{ id: 'same', amount: 400, note: 'Ingreso distinto', occurredAt: '2026-11-04T10:00:00Z' }]
      }
    };
  `, context);

  const movements = vm.runInContext('getCurrentPeriodMovements({label: "noviembre"})', context);
  assert.equal(movements.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(movements.map(item => item.type).sort())), ['expense', 'income']);
});

test('archived movement view filters by period and deduplicates without changing period identity', () => {
  const environment = createEnvironment();
  const { context } = environment;
  context.escapeHtml = value => String(value);
  context.fmt = amount => `COP ${amount}`;
  context.transactionDateLabel = item => item.occurredOnLocal || 'Fecha por confirmar';
  const records = [
    { id: 'same', periodId: 'old-cycle', type: 'expense', bucket: 'fijos', amountCop: 500, note: 'Primero', occurredOnLocal: '2026-10-02' },
    { id: 'same', periodId: 'old-cycle', type: 'expense', bucket: 'fijos', amountCop: 500, note: 'Duplicado', occurredOnLocal: '2026-10-02' },
    { id: 'other', periodId: 'new-cycle', type: 'income', amountCop: 800, note: 'Otro ciclo', occurredOnLocal: '2026-11-02' }
  ];
  context.records = records;

  const movements = vm.runInContext('getHistoricalMovements(records, {id: "old-cycle", label: "octubre"})', context);
  assert.equal(movements.length, 1);
  assert.equal(movements[0].periodId, 'old-cycle');
  assert.equal(movements[0].periodLabel, 'octubre');
  const html = vm.runInContext('renderMovementList(getHistoricalMovements(records, {id: "old-cycle", label: "octubre"}), "vacío")', context);
  assert.match(html, /Primero/);
  assert.match(html, /Gasto fijo/);
  assert.doesNotMatch(html, /Otro ciclo/);
});

test('archived cycle movements load only on request and use the selected period id', async () => {
  const environment = createEnvironment();
  const { context } = environment;
  context.escapeHtml = value => String(value);
  context.fmt = amount => `COP ${amount}`;
  context.transactionDateLabel = item => item.occurredOnLocal || 'Fecha por confirmar';
  vm.runInContext(`
    state = {
      currentPeriod: { key: 'current' },
      history: [{ key: 'archive', label: 'Ciclo archivado' }]
    };
    archiveMovementCache.clear();
  `, context);

  const calls = [];
  context.FinanceDB = {
    getTransactionsByPeriod: async periodId => {
      calls.push(periodId);
      return [
        { id: 'archived-expense', periodId: 'archive', type: 'expense', bucket: 'extra', amountCop: 500, note: 'Respaldo', occurredOnLocal: '2026-10-04' },
        { id: 'other-cycle', periodId: 'other', type: 'income', amountCop: 700, note: 'No mostrar' }
      ];
    }
  };
  const movementContainer = new FakeElement();
  const cycleContainer = new FakeElement();
  cycleContainer.querySelector = selector => selector === '[data-history-movements]' ? movementContainer : null;
  const button = new FakeElement({ dataset: { historyPeriod: 'archive' } });
  button.closest = selector => selector === '[data-history-cycle]' ? cycleContainer : null;
  context.historyButton = button;

  await vm.runInContext('loadArchivedPeriodMovements(historyButton)', context);
  assert.deepEqual(calls, ['archive']);
  assert.equal(button.hidden, true);
  assert.match(movementContainer.innerHTML, /Respaldo/);
  assert.match(movementContainer.innerHTML, /Ciclo archivado/);
  assert.doesNotMatch(movementContainer.innerHTML, /No mostrar/);
});

test('archived cycles without individual records keep their summary and disclose the limitation', async () => {
  const environment = createEnvironment();
  const { context } = environment;
  context.escapeHtml = value => String(value);
  vm.runInContext(`
    state = { currentPeriod: { key: 'current' }, history: [{ key: 'archive', label: 'Ciclo antiguo' }] };
    archiveMovementCache.clear();
  `, context);
  context.FinanceDB = { getTransactionsByPeriod: async () => [] };

  const movementContainer = new FakeElement();
  const cycleContainer = new FakeElement();
  cycleContainer.querySelector = () => movementContainer;
  const button = new FakeElement({ dataset: { historyPeriod: 'archive' } });
  button.closest = () => cycleContainer;
  context.historyButton = button;

  await vm.runInContext('loadArchivedPeriodMovements(historyButton)', context);
  assert.equal(button.hidden, true);
  assert.match(movementContainer.innerHTML, /solo se conserva el resumen/);
});

test('legacy-shaped movements preserve their available values and never invent a date or amount', () => {
  const environment = createEnvironment();
  const { context } = environment;
  context.escapeHtml = value => String(value);
  context.fmt = amount => `COP ${amount}`;
  context.transactionDateLabel = item => item.occurredOnLocal || 'Fecha por confirmar';
  context.legacy = { id: 'legacy-id', amount: 1500, bucket: 'fijos', category: 'Servicios', note: 'Agua' };
  context.invalid = { id: 'invalid-id', amount: null, bucket: 'libre', note: '' };

  const legacy = vm.runInContext('makeMovement(legacy, "old-cycle", "ciclo viejo", "expense")', context);
  const invalidHtml = vm.runInContext('renderMovementItem(makeMovement(invalid, "old-cycle", "ciclo viejo", "expense"))', context);
  assert.equal(legacy.amount, 1500);
  assert.equal(legacy.dateLabel, 'Fecha por confirmar');
  assert.match(vm.runInContext('renderMovementItem(makeMovement(legacy, "old-cycle", "ciclo viejo", "expense"))', context), /Agua/);
  assert.match(invalidHtml, /Monto por revisar/);
  assert.doesNotMatch(invalidHtml, /COP 0/);
});

test('empty movement list is explicit', () => {
  const environment = createEnvironment();
  const { context } = environment;
  context.escapeHtml = value => String(value);
  const html = vm.runInContext('renderMovementList([], "No hay movimientos del ciclo")', context);
  assert.match(html, /No hay movimientos del ciclo/);
});

test('service worker uses a new shell cache for the wallet redesign', () => {
  const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const storageTest = fs.readFileSync(path.join(root, 'tests', 'storage.test.html'), 'utf8');
  assert.match(serviceWorker, /CACHE_PREFIX = 'asistente-financiero-'/);
  assert.match(serviceWorker, /\$\{CACHE_PREFIX\}shell-v3/);
  assert.match(storageTest, /asistente-financiero-shell-v3/);
});

test('mobile navigation styles keep the bar and its buttons pointer-targetable', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const nav = css.match(/\.mobile-nav\s*\{([^}]*)\}/);
  const items = css.match(/\.mobile-nav-item\s*\{([^}]*)\}/);
  const navMarkup = html.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/);
  assert.ok(nav);
  assert.ok(items);
  assert.ok(navMarkup);
  assert.match(html, /id="openSettings"/);
  assert.match(nav[1], /pointer-events:\s*auto/);
  assert.match(items[1], /pointer-events:\s*auto/);
  assert.doesNotMatch(nav[1], /pointer-events:\s*none/);
  assert.deepEqual(
    [...navMarkup[0].matchAll(/data-mobile-tab="([^"]+)"/g)].map(match => match[1]),
    ['dashboard', 'extra', 'goals', 'loans', 'assistant', 'settings']
  );
  assert.match(navMarkup[0], /id="quickExpense"/);
  assert.match(css, /\.wallet-balance-card\s*\{/);
  assert.match(css, /\.wallet-activity-item\s*\{/);
});

test('mobile navigation stays hidden while the initial setup form is shown', () => {
  const environment = createEnvironment();
  environment.context.renderSetup = () => 'setup';
  environment.context.bindSetup = () => {};
  vm.runInContext('render()', environment.context);
  assert.equal(environment.mobileNav.hidden, true);
});

test('Android workflow runs for every changed PWA runtime asset', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'android-debug.yml'), 'utf8');
  const push = workflow.match(/  push:\r?\n([\s\S]*?)\r?\n  pull_request:/);
  const pullRequest = workflow.match(/  pull_request:\r?\n([\s\S]*?)\r?\n  workflow_dispatch:/);
  assert.ok(push);
  assert.ok(pullRequest);
  for (const section of [push[1], pullRequest[1]]) {
    assert.match(section, /branches:\r?\n\s+- main/);
    for (const file of [
      'app.js',
      'index.html',
      'manifest.webmanifest',
      'migration.js',
      'storage.js',
      'styles.css',
      'sw.js',
      'tests/**',
      'android/**',
      '.github/workflows/android-debug.yml'
    ]) assert.ok(section.includes(file), `${file} triggers Android checks`);
  }
});
