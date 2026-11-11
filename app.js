let state = null;
let currentTab = 'dashboard';
let sessionGeminiKey = '';
let processingNativeExpense = false;
const NOTICE_DURATION = 5000;
let activeNotice = null;
let noticeTimer = null;
let noticeTimerVersion = 0;
const archiveMovementCache = new Map();
let archivedPeriodsCache = null;
let archivedPeriodLoadPromise = null;

const CATS = {
  fijos: ['Plan celular','Mercado','Deudas','Gasolina/moto','Servicios','Arriendo','Salud','Educación','Otro fijo'],
  libre: ['Transporte','Comida fuera','Gastos hormiga','Entretenimiento','Suscripciones','Ropa','Otro libre']
};

function getGeminiKey() {
  return sessionGeminiKey;
}

async function loadState(){
  state = await FinanceDB.loadState();
  archiveMovementCache.clear();
  archivedPeriodsCache = null;
  archivedPeriodLoadPromise = null;
}

async function saveState(){
  await FinanceDB.saveState(state);
  clearPersistenceError();
}

function showPersistenceError(error) {
  const app = document.getElementById('app');
  if (!app) return;
  let notice = document.getElementById('persistenceError');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'persistenceError';
    notice.className = 'alert danger';
    notice.setAttribute('role', 'alert');
    const message = document.createElement('span');
    message.className = 'notice-message';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'notice-dismiss';
    closeButton.setAttribute('aria-label', 'Cerrar aviso de guardado');
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => notice.remove());
    notice.append(message, closeButton);
    app.prepend(notice);
  }
  notice.children[0].textContent = `No se pudieron guardar tus cambios: ${error.message}`;
}

function clearPersistenceError() {
  document.getElementById('persistenceError')?.remove();
}

function dismissNotice(notice) {
  if (!notice || notice !== activeNotice) return;
  if (noticeTimer !== null) clearTimeout(noticeTimer);
  noticeTimerVersion += 1;
  noticeTimer = null;
  activeNotice = null;
  notice.remove();
}

function scheduleNoticeDismissal(notice) {
  if (noticeTimer !== null) clearTimeout(noticeTimer);
  const timerVersion = ++noticeTimerVersion;
  noticeTimer = setTimeout(() => {
    if (timerVersion === noticeTimerVersion) dismissNotice(notice);
  }, NOTICE_DURATION);
}

function showNotice(message, className = 'alert warn') {
  const app = document.getElementById('app');
  if (!app || typeof message !== 'string' || !message.trim()) return;
  if (activeNotice && activeNotice.parentNode === app &&
      activeNotice.dataset.noticeMessage === message &&
      activeNotice.dataset.noticeClass === className) {
    scheduleNoticeDismissal(activeNotice);
    return;
  }
  if (activeNotice) dismissNotice(activeNotice);
  const notice = document.createElement('div');
  notice.className = `${className} transient-notice`;
  notice.dataset.noticeMessage = message;
  notice.dataset.noticeClass = className;
  notice.setAttribute('role', className.includes('danger') ? 'alert' : 'status');
  notice.setAttribute('aria-live', className.includes('danger') ? 'assertive' : 'polite');
  const messageElement = document.createElement('span');
  messageElement.className = 'notice-message';
  messageElement.textContent = message;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'notice-dismiss';
  closeButton.setAttribute('aria-label', 'Cerrar aviso');
  closeButton.textContent = '×';
  closeButton.addEventListener('click', () => dismissNotice(notice));
  notice.append(messageElement, closeButton);
  app.prepend(notice);
  activeNotice = notice;
  scheduleNoticeDismissal(notice);
}

function transactionDateFields(bucket, occurredAt = new Date()) {
  const now = occurredAt;
  const local = FinanceMigration.toLocalDate(now);
  const periodId = state.currentPeriod.key;
  const allocations = getAllocations();
  return {
    occurredAt: now.toISOString(),
    occurredOnLocal: local.date,
    timezoneOffsetMinutes: local.timezoneOffsetMinutes,
    dateQuality: 'exact',
    periodId,
    budgetRef: {
      periodId,
      bucket,
      allocatedCop: bucket === 'fijos'
        ? allocations.fijos
        : bucket === 'libre'
          ? allocations.libre
          : bucket === 'extra'
            ? extraPoolTotal(computePeriod(now, state.payDay, state.payFrequency), state.currentPeriod)
            : null
    }
  };
}

async function persistAndRender() {
  try {
    await saveState();
    render();
  } catch (error) {
    showPersistenceError(error);
  }
}

async function processPendingNativeExpense() {
  if (!state || processingNativeExpense) return;
  const serialized = sessionStorage.getItem('pendingNativeExpense');
  if (!serialized) return;

  let expense;
  try {
    expense = JSON.parse(serialized);
  } catch (error) {
    sessionStorage.removeItem('pendingNativeExpense');
    showNotice('No se pudo leer la compra detectada. No se guardó ningún gasto.', 'alert danger');
    return;
  }

  const occurredAt = new Date(expense.occurredAt);
  if (!/^[a-f0-9]{64}$/.test(expense.captureId || '') ||
      !Number.isSafeInteger(expense.amount) || expense.amount <= 0 ||
      !Number.isFinite(occurredAt.getTime()) ||
      typeof expense.description !== 'string' || !expense.description.trim() ||
      typeof expense.source !== 'string' || !expense.source.trim()) {
    sessionStorage.removeItem('pendingNativeExpense');
    showNotice('La compra detectada tenía datos incompletos y no se guardó.', 'alert danger');
    return;
  }

  processingNativeExpense = true;
  try {
    const cp = state.currentPeriod;
    normalizePeriod(cp);
    const id = `android:${expense.captureId}`;
    if (cp.expenses.some(item => item.id === id)) {
      await saveState();
      sessionStorage.removeItem('pendingNativeExpense');
      return;
    }

    const bucket = 'libre';
    const category = 'Gastos hormiga';
    cp.expenses.push({
      id,
      bucket,
      amount: expense.amount,
      note: expense.description.trim().slice(0, 200),
      category,
      source: expense.source.trim().slice(0, 60),
      ...transactionDateFields(bucket, occurredAt)
    });
    cp.spent[bucket] += expense.amount;
    await saveState();
    sessionStorage.removeItem('pendingNativeExpense');
    render();
    showNotice(`Compra de ${expense.source.trim()} guardada. Puedes cambiar su categoría desde el movimiento.`);
  } catch (error) {
    showPersistenceError(error);
  } finally {
    processingNativeExpense = false;
  }
}

window.receiveNativeExpense = function(serialized) {
  if (typeof serialized !== 'string' || serialized.length > 2000) return false;
  try {
    JSON.parse(serialized);
    sessionStorage.setItem('pendingNativeExpense', serialized);
    processPendingNativeExpense();
    return true;
  } catch (error) {
    showNotice(`No se pudo preparar la compra detectada: ${error.message}`, 'alert danger');
    return false;
  }
};

function fmt(n){ return Number(n||0).toLocaleString('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}); }
function daysInMonth(y,m){ return new Date(y, m+1, 0).getDate(); }
function newId(){ return window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
function transactionDateLabel(item){
  if(item.dateQuality === 'id-derived-utc' && item.occurredAt) return `Fecha derivada (UTC): ${new Date(item.occurredAt).toLocaleDateString('es-CO', { timeZone: 'UTC' })}`;
  if(item.occurredOnLocal) return `Fecha: ${item.occurredOnLocal}`;
  return 'Fecha por confirmar';
}

function validMovementAmount(item) {
  const amount = item.amountCop ?? item.amount;
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function movementTimestamp(item) {
  const exact = Date.parse(item.occurredAt || '');
  if (!Number.isNaN(exact)) return exact;
  const localDate = Date.parse(item.occurredOnLocal || '');
  return Number.isNaN(localDate) ? 0 : localDate;
}

function formatKnownAmount(amount) {
  return Number.isSafeInteger(amount) && amount >= 0 ? fmt(amount) : 'Dato no disponible';
}

function makeMovement(item, periodId, periodLabel, type = item.type, bucketOverride = null) {
  const bucket = bucketOverride || item.bucket || null;
  const rawCategory = item.categoryLabel || item.category || item.categoryId;
  const bucketCategory = bucket === 'fijos' ? 'Obligaciones'
    : bucket === 'libre' ? 'Gasto libre'
      : bucket === 'extra' ? 'Dinero libre'
        : '';
  const category = rawCategory ? String(rawCategory) : bucketCategory;
  const normalizedType = type === 'income' || type === 'expense' ? type : 'other';
  const typeLabel = normalizedType === 'income' ? 'Ingreso'
    : normalizedType === 'expense' && bucket === 'extra' ? 'Gasto extraordinario'
      : normalizedType === 'expense' && bucket === 'fijos' ? 'Gasto fijo'
        : normalizedType === 'expense' && bucket === 'libre' ? 'Gasto libre'
          : normalizedType === 'expense' ? 'Gasto'
            : String(type || 'Movimiento');

  return {
    id: item.id === undefined || item.id === null ? null : String(item.id),
    periodId: String(item.periodId || periodId || ''),
    periodLabel,
    type: normalizedType,
    typeLabel,
    bucket,
    category: category || 'Categoría no disponible',
    description: typeof item.note === 'string' && item.note.trim()
      ? item.note.trim()
      : 'Sin descripción',
    source: typeof item.source === 'string' && item.source.trim() ? item.source.trim() : '',
    amount: validMovementAmount(item),
    dateLabel: transactionDateLabel(item),
    timestamp: movementTimestamp(item)
  };
}

function uniqueChronologicalMovements(movements) {
  const seen = new Set();
  return movements.filter(item => {
    if (item.id === null) return true;
    const key = `${item.periodId}:${item.type}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.timestamp - a.timestamp);
}

function getCurrentPeriodMovements(period) {
  const cp = state.currentPeriod;
  const movements = [
    ...(cp.expenses || []).map(item => makeMovement(item, cp.key, period.label, 'expense')),
    ...(cp.extraExpenses || []).map(item => makeMovement(item, cp.key, period.label, 'expense', 'extra')),
    ...(cp.incomes || []).map(item => makeMovement(item, cp.key, period.label, 'income'))
  ];
  return uniqueChronologicalMovements(movements);
}

function getHistoricalMovements(records, period) {
  const movements = records
    .filter(record => String(record.periodId || '') === String(period.id))
    .map(record => makeMovement(record, period.id, period.label));
  return uniqueChronologicalMovements(movements);
}

function renderMovementItem(movement, allowDelete = false) {
  const sign = movement.type === 'income' ? '+' : movement.type === 'expense' ? '−' : '';
  let deleteButton = '';
  if (allowDelete && movement.id !== null) {
    if (movement.type === 'income') {
      deleteButton = `<button type="button" class="del" data-inc-id="${escapeHtml(movement.id)}" aria-label="Eliminar ingreso">✕</button>`;
    } else if (movement.type === 'expense' && movement.bucket === 'extra') {
      deleteButton = `<button type="button" class="del" data-extra-id="${escapeHtml(movement.id)}" aria-label="Eliminar desembolso extraordinario">✕</button>`;
    } else if (movement.type === 'expense') {
      deleteButton = `<button type="button" class="del" data-id="${escapeHtml(movement.id)}" aria-label="Eliminar gasto">✕</button>`;
    }
  }
  const amount = movement.amount === null ? 'Monto por revisar' : `${sign}${fmt(movement.amount)}`;
  const source = movement.source ? ` · ${escapeHtml(movement.source)}` : '';

  return `
    <article class="wallet-activity-item">
      <span class="wallet-activity-icon ${movement.type}" aria-hidden="true">${movement.type === 'income' ? '+' : movement.type === 'expense' ? '−' : '·'}</span>
      <span class="wallet-activity-copy">
        <strong>${escapeHtml(movement.description)}</strong>
        <small>${escapeHtml(movement.typeLabel)} · ${escapeHtml(movement.category)} · ${escapeHtml(movement.periodLabel)} · ${escapeHtml(movement.dateLabel)}${source}</small>
      </span>
      <span class="wallet-activity-value"><b class="wallet-activity-amount ${movement.type}">${amount}</b>${deleteButton}</span>
    </article>
  `;
}

function renderMovementList(movements, emptyMessage, allowDelete = false) {
  return movements.length
    ? movements.map(item => renderMovementItem(item, allowDelete)).join('')
    : `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
}

function calculateWalletSummary(period) {
  const cp = state.currentPeriod;
  const frequency = state.payFrequency || 'quincenal';
  const salaryValue = Number(state.salary);
  const configuredIncomeValid = frequency === 'independiente' ||
    (Number.isSafeInteger(salaryValue) && salaryValue >= 0);
  const configuredIncome = frequency === 'independiente' ? 0 : configuredIncomeValid ? salaryValue : 0;
  const incomeAmounts = (cp.incomes || []).map(validMovementAmount);
  const incomeItemsValid = incomeAmounts.every(amount => amount !== null);
  const registeredIncome = (cp.incomes || []).reduce((sum, item) => {
    const amount = validMovementAmount(item);
    return amount === null ? sum : sum + amount;
  }, 0);
  const registeredIncomeValid = incomeItemsValid && Number.isSafeInteger(registeredIncome);
  const storedSpend = cp.spent || {};
  const spendingAggregatesValid = ['fijos', 'libre', 'extra'].every(bucket =>
    Number.isSafeInteger(storedSpend[bucket]) && storedSpend[bucket] >= 0);
  const fixedSpent = Number.isSafeInteger(storedSpend.fijos) ? storedSpend.fijos : 0;
  const flexibleSpent = Number.isSafeInteger(storedSpend.libre) ? storedSpend.libre : 0;
  const extraordinarySpent = Number.isSafeInteger(storedSpend.extra) ? storedSpend.extra : 0;
  const estimatedIncome = configuredIncome + registeredIncome;
  const periodExpenses = fixedSpent + flexibleSpent + extraordinarySpent;
  const movementTotals = { fijos: 0, libre: 0, extra: 0 };
  let movementDetailsValid = true;
  for (const movement of getCurrentPeriodMovements(period)) {
    if (movement.type !== 'expense') continue;
    if (!Object.prototype.hasOwnProperty.call(movementTotals, movement.bucket) || movement.amount === null) {
      movementDetailsValid = false;
      continue;
    }
    const bucketTotal = movementTotals[movement.bucket] + movement.amount;
    if (!Number.isSafeInteger(bucketTotal)) {
      movementDetailsValid = false;
      continue;
    }
    movementTotals[movement.bucket] = bucketTotal;
  }
  const aggregatesMatchMovements = movementDetailsValid &&
    movementTotals.fijos === fixedSpent &&
    movementTotals.libre === flexibleSpent &&
    movementTotals.extra === extraordinarySpent;
  const estimatedBalance = estimatedIncome - periodExpenses;
  const dataConsistent = configuredIncomeValid && registeredIncomeValid && spendingAggregatesValid &&
    Number.isSafeInteger(estimatedIncome) && Number.isSafeInteger(periodExpenses) &&
    Number.isSafeInteger(estimatedBalance) && aggregatesMatchMovements;
  const freeMoney = extraPoolTotal(period, cp) - extraordinarySpent;
  const freeMoneyValid = dataConsistent && Number.isSafeInteger(freeMoney);

  return {
    frequency,
    configuredIncome,
    configuredIncomeValid,
    registeredIncome,
    registeredIncomeValid,
    estimatedIncome,
    fixedSpent,
    flexibleSpent,
    extraordinarySpent,
    periodExpenses,
    dataConsistent,
    estimatedBalance: dataConsistent ? estimatedBalance : null,
    freeMoneyValid,
    freeMoney: freeMoneyValid ? freeMoney : null
  };
}

function archivedCycleSummaries() {
  const currentKey = String(state.currentPeriod?.key || '');
  const entries = new Map();
  const order = [];

  for (const summary of state.history || []) {
    const id = String(summary.key || '');
    if (!id || id === currentKey || entries.has(id)) continue;
    entries.set(id, { id, status: 'closed', label: summary.label || id, summary });
    order.push(id);
  }

  const storedPeriods = (archivedPeriodsCache || [])
    .filter(period => period.status === 'closed' && String(period.id || '') !== currentKey)
    .slice()
    .sort((a, b) => String(b.id).localeCompare(String(a.id)));
  for (const period of storedPeriods) {
    const id = String(period.id || '');
    if (!id) continue;
    const existing = entries.get(id);
    if (existing) {
      entries.set(id, {
        ...existing,
        ...period,
        id,
        label: period.label || existing.label,
        summary: period.summary || existing.summary
      });
    } else {
      entries.set(id, { ...period, id, label: period.label || id, summary: period.summary || period });
      order.push(id);
    }
  }

  return order.map(id => entries.get(id));
}

function renderArchivedCycles(cycles) {
  if (!cycles.length) return '<div class="empty">Aún no hay ciclos anteriores.</div>';
  return cycles.map(cycle => {
    const summary = cycle.summary || cycle;
    const cycleExpenses = [summary.fijosSpent, summary.libreSpent, summary.extraSpent];
    const totalCycleExpenses = cycleExpenses.every(amount => Number.isSafeInteger(amount) && amount >= 0)
      ? cycleExpenses.reduce((sum, amount) => sum + amount, 0)
      : null;
    return `
      <article class="wallet-history-cycle" data-history-cycle>
        <details>
          <summary>
            <span><strong>${escapeHtml(cycle.label || 'Período archivado')}</strong><small>${escapeHtml(cycle.id)}</small></span>
            <span class="wallet-history-totals"><span>Ingreso estimado <b>${formatKnownAmount(summary.ingresoExtra)}</b></span><span>Gastos <b>${formatKnownAmount(totalCycleExpenses)}</b></span></span>
          </summary>
          <div class="wallet-history-period-content">
            <button type="button" class="wallet-text-action" data-history-period="${escapeHtml(cycle.id)}">Consultar movimientos</button>
            <div class="wallet-history-movements" data-history-movements hidden aria-live="polite"></div>
          </div>
        </details>
      </article>
    `;
  }).join('');
}

async function loadArchivedPeriods(container) {
  if (!container) return;
  if (archivedPeriodsCache) {
    container.innerHTML = renderArchivedCycles(archivedCycleSummaries());
    return;
  }
  if (archivedPeriodLoadPromise) {
    await archivedPeriodLoadPromise;
    container.innerHTML = renderArchivedCycles(archivedCycleSummaries());
    return;
  }

  container.innerHTML = '<div class="empty">Cargando ciclos anteriores…</div>';
  archivedPeriodLoadPromise = (async () => {
    try {
      archivedPeriodsCache = await FinanceDB.getArchivedPeriods();
      container.innerHTML = renderArchivedCycles(archivedCycleSummaries());
    } catch (error) {
      container.innerHTML = `<div class="err" role="alert">No se pudieron cargar los ciclos anteriores: ${escapeHtml(error.message)}</div>`;
    } finally {
      archivedPeriodLoadPromise = null;
    }
  })();
  await archivedPeriodLoadPromise;
}

function computePeriod(today, cutoff, frequency){
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
  const lastDay = daysInMonth(y,m);
  const monthNames = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

  if(frequency === 'mensual' || frequency === 'independiente'){
    const startDay = 1, endDay = lastDay;
    const key = `${y}-${String(m+1).padStart(2,'0')}-${frequency === 'independiente' ? 'IND' : 'M'}`;
    const label = frequency === 'independiente' ? `Independiente - ${monthNames[m]} ${y}` : `${monthNames[m]} completo`;
    const payDay = Math.min(cutoff||lastDay, lastDay);
    const remaining = (payDay >= d) ? (payDay - d) : (lastDay - d);
    return {key,label,startDay,endDay,totalDays:endDay-startDay+1,elapsed:d-startDay+1,remaining,month:m,year:y};
  }

  let startDay, endDay, half;
  if(d <= cutoff){ startDay = 1; endDay = cutoff; half='A'; }
  else { startDay = cutoff+1; endDay = lastDay; half='B'; }
  const key = `${y}-${String(m+1).padStart(2,'0')}-${half}`;
  const label = `${startDay}–${endDay} de ${monthNames[m]}`;
  return {key,label,startDay,endDay,totalDays:endDay-startDay+1,elapsed:d-startDay+1,remaining:endDay-d,month:m,year:y};
}

function extraPoolTotal(period, cp){
  const alloc = getAllocations();
  const ingresoExtra = (cp.incomes||[]).reduce((s,i)=>s+i.amount,0);
  const baseSalary = state.payFrequency === 'independiente' ? 0 : state.salary;
  const ingresoTotal = baseSalary + ingresoExtra;
  
  const prestamosPendientes = (state.loans || [])
    .filter(l => l.status === 'Pendiente')
    .reduce((s, l) => s + (l.pending || 0), 0);

  return ingresoTotal - alloc.fijos - alloc.libre - prestamosPendientes;
}

function normalizePeriod(cp){
  if(!cp.spent) cp.spent = {fijos:0,libre:0,extra:0};
  for (const bucket of ['fijos', 'libre', 'extra']) {
    if (!Number.isFinite(cp.spent[bucket])) cp.spent[bucket] = 0;
  }
  if(!cp.extraExpenses) cp.extraExpenses = [];
  if(!cp.incomes) cp.incomes = [];
  if(!cp.expenses) cp.expenses = [];
}

function getAllocations(){
  if(state.payFrequency === 'mensual' || state.payFrequency === 'independiente'){
    return { fijos: Math.round(Number(state.fijosMensual)||0), libre: Math.round(Number(state.variablesMensual)||0) };
  }
  return {
    fijos: Math.round((Number(state.fijosMensual)||0)/2),
    libre: Math.round((Number(state.variablesMensual)||0)/2)
  };
}

function archiveIfNeeded(period){
  let changed = false;
  if(state.currentPeriod && state.currentPeriod.key !== period.key){
    const cp = state.currentPeriod;
    normalizePeriod(cp);
    const snapshot = cp.budgetSnapshot || {
      salaryCop: Number(state.salary) || 0,
      fixedCop: getAllocations().fijos,
      flexibleCop: getAllocations().libre,
      extraCop: extraPoolTotal(period, cp)
    };
    const ingresoExtra = (cp.incomes||[]).reduce((s,i)=>s+i.amount,0);
    const baseSalary = (snapshot.frequency || state.payFrequency) === 'independiente' ? 0 : snapshot.salaryCop;
    state.history.unshift({
      key: cp.key, label: cp.label,
      fijosAlloc: snapshot.fixedCop, fijosSpent: cp.spent.fijos,
      libreAlloc: snapshot.flexibleCop, libreSpent: cp.spent.libre,
      extraAlloc: snapshot.extraCop, extraSpent: cp.spent.extra,
      ingresoExtra: baseSalary + ingresoExtra
    });
    state.currentPeriod = null;
    changed = true;
  }
  if(!state.currentPeriod){
    const currentPeriod = {
      key:period.key,
      label:period.label,
      startDate: FinanceMigration.toLocalDate(new Date(period.year, period.month, period.startDay)).date,
      endDate: FinanceMigration.toLocalDate(new Date(period.year, period.month, period.endDay)).date,
      dateQuality:'exact',
      spent:{fijos:0,libre:0,extra:0},
      expenses:[],
      incomes:[],
      extraExpenses:[]
    };
    const allocations = getAllocations();
    currentPeriod.budgetSnapshot = {
      salaryCop: Number(state.salary) || 0,
      fixedCop: allocations.fijos,
      flexibleCop: allocations.libre,
      extraCop: extraPoolTotal(period, currentPeriod),
      frequency: state.payFrequency || 'quincenal'
    };
    currentPeriod.budgetQuality = 'snapshot';
    state.currentPeriod = currentPeriod;
    changed = true;
  } else {
    if (state.currentPeriod.label !== period.label) {
      state.currentPeriod.label = period.label;
      changed = true;
    }
    normalizePeriod(state.currentPeriod);
  }
  if (changed) {
    archivedPeriodsCache = null;
    archivedPeriodLoadPromise = null;
  }
  return changed;
}

function updateMobileNav() {
  const items = document.querySelectorAll('.mobile-nav-item');
  items.forEach(item => {
    const active = item.dataset.mobileTab === currentTab;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
}

window.switchMobileTab = function(tabName) {
  currentTab = tabName;
  render();
};

window.abrirModalGastoRapido = function() {
  currentTab = 'dashboard';
  render();
  setTimeout(() => {
    const entry = document.getElementById('expenseEntry');
    if (entry) entry.open = true;
    const expForm = document.getElementById('expForm');
    if (expForm) {
      expForm.scrollIntoView({ behavior: 'smooth' });
      const amountInput = document.getElementById('expAmount');
      if (amountInput) amountInput.focus();
    }
  }, 100);
};

window.abrirModalIngresoRapido = function() {
  currentTab = 'dashboard';
  render();
  setTimeout(() => {
    const entry = document.getElementById('incomeEntry');
    if (entry) entry.open = true;
    const incForm = document.getElementById('incForm');
    if (incForm) {
      incForm.scrollIntoView({ behavior: 'smooth' });
      const amountInput = document.getElementById('incAmount');
      if (amountInput) amountInput.focus();
    }
  }, 100);
};

function render(){
  const app = document.getElementById('app');
  const loading = document.getElementById('loading');
  const mobileNav = document.getElementById('mobileNav');
  
  if(loading) loading.style.display = 'none';
  if(app) app.style.display = 'block';
  if(mobileNav) mobileNav.hidden = !state;

  if(!state){ if(app) app.innerHTML = renderSetup(null); bindSetup(); return; }
  if(!state.loans) state.loans = [];
  if(!state.goals) state.goals = [];

  const today = new Date();
  const freq = state.payFrequency || 'quincenal';
  const period = computePeriod(today, state.payDay, freq);
  if (archiveIfNeeded(period)) saveState().catch(showPersistenceError);

  const userName = state.userName || '';
  
  const titleEl = document.getElementById('mainTitle');
  if(titleEl) {
    titleEl.textContent = freq==='mensual' ? 'Mes en curso' : freq==='independiente' ? 'Ciclo Independiente' : 'Quincena en curso';
  }
  
  let userHeaderEl = document.getElementById('userGreeting');
  if(!userHeaderEl && titleEl) {
    userHeaderEl = document.createElement('div');
    userHeaderEl.id = 'userGreeting';
    userHeaderEl.className = 'user-greeting';
    titleEl.parentNode.insertBefore(userHeaderEl, titleEl);
  }
  if(userHeaderEl) {
    userHeaderEl.textContent = userName ? `¡Hola, ${userName}! 👋` : '';
  }

  app.innerHTML = `
    <div class="tabs">
      <button type="button" class="tab ${currentTab==='dashboard'?'active':''}" data-tab="dashboard">${freq==='mensual'?'Mes':freq==='independiente'?'Independiente':'Quincena'}</button>
      <button type="button" class="tab ${currentTab==='extra'?'active':''}" data-tab="extra">Dinero libre</button>
      <button type="button" class="tab ${currentTab==='loans'?'active':''}" data-tab="loans">🤝 Préstamos</button>
      <button type="button" class="tab ${currentTab==='assistant'?'active':''}" data-tab="assistant">🤖 Asistente</button>
      <button type="button" class="tab ${currentTab==='goals'?'active':''}" data-tab="goals">🎯 Metas</button>
      <button type="button" class="tab ${currentTab==='settings'?'active':''}" data-tab="settings">⚙️ Ajustes</button>
    </div>
    <div id="tabContent"></div>
  `;

  document.querySelectorAll('.tab').forEach(t=>{
    t.addEventListener('click', (e) => {
      e.preventDefault();
      currentTab = t.getAttribute('data-tab');
      render();
    });
  });

  const tc = document.getElementById('tabContent');
  if(currentTab==='dashboard'){ tc.innerHTML = renderDashboard(period); bindDashboard(); }
  else if(currentTab==='extra'){ tc.innerHTML = renderExtra(period); bindExtra(period); }
  else if(currentTab==='loans'){ tc.innerHTML = renderLoans(); bindLoans(); }
  else if(currentTab==='assistant'){ tc.innerHTML = renderAssistant(period); bindAssistant(period); }
  else if(currentTab==='goals'){ tc.innerHTML = renderGoals(); bindGoals(); }
  else if(currentTab==='settings'){ tc.innerHTML = renderSetup({userName:state.userName, salary:state.salary, payDay:state.payDay, fijosMensual:state.fijosMensual, variablesMensual:state.variablesMensual, payFrequency:state.payFrequency||'quincenal'}); bindSetup(); }
  updateMobileNav();
}

function renderSetup(prefill){
  const s = prefill || {userName:'', salary:950000, payDay:30, fijosMensual:710000, variablesMensual:300000, payFrequency:'quincenal'};
  const freq = s.payFrequency || 'quincenal';

  const salaryLabelText = freq === 'mensual' ? 'Sueldo neto mensual' : 'Sueldo neto por quincena';
  const cutoffLabelText = freq === 'mensual' || freq === 'independiente' ? 'Día límite o cierre de mes' : 'Día de corte de la primera quincena';

  return `
    <div class="panel" id="setupPanel">
      <h2>${state ? 'Ajustar tu sistema' : 'Arma tu sistema financiero'}</h2>
      <form id="setupForm">
        <div class="field">
          <label for="inUserName">¿Cómo te llamas?</label>
          <input type="text" id="inUserName" value="${escapeHtml(s.userName||'')}" placeholder="Ej: Darikson">
        </div>
        <div class="field">
          <div class="freq-toggle" id="freqToggle" role="group" aria-labelledby="frequencyLabel">
            <span class="sr-only" id="frequencyLabel">¿Cómo manejas tus ingresos?</span>
            <button type="button" class="freqBtn ${freq==='quincenal'?'active':''}" data-freq="quincenal">Quincenal</button>
            <button type="button" class="freqBtn ${freq==='mensual'?'active':''}" data-freq="mensual">Mensual</button>
            <button type="button" class="freqBtn ${freq==='independiente'?'active':''}" data-freq="independiente">Independiente</button>
          </div>
        </div>
        <div class="field" style="${freq === 'independiente' ? 'display:none;' : ''}">
          <label id="salaryLabel" for="inSalary">${salaryLabelText}</label>
          <input type="number" id="inSalary" min="1" step="1" value="${s.salary}">
        </div>
        <div class="field"><label id="cutoffLabel" for="inCutoff">${cutoffLabelText}</label><input type="number" id="inCutoff" min="1" max="31" step="1" value="${s.payDay}"></div>
        <div class="row2">
          <div class="field"><label for="inFijos">Gastos fijos al mes</label><input type="number" id="inFijos" min="0" step="1" value="${s.fijosMensual}"></div>
          <div class="field"><label for="inVar">Gastos variables al mes</label><input type="number" id="inVar" min="0" step="1" value="${s.variablesMensual}"></div>
        </div>
        <div class="field">
          <label for="inApiKey">Clave Gemini opcional (solo esta sesión)</label>
          <input type="password" id="inApiKey" autocomplete="off" placeholder="No se guardará en este dispositivo">
          <small>Una clave ingresada en una PWA no es secreta. Solo se conserva en memoria hasta cerrar o recargar esta pestaña.</small>
        </div>
        <button type="submit" class="btn">Guardar</button>
        <div class="err" id="setupErr" role="alert" aria-live="polite"></div>
      </form>
      <section class="backup-tools" aria-labelledby="backupTitle">
        <h3 id="backupTitle">Respaldo local</h3>
        <p>El archivo incluye información financiera sensible. Guárdalo en un lugar privado.</p>
        <button type="button" class="btn btn-blue" id="exportBackup" ${state ? '' : 'disabled'}>Descargar respaldo</button>
        <label for="importBackupFile">Restaurar desde un respaldo JSON</label>
        <input type="file" id="importBackupFile" accept="application/json,.json">
        <div class="err" id="backupErr" role="alert" aria-live="polite"></div>
      </section>
    </div>
  `;
}

function bindSetup(){
  let selectedFreq = document.querySelector('.freqBtn.active')?.getAttribute('data-freq') || 'quincenal';
  document.querySelectorAll('.freqBtn').forEach(btn=>{
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      selectedFreq = btn.getAttribute('data-freq');
      document.querySelectorAll('.freqBtn').forEach(b=>b.classList.toggle('active', b===btn));

      const salaryFieldContainer = document.getElementById('inSalary')?.closest('.field');
      if (salaryFieldContainer) {
        if (selectedFreq === 'independiente') {
          salaryFieldContainer.style.display = 'none';
        } else {
          salaryFieldContainer.style.display = 'block';
          const salaryLabel = document.getElementById('salaryLabel');
          if (salaryLabel) {
            salaryLabel.textContent = selectedFreq === 'mensual' ? 'Sueldo neto mensual' : 'Sueldo neto por quincena';
          }
        }
      }
      const cutoffLabel = document.getElementById('cutoffLabel');
      if (cutoffLabel) {
        cutoffLabel.textContent = (selectedFreq === 'mensual' || selectedFreq === 'independiente') ? 'Día límite o cierre de mes' : 'Día de corte de la primera quincena';
      }
    });
  });

  const setupForm = document.getElementById('setupForm');
  if(setupForm) {
    setupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userName = document.getElementById('inUserName').value.trim();
      const salaryInput = document.getElementById('inSalary');
      const salary = salaryInput ? Number(salaryInput.value) : 0;
      const cutoff = Number(document.getElementById('inCutoff').value);
      const fijosMensual = Number(document.getElementById('inFijos').value);
      const variablesMensual = Number(document.getElementById('inVar').value);
      const apiKey = document.getElementById('inApiKey').value.trim();
      const errEl = document.getElementById('setupErr');

      if(selectedFreq !== 'independiente' && (!Number.isSafeInteger(salary) || salary<=0)){ if(errEl) errEl.textContent = 'Ingresa un sueldo entero válido en pesos.'; return; }
      if (!Number.isInteger(cutoff) || cutoff < 1 || cutoff > 31 ||
          !Number.isSafeInteger(fijosMensual) || fijosMensual < 0 ||
          !Number.isSafeInteger(variablesMensual) || variablesMensual < 0) {
        if (errEl) errEl.textContent = 'Revisa el día de corte y los presupuestos mensuales.';
        return;
      }

      sessionGeminiKey = apiKey;

      const wasSetUp = !!state;
      state = state || {history:[], currentPeriod:null, goals:[], loans:[]};
      state.userName = userName;
      state.payFrequency = selectedFreq;
      state.salary = selectedFreq === 'independiente' ? 0 : salary; 
      state.payDay = cutoff;
      state.fijosMensual = fijosMensual; 
      state.variablesMensual = variablesMensual;

      if(!wasSetUp){
        state.history = []; 
        state.currentPeriod = null;
        state.goals = [{id:'seed-1', name:'Fondo de emergencia', target:800000, saved:0}];
      }

      archiveIfNeeded(computePeriod(new Date(), state.payDay, state.payFrequency));
      currentTab = 'dashboard';
      await persistAndRender();
      await processPendingNativeExpense();
    });
  }

  document.getElementById('exportBackup')?.addEventListener('click', async () => {
    try {
      const backup = await FinanceDB.exportBackup();
      FinanceDB.downloadJson(backup, 'asistente-financiero-respaldo.json');
    } catch (error) {
      const err = document.getElementById('backupErr');
      if (err) err.textContent = error.message;
    }
  });

  document.getElementById('importBackupFile')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!window.confirm('Restaurar reemplazará los datos actuales. Si hay datos, se descargará una copia y se conservará una copia local antes de continuar. ¿Continuar?')) {
      event.target.value = '';
      return;
    }
    try {
      if (state) {
        await saveState();
        const currentBackup = await FinanceDB.exportBackup();
        FinanceDB.downloadJson(currentBackup, 'asistente-financiero-respaldo-anterior.json');
      }
      await FinanceDB.importBackup(await file.text());
      await loadState();
      render();
      showNotice('Respaldo restaurado correctamente.');
    } catch (error) {
      const err = document.getElementById('backupErr');
      if (err) err.textContent = error.message;
    }
  });
}

function renderDashboard(period){
  const alloc = getAllocations();
  const cp = state.currentPeriod;
  const summary = calculateWalletSummary(period);
  const cycleProgress = Math.min(100, Math.max(0, Math.round((period.elapsed / Math.max(1, period.totalDays)) * 100)));
  const fijosPct = Math.round((cp.spent.fijos/Math.max(1,alloc.fijos))*100);
  const librePct = Math.round((cp.spent.libre/Math.max(1,alloc.libre))*100);
  const catOptionsLibre = CATS.libre.map(c=>`<option value="${c}">${c}</option>`).join('');
  const currentMovements = getCurrentPeriodMovements(period);
  const recentMovesHtml = renderMovementList(currentMovements.slice(0, 5), 'Aún no hay movimientos registrados en este ciclo.');
  const currentHistoryHtml = renderMovementList(currentMovements, 'Aún no hay movimientos registrados en este ciclo.', true);
  const archivedCycles = archivedCycleSummaries();
  const archivedCyclesHtml = renderArchivedCycles(archivedCycles);
  const balanceValue = summary.dataConsistent ? fmt(summary.estimatedBalance) : 'Revisar registros';
  const freeMoneyValue = !summary.dataConsistent
    ? 'Revisar registros'
    : summary.freeMoneyValid ? fmt(summary.freeMoney) : 'Revisar compromisos';
  const registeredIncomeValue = summary.registeredIncomeValid ? fmt(summary.registeredIncome) : 'Revisar ingresos';
  const configuredIncomeValue = summary.frequency === 'independiente'
    ? 'No aplica'
    : summary.configuredIncomeValid ? fmt(summary.configuredIncome) : 'Revisar configuración';

  return `
    <section class="wallet-balance-card" aria-label="Balance estimado del ciclo">
      <div class="wallet-card-heading">
        <span>Balance estimado del ciclo</span>
        <span class="wallet-cycle-label">${escapeHtml(period.label)}</span>
      </div>
      <strong class="wallet-balance-amount ${summary.estimatedBalance < 0 ? 'negative' : ''}">${balanceValue}</strong>
      <p class="wallet-cycle-note">Estimación del ciclo, no saldo bancario · ${summary.frequency === 'independiente' ? 'este mes' : `${period.remaining} días para cerrar`}</p>
      <div class="wallet-cycle-progress" role="meter" aria-label="Progreso del ciclo" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${cycleProgress}">
        <span style="width:${cycleProgress}%"></span>
      </div>
      <div class="wallet-cycle-progress-label"><span>Día ${period.elapsed} de ${period.totalDays}</span><span>Base configurada, no confirmada</span></div>
      <div class="wallet-balance-breakdown">
        <div><span>Base configurada, no confirmada</span><b>${configuredIncomeValue}</b></div>
        <div><span>Ingresos registrados</span><b>${registeredIncomeValue}</b></div>
        <div><span>Gastos del período</span><b>${summary.dataConsistent ? fmt(summary.periodExpenses) : 'Revisar movimientos'}</b></div>
      </div>
      ${summary.dataConsistent ? '' : '<p class="wallet-balance-warning" role="status">Los movimientos y los totales guardados no coinciden. El balance no se estima hasta revisar los registros.</p>'}
    </section>

    <section class="wallet-free-card" aria-label="Dinero libre después de compromisos pendientes">
      <div><span>Dinero libre</span><small>Después de presupuestos y préstamos pendientes</small></div>
      <strong>${freeMoneyValue}</strong>
    </section>

    <div class="wallet-quick-actions" aria-label="Accesos rápidos">
      <button type="button" class="wallet-quick-action expense" id="quickAddExpense">
        <span aria-hidden="true">−</span><span>Registrar gasto</span>
      </button>
      <button type="button" class="wallet-quick-action income" id="quickAddIncome">
        <span aria-hidden="true">+</span><span>Registrar ingreso</span>
      </button>
    </div>

    <section class="wallet-section" aria-labelledby="recentMovesTitle">
      <div class="wallet-section-heading">
        <h2 id="recentMovesTitle">Movimientos recientes</h2>
        <button type="button" class="wallet-text-action" id="showHistory">Ver historial</button>
      </div>
      <div class="wallet-activity-list">${recentMovesHtml}</div>
    </section>

    <details class="wallet-disclosure">
      <summary>Presupuesto del ciclo</summary>
      <div class="buckets">
        <div class="bucket fijos ${fijosPct>=100?'over':''}">
          <div class="bucket-label">Obligaciones (fijos)</div>
          <div class="bucket-amt">${fmt(alloc.fijos)}</div>
          <div class="bar"><div class="bar-fill" style="width:${Math.min(100,fijosPct)}%"></div></div>
          <div class="bucket-detail"><b>${fmt(cp.spent.fijos)}</b> gastado · ${fmt(Math.max(0,alloc.fijos-cp.spent.fijos))} disponible</div>
        </div>
        <div class="bucket libre ${librePct>=100?'over':''}">
          <div class="bucket-label">Gasto libre</div>
          <div class="bucket-amt">${fmt(alloc.libre)}</div>
          <div class="bar"><div class="bar-fill" style="width:${Math.min(100,librePct)}%"></div></div>
          <div class="bucket-detail"><b>${fmt(cp.spent.libre)}</b> gastado · ${fmt(Math.max(0,alloc.libre-cp.spent.libre))} disponible</div>
        </div>
      </div>
    </details>

    <details class="wallet-disclosure" id="incomeEntry">
      <summary>Registrar ingreso</summary>
      <div class="wallet-disclosure-content">
        <h2>${summary.frequency === 'independiente' ? 'Ingreso diario' : 'Ingreso extra'}</h2>
        <form id="incForm" class="expense-form">
          <label class="sr-only" for="incAmount">Monto del ingreso</label>
          <input type="number" id="incAmount" min="1" step="1" placeholder="Monto" required>
          <label class="sr-only" for="incNote">Concepto del ingreso</label>
          <input type="text" id="incNote" placeholder="Concepto (ej. Bono, venta...)">
          <button type="submit">Agregar ingreso</button>
        </form>
        <div class="err" id="incErr"></div>
      </div>
    </details>

    <details class="wallet-disclosure" id="expenseEntry">
      <summary>Registrar gasto</summary>
      <div class="wallet-disclosure-content">
        <h2>Nuevo gasto</h2>
        <form id="expForm" class="expense-form">
          <label class="sr-only" for="expBucket">Presupuesto</label>
          <select id="expBucket">
            <option value="fijos">Obligaciones</option>
            <option value="libre" selected>Gasto libre</option>
          </select>
          <label class="sr-only" for="expCategory">Categoría del gasto</label>
          <select id="expCategory">${catOptionsLibre}</select>
          <label class="sr-only" for="expAmount">Monto del gasto</label>
          <input type="number" id="expAmount" min="1" step="1" placeholder="Monto" required>
          <label class="sr-only" for="expNote">Nota del gasto</label>
          <input type="text" id="expNote" placeholder="Nota (opcional)">
          <button type="submit">Agregar</button>
        </form>
        <div class="err" id="expErr" role="alert" aria-live="polite"></div>
      </div>
    </details>

    <details class="wallet-disclosure" id="periodHistory">
      <summary>Historial completo</summary>
      <div class="wallet-disclosure-content">
        <h2>Movimientos de ${escapeHtml(period.label)}</h2>
        <div class="wallet-history-current">${currentHistoryHtml}</div>
        <h2 class="wallet-archive-title">Resumen de ciclos anteriores</h2>
        <p class="wallet-history-note">Selecciona un ciclo para consultar sus movimientos guardados.</p>
        <div class="wallet-history-list" id="archivedCycleList">${archivedCyclesHtml}</div>
      </div>
    </details>
  `;
}

async function loadArchivedPeriodMovements(button) {
  const periodId = button.dataset.historyPeriod;
  const cycleContainer = button.closest('[data-history-cycle]');
  const movementContainer = cycleContainer?.querySelector('[data-history-movements]');
  const cycle = archivedCycleSummaries().find(item => String(item.id) === periodId);
  if (!periodId || !movementContainer || !cycle) return;

  button.disabled = true;
  button.textContent = 'Cargando…';
  movementContainer.hidden = false;
  try {
    let records = archiveMovementCache.get(periodId);
    if (!records) {
      records = await FinanceDB.getTransactionsByPeriod(periodId);
      archiveMovementCache.set(periodId, records);
    }
    const movements = getHistoricalMovements(records, { id: periodId, label: cycle.label || periodId });
    movementContainer.innerHTML = movements.length
      ? renderMovementList(movements, '')
      : '<p class="wallet-history-note">No hay movimientos individuales guardados para este ciclo; solo se conserva el resumen.</p>';
    button.hidden = true;
  } catch (error) {
    movementContainer.innerHTML = `<p class="err" role="alert">No se pudieron cargar los movimientos: ${escapeHtml(error.message)}</p>`;
    button.disabled = false;
    button.textContent = 'Reintentar';
  }
}

function bindDashboard(){
  const bucketSel = document.getElementById('expBucket');
  const catSel = document.getElementById('expCategory');

  document.getElementById('quickAddExpense')?.addEventListener('click', window.abrirModalGastoRapido);
  document.getElementById('quickAddIncome')?.addEventListener('click', window.abrirModalIngresoRapido);
  const historyDetails = document.getElementById('periodHistory');
  const archiveList = document.getElementById('archivedCycleList');
  historyDetails?.addEventListener('toggle', () => {
    if (historyDetails.open) void loadArchivedPeriods(archiveList);
  });
  document.getElementById('showHistory')?.addEventListener('click', () => {
    if (historyDetails) {
      historyDetails.open = true;
      historyDetails.scrollIntoView({ behavior: 'smooth' });
      void loadArchivedPeriods(archiveList);
    }
  });
  
  if(bucketSel && catSel) {
    bucketSel.addEventListener('change', ()=>{
      const opts = bucketSel.value==='fijos'?CATS.fijos:CATS.libre;
      catSel.innerHTML = opts.map(c=>`<option value="${c}">${c}</option>`).join('');
    });
  }

  const incForm = document.getElementById('incForm');
  if(incForm){
    incForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = Number(document.getElementById('incAmount').value);
      const note = document.getElementById('incNote').value.trim();
      const errEl = document.getElementById('incErr');

      if(!Number.isSafeInteger(amount) || amount <= 0){ if(errEl) errEl.textContent = 'Ingresa un monto entero válido en pesos.'; return; }

      if(!state.currentPeriod.incomes) state.currentPeriod.incomes = [];
      const id = newId();
      state.currentPeriod.incomes.push({ id, amount, note, ...transactionDateFields(null) });

      await persistAndRender();
    });
  }

  const expForm = document.getElementById('expForm');
  if(expForm){
    expForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const bucket = bucketSel.value;
      const category = catSel.value;
      const amount = Number(document.getElementById('expAmount').value);
      const note = document.getElementById('expNote').value.trim();
      const errEl = document.getElementById('expErr');

      if(!Number.isSafeInteger(amount) || amount<=0){ if(errEl) errEl.textContent='Ingresa un monto entero válido en pesos.'; return; }

      const id = newId();
      state.currentPeriod.expenses.push({id, bucket, amount, note, category, ...transactionDateFields(bucket)});
      state.currentPeriod.spent[bucket] += amount;

      await persistAndRender();
    });
  }

  const tc = document.getElementById('tabContent');
  if(tc) {
    tc.addEventListener('click', async (e) => {
      const historyButton = e.target.closest('[data-history-period]');
      if (historyButton) {
        await loadArchivedPeriodMovements(historyButton);
        return;
      }

      const btnInc = e.target.closest('.del[data-inc-id]');
      if (btnInc) {
        const id = btnInc.getAttribute('data-inc-id');
        const idx = (state.currentPeriod.incomes||[]).findIndex(i=>i.id===id);
        if(idx > -1){
          state.currentPeriod.incomes.splice(idx,1);
          await persistAndRender();
        }
        return;
      }

      const btnExtra = e.target.closest('.del[data-extra-id]');
      if (btnExtra) {
        const id = btnExtra.getAttribute('data-extra-id');
        const idx = state.currentPeriod.extraExpenses.findIndex(item => item.id === id);
        if (idx > -1) {
          state.currentPeriod.spent.extra -= state.currentPeriod.extraExpenses[idx].amount;
          state.currentPeriod.extraExpenses.splice(idx, 1);
          await persistAndRender();
        }
        return;
      }

      const btnExp = e.target.closest('.del[data-id]');
      if (btnExp) {
        const id = btnExp.getAttribute('data-id');
        const idx = state.currentPeriod.expenses.findIndex(e=>e.id===id);
        if(idx>-1){
          state.currentPeriod.spent[state.currentPeriod.expenses[idx].bucket] -= state.currentPeriod.expenses[idx].amount;
          state.currentPeriod.expenses.splice(idx,1);
          await persistAndRender();
        }
      }
    });
  }
}

function renderExtra(period){
  const cp = state.currentPeriod;
  normalizePeriod(cp);
  const total = extraPoolTotal(period, cp);
  const spent = cp.spent.extra;
  const remaining = total - spent;

  const extraMovesHtml = (cp.extraExpenses && cp.extraExpenses.length) ? cp.extraExpenses.slice().reverse().map(e => `
    <li>
      <span>${e.note ? escapeHtml(e.note) : 'Desembolso libre'}<small>${escapeHtml(transactionDateLabel(e))}</small></span>
      <span style="display:flex;align-items:center;gap:8px;"><b>${fmt(e.amount)}</b><button type="button" class="del" data-extra-id="${escapeHtml(e.id)}" aria-label="Eliminar desembolso">✕</button></span>
    </li>
  `).join('') : '<div class="empty">Sin desembolsos libres registrados en este período.</div>';

  return `
    <div class="sinasignar">
      <div class="lbl">Dinero libre disponible</div>
      <div class="amt">${fmt(remaining)}</div>
    </div>
    <div class="panel">
      <h2>Registra un desembolso libre</h2>
      <form id="extraForm" class="expense-form">
        <label class="sr-only" for="extraAmount">Monto del desembolso</label>
        <input type="number" id="extraAmount" min="1" step="1" placeholder="Monto" required>
        <label class="sr-only" for="extraNote">Concepto del desembolso</label>
        <input type="text" id="extraNote" placeholder="¿En qué?">
        <button type="submit">Agregar</button>
      </form>
      
      <h3 style="margin-top:20px; font-size: 0.95rem;">Historial de desembolsos libres:</h3>
      <ul class="moves" style="margin-top:8px;">${extraMovesHtml}</ul>
    </div>
  `;
}

function bindExtra(period){
  const extraForm = document.getElementById('extraForm');
  if(extraForm){
    extraForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = Number(document.getElementById('extraAmount').value);
      const note = document.getElementById('extraNote').value.trim();
      if(!Number.isSafeInteger(amount) || amount<=0) return;

      const cp = state.currentPeriod;
      normalizePeriod(cp);
      const id = newId();
      cp.extraExpenses.push({id, amount, note, ...transactionDateFields('extra')});
      cp.spent.extra += amount;

      await persistAndRender();
    });
  }

  const tc = document.getElementById('tabContent');
  tc?.addEventListener('click', async event => {
    const button = event.target.closest('.del[data-extra-id]');
    if (!button) return;
    const index = state.currentPeriod.extraExpenses.findIndex(item => item.id === button.dataset.extraId);
    if (index < 0) return;
    state.currentPeriod.spent.extra -= state.currentPeriod.extraExpenses[index].amount;
    state.currentPeriod.extraExpenses.splice(index, 1);
    await persistAndRender();
  });
}

function renderLoans(){
  const loansHtml = (state.loans && state.loans.length) ? state.loans.map(l => {
    const isPagado = l.status === 'Pagado';
    return `
      <li>
        <span><b>${escapeHtml(l.person)}</b> - ${isPagado ? 'Monto:' : 'Pendiente:'} ${fmt(l.pending)}</span>
        <span style="display:flex;align-items:center;gap:8px;">
          <button type="button" class="tag tag-toggle ${isPagado ? 'pagado' : 'pendiente'}" data-loan-toggle="${escapeHtml(l.id)}" aria-label="Cambiar estado del préstamo de ${escapeHtml(l.person)}">
            ${escapeHtml(l.status)}
          </button>
          <button type="button" class="del" data-loan-del="${escapeHtml(l.id)}" aria-label="Eliminar préstamo de ${escapeHtml(l.person)}">✕</button>
        </span>
      </li>
    `;
  }).join('') : '<div class="empty">No tienes préstamos registrados.</div>';

  return `
    <div class="panel">
      <h2>Préstamos</h2>
      <form id="loanForm">
        <div class="row2">
          <div class="field"><label for="loanPerson">Persona</label><input type="text" id="loanPerson" placeholder="Nombre" required></div>
          <div class="field"><label for="loanAmount">Monto</label><input type="number" id="loanAmount" min="1" step="1" placeholder="Monto" required></div>
        </div>
        <button type="submit" class="btn">Registrar Préstamo</button>
      </form>
      <ul class="moves" style="margin-top:16px;">${loansHtml}</ul>
    </div>
  `;
}

function bindLoans(){
  const loanForm = document.getElementById('loanForm');
  if(loanForm){
    loanForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const person = document.getElementById('loanPerson').value.trim();
      const amount = Number(document.getElementById('loanAmount').value);
      if(!person || !Number.isSafeInteger(amount) || amount<=0) return;

      state.loans.push({
        id: newId(),
        person, 
        original: amount, 
        returned: 0, 
        pending: amount, 
        status: 'Pendiente'
      });
      await persistAndRender();
    });
  }

  const tc = document.getElementById('tabContent');
  if(tc) {
    tc.addEventListener('click', async (e) => {
      const toggleBtn = e.target.closest('[data-loan-toggle]');
      if (toggleBtn) {
        const id = toggleBtn.getAttribute('data-loan-toggle');
        const loan = state.loans.find(l => l.id === id);
        if(loan){
          loan.status = loan.status === 'Pagado' ? 'Pendiente' : 'Pagado';
          await persistAndRender();
        }
        return;
      }

      const delBtn = e.target.closest('[data-loan-del]');
      if (delBtn) {
        const id = delBtn.getAttribute('data-loan-del');
        state.loans = state.loans.filter(l => l.id !== id);
        await persistAndRender();
      }
    });
  }
}

function buildFinancialContext(period) {
  const alloc = getAllocations();
  const cp = state.currentPeriod;
  const ingresoExtra = (cp.incomes || []).reduce((s, i) => s + i.amount, 0);
  const ingresoTotal = ((state.payFrequency || 'quincenal') === 'independiente' ? 0 : state.salary) + ingresoExtra;

  const fijosDisp = Math.max(0, alloc.fijos - cp.spent.fijos);
  const libreDisp = Math.max(0, alloc.libre - cp.spent.libre);
  const extraTotal = extraPoolTotal(period, cp);
  const extraDisp = extraTotal - cp.spent.extra;

  return `
Resumen financiero agregado y anónimo en COP:
- Ingreso del período: ${Math.round(ingresoTotal)}
- Presupuesto fijo: ${Math.round(alloc.fijos)}; gastado: ${Math.round(cp.spent.fijos)}; disponible: ${Math.round(fijosDisp)}
- Presupuesto flexible: ${Math.round(alloc.libre)}; gastado: ${Math.round(cp.spent.libre)}; disponible: ${Math.round(libreDisp)}
- Dinero libre disponible: ${Math.round(extraDisp)}
`;
}

function renderAssistant(period){
  return `
    <div class="panel">
      <h2>Asistente Financiero IA</h2>
      <div class="sub">Opcional. No incluyas nombres, notas ni otros datos que identifiquen personas.</div>
      <div class="chat-log" id="chatLog">
        <div class="bubble bot">Puedo responder usando totales agregados. No se envían nombres ni detalles de movimientos.</div>
      </div>
      <form id="chatForm" class="chat-input">
        <label class="sr-only" for="chatInput">Pregunta para el asistente</label>
        <input type="text" id="chatInput" placeholder="Ej: ¿Cuánto dinero me queda libre para salir?" required>
        <button type="submit">Enviar</button>
      </form>
      <label class="assistant-consent"><input type="checkbox" id="assistantConsent"> Entiendo que mi pregunta y los totales agregados se enviarán a Google Gemini.</label>
    </div>
  `;
}

function bindAssistant(period){
  const chatInput = document.getElementById('chatInput');
  const chatLog = document.getElementById('chatLog');
  const chatForm = document.getElementById('chatForm');

  if(chatForm){
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userText = chatInput.value.trim();
      if (!userText) return;

      chatLog.innerHTML += `<div class="bubble user">${escapeHtml(userText)}</div>`;
      chatInput.value = '';
      chatLog.scrollTop = chatLog.scrollHeight;

      const loadingId = 'loading-' + Date.now();
      chatLog.innerHTML += `<div class="bubble bot" id="${loadingId}">Pensando y calculando...</div>`;
      chatLog.scrollTop = chatLog.scrollHeight;

      const apiKey = getGeminiKey().trim();
      if (!apiKey) {
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.textContent = 'Ingresa una clave propia solo para esta sesión en Ajustes. La app no la guarda.';
        return;
      }
      if (!document.getElementById('assistantConsent')?.checked) {
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.textContent = 'Confirma el envío externo antes de continuar.';
        return;
      }

      try {
        const systemContext = buildFinancialContext(period);
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${systemContext}\n\nPregunta: ${userText}` }] }]
          })
        });

        const data = await response.json();
        const loadingEl = document.getElementById(loadingId);

        if (!response.ok) {
          if (loadingEl) loadingEl.textContent = `Error API (${response.status}): ${data.error?.message || 'Verifica tu API Key en Ajustes.'}`;
          return;
        }

        const botReply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No pude interpretar la respuesta.';
        if (loadingEl) loadingEl.textContent = botReply;

      } catch (err) {
        console.error(err);
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) {
          loadingEl.textContent = 'Hubo un problema de conexión al llamar a la API.';
        }
      }
      chatLog.scrollTop = chatLog.scrollHeight;
    });
  }
}

function renderGoals(){
  if (!state.goals) state.goals = [];

  const goalsList = state.goals.length ? state.goals.map(g => {
    const pct = Math.min(100, Math.round((g.saved / Math.max(1, g.target)) * 100));
    return `
      <div class="panel" style="margin-bottom: 12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
          <b style="font-size: 1.1rem;">🎯 ${escapeHtml(g.name)}</b>
          <button type="button" class="del" data-goal-del="${escapeHtml(g.id)}" aria-label="Eliminar meta ${escapeHtml(g.name)}">✕</button>
        </div>
        <div class="goal-details" style="font-size: 0.9rem; margin-bottom: 6px;">
          Ahorrado: <b>${fmt(g.saved)}</b> de <b>${fmt(g.target)}</b> (${pct}%)
        </div>
        <div class="bar" style="margin-bottom: 12px;"><div class="bar-fill goal-fill" style="width:${pct}%;"></div></div>
        <form class="goal-add-form expense-form" data-goal-id="${escapeHtml(g.id)}">
            <label class="sr-only" for="addSaved_${escapeHtml(g.id)}">Abono para ${escapeHtml(g.name)}</label>
            <input type="number" id="addSaved_${escapeHtml(g.id)}" min="1" step="1" placeholder="Abonar monto" required>
          <button type="submit">Abonar</button>
        </form>
      </div>
    `;
  }).join('') : '<div class="empty">No tienes metas de ahorro registradas.</div>';

  return `
    <div class="panel" style="margin-bottom: 16px;">
      <h2>🎯 Crear nueva meta de ahorro</h2>
      <form id="newGoalForm" class="expense-form">
        <label class="sr-only" for="goalName">Nombre de la meta</label>
        <input type="text" id="goalName" placeholder="Ej: Viaje, Moto, Fondo de emergencia" required>
        <label class="sr-only" for="goalTarget">Monto de la meta</label>
        <input type="number" id="goalTarget" min="1" step="1" placeholder="Meta ($)" required>
        <button type="submit">Crear Meta</button>
      </form>
      <div class="err" id="goalErr"></div>
    </div>
    <h2>Tus Metas</h2>
    ${goalsList}
  `;
}

function bindGoals(){
  const newGoalForm = document.getElementById('newGoalForm');
  if(newGoalForm){
    newGoalForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('goalName').value.trim();
      const target = Number(document.getElementById('goalTarget').value);
      const errEl = document.getElementById('goalErr');

      if(!name || !Number.isSafeInteger(target) || target <= 0){
        if(errEl) errEl.textContent = 'Ingresa un nombre y un monto objetivo válido.';
        return;
      }

      if(!state.goals) state.goals = [];
      state.goals.push({ id: newId(), name, target, saved: 0 });

      await persistAndRender();
    });
  }

  const tc = document.getElementById('tabContent');
  if(tc) {
    tc.addEventListener('submit', async (e) => {
      const goalForm = e.target.closest('.goal-add-form');
      if(goalForm) {
        e.preventDefault();
        const id = goalForm.getAttribute('data-goal-id');
        const input = document.getElementById(`addSaved_${id}`);
        const amount = Number(input?.value);
        if(!Number.isSafeInteger(amount) || amount <= 0) return;

        const goal = state.goals.find(g => g.id === id);
        if(goal){
          goal.saved += amount;
          await persistAndRender();
        }
      }
    });

    tc.addEventListener('click', async (e) => {
      const delBtn = e.target.closest('[data-goal-del]');
      if (delBtn) {
        const id = delBtn.getAttribute('data-goal-del');
        state.goals = state.goals.filter(g => g.id !== id);
        await persistAndRender();
      }
    });
  }
}

function escapeHtml(str) {
  return String(str||'').replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}

function showStartupError(error) {
  const loading = document.getElementById('loading');
  const app = document.getElementById('app');
  const mobileNav = document.getElementById('mobileNav');
  if (loading) loading.style.display = 'none';
  if (mobileNav) mobileNav.hidden = true;
  if (!app) return;
  app.classList.remove('hidden');
  app.style.display = 'block';
  app.innerHTML = '<section class="panel"><h2>No se pudieron abrir tus datos</h2><p id="startupError" role="alert"></p><p>Los datos originales no se borraron. Descarga una copia antes de intentar recuperar el estado.</p><button type="button" class="btn btn-blue" id="downloadLegacyBackup">Descargar datos locales originales</button></section>';
  document.getElementById('startupError').textContent = error.message;
  const downloadButton = document.getElementById('downloadLegacyBackup');
  if (localStorage.getItem('quincena-state-v3') === null) downloadButton.disabled = true;
  downloadButton.addEventListener('click', () => {
    try {
      FinanceDB.downloadLegacyBackup();
    } catch (backupError) {
      document.getElementById('startupError').textContent = backupError.message;
    }
  });
}

async function initApp() {
  try {
    await loadState();
    if (state) {
      if (!Array.isArray(state.history)) state.history = [];
      if (!Array.isArray(state.loans)) state.loans = [];
      if (!Array.isArray(state.goals)) state.goals = [];
      const period = computePeriod(new Date(), state.payDay, state.payFrequency || 'quincenal');
      if (archiveIfNeeded(period)) await saveState();
    }
    render();
    await processPendingNativeExpense();
    const notice = await FinanceDB.getMigrationNotice();
    showNotice(notice);
  } catch (error) {
    showStartupError(error);
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .catch(() => showNotice('No se pudo activar el modo instalable. La aplicación sigue disponible mientras haya conexión.'));
  });
}

function bindMobileNavigation() {
  document.querySelectorAll('[data-mobile-tab]').forEach(button => {
    button.addEventListener('click', () => window.switchMobileTab(button.dataset.mobileTab));
  });
  document.getElementById('quickExpense')?.addEventListener('click', window.abrirModalGastoRapido);
  document.getElementById('openSettings')?.addEventListener('click', () => window.switchMobileTab('settings'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
bindMobileNavigation();
registerServiceWorker();