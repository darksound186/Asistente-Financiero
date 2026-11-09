const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate } = require('../migration.js');

const fixedNow = new Date('2026-11-09T12:00:00.000Z');

test('migrates active expenses, extra expenses, incomes, and keeps source IDs and period references', () => {
  const timestamp = Date.UTC(2026, 10, 8, 18, 30);
  const expenseId = `${timestamp.toString(36)}abcd`;
  const incomeId = timestamp.toString(36);
  const extraId = (timestamp + 1000).toString(36);
  const raw = JSON.stringify({
    userName: 'Ana',
    salary: 1000000,
    payFrequency: 'quincenal',
    payDay: 15,
    fijosMensual: 400000,
    variablesMensual: 300000,
    currentPeriod: {
      key: '2026-11-A',
      label: '1–15 de noviembre',
      spent: { fijos: 12500, libre: 0, extra: 5000 },
      expenses: [{ id: expenseId, bucket: 'fijos', amount: 12500, category: 'Servicios', note: 'Agua' }],
      extraExpenses: [{ id: extraId, amount: 5000, note: 'Regalo' }],
      incomes: [{ id: incomeId, amount: 20000, note: 'Bono' }]
    },
    history: [{ key: '2026-10-B', label: '16–31 de octubre', fijosAlloc: 200000, fijosSpent: 190000 }],
    goals: [{ id: 'goal-1', name: 'Ahorro', target: 500000, saved: 20000 }],
    loans: [{ id: 'loan-1', person: 'Luis', pending: 10000, status: 'Pendiente' }]
  });

  const result = migrate(raw, fixedNow);

  assert.equal(result.transactions.length, 3);
  assert.equal(result.transactions[0].amountCop, 12500);
  assert.equal(result.transactions[0].legacyId, expenseId);
  assert.equal(result.transactions[0].occurredAt, new Date(timestamp).toISOString());
  assert.equal(result.transactions[0].occurredOnLocal, null);
  assert.equal(result.transactions[0].dateQuality, 'id-derived-utc');
  assert.equal(result.transactions[0].periodId, '2026-11-A');
  assert.equal(result.transactions[0].budgetRef.bucket, 'fijos');
  assert.equal(result.transactions[1].budgetRef.allocatedCop, 660000);
  assert.equal(result.state.currentPeriod.expenses[0].occurredAt, new Date(timestamp).toISOString());
  assert.equal(result.periods[0].budgetQuality, 'legacy-summary');
  assert.deepEqual(result.goals, [{ id: 'goal-1', name: 'Ahorro', target: 500000, saved: 20000 }]);
  assert.deepEqual(result.loans, [{ id: 'loan-1', person: 'Luis', pending: 10000, status: 'Pendiente' }]);
});

test('preserves archived summaries without inventing their individual transactions', () => {
  const result = migrate(JSON.stringify({
    history: [{ key: '2025-01-A', fijosAlloc: 200000, fijosSpent: 100000 }]
  }), fixedNow);

  assert.equal(result.transactions.length, 0);
  assert.equal(result.periods.length, 1);
  assert.equal(result.periods[0].summary.fijosSpent, 100000);
  assert.equal(result.periods[0].dateQuality, 'unknown');
});

test('rejects malformed or unsupported input rather than treating it as an empty account', () => {
  assert.throws(() => migrate('{broken', fixedNow), /no son JSON válido/i);
  assert.throws(() => migrate('null', fixedNow), /no es compatible/i);
});

test('retains malformed transaction values in the legacy payload and reports them', () => {
  const result = migrate(JSON.stringify({
    currentPeriod: {
      key: '2026-11-A',
      expenses: [{ id: 'legacy-id', amount: 'not-a-number', bucket: 'libre', category: 'Otro' }]
    }
  }), fixedNow);

  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].amountCop, null);
  assert.equal(result.transactions[0].legacyRecord.amount, 'not-a-number');
  assert.match(result.warnings[0], /Monto legacy no válido/);
});
