const STORE_KEY = 'quincena-state-v3';
let state = null;
let currentTab = 'dashboard';

const CATS = {
  fijos: ['Plan celular','Mercado','Deudas','Gasolina/moto','Servicios','Arriendo','Salud','Educación','Otro fijo'],
  libre: ['Transporte','Comida fuera','Gastos hormiga','Entretenimiento','Suscripciones','Ropa','Otro libre']
};

function getGeminiKey() {
  return localStorage.getItem('gemini_api_key') || '';
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(raw) state = JSON.parse(raw);
  }catch(e){ state = null; }
}

function saveState(){
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch(e){ console.error('No se pudo guardar', e); }
}

function fmt(n){ return Number(n||0).toLocaleString('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}); }
function daysInMonth(y,m){ return new Date(y, m+1, 0).getDate(); }

function computePeriod(today, cutoff, frequency){
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
  const lastDay = daysInMonth(y,m);
  const monthNames = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

  if(frequency === 'mensual'){
    const startDay = 1, endDay = lastDay;
    const key = `${y}-${String(m+1).padStart(2,'0')}-M`;
    const label = `${monthNames[m]} completo`;
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
  const ingresoTotal = state.salary + ingresoExtra;
  
  const prestamosPendientes = (state.loans || [])
    .filter(l => l.status === 'Pendiente')
    .reduce((s, l) => s + (l.pending || 0), 0);

  return ingresoTotal - alloc.fijos - alloc.libre - prestamosPendientes;
}

function normalizePeriod(cp){
  if(!cp.spent) cp.spent = {fijos:0,libre:0,extra:0};
  if(typeof cp.spent.extra !== 'number') cp.spent.extra = 0;
  if(!cp.extraExpenses) cp.extraExpenses = [];
  if(!cp.incomes) cp.incomes = [];
  if(!cp.expenses) cp.expenses = [];
}

function getAllocations(){
  if(state.payFrequency === 'mensual'){
    return { fijos: Math.round(state.fijosMensual), libre: Math.round(state.variablesMensual) };
  }
  return {
    fijos: Math.round(state.fijosMensual/2),
    libre: Math.round(state.variablesMensual/2)
  };
}

function archiveIfNeeded(period){
  if(state.currentPeriod && state.currentPeriod.key !== period.key){
    const cp = state.currentPeriod;
    normalizePeriod(cp);
    const alloc = getAllocations();
    const ingresoExtra = (cp.incomes||[]).reduce((s,i)=>s+i.amount,0);
    state.history.unshift({
      key: cp.key, label: cp.label,
      fijosAlloc: alloc.fijos, fijosSpent: cp.spent.fijos,
      libreAlloc: alloc.libre, libreSpent: cp.spent.libre,
      extraAlloc: extraPoolTotal(period, cp), extraSpent: cp.spent.extra,
      ingresoExtra
    });
    state.currentPeriod = null;
  }
  if(!state.currentPeriod){
    state.currentPeriod = {key:period.key, label:period.label, spent:{fijos:0,libre:0,extra:0}, expenses:[], incomes:[], extraExpenses:[]};
  } else {
    state.currentPeriod.label = period.label;
    normalizePeriod(state.currentPeriod);
  }
}

function updateMobileNav() {
  const items = document.querySelectorAll('.mobile-nav-item');
  items.forEach(item => {
    const onclickAttr = item.getAttribute('onclick') || '';
    if (onclickAttr.includes(`'${currentTab}'`)) {
      item.classList.add('active');
    } else if (!onclickAttr.includes('abrirModalGastoRapido')) {
      item.classList.remove('active');
    }
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
    const expForm = document.getElementById('expForm');
    if (expForm) {
      expForm.scrollIntoView({ behavior: 'smooth' });
      const amountInput = document.getElementById('expAmount');
      if (amountInput) amountInput.focus();
    }
  }, 100);
};

function render(){
  const app = document.getElementById('app');
  const loading = document.getElementById('loading');
  
  if(loading) loading.style.display = 'none';
  if(app) app.style.display = 'block';

  if(!state){ if(app) app.innerHTML = renderSetup(null); bindSetup(); return; }
  if(!state.loans) state.loans = [];
  if(!state.goals) state.goals = [];

  const today = new Date();
  const period = computePeriod(today, state.payDay, state.payFrequency||'quincenal');
  archiveIfNeeded(period);
  saveState();

  const freq = state.payFrequency || 'quincenal';
  const userName = state.userName || '';
  
  const titleEl = document.getElementById('mainTitle');
  if(titleEl) {
    titleEl.textContent = freq==='mensual' ? 'Mes en curso' : 'Quincena en curso';
  }
  
  let userHeaderEl = document.getElementById('userGreeting');
  if(!userHeaderEl && titleEl) {
    userHeaderEl = document.createElement('div');
    userHeaderEl.id = 'userGreeting';
    userHeaderEl.style.fontSize = '1.3rem';
    userHeaderEl.style.fontWeight = 'bold';
    userHeaderEl.style.color = '#7c4dff';
    userHeaderEl.style.marginBottom = '4px';
    titleEl.parentNode.insertBefore(userHeaderEl, titleEl);
  }
  if(userHeaderEl) {
    userHeaderEl.textContent = userName ? `¡Hola, ${userName}! 👋` : '';
  }

  app.innerHTML = `
    <div class="tabs">
      <button type="button" class="tab ${currentTab==='dashboard'?'active':''}" data-tab="dashboard">${freq==='mensual'?'Mes':'Quincena'}</button>
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
  const s = prefill || {userName:'', salary:950000, payDay:15, fijosMensual:710000, variablesMensual:300000, payFrequency:'quincenal'};
  const freq = s.payFrequency || 'quincenal';
  const apiKey = getGeminiKey();

  return `
    <div class="panel" id="setupPanel">
      <h2>${state ? 'Ajustar tu sistema' : 'Arma tu sistema financiero'}</h2>
      <form id="setupForm">
        <div class="field">
          <label>¿Cómo te llamas?</label>
          <input type="text" id="inUserName" value="${escapeHtml(s.userName||'')}" placeholder="Ej: Darikson">
        </div>
        <div class="field">
          <label>¿Cómo te pagan?</label>
          <div class="freq-toggle" id="freqToggle">
            <button type="button" class="freqBtn ${freq==='quincenal'?'active':''}" data-freq="quincenal">Quincenal</button>
            <button type="button" class="freqBtn ${freq==='mensual'?'active':''}" data-freq="mensual">Mensual</button>
          </div>
        </div>
        <div class="field"><label id="salaryLabel">${freq==='mensual'?'Sueldo neto mensual':'Sueldo neto por quincena'}</label><input type="number" id="inSalary" value="${s.salary}"></div>
        <div class="field"><label id="cutoffLabel">${freq==='mensual'?'Día del mes en que te pagan':'Día de corte de la primera quincena'}</label><input type="number" id="inCutoff" min="1" max="31" value="${s.payDay}"></div>
        <div class="row2">
          <div class="field"><label>Gastos fijos al mes</label><input type="number" id="inFijos" value="${s.fijosMensual}"></div>
          <div class="field"><label>Gastos variables al mes</label><input type="number" id="inVar" value="${s.variablesMensual}"></div>
        </div>
        <div class="field">
          <label>Gemini API Key (para el Asistente IA)</label>
          <input type="password" id="inApiKey" value="${apiKey}" placeholder="Pega tu API Key de Google AI Studio">
        </div>
        <button type="submit" class="btn">Guardar</button>
        <div class="err" id="setupErr"></div>
      </form>
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
    });
  });

  const setupForm = document.getElementById('setupForm');
  if(setupForm) {
    setupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const userName = document.getElementById('inUserName').value.trim();
      const salary = Number(document.getElementById('inSalary').value);
      const cutoff = Number(document.getElementById('inCutoff').value);
      const fijosMensual = Number(document.getElementById('inFijos').value);
      const variablesMensual = Number(document.getElementById('inVar').value);
      const apiKey = document.getElementById('inApiKey').value.trim();
      const errEl = document.getElementById('setupErr');

      if(!salary || salary<=0){ if(errEl) errEl.textContent = 'Ingresa un sueldo válido.'; return; }

      if(apiKey) localStorage.setItem('gemini_api_key', apiKey);

      const wasSetUp = !!state;
      state = state || {history:[], currentPeriod:null, goals:[], loans:[]};
      state.userName = userName;
      state.payFrequency = selectedFreq;
      state.salary = salary; 
      state.payDay = cutoff;
      state.fijosMensual = fijosMensual; 
      state.variablesMensual = variablesMensual;

      if(!wasSetUp){
        state.history = []; 
        state.currentPeriod = null;
        state.goals = [{id:'seed-1', name:'Fondo de emergencia', target:800000, saved:0}];
      }

      saveState();
      currentTab = 'dashboard';
      render();
    });
  }
}

function renderDashboard(period){
  const alloc = getAllocations();
  const cp = state.currentPeriod;
  const totalDays = period.totalDays;
  let ticks = '';
  for(let i=1;i<=totalDays;i++){
    let cls='tick';
    if(i<period.elapsed) cls+=' filled'; else if(i===period.elapsed) cls+=' today';
    ticks += `<div class="${cls}"></div>`;
  }
  const ingresoExtra = (cp.incomes||[]).reduce((s,i)=>s+i.amount,0);
  const ingresoTotal = state.salary + ingresoExtra;

  const fijosPct = Math.round((cp.spent.fijos/Math.max(1,alloc.fijos))*100);
  const librePct = Math.round((cp.spent.libre/Math.max(1,alloc.libre))*100);

  const catOptionsLibre = CATS.libre.map(c=>`<option value="${c}">${c}</option>`).join('');

  const movesHtml = (cp.expenses && cp.expenses.length) ? cp.expenses.slice().reverse().map(e => `
    <li>
      <span>${e.note ? escapeHtml(e.note) : e.category}<span class="tag">${e.category}</span></span>
      <span style="display:flex;align-items:center;gap:8px;"><b>${fmt(e.amount)}</b><button type="button" class="del" data-id="${e.id}">✕</button></span>
    </li>
  `).join('') : '<div class="empty">Sin movimientos todavía en este período.</div>';

  const incomesHtml = (cp.incomes && cp.incomes.length) ? cp.incomes.slice().reverse().map(i => `
    <li>
      <span>${i.note ? escapeHtml(i.note) : 'Ingreso Adicional'}</span>
      <span style="display:flex;align-items:center;gap:8px;color:#2e7d32;"><b>+${fmt(i.amount)}</b><button type="button" class="del" data-inc-id="${i.id}">✕</button></span>
    </li>
  `).join('') : '<div class="empty">No hay ingresos extra registrados.</div>';

  return `
    <div class="hero">
      <div class="hero-top">
        <div>
          <div class="hero-label">${period.label}</div>
          <div class="days-num">${period.remaining}<span>días para tu próximo pago</span></div>
        </div>
      </div>
      <div class="timeline">${ticks}<div class="coin">$</div></div>
      <div class="timeline-caption"><span>Día ${period.elapsed} de ${totalDays}</span><span>Base: ${fmt(state.salary)}</span></div>
    </div>

    <div class="incomebar">
      <span>Ingreso disponible este período</span>
      <b>${fmt(ingresoTotal)}</b>
    </div>

    <div class="panel" style="margin-bottom: 16px;">
      <h2>💰 Registrar Ingreso Extra</h2>
      <form id="incForm" class="expense-form">
        <input type="number" id="incAmount" placeholder="Monto extra" required>
        <input type="text" id="incNote" placeholder="Concepto (ej. Trabajo freelance, regalo...)">
        <button type="submit">Agregar Ingreso</button>
      </form>
      <div class="err" id="incErr"></div>
      
      <h3 style="margin-top:16px; font-size: 0.95rem; color:#555;">Ingresos registrados en este período:</h3>
      <ul class="moves" style="margin-top:8px;">${incomesHtml}</ul>
    </div>

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

    <div class="panel">
      <h2>Registrar un gasto</h2>
      <form id="expForm" class="expense-form">
        <select id="expBucket">
          <option value="fijos">Obligaciones</option>
          <option value="libre" selected>Gasto libre</option>
        </select>
        <select id="expCategory">${catOptionsLibre}</select>
        <input type="number" id="expAmount" placeholder="Monto" required>
        <input type="text" id="expNote" placeholder="Nota (opcional)">
        <button type="submit">Agregar</button>
      </form>
      <div class="err" id="expErr"></div>
      <ul class="moves">${movesHtml}</ul>
    </div>
  `;
}

function bindDashboard(){
  const bucketSel = document.getElementById('expBucket');
  const catSel = document.getElementById('expCategory');
  
  if(bucketSel && catSel) {
    bucketSel.addEventListener('change', ()=>{
      const opts = bucketSel.value==='fijos'?CATS.fijos:CATS.libre;
      catSel.innerHTML = opts.map(c=>`<option value="${c}">${c}</option>`).join('');
    });
  }

  const incForm = document.getElementById('incForm');
  if(incForm){
    incForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const amount = Number(document.getElementById('incAmount').value);
      const note = document.getElementById('incNote').value.trim();
      const errEl = document.getElementById('incErr');

      if(!amount || amount <= 0){ if(errEl) errEl.textContent = 'Ingresa un monto válido.'; return; }

      if(!state.currentPeriod.incomes) state.currentPeriod.incomes = [];
      const id = Date.now().toString(36);
      state.currentPeriod.incomes.push({ id, amount, note });

      saveState();
      render();
    });
  }

  const expForm = document.getElementById('expForm');
  if(expForm){
    expForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const bucket = bucketSel.value;
      const category = catSel.value;
      const amount = Number(document.getElementById('expAmount').value);
      const note = document.getElementById('expNote').value.trim();
      const errEl = document.getElementById('expErr');

      if(!amount || amount<=0){ if(errEl) errEl.textContent='Ingresa un monto válido.'; return; }

      const id = Date.now().toString(36)+Math.random().toString(36).slice(2,6);
      state.currentPeriod.expenses.push({id, bucket, amount, note, category});
      state.currentPeriod.spent[bucket] += amount;

      saveState();
      render();
    });
  }

  const tc = document.getElementById('tabContent');
  if(tc) {
    tc.addEventListener('click', (e) => {
      const btnInc = e.target.closest('.del[data-inc-id]');
      if (btnInc) {
        const id = btnInc.getAttribute('data-inc-id');
        const idx = (state.currentPeriod.incomes||[]).findIndex(i=>i.id===id);
        if(idx > -1){
          state.currentPeriod.incomes.splice(idx,1);
          saveState();
          render();
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
          saveState(); 
          render();
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

  return `
    <div class="sinasignar">
      <div class="lbl">Dinero libre disponible</div>
      <div class="amt">${fmt(remaining)}</div>
    </div>
    <div class="panel">
      <h2>Registra un desembolso libre</h2>
      <form id="extraForm" class="expense-form">
        <input type="number" id="extraAmount" placeholder="Monto" required>
        <input type="text" id="extraNote" placeholder="¿En qué?">
        <button type="submit">Agregar</button>
      </form>
    </div>
  `;
}

function bindExtra(period){
  const extraForm = document.getElementById('extraForm');
  if(extraForm){
    extraForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const amount = Number(document.getElementById('extraAmount').value);
      const note = document.getElementById('extraNote').value.trim();
      if(!amount || amount<=0) return;

      const cp = state.currentPeriod;
      normalizePeriod(cp);
      const id = Date.now().toString(36);
      cp.extraExpenses.push({id, amount, note});
      cp.spent.extra += amount;

      saveState();
      render();
    });
  }
}

function renderLoans(){
  const loansHtml = (state.loans && state.loans.length) ? state.loans.map(l => {
    const isPagado = l.status === 'Pagado';
    return `
      <li>
        <span><b>${escapeHtml(l.person)}</b> - ${isPagado ? 'Monto:' : 'Pendiente:'} ${fmt(l.pending)}</span>
        <span style="display:flex;align-items:center;gap:8px;">
          <button type="button" class="tag tag-toggle ${isPagado ? 'pagado' : 'pendiente'}" data-loan-toggle="${l.id}">
            ${l.status}
          </button>
          <button type="button" class="del" data-loan-del="${l.id}">✕</button>
        </span>
      </li>
    `;
  }).join('') : '<div class="empty">No tienes préstamos registrados.</div>';

  return `
    <div class="panel">
      <h2>Préstamos</h2>
      <form id="loanForm">
        <div class="row2">
          <div class="field"><label>Persona</label><input type="text" id="loanPerson" placeholder="Nombre" required></div>
          <div class="field"><label>Monto</label><input type="number" id="loanAmount" placeholder="Monto" required></div>
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
    loanForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const person = document.getElementById('loanPerson').value.trim();
      const amount = Number(document.getElementById('loanAmount').value);
      if(!person || !amount || amount<=0) return;

      state.loans.push({
        id: Date.now().toString(36), 
        person, 
        original: amount, 
        returned: 0, 
        pending: amount, 
        status: 'Pendiente'
      });
      saveState();
      render();
    });
  }

  const tc = document.getElementById('tabContent');
  if(tc) {
    tc.addEventListener('click', (e) => {
      const toggleBtn = e.target.closest('[data-loan-toggle]');
      if (toggleBtn) {
        const id = toggleBtn.getAttribute('data-loan-toggle');
        const loan = state.loans.find(l => l.id === id);
        if(loan){
          loan.status = loan.status === 'Pagado' ? 'Pendiente' : 'Pagado';
          saveState();
          render();
        }
        return;
      }

      const delBtn = e.target.closest('[data-loan-del]');
      if (delBtn) {
        const id = delBtn.getAttribute('data-loan-del');
        state.loans = state.loans.filter(l => l.id !== id);
        saveState();
        render();
      }
    });
  }
}

function buildFinancialContext(period) {
  const alloc = getAllocations();
  const cp = state.currentPeriod;
  const daysLeft = period.remaining;
  const ingresoExtra = (cp.incomes || []).reduce((s, i) => s + i.amount, 0);
  const ingresoTotal = state.salary + ingresoExtra;

  const fijosDisp = Math.max(0, alloc.fijos - cp.spent.fijos);
  const libreDisp = Math.max(0, alloc.libre - cp.spent.libre);
  const extraTotal = extraPoolTotal(period, cp);
  const extraDisp = extraTotal - cp.spent.extra;

  const prestamosActivos = (state.loans || [])
    .filter(l => l.pending > 0 && l.status === 'Pendiente')
    .map(l => `${l.person}: debe ${fmt(l.pending)}`)
    .join(', ') || 'Ninguno';

  const ultimosGastos = (cp.expenses || [])
    .slice(-5)
    .map(e => `- ${e.category} (${e.bucket}): ${fmt(e.amount)} ${e.note ? '('+e.note+')' : ''}`)
    .join('\n') || 'Sin gastos recientes';

  const userName = state.userName || 'Usuario';

  return `
Eres el asistente financiero personal en la app "Control Quincenal".
El nombre del usuario es ${userName}. Dirígete a él/ella por su nombre de forma natural, empática, clara y muy práctica. Utiliza pesos colombianos (COP).

ESTADO FINANCIERO ACTUAL DE ${userName.toUpperCase()} (${period.label}):
- Frecuencia de pago: ${state.payFrequency || 'quincenal'}
- Sueldo base del período: ${fmt(state.salary)}
- Ingresos adicionales este período: ${fmt(ingresoExtra)}
- Ingreso total disponible: ${fmt(ingresoTotal)}
- Días restantes para el próximo pago: ${daysLeft} días

PRESUPUESTOS Y DISPONIBILIDAD:
1. Gastos Fijos (Obligaciones):
   - Presupuestado: ${fmt(alloc.fijos)} | Gastado: ${fmt(cp.spent.fijos)} | Disponible: ${fmt(fijosDisp)}
2. Gasto Libre:
   - Presupuestado: ${fmt(alloc.libre)} | Gastado: ${fmt(cp.spent.libre)} | Disponible: ${fmt(libreDisp)}
3. Dinero Libre:
   - Total disponible: ${fmt(extraDisp)}

OTRO DETALLE:
- Préstamos pendientes por cobrar: ${prestamosActivos}
- Últimos gastos registrados:
${ultimosGastos}
`;
}

function renderAssistant(period){
  return `
    <div class="panel">
      <h2>Asistente Financiero IA</h2>
      <div class="sub">Analizando en tiempo real tu estado financiero del período.</div>
      <div class="chat-log" id="chatLog">
        <div class="bubble bot">¡Hola! Analicé tus finanzas de este período. ¿En qué te puedo ayudar hoy?</div>
      </div>
      <form id="chatForm" class="chat-input">
        <input type="text" id="chatInput" placeholder="Ej: ¿Cuánto dinero me queda libre para salir?" required>
        <button type="submit">Enviar</button>
      </form>
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
        if (loadingEl) loadingEl.textContent = 'Por favor configura tu Gemini API Key en Ajustes (⚙️).';
        return;
      }

      try {
        const systemContext = buildFinancialContext(period);

        let response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${systemContext}\n\nPregunta del usuario: ${userText}` }] }]
          })
        });

        if (!response.ok) {
          response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: `${systemContext}\n\nPregunta del usuario: ${userText}` }] }]
            })
          });
        }

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
          <button type="button" class="del" data-goal-del="${g.id}">✕</button>
        </div>
        <div style="font-size: 0.9rem; color: #666; margin-bottom: 6px;">
          Ahorrado: <b>${fmt(g.saved)}</b> de <b>${fmt(g.target)}</b> (${pct}%)
        </div>
        <div class="bar" style="margin-bottom: 12px;"><div class="bar-fill goal-fill" style="width:${pct}%; background: linear-gradient(90deg, #4caf50, #2e7d32);"></div></div>
        <form class="goal-add-form expense-form" data-goal-id="${g.id}">
          <input type="number" id="addSaved_${g.id}" placeholder="Abonar monto" required>
          <button type="submit">Abonar</button>
        </form>
      </div>
    `;
  }).join('') : '<div class="empty">No tienes metas de ahorro registradas.</div>';

  return `
    <div class="panel" style="margin-bottom: 16px;">
      <h2>🎯 Crear nueva meta de ahorro</h2>
      <form id="newGoalForm" class="expense-form">
        <input type="text" id="goalName" placeholder="Ej: Viaje, Moto, Fondo de emergencia" required>
        <input type="number" id="goalTarget" placeholder="Meta ($)" required>
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
    newGoalForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('goalName').value.trim();
      const target = Number(document.getElementById('goalTarget').value);
      const errEl = document.getElementById('goalErr');

      if(!name || !target || target <= 0){
        if(errEl) errEl.textContent = 'Ingresa un nombre y un monto objetivo válido.';
        return;
      }

      if(!state.goals) state.goals = [];
      state.goals.push({ id: Date.now().toString(36), name, target, saved: 0 });

      saveState();
      render();
    });
  }

  const tc = document.getElementById('tabContent');
  if(tc) {
    tc.addEventListener('submit', (e) => {
      const goalForm = e.target.closest('.goal-add-form');
      if(goalForm) {
        e.preventDefault();
        const id = goalForm.getAttribute('data-goal-id');
        const input = document.getElementById(`addSaved_${id}`);
        const amount = Number(input?.value);
        if(!amount || amount <= 0) return;

        const goal = state.goals.find(g => g.id === id);
        if(goal){
          goal.saved += amount;
          saveState();
          render();
        }
      }
    });

    tc.addEventListener('click', (e) => {
      const delBtn = e.target.closest('[data-goal-del]');
      if (delBtn) {
        const id = delBtn.getAttribute('data-goal-del');
        state.goals = state.goals.filter(g => g.id !== id);
        saveState();
        render();
      }
    });
  }
}

function escapeHtml(str) {
  return String(str||'').replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}

function initApp() {
  loadState();
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}