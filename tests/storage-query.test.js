const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const storageSource = fs.readFileSync(path.join(root, 'storage.js'), 'utf8');

function createStorageEnvironment(data) {
  const transactions = [];
  const counters = { indexedPeriodQueries: 0, fullTransactionReads: 0, closeCalls: 0 };

  const db = {
    transaction(storeNames, mode) {
      const transaction = {
        mode,
        pending: 0,
        oncomplete: null,
        onabort: null,
        onerror: null,
        request(result) {
          const request = { result, onsuccess: null, onerror: null };
          this.pending += 1;
          queueMicrotask(() => {
            request.onsuccess?.({ target: request });
            this.pending -= 1;
            if (this.pending === 0) queueMicrotask(() => this.oncomplete?.({ target: this }));
          });
          return request;
        },
        objectStore(name) {
          return {
            get(id) {
              const record = (data[name] || []).find(item => item.id === id);
              return transaction.request(record);
            },
            getAll() {
              if (name === 'transactions') counters.fullTransactionReads += 1;
              return transaction.request(data[name] || []);
            },
            index(indexName) {
              return {
                getAll(range) {
                  assert.equal(indexName, 'periodId');
                  counters.indexedPeriodQueries += 1;
                  return transaction.request((data[name] || []).filter(item => item.periodId === range));
                }
              };
            }
          };
        }
      };
      transactions.push(transaction);
      return transaction;
    },
    close() {
      counters.closeCalls += 1;
    }
  };

  const indexedDB = {
    open() {
      const request = { result: db, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      queueMicrotask(() => request.onsuccess?.({ target: request }));
      return request;
    }
  };
  const window = {
    indexedDB,
    FinanceMigration: { LEGACY_KEY: 'legacy-state' },
    localStorage: { getItem: () => null }
  };
  const context = {
    window,
    indexedDB,
    localStorage: window.localStorage,
    IDBKeyRange: { only: value => value },
    Date,
    JSON,
    Promise,
    Error,
    Number,
    Math,
    String,
    Array,
    Object,
    Set,
    queueMicrotask
  };

  vm.createContext(context);
  vm.runInContext(storageSource, context, { filename: 'storage.js' });

  return { financeDB: window.FinanceDB, transactions, counters, data };
}

test('historical transaction query uses the period index and does not mutate records', async () => {
  const sourceRecords = [
    { id: 'old-1', periodId: '2026-10-A', type: 'expense', amountCop: 1200 },
    { id: 'new-1', periodId: '2026-11-A', type: 'income', amountCop: 5000 }
  ];
  const fixture = { appState: [], periods: [], transactions: sourceRecords, goals: [], loans: [] };
  const environment = createStorageEnvironment(fixture);

  const result = await environment.financeDB.getTransactionsByPeriod('2026-10-A');

  assert.deepEqual(JSON.parse(JSON.stringify(result)), [sourceRecords[0]]);
  assert.equal(environment.transactions[0].mode, 'readonly');
  assert.equal(environment.counters.indexedPeriodQueries, 1);
  assert.equal(environment.counters.fullTransactionReads, 0);
  assert.equal(environment.counters.closeCalls, 1);
  assert.deepEqual(fixture.transactions, sourceRecords);
});

test('historical transaction query rejects an empty period id before opening the database', async () => {
  const environment = createStorageEnvironment({ appState: [], periods: [], transactions: [], goals: [], loans: [] });

  await assert.rejects(environment.financeDB.getTransactionsByPeriod(' '), /identificador del período/);
  assert.equal(environment.transactions.length, 0);
});

test('archived period query reads period summaries without loading transactions', async () => {
  const fixture = {
    appState: [],
    periods: [
      { id: 'old-cycle', status: 'closed', label: 'Ciclo anterior' },
      { id: 'current-cycle', status: 'active', label: 'Ciclo actual' }
    ],
    transactions: [{ id: 'old-movement', periodId: 'old-cycle', amountCop: 500 }],
    goals: [],
    loans: []
  };
  const environment = createStorageEnvironment(fixture);

  const periods = await environment.financeDB.getArchivedPeriods();

  assert.deepEqual(JSON.parse(JSON.stringify(periods)), [fixture.periods[0]]);
  assert.equal(environment.transactions[0].mode, 'readonly');
  assert.equal(environment.counters.fullTransactionReads, 0);
  assert.equal(environment.counters.closeCalls, 1);
});

test('backup export continues to include current and archived records unchanged', async () => {
  const fixture = {
    appState: [{ id: 'main', salary: 100000 }],
    periods: [{ id: '2026-10-A', status: 'closed', summary: { fijosSpent: 5000 } }],
    transactions: [
      { id: 'archived-1', periodId: '2026-10-A', type: 'expense', amountCop: 5000 },
      { id: 'current-1', periodId: '2026-11-A', type: 'income', amountCop: 15000 }
    ],
    goals: [{ id: 'goal-1', saved: 2000 }],
    loans: [{ id: 'loan-1', pending: 3000 }]
  };
  const before = JSON.parse(JSON.stringify(fixture));
  const environment = createStorageEnvironment(fixture);

  const backup = await environment.financeDB.exportBackup();

  assert.equal(backup.format, 'asistente-financiero-backup');
  assert.equal(backup.version, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(backup.transactions)), before.transactions);
  assert.deepEqual(JSON.parse(JSON.stringify(backup.periods)), before.periods);
  assert.deepEqual(JSON.parse(JSON.stringify(backup.goals)), before.goals);
  assert.deepEqual(JSON.parse(JSON.stringify(backup.loans)), before.loans);
  assert.deepEqual(fixture, before);
  assert.equal(environment.counters.fullTransactionReads, 1);
});
