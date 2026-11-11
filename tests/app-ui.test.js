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
  const amountInput = new FakeElement();
  let scrollCount = 0;
  let focusCount = 0;
  expenseForm.scrollIntoView = () => { scrollCount += 1; };
  amountInput.focus = () => { focusCount += 1; };

  const elements = new Map([
    ['app', app],
    ['loading', loading],
    ['mobileNav', mobileNav],
    ['quickExpense', quickExpense],
    ['expForm', expenseForm],
    ['expAmount', amountInput]
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
  assert.match(nav[1], /pointer-events:\s*auto/);
  assert.match(items[1], /pointer-events:\s*auto/);
  assert.doesNotMatch(nav[1], /pointer-events:\s*none/);
  assert.deepEqual(
    [...navMarkup[0].matchAll(/data-mobile-tab="([^"]+)"/g)].map(match => match[1]),
    ['dashboard', 'extra', 'goals', 'loans', 'assistant', 'settings']
  );
  assert.match(navMarkup[0], /id="quickExpense"/);
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
