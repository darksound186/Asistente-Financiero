(function (root, factory) {
  const migration = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = migration;
  if (root) root.FinanceMigration = migration;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LEGACY_KEY = 'quincena-state-v3';

  function localDateParts(date) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      timezoneOffsetMinutes: date.getTimezoneOffset()
    };
  }

  function decodeLegacyTimestamp(id, kind, now) {
    if (typeof id !== 'string' || !/^[0-9a-z]+$/i.test(id)) return null;
    const encoded = kind === 'expense' ? id.slice(0, -4) : id;
    if (!encoded || !/^[0-9a-z]+$/i.test(encoded)) return null;

    const milliseconds = Number.parseInt(encoded, 36);
    const currentTime = now instanceof Date ? now.getTime() : Date.now();
    const minTime = Date.UTC(2000, 0, 1);
    if (!Number.isSafeInteger(milliseconds) ||
        milliseconds < minTime ||
        milliseconds > currentTime + 24 * 60 * 60 * 1000) {
      return null;
    }

    return new Date(milliseconds).toISOString();
  }

  function allocationsFor(state) {
    const frequency = state.payFrequency || 'quincenal';
    const fixed = Number(state.fijosMensual) || 0;
    const flexible = Number(state.variablesMensual) || 0;
    const divisor = frequency === 'mensual' || frequency === 'independiente' ? 1 : 2;
    return {
      frequency,
      salaryCop: Number(state.salary) || 0,
      fixedCop: Math.round(fixed / divisor),
      flexibleCop: Math.round(flexible / divisor),
      currency: 'COP'
    };
  }

  function normalizeRecord(record, kind, bucket, period, now, warnings) {
    if (!record || typeof record !== 'object') {
      throw new Error(`Se encontró un registro ${kind} con formato no válido. Los datos originales se conservaron.`);
    }

    const id = String(record.id ?? `missing-${kind}-${warnings.length}`);
    const occurredAt = decodeLegacyTimestamp(id, kind, now);
    const amount = Number(record.amount);
    const validAmount = Number.isSafeInteger(amount) && amount > 0;
    if (!validAmount) warnings.push(`Monto legacy no válido en ${kind} ${id}; se conservó el registro original.`);

    return {
      id: `legacy:${kind}:${bucket || 'none'}:${id}`,
      legacyId: id,
      type: kind === 'income' ? 'income' : 'expense',
      amountCop: validAmount ? amount : null,
      currency: 'COP',
      occurredAt,
      occurredOnLocal: null,
      timezoneOffsetMinutes: null,
      dateQuality: occurredAt ? 'id-derived-utc' : 'unknown',
      periodId: period.id,
      bucket,
      categoryId: record.category || (bucket === 'extra' ? 'dinero-libre' : null),
      categoryLabel: record.category || (bucket === 'extra' ? 'Dinero libre' : null),
      note: typeof record.note === 'string' ? record.note : '',
      budgetRef: {
        periodId: period.id,
        bucket,
        allocatedCop: bucket === 'fijos'
          ? period.budgetSnapshot.fixedCop
          : bucket === 'libre'
            ? period.budgetSnapshot.flexibleCop
            : bucket === 'extra'
              ? period.budgetSnapshot.extraCop
              : null
      },
      createdAt: occurredAt,
      origin: 'legacy-migration',
      legacyRecord: record
    };
  }

  function migrate(raw, now, legacyKey = LEGACY_KEY) {
    let source;
    try {
      source = JSON.parse(raw);
    } catch (error) {
      throw new Error('Los datos financieros locales no son JSON válido. Se conservaron sin cambios.', { cause: error });
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error('El formato de los datos financieros locales no es compatible. Se conservaron sin cambios.');
    }

    const current = source.currentPeriod || null;
    if (current && (typeof current !== 'object' || Array.isArray(current))) {
      throw new Error('El período actual tiene un formato no compatible. Los datos originales se conservaron.');
    }
    if (current) {
      for (const key of ['expenses', 'extraExpenses', 'incomes']) {
        if (current[key] !== undefined && !Array.isArray(current[key])) {
          throw new Error(`La lista ${key} tiene un formato no compatible. Los datos originales se conservaron.`);
        }
      }
    }
    for (const key of ['goals', 'loans']) {
      if (source[key] !== undefined && !Array.isArray(source[key])) {
        throw new Error(`La lista ${key} tiene un formato no compatible. Los datos originales se conservaron.`);
      }
    }
    if (source.history !== undefined && !Array.isArray(source.history)) {
      throw new Error('El historial tiene un formato no compatible. Los datos originales se conservaron.');
    }
    const settings = allocationsFor(source);
    const warnings = [];
    const period = current ? {
      id: String(current.key || 'legacy-current'),
      status: 'active',
      label: String(current.label || 'Período anterior'),
      startDate: null,
      endDate: null,
      dateQuality: 'unknown',
      frequency: settings.frequency,
      cutoffDay: Number(source.payDay) || null,
      currency: 'COP',
      budgetSnapshot: settings,
      budgetQuality: 'reconstructed',
      legacySpent: current.spent || {},
      createdAt: null,
      closedAt: null
    } : null;
    if (current && period) {
      current.budgetSnapshot = period.budgetSnapshot;
      current.budgetQuality = period.budgetQuality;
      const extraIncome = (current.incomes || []).reduce((total, item) => total + (Number(item?.amount) || 0), 0);
      const pendingLoans = (Array.isArray(source.loans) ? source.loans : [])
        .filter(loan => loan?.status === 'Pendiente')
        .reduce((total, loan) => total + (Number(loan.pending) || 0), 0);
      const baseSalary = settings.frequency === 'independiente' ? 0 : settings.salaryCop;
      period.budgetSnapshot.extraCop = baseSalary + extraIncome -
        settings.fixedCop - settings.flexibleCop - pendingLoans;
      current.budgetSnapshot = period.budgetSnapshot;
    }
    const transactions = [];

    if (current && period) {
      for (const [kind, bucket, records] of [
        ['expense', null, current.expenses || []],
        ['expense', 'extra', current.extraExpenses || []],
        ['income', null, current.incomes || []]
      ]) {
        for (const record of records) {
          const recordBucket = bucket || record?.bucket || null;
          const normalized = normalizeRecord(record, kind, recordBucket, period, now, warnings);
          transactions.push(normalized);
        }
      }

      if (current && period) {
        const byLegacyId = new Map(transactions.map(record => [
          `${record.type}:${record.bucket || 'none'}:${record.legacyId}`,
          record
        ]));
        const decorate = (record, type, bucket) => {
          const key = `${type}:${bucket || 'none'}:${String(record.id ?? '')}`;
          const transaction = byLegacyId.get(key);
          return transaction ? {
            ...record,
            origin: 'legacy-migration',
            legacyId: transaction.legacyId,
            occurredAt: transaction.occurredAt,
            occurredOnLocal: transaction.occurredOnLocal,
            dateQuality: transaction.dateQuality,
            periodId: transaction.periodId,
            budgetRef: transaction.budgetRef,
            legacyRecord: record
          } : { ...record };
        };
        current.expenses = (current.expenses || []).map(record => decorate(record, 'expense', record?.bucket || null));
        current.extraExpenses = (current.extraExpenses || []).map(record => decorate(record, 'expense', 'extra'));
        current.incomes = (current.incomes || []).map(record => decorate(record, 'income', null));
      }
    }

    const periods = Array.isArray(source.history)
      ? source.history.map((item, index) => ({
          id: String(item?.key || `legacy-history-${index}`),
          status: 'closed',
          label: String(item?.label || 'Período archivado'),
          startDate: null,
          endDate: null,
          dateQuality: 'unknown',
          frequency: null,
          cutoffDay: null,
          currency: 'COP',
          budgetSnapshot: {
            fixedCop: item?.fijosAlloc ?? null,
            flexibleCop: item?.libreAlloc ?? null,
            extraCop: item?.extraAlloc ?? null
          },
          budgetQuality: 'legacy-summary',
          summary: item,
          createdAt: null,
          closedAt: null
        }))
      : [];

    const state = {
      ...source,
      currentPeriod: current ? {
        ...current,
        expenses: (current.expenses || []).map(item => ({ ...item })),
        extraExpenses: (current.extraExpenses || []).map(item => ({ ...item })),
        incomes: (current.incomes || []).map(item => ({ ...item }))
      } : null,
      goals: Array.isArray(source.goals) ? source.goals : [],
      loans: Array.isArray(source.loans) ? source.loans : []
    };

    return {
      legacyKey,
      state,
      period,
      periods,
      transactions,
      goals: state.goals,
      loans: state.loans,
      warnings,
      migratedAt: (now instanceof Date ? now : new Date()).toISOString()
    };
  }

  function toLocalDate(date) {
    const parts = localDateParts(date);
    return {
      date: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
      timezoneOffsetMinutes: parts.timezoneOffsetMinutes
    };
  }

  return { LEGACY_KEY, migrate, toLocalDate };
});
