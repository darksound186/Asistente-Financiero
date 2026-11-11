(function () {
  const DB_NAME = window.FINANCE_DB_NAME || 'asistente-financiero';
  const DB_VERSION = 1;
  const APP_ID = 'main';
  const LEGACY_KEY = window.FINANCE_LEGACY_KEY || window.FinanceMigration.LEGACY_KEY;
  const LEGACY_API_KEY = window.FINANCE_GEMINI_KEY_NAME || 'gemini_api_key';
  const STORE_NAMES = ['appState', 'periods', 'transactions', 'goals', 'loans', 'backups', 'meta'];

  function openDatabase() {
    if (!('indexedDB' in window)) {
      return Promise.reject(new Error('Este navegador no permite el almacenamiento local necesario para la aplicación.'));
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      let blocked = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('appState')) db.createObjectStore('appState', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('periods')) db.createObjectStore('periods', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('transactions')) {
          const store = db.createObjectStore('transactions', { keyPath: 'id' });
          store.createIndex('periodId', 'periodId', { unique: false });
          store.createIndex('occurredAt', 'occurredAt', { unique: false });
          store.createIndex('type', 'type', { unique: false });
        }
        if (!db.objectStoreNames.contains('goals')) db.createObjectStore('goals', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('loans')) db.createObjectStore('loans', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('No se pudo abrir la base de datos local.'));
      request.onblocked = () => {
        blocked = true;
        reject(new Error('Cierra otras pestañas de la aplicación para completar la actualización local.'));
      };
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Falló una operación de almacenamiento.'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('No se pudo completar la escritura local.'));
      transaction.onerror = () => reject(transaction.error || new Error('Falló una transacción de almacenamiento.'));
    });
  }

  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function serializeState(state) {
    const stored = copy(state);
    if (stored.currentPeriod) {
      delete stored.currentPeriod.expenses;
      delete stored.currentPeriod.incomes;
      delete stored.currentPeriod.extraExpenses;
    }
    delete stored.goals;
    delete stored.loans;
    return { ...stored, id: APP_ID };
  }

  function periodFromHistory(summary) {
    return {
      id: String(summary.key),
      status: 'closed',
      label: summary.label || 'Período archivado',
      dateQuality: 'unknown',
      currency: 'COP',
      budgetSnapshot: {
        fixedCop: summary.fijosAlloc ?? null,
        flexibleCop: summary.libreAlloc ?? null,
        extraCop: summary.extraAlloc ?? null
      },
      budgetQuality: 'legacy-summary',
      summary
    };
  }

  function toTransaction(record, type, bucket, period) {
    const id = String(record.id ?? (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`));
    const amount = Number(record.amount);
    const isLegacy = record.origin === 'legacy-migration' || String(record.id).startsWith('legacy:');
    const generatedAt = record.occurredAt || (isLegacy ? null : new Date().toISOString());
    const localDate = generatedAt ? FinanceMigration.toLocalDate(new Date(generatedAt)) : null;
    const category = record.category || (bucket === 'extra' ? 'Dinero libre' : null);
    const allocation = bucket === 'fijos'
      ? period?.budgetSnapshot?.fixedCop
      : bucket === 'libre'
        ? period?.budgetSnapshot?.flexibleCop
        : bucket === 'extra'
          ? period?.budgetSnapshot?.extraCop
          : null;

    return {
      id: isLegacy ? `${type}:${bucket || 'none'}:${id}` : id,
      legacyId: isLegacy ? String(record.legacyId || record.id) : null,
      type,
      amountCop: Number.isSafeInteger(amount) && amount > 0 ? amount : null,
      currency: 'COP',
      occurredAt: record.occurredAt || generatedAt,
      occurredOnLocal: record.occurredOnLocal || (isLegacy ? null : localDate?.date) || null,
      timezoneOffsetMinutes: record.timezoneOffsetMinutes ?? (isLegacy ? null : localDate?.timezoneOffsetMinutes) ?? null,
      dateQuality: record.dateQuality || 'exact',
      periodId: period?.id || null,
      bucket,
      categoryId: category,
      categoryLabel: category,
      note: record.note || '',
      source: record.source || null,
      budgetRef: {
        periodId: period?.id || null,
        bucket,
        allocatedCop: record.budgetRef?.allocatedCop ?? allocation ?? null
      },
      createdAt: record.createdAt || generatedAt,
      origin: isLegacy ? 'legacy-migration' : 'user-entry',
      legacyRecord: record.legacyRecord || null
    };
  }

  function toPeriodRecord(currentPeriod, state) {
    const frequency = state.payFrequency || 'quincenal';
    const divisor = frequency === 'mensual' || frequency === 'independiente' ? 1 : 2;
    return {
      id: String(currentPeriod.key),
      status: 'active',
      label: currentPeriod.label,
      startDate: currentPeriod.startDate || null,
      endDate: currentPeriod.endDate || null,
      dateQuality: currentPeriod.dateQuality || 'unknown',
      frequency,
      cutoffDay: Number(state.payDay) || null,
      currency: 'COP',
      budgetSnapshot: currentPeriod.budgetSnapshot || {
        salaryCop: Number(state.salary) || 0,
        fixedCop: Math.round((Number(state.fijosMensual) || 0) / divisor),
        flexibleCop: Math.round((Number(state.variablesMensual) || 0) / divisor)
      },
      budgetQuality: currentPeriod.budgetQuality || 'reconstructed'
    };
  }

  function activeTransactions(state, period) {
    const current = state.currentPeriod;
    if (!current || !period) return [];
    const records = [];
    for (const item of current.expenses || []) {
      records.push(toTransaction(item, 'expense', item.bucket, period));
    }
    for (const item of current.extraExpenses || []) {
      records.push(toTransaction(item, 'expense', 'extra', period));
    }
    for (const item of current.incomes || []) {
      records.push(toTransaction(item, 'income', null, period));
    }
    return records;
  }

  function transactionToLegacy(record) {
    const original = record.legacyRecord;
    if (original) {
      return {
        ...original,
        id: record.legacyId || original.id,
        amount: record.amountCop ?? original.amount,
        note: record.note ?? original.note,
        source: record.source ?? original.source ?? null,
        category: record.categoryLabel ?? original.category,
        bucket: record.bucket ?? original.bucket,
        occurredAt: record.occurredAt,
        occurredOnLocal: record.occurredOnLocal,
        timezoneOffsetMinutes: record.timezoneOffsetMinutes,
        dateQuality: record.dateQuality,
        periodId: record.periodId,
        budgetRef: record.budgetRef,
        origin: 'legacy-migration',
        legacyId: record.legacyId || original.id,
        legacyRecord: original
      };
    }
    return {
      id: record.legacyId || record.id,
      amount: record.amountCop,
      note: record.note,
      source: record.source || null,
      category: record.categoryLabel,
      bucket: record.bucket,
      occurredAt: record.occurredAt,
      occurredOnLocal: record.occurredOnLocal,
      timezoneOffsetMinutes: record.timezoneOffsetMinutes,
      dateQuality: record.dateQuality,
      periodId: record.periodId,
      budgetRef: record.budgetRef
    };
  }

  async function loadAllState(db) {
    const transaction = db.transaction(['appState', 'transactions', 'goals', 'loans'], 'readonly');
    const done = transactionDone(transaction);
    const appRequest = requestResult(transaction.objectStore('appState').get(APP_ID));
    const goalsRequest = requestResult(transaction.objectStore('goals').getAll());
    const loansRequest = requestResult(transaction.objectStore('loans').getAll());
    const recordsRequest = requestResult(transaction.objectStore('transactions').getAll());
    const [stored, goals, loans, records] = await Promise.all([appRequest, goalsRequest, loansRequest, recordsRequest]);
    await done;
    if (!stored) return null;

    const state = { ...stored };
    delete state.id;
    state.goals = goals;
    state.loans = loans;
    if (state.currentPeriod) {
      const currentRecords = records.filter(record => record.periodId === state.currentPeriod.key);
      state.currentPeriod.expenses = currentRecords
        .filter(record => record.type === 'expense' && record.bucket !== 'extra')
        .map(transactionToLegacy);
      state.currentPeriod.extraExpenses = currentRecords
        .filter(record => record.type === 'expense' && record.bucket === 'extra')
        .map(transactionToLegacy);
      state.currentPeriod.incomes = currentRecords
        .filter(record => record.type === 'income')
        .map(transactionToLegacy);
    }
    return state;
  }

  async function setMeta(db, values) {
    const transaction = db.transaction('meta', 'readwrite');
    transaction.objectStore('meta').put({ id: 'migration', ...values });
    await transactionDone(transaction);
  }

  async function getLegacyBackupRaw(db) {
    const transaction = db.transaction('backups', 'readonly');
    const done = transactionDone(transaction);
    const backup = await requestResult(transaction.objectStore('backups').get(LEGACY_KEY));
    await done;
    return typeof backup?.raw === 'string' ? backup.raw : null;
  }

  async function migrateLegacy(db, raw) {
    const converted = FinanceMigration.migrate(raw, undefined, LEGACY_KEY);
    const transaction = db.transaction(STORE_NAMES, 'readwrite');
    const done = transactionDone(transaction);
    for (const name of STORE_NAMES) transaction.objectStore(name).clear();

    transaction.objectStore('appState').put(serializeState(converted.state));
    transaction.objectStore('backups').put({
      id: LEGACY_KEY,
      key: LEGACY_KEY,
      raw,
      createdAt: converted.migratedAt,
      containsApiKey: false
    });
    transaction.objectStore('meta').put({
      id: 'migration',
      status: 'committed',
      migratedAt: converted.migratedAt,
      transactionCount: converted.transactions.length,
      goalCount: converted.goals.length,
      loanCount: converted.loans.length,
      archivedSummaryCount: converted.periods.length,
      noticeShown: false,
      warnings: converted.warnings
    });
    for (const period of converted.periods) transaction.objectStore('periods').put(period);
    if (converted.period) transaction.objectStore('periods').put(converted.period);
    for (const record of converted.transactions) transaction.objectStore('transactions').put(record);
    for (const goal of converted.goals) {
      transaction.objectStore('goals').put({ ...goal, id: String(goal.id) });
    }
    for (const loan of converted.loans) {
      transaction.objectStore('loans').put({ ...loan, id: String(loan.id) });
    }
    await done;

    const check = db.transaction(['backups', 'meta', 'transactions', 'goals', 'loans'], 'readonly');
    const checkDone = transactionDone(check);
    const backupRequest = requestResult(check.objectStore('backups').get(LEGACY_KEY));
    const metaRequest = requestResult(check.objectStore('meta').get('migration'));
    const transactionRequest = requestResult(check.objectStore('transactions').getAll());
    const goalRequest = requestResult(check.objectStore('goals').getAll());
    const loanRequest = requestResult(check.objectStore('loans').getAll());
    const [backup, meta, records, goals, loans] = await Promise.all([
      backupRequest, metaRequest, transactionRequest, goalRequest, loanRequest
    ]);
    await checkDone;

    if (!backup || backup.raw !== raw ||
        records.length !== converted.transactions.length ||
        goals.length !== converted.goals.length ||
        loans.length !== converted.loans.length) {
      throw new Error('La verificación de la migración no coincide. Los datos originales siguen disponibles en el almacenamiento anterior.');
    }
    await setMeta(db, { ...meta, status: 'verified', verifiedAt: new Date().toISOString() });

    if (localStorage.getItem(LEGACY_API_KEY) !== null) {
      localStorage.removeItem(LEGACY_API_KEY);
      await setMeta(db, {
        status: 'verified',
        verifiedAt: new Date().toISOString(),
        transactionCount: converted.transactions.length,
        goalCount: converted.goals.length,
        loanCount: converted.loans.length,
        archivedSummaryCount: converted.periods.length,
        noticeShown: false,
        warnings: converted.warnings,
        legacyGeminiKeyRemoved: true
      });
    }
  }

  async function loadState() {
    const db = await openDatabase();
    try {
      const metaTransaction = db.transaction(['meta', 'appState'], 'readonly');
      const metaDone = transactionDone(metaTransaction);
      const metaRequest = requestResult(metaTransaction.objectStore('meta').get('migration'));
      const appRequest = requestResult(metaTransaction.objectStore('appState').get(APP_ID));
      const [meta, app] = await Promise.all([metaRequest, appRequest]);
      await metaDone;
      const legacyRaw = localStorage.getItem(LEGACY_KEY);
      const backupRaw = meta?.status === 'committed' && legacyRaw === null
        ? await getLegacyBackupRaw(db)
        : null;
      const migrationRaw = legacyRaw ?? backupRaw;

      if ((!app || meta?.status === 'committed') && migrationRaw !== null) {
        await migrateLegacy(db, migrationRaw);
      } else if (meta?.status === 'committed') {
        throw new Error('La migración quedó incompleta y no hay respaldo legible para reintentarla.');
      } else if (!app) {
        return null;
      }

      if (localStorage.getItem(LEGACY_API_KEY) !== null) {
        localStorage.removeItem(LEGACY_API_KEY);
        await setMeta(db, { ...(meta || {}), status: 'verified', noticeShown: false, legacyGeminiKeyRemoved: true });
      }
      return await loadAllState(db);
    } finally {
      db.close();
    }
  }

  async function getTransactionsByPeriod(periodId) {
    if (typeof periodId !== 'string' || !periodId.trim()) {
      throw new Error('El identificador del período no es válido.');
    }

    const db = await openDatabase();
    try {
      const transaction = db.transaction('transactions', 'readonly');
      const done = transactionDone(transaction);
      const recordsRequest = requestResult(
        transaction.objectStore('transactions').index('periodId').getAll(IDBKeyRange.only(periodId))
      );
      const records = await recordsRequest;
      await done;
      return records;
    } finally {
      db.close();
    }
  }

  async function getArchivedPeriods() {
    const db = await openDatabase();
    try {
      const transaction = db.transaction('periods', 'readonly');
      const done = transactionDone(transaction);
      const request = requestResult(transaction.objectStore('periods').getAll());
      const periods = await request;
      await done;
      return periods.filter(period => period.status === 'closed');
    } finally {
      db.close();
    }
  }

  async function saveState(state) {
    if (!state || typeof state !== 'object') throw new Error('No hay datos válidos para guardar.');
    const db = await openDatabase();
    try {
      const transaction = db.transaction(['appState', 'periods', 'transactions', 'goals', 'loans'], 'readwrite');
      const done = transactionDone(transaction);
      const appStore = transaction.objectStore('appState');
      const periodsStore = transaction.objectStore('periods');
      const transactionsStore = transaction.objectStore('transactions');
      const goalsStore = transaction.objectStore('goals');
      const loansStore = transaction.objectStore('loans');
      const period = state.currentPeriod ? toPeriodRecord(state.currentPeriod, state) : null;

      appStore.put(serializeState(state));
      goalsStore.clear();
      for (const goal of state.goals || []) goalsStore.put({ ...goal, id: String(goal.id) });
      loansStore.clear();
      for (const loan of state.loans || []) loansStore.put({ ...loan, id: String(loan.id) });

      periodsStore.clear();
      for (const summary of state.history || []) periodsStore.put(periodFromHistory(summary));
      if (period) periodsStore.put(period);

      if (period) {
        const indexRequest = transactionsStore.index('periodId').getAll(IDBKeyRange.only(period.id));
        indexRequest.onsuccess = () => {
          for (const existing of indexRequest.result) transactionsStore.delete(existing.id);
          for (const record of activeTransactions(state, period)) transactionsStore.put(record);
        };
        indexRequest.onerror = () => transaction.abort();
      }

      await done;
    } catch (error) {
      throw new Error(`No se pudieron guardar los datos en este dispositivo: ${error.message}`, { cause: error });
    } finally {
      db.close();
    }
  }

  async function getMigrationNotice() {
    const db = await openDatabase();
    try {
      const transaction = db.transaction('meta', 'readwrite');
      const done = transactionDone(transaction);
      const store = transaction.objectStore('meta');
      const metaRequest = requestResult(store.get('migration'));
      const meta = await metaRequest;
      if (!meta || meta.noticeShown) {
        await done;
        return '';
      }
      const notices = [];
      if (meta.legacyGeminiKeyRemoved) notices.push('Por seguridad, se eliminó una clave Gemini que estaba guardada en el navegador; la app ya no la conserva.');
      if (meta.archivedSummaryCount) notices.push(`El historial conserva ${meta.archivedSummaryCount} períodos como totales: el detalle de esos gastos no existía en el formato anterior.`);
      if (meta.warnings?.length) notices.push(`La migración detectó ${meta.warnings.length} registro(s) que requieren revisión. El respaldo original sigue disponible.`);
      store.put({ ...meta, noticeShown: true, legacyGeminiKeyRemoved: false });
      await done;
      return notices.join(' ');
    } finally {
      db.close();
    }
  }

  async function exportBackup() {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(['appState', 'periods', 'transactions', 'goals', 'loans'], 'readonly');
      const done = transactionDone(transaction);
      const appState = requestResult(transaction.objectStore('appState').get(APP_ID));
      const periods = requestResult(transaction.objectStore('periods').getAll());
      const transactions = requestResult(transaction.objectStore('transactions').getAll());
      const goals = requestResult(transaction.objectStore('goals').getAll());
      const loans = requestResult(transaction.objectStore('loans').getAll());
      const [app, periodRecords, transactionRecords, goalRecords, loanRecords] = await Promise.all([
        appState, periods, transactions, goals, loans
      ]);
      await done;
      if (!app) throw new Error('No hay datos guardados para exportar.');
      return {
        format: 'asistente-financiero-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        appState: app,
        periods: periodRecords,
        transactions: transactionRecords,
        goals: goalRecords,
        loans: loanRecords
      };
    } finally {
      db.close();
    }
  }

  async function importBackup(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      throw new Error('El archivo de respaldo no contiene JSON válido.', { cause: error });
    }
    let legacyRaw = null;
    if (data?.format === 'asistente-financiero-legacy' && typeof data.raw === 'string') {
      legacyRaw = data.raw;
      const converted = FinanceMigration.migrate(legacyRaw, new Date(), LEGACY_KEY);
      data = {
        format: 'asistente-financiero-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        appState: serializeState(converted.state),
        periods: [...converted.periods, ...(converted.period ? [converted.period] : [])],
        transactions: converted.transactions,
        goals: converted.goals,
        loans: converted.loans
      };
    }
    if (!data || data.format !== 'asistente-financiero-backup' || data.version !== 1 ||
        typeof data.appState !== 'object' || Array.isArray(data.appState) ||
        !Array.isArray(data.periods) || !Array.isArray(data.transactions) ||
        !Array.isArray(data.goals) || !Array.isArray(data.loans)) {
      throw new Error('El archivo no es un respaldo compatible de Asistente-Financiero.');
    }
    if (data.appState.history !== undefined && !Array.isArray(data.appState.history)) {
      throw new Error('El respaldo contiene un historial con formato no válido.');
    }
    for (const [name, records] of [
      ['períodos', data.periods],
      ['movimientos', data.transactions],
      ['metas', data.goals],
      ['préstamos', data.loans]
    ]) {
      if (records.some(record => !record || typeof record.id !== 'string')) {
        throw new Error(`El respaldo contiene registros de ${name} sin identificador válido.`);
      }
    }

    const db = await openDatabase();
    try {
      let prior = null;
      try {
        prior = await exportBackup();
      } catch (error) {
        if (error.message !== 'No hay datos guardados para exportar.') throw error;
      }
      const transaction = db.transaction(['appState', 'periods', 'transactions', 'goals', 'loans', 'backups', 'meta'], 'readwrite');
      const done = transactionDone(transaction);
      if (prior) {
        transaction.objectStore('backups').put({
          id: `pre-import-${Date.now()}`,
          createdAt: new Date().toISOString(),
          data: prior
        });
      }
      if (legacyRaw !== null) {
        transaction.objectStore('backups').put({
          id: `imported-legacy-${Date.now()}`,
          key: LEGACY_KEY,
          raw: legacyRaw,
          createdAt: new Date().toISOString(),
          containsApiKey: false
        });
      }
      for (const [name, records] of [
        ['appState', [{ ...data.appState, id: APP_ID }]],
        ['periods', data.periods],
        ['transactions', data.transactions],
        ['goals', data.goals],
        ['loans', data.loans]
      ]) {
        const store = transaction.objectStore(name);
        store.clear();
        for (const record of records) store.put(record);
      }
      transaction.objectStore('meta').put({
        id: 'migration',
        status: 'verified',
        importedAt: new Date().toISOString(),
        legacyGeminiKeyRemoved: false
      });
      await done;
      const restored = await exportBackup();
      if (restored.transactions.length !== data.transactions.length ||
          restored.periods.length !== data.periods.length ||
          restored.goals.length !== data.goals.length ||
          restored.loans.length !== data.loans.length) {
        throw new Error('El respaldo se escribió, pero sus conteos no coinciden. La copia previa se conservó.');
      }
    } finally {
      db.close();
    }
  }

  function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadLegacyBackup() {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw === null) throw new Error('No hay datos legacy disponibles para exportar.');
    downloadJson({ format: 'asistente-financiero-legacy', version: 1, raw }, 'asistente-financiero-respaldo-legacy.json');
  }

  window.FinanceDB = {
    loadState,
    getTransactionsByPeriod,
    getArchivedPeriods,
    saveState,
    getMigrationNotice,
    downloadLegacyBackup,
    exportBackup,
    importBackup,
    downloadJson
  };
})();
