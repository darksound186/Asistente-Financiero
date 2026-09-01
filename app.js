const STORE_KEY = 'quincena-state-v3';
let state = null;
let currentTab = 'dashboard';
let pendingImport = [];

const CATS = {
  fijos: ['Plan celular','Mercado','Deudas','Gasolina/moto','Servicios','Arriendo','Salud','Educación','Otro fijo'],
  libre: ['Transporte','Comida fuera','Gastos hormiga','Entretenimiento','Suscripciones','Ropa','Otro libre']
};
const CAT_RULES = [
  [/arriendo|canon/i,'fijos','Arriendo'],
  [/eps|farmacia|drogueria|droguería|medic/i,'fijos','Salud'],
  [/gasolina|combustible|estacion de servicio|terpel|esso|primax/i,'fijos','Gasolina/moto'],
  [/uber|didi|cabify|taxi|transmilenio|sitp|parqueadero/i,'libre','Transporte'],
  [/rappi|domicil|ifood|\bcomida\b/i,'libre','Comida fuera'],
  [/netflix|spotify|hbo|disney|amazon prime|youtube|claro video/i,'libre','Suscripciones'],
  [/\bexito\b|\bd1\b|\bara\b|carulla|jumbo|supermercado|mercado/i,'fijos','Mercado'],
  [/matricula|colegio|universidad|pension/i,'fijos','Educación'],
  [/luz|agua|gas natural|internet|claro|movistar|tigo|une/i,'fijos','Servicios'],
  [/cuota|prestamo|préstamo|tarjeta de credito|tarjeta de crédito|libranza/i,'fijos','Deudas'],
];

const hasNativeStorage = (typeof window !== 'undefined') && !!window.storage;

async function storageGet(key){
  if(hasNativeStorage) return window.storage.get(key, false);
  const raw = localStorage.getItem(key);
  if(raw === null) throw new Error('not found');
  return {key, value: raw, shared:false};
}
async function storageSet(key, value){
  if(hasNativeStorage) return window.storage.set(key, value, false);
  localStorage.setItem(key, value);
  return {key, value, shared:false};
}

async function loadState(){
  try{
    const res = await storageGet(STORE_KEY);
    if(res){ state = JSON.parse(res.value); return; }
  }catch(e){}
  state = null;
}
async function saveState(){
  try{ await storageSet(STORE_KEY, JSON.stringify(state)); }
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
  return ingresoTotal - alloc.fijos - alloc.libre;
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
// Migración segura: los períodos creados antes de que existiera el bolsillo "extra" no tienen estos campos.
function normalizePeriod(cp){
  if(!cp.spent) cp.spent = {fijos:0,libre:0};
  if(typeof cp.spent.extra !== 'number') cp.spent.extra = 0;
  if(!cp.extraExpenses) cp.extraExpenses = [];
  if(!cp.incomes) cp.incomes = [];
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

function computeSpendingGuidance(period, today){
  const alloc = getAllocations();
  const cp = state.currentPeriod;
  const availableVariable = Math.max(0, alloc.libre - cp.spent.libre);
  const endDate = new Date(period.year, period.month, period.endDay);
  const todayDate = new Date(period.year, period.month, today.getDate());
  const daysLeft = Math.max(1, Math.round((endDate - todayDate)/(1000*60*60*24)) + 1);
  const dailyRecommended = Math.floor(availableVariable / daysLeft);
  let weekendDays = 0;
  const cursor = new Date(todayDate);
  while(cursor <= endDate){
    const dow = cursor.getDay();
    if(dow === 0 || dow === 6) weekendDays++;
    cursor.setDate(cursor.getDate()+1);
  }
  const weekendRecommended = dailyRecommended * weekendDays;
  return {availableVariable, daysLeft, dailyRecommended, weekendDays, weekendRecommended};
}

// ---- Lenguaje natural: parseo de montos y tipo de movimiento ----
function parseAmountFromText(text){
  const milMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(mil|k|lucas?)\b/i);
  if(milMatch){
    const num = parseFloat(milMatch[1].replace(',','.'));
    return Math.round(num*1000);
  }
  const match = text.match(/\$?\s?(\d{1,3}(?:[.,]\d{3})+|\d{4,})/);
  if(match){
    const raw = match[1].replace(/[.,]/g,'');
    const n = parseInt(raw,10);
    return isNaN(n) ? null : n;
  }
  return null;
}
// Detecta un número corto y suelto (ej. "50", "100") que en el contexto colombiano probablemente
// signifique miles de pesos, pero SIN asumirlo — solo se usa para sugerir y pedir confirmación explícita.
function detectAmbiguousShortAmount(text){
  const m = text.match(/\b(\d{1,3})\b/);
  if(!m) return null;
  const n = parseInt(m[1],10);
  if(!n || n<=0) return null;
  return n;
}
function isQuestionText(text){
  const t = text.trim();
  return /\?/.test(t) || /^(cu[aá]nto|c[oó]mo|qu[eé]|puedo|voy|estoy|d[oó]nde|cu[aá]l|debo|deber[ií]a)\b/i.test(t);
}
function detectMovementType(text){
  if(/recib[ií]|me pagaron|ingres[oó]|gan[eé]|vend[ií]|entr[oó]|consign|me lleg[oó]|me cay[oó]|devolvieron|devuelven|reembols|me reintegr/i.test(text)) return 'ingreso';
  if(/gast[eé]|pagu[eé]|compr[eé]|se me fue en|no registr[eé].*gasto|se me (olvid[oó]|pas[oó]).*(registrar|anotar)/i.test(text)) return 'gasto';
  return null;
}
function tryParseMovement(text){
  if(isQuestionText(text)) return null;
  const type = detectMovementType(text);
  if(!type) return null;
  const amount = parseAmountFromText(text);
  if(!amount) return {needsAmount:true};
  if(type==='gasto'){
    const guess = guessCategory(text);
    return {type:'gasto', amount, bucket:guess.bucket, category:guess.cat, note:text, uncertain: guess.cat==='Otro libre'||guess.cat==='Otro fijo'};
  }
  return {type:'ingreso', amount, note:text};
}

// Detecta si un mismo mensaje describe VARIOS movimientos ("Gasté $20.000 y recibí $50.000")
// separando por conectores comunes y buscando un tipo+monto propio en cada parte.
function splitClauses(text){
  return text.split(/\s+y\s+|\s+pero\s+|,\s*/i).map(s=>s.trim()).filter(Boolean);
}
function detectMultipleMovements(text){
  const clauses = splitClauses(text);
  if(clauses.length<2) return null;
  const movs = [];
  clauses.forEach(c=>{
    const type = detectMovementType(c);
    const amount = parseAmountFromText(c);
    if(type && amount){
      const mv = {type, amount, note:c.trim()};
      if(type==='gasto'){
        const guess = guessCategory(c);
        mv.bucket = guess.bucket; mv.category = guess.cat; mv.uncertain = guess.cat==='Otro libre'||guess.cat==='Otro fijo';
      }
      movs.push(mv);
    }
  });
  return movs.length>=2 ? movs : null;
}

// ---- Agregación mensual y evaluación de compras ----
function monthTotals(today){
  const y=today.getFullYear(), m=today.getMonth();
  const prefix = `${y}-${String(m+1).padStart(2,'0')}`;
  let fijos=0, libre=0, ingresoExtra=0;
  state.history.forEach(h=>{ if(h.key.startsWith(prefix)){ fijos+=h.fijosSpent; libre+=h.libreSpent; ingresoExtra+=h.ingresoExtra||0; } });
  const cp = state.currentPeriod;
  if(cp.key.startsWith(prefix)){
    fijos+=cp.spent.fijos; libre+=cp.spent.libre;
    ingresoExtra += (cp.incomes||[]).reduce((s,i)=>s+i.amount,0);
  }
  return {fijos, libre, total:fijos+libre, ingresoExtra};
}

function evaluatePurchase(amount, period, weekendContext){
  const alloc = getAllocations();
  const cp = state.currentPeriod;
  const availableVariable = Math.max(0, alloc.libre - cp.spent.libre);
  const g = computeSpendingGuidance(period, new Date());
  const reference = weekendContext ? g.weekendRecommended : availableVariable;
  let verdict;
  if(amount <= reference*0.6) verdict = '🟢 Sí puedes comprarlo sin apretar el resto del período.';
  else if(amount <= availableVariable) verdict = '🟡 Puedes comprarlo, pero te va a dejar muy justo en Gasto libre para lo que resta.';
  else verdict = '🔴 No te alcanza dentro de tu presupuesto de Gasto libre actual sin sacarlo de otro lado.';
  let metaNote = '';
  if(amount > availableVariable && state.goals.length){
    metaNote = ' Si de todas formas lo compras, probablemente reduzcas lo que tenías pensado para tus metas este período.';
  }
  return `${verdict} Te quedan ${fmt(availableVariable)} disponibles en Gasto libre para ${g.daysLeft} días.${metaNote} La decisión es tuya — yo solo te muestro el impacto.`;
}

function buildAlerts(period, alloc, cp){
  const alerts = [];
  [['fijos','Obligaciones (fijos)'],['libre','Gasto libre']].forEach(([key,label])=>{
    const spent = cp.spent[key], budget = alloc[key];
    const pct = Math.round((spent/Math.max(1,budget))*100);
    const elapsed = Math.max(1, period.elapsed), total = period.totalDays;
    const proyectado = (spent/elapsed) * total;
    if(pct>=100){
      alerts.push({level:'danger', text:`🔴 Ya superaste el presupuesto de ${label} de este período (${pct}%).`});
    } else if(proyectado > budget*1.05 && elapsed>=3){
      alerts.push({level:'danger', text:`🔴 Si mantienes tu ritmo actual, probablemente superarás tu presupuesto de ${label} (proyectado ${fmt(Math.round(proyectado))} de ${fmt(budget)}).`});
    } else if(pct>=80){
      alerts.push({level:'warn', text:`🟡 Vas en ${pct}% de tu presupuesto de ${label}, quedan ${period.remaining} días.`});
    } else if(elapsed>=5 && pct <= (elapsed/total)*100*0.6){
      alerts.push({level:'ok', text:`🟢 Vas por debajo de lo previsto en ${label} este período.`});
    }
  });
  return alerts;
}

function render(){
  const app = document.getElementById('app');
  if(!state){ app.innerHTML = renderSetup(null); bindSetup(); return; }
  if(!state.loans) state.loans = []; // migración: states guardados antes de que existiera Préstamos

  const today = new Date();
  const period = computePeriod(today, state.payDay, state.payFrequency||'quincenal');
  archiveIfNeeded(period);
  saveState();

  const freq = state.payFrequency || 'quincenal';
  const titleEl = document.getElementById('mainTitle');
  if(titleEl) titleEl.textContent = freq==='mensual' ? 'Mes en curso' : 'Quincena en curso';

  app.innerHTML = `
    <div class="tabs">
      <button class="tab ${currentTab==='dashboard'?'active':''}" data-tab="dashboard">${freq==='mensual'?'Mes':'Quincena'}</button>
      <button class="tab ${currentTab==='extra'?'active':''}" data-tab="extra">Sin comprometer</button>
      <button class="tab ${currentTab==='loans'?'active':''}" data-tab="loans">💸 Préstamos</button>
      <button class="tab ${currentTab==='assistant'?'active':''}" data-tab="assistant">Asistente</button>
      <button class="tab ${currentTab==='goals'?'active':''}" data-tab="goals">Metas</button>
      <button class="tab ${currentTab==='import'?'active':''}" data-tab="import">Importar extracto</button>
      <button class="tab ${currentTab==='settings'?'active':''}" data-tab="settings">Ajustes</button>
    </div>
    <div id="tabContent"></div>
  `;
  document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click', ()=>{ currentTab=t.getAttribute('data-tab'); render(); }));

  const tc = document.getElementById('tabContent');
  if(currentTab==='dashboard'){ tc.innerHTML = renderDashboard(period); bindDashboard(); }
  else if(currentTab==='extra'){ tc.innerHTML = renderExtra(period); bindExtra(period); }
  else if(currentTab==='loans'){ tc.innerHTML = renderLoans(); bindLoans(); }
  else if(currentTab==='assistant'){ tc.innerHTML = renderAssistant(period); bindAssistant(period); }
  else if(currentTab==='goals'){ tc.innerHTML = renderGoals(); bindGoals(); }
  else if(currentTab==='import'){ tc.innerHTML = renderImport(); bindImport(); }
  else if(currentTab==='settings'){ tc.innerHTML = renderSetup({salary:state.salary, payDay:state.payDay, fijosMensual:state.fijosMensual, variablesMensual:state.variablesMensual, payFrequency:state.payFrequency||'quincenal'}); bindSetup(); }
}

function renderSetup(prefill){
  const s = prefill || {salary:950000, payDay:15, fijosMensual:710000, variablesMensual:300000, payFrequency:'quincenal'};
  const freq = s.payFrequency || 'quincenal';
  return `
    <div class="panel" id="setupPanel">
      <h2>${state ? 'Ajustar tu sistema' : 'Arma tu sistema financiero'}</h2>
      <div class="field">
        <label>¿Cómo te pagan?</label>
        <div class="freq-toggle" id="freqToggle">
          <button type="button" class="freqBtn ${freq==='quincenal'?'active':''}" data-freq="quincenal">Quincenal</button>
          <button type="button" class="freqBtn ${freq==='mensual'?'active':''}" data-freq="mensual">Mensual</button>
        </div>
      </div>
      <div class="field"><label id="salaryLabel">${freq==='mensual'?'Sueldo neto mensual':'Sueldo neto por quincena'} (ya con el descuento del fondo de empleados)</label><input type="number" id="inSalary" value="${s.salary}"></div>
      <div class="field"><label id="cutoffLabel">${freq==='mensual'?'Día del mes en que te pagan (para el conteo regresivo)':'Día de corte de la primera quincena (la segunda va hasta fin de mes)'}</label><input type="number" id="inCutoff" min="1" max="31" value="${s.payDay}"></div>
      <div class="row2">
        <div class="field"><label>Gastos fijos al mes (plan, mercado, deudas, gasolina, etc.)</label><input type="number" id="inFijos" value="${s.fijosMensual}"></div>
        <div class="field"><label>Gastos variables al mes (transporte, comida, hormiga)</label><input type="number" id="inVar" value="${s.variablesMensual}"></div>
      </div>
      <div class="bucket-detail" style="margin-bottom:10px;">No incluyas ahorro aquí — ya se descuenta solo por el fondo de empleados. Esta app solo reparte lo que te llega a la mano.</div>
      <button class="btn" id="saveSetup">Guardar</button>
      <div class="err" id="setupErr"></div>
    </div>
  `;
}
function bindSetup(){
  let selectedFreq = document.querySelector('.freqBtn.active')?.getAttribute('data-freq') || 'quincenal';
  document.querySelectorAll('.freqBtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      selectedFreq = btn.getAttribute('data-freq');
      document.querySelectorAll('.freqBtn').forEach(b=>b.classList.toggle('active', b===btn));
      document.getElementById('salaryLabel').textContent = (selectedFreq==='mensual'?'Sueldo neto mensual':'Sueldo neto por quincena')+' (ya con el descuento del fondo de empleados)';
      document.getElementById('cutoffLabel').textContent = selectedFreq==='mensual'?'Día del mes en que te pagan (para el conteo regresivo)':'Día de corte de la primera quincena (la segunda va hasta fin de mes)';
    });
  });

  document.getElementById('saveSetup').addEventListener('click', ()=>{
    const salary = Number(document.getElementById('inSalary').value);
    const cutoff = Number(document.getElementById('inCutoff').value);
    const fijosMensual = Number(document.getElementById('inFijos').value);
    const variablesMensual = Number(document.getElementById('inVar').value);
    const errEl = document.getElementById('setupErr');
    if(!salary || salary<=0){ errEl.textContent = 'Ingresa un sueldo válido.'; return; }
    const maxCutoff = selectedFreq==='mensual' ? 31 : 27;
    if(!cutoff || cutoff<1 || cutoff>maxCutoff){ errEl.textContent = `El día debe estar entre 1 y ${maxCutoff}.`; return; }
    if(fijosMensual<0 || variablesMensual<0){ errEl.textContent = 'Los montos no pueden ser negativos.'; return; }
    const wasSetUp = !!state;
    state = state || {history:[], currentPeriod:null, goals:[], loans:[]};
    if(!state.loans) state.loans = []; // migración segura para states existentes sin préstamos
    state.payFrequency = selectedFreq;
    state.salary = salary; state.payDay = cutoff;
    state.fijosMensual = fijosMensual; state.variablesMensual = variablesMensual;
    if(!wasSetUp){
      state.history = []; state.currentPeriod = null;
      const d = new Date(); d.setMonth(d.getMonth()+6);
      state.goals = [{id:'seed-emergencia', name:'Fondo de emergencia', target:800000, saved:0, date:d.toISOString().slice(0,10)}];
    }
    saveState();
    currentTab = 'dashboard';
    render();
  });
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
  const extraTotal = ingresoTotal - alloc.fijos - alloc.libre;
  const extraSpent = cp.spent.extra||0;
  const sinAsignar = extraTotal - extraSpent;

  const fijosPct = Math.round((cp.spent.fijos/Math.max(1,alloc.fijos))*100);
  const librePct = Math.round((cp.spent.libre/Math.max(1,alloc.libre))*100);

  const alertObjs = buildAlerts(period, alloc, cp);
  let alerts = alertObjs.map(a=>`<div class="alert ${a.level==='danger'?'danger':a.level==='ok'?'ok':'warn'}">${a.text}</div>`).join('');

  const catOptionsLibre = CATS.libre.map(c=>`<option value="${c}">${c}</option>`).join('');

  const movesHtml = cp.expenses.length ? cp.expenses.slice().reverse().map(e => `
    <li>
      <span>${e.note ? e.note : e.category}<span class="tag">${e.category}</span></span>
      <span style="display:flex;align-items:center;gap:8px;"><b>${fmt(e.amount)}</b><button class="del" data-id="${e.id}">✕</button></span>
    </li>
  `).join('') : '<div class="empty">Sin movimientos todavía en este período.</div>';

  const incomeHtml = (cp.incomes||[]).length ? cp.incomes.slice().reverse().map(i=>`
    <li>
      <span>${i.note || 'Ingreso extra'}</span>
      <span style="display:flex;align-items:center;gap:8px;"><b style="color:var(--blue);">+${fmt(i.amount)}</b><button class="del" data-inc-id="${i.id}">✕</button></span>
    </li>
  `).join('') : '<div class="empty">Sin ingresos extra registrados este período.</div>';

  const histHtml = state.history.length ? state.history.slice(0,6).map(h=>`
    <div style="display:flex;justify-content:space-between;font-size:13px;padding:7px 0;border-top:1px solid var(--border);">
      <span style="color:var(--muted);">${h.label}</span>
      <span>Obligaciones ${fmt(h.fijosSpent)}/${fmt(h.fijosAlloc)} · Gasto libre ${fmt(h.libreSpent)}/${fmt(h.libreAlloc)}${h.ingresoExtra?` · +${fmt(h.ingresoExtra)} extra`:''}</span>
    </div>
  `).join('') : '<div class="empty">Aún no tienes períodos anteriores registrados.</div>';

  const mt = monthTotals(new Date());
  const monthlyCard = state.payFrequency !== 'mensual' ? `
    <div class="panel">
      <h3 style="margin-top:0;">Vista mensual consolidada</h3>
      <div class="bucket-detail">Suma de las quincenas de este mes (incluye la actual): Obligaciones <b>${fmt(mt.fijos)}</b> · Gasto libre <b>${fmt(mt.libre)}</b> · Total gastado <b>${fmt(mt.total)}</b>${mt.ingresoExtra?` · Ingresos extra <b>${fmt(mt.ingresoExtra)}</b>`:''}.</div>
    </div>
  ` : '';

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
      <span>Ingreso disponible este período (sueldo${ingresoExtra?' + extra':''})</span>
      <b>${fmt(ingresoTotal)}</b>
    </div>

    ${alerts}

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

    <div class="sinasignar">
      <div class="lbl">Disponible sin comprometer</div>
      <div class="amt">${fmt(sinAsignar)}</div>
      <div class="note">De un total de ${fmt(extraTotal)}, ya llevas ${fmt(extraSpent)} registrado ahí. Ve a la pestaña <b>"Sin comprometer"</b> para anotar en qué se te va — así deja de ser una cifra abstracta.</div>
    </div>

    ${monthlyCard}

    <div class="panel">
      <h2>Registrar un gasto</h2>
      <div class="expense-form">
        <select id="expBucket">
          <option value="fijos">Obligaciones</option>
          <option value="libre" selected>Gasto libre</option>
        </select>
        <select id="expCategory">${catOptionsLibre}</select>
        <input type="number" id="expAmount" placeholder="Monto">
        <input type="text" id="expNote" placeholder="Nota (opcional)">
        <button id="addExpense">Agregar</button>
      </div>
      <div class="err" id="expErr"></div>
      <ul class="moves">${movesHtml}</ul>

      <h3>Ingresos extra (moto, etc.)</h3>
      <div class="expense-form">
        <input type="number" id="incAmount" placeholder="Monto">
        <input type="text" id="incNote" placeholder="Nota (ej: viajes en moto)">
        <button id="addIncome" style="background:var(--blue);color:#0A1A2B;">Agregar</button>
      </div>
      <div class="err" id="incErr"></div>
      <ul class="moves">${incomeHtml}</ul>
    </div>

    <div class="panel">
      <h2>Historial</h2>
      ${histHtml}
    </div>
  `;
}

function bindDashboard(){
  const bucketSel = document.getElementById('expBucket');
  const catSel = document.getElementById('expCategory');
  bucketSel.addEventListener('change', ()=>{
    const opts = bucketSel.value==='fijos'?CATS.fijos:CATS.libre;
    catSel.innerHTML = opts.map(c=>`<option value="${c}">${c}</option>`).join('');
  });

  document.getElementById('addExpense').addEventListener('click', async ()=>{
    const bucket = bucketSel.value;
    const category = catSel.value;
    const amount = Number(document.getElementById('expAmount').value);
    const note = document.getElementById('expNote').value.trim();
    const errEl = document.getElementById('expErr');
    if(!amount || amount<=0){ errEl.textContent='Ingresa un monto válido.'; return; }
    errEl.textContent='';
    const id = Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    state.currentPeriod.expenses.push({id, bucket, amount, note, category});
    state.currentPeriod.spent[bucket] += amount;
    await saveState();
    render();
  });

  document.getElementById('addIncome').addEventListener('click', async ()=>{
    const amount = Number(document.getElementById('incAmount').value);
    const note = document.getElementById('incNote').value.trim();
    const errEl = document.getElementById('incErr');
    if(!amount || amount<=0){ errEl.textContent='Ingresa un monto válido.'; return; }
    errEl.textContent='';
    const id = Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    state.currentPeriod.incomes = state.currentPeriod.incomes || [];
    state.currentPeriod.incomes.push({id, amount, note});
    await saveState();
    render();
  });

  document.querySelectorAll('.del[data-id]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-id');
      const idx = state.currentPeriod.expenses.findIndex(e=>e.id===id);
      if(idx>-1){
        const e = state.currentPeriod.expenses[idx];
        if(!confirm(`¿Eliminar el gasto de ${fmt(e.amount)} en ${e.category}?`)) return;
        state.currentPeriod.spent[e.bucket] -= e.amount;
        state.currentPeriod.expenses.splice(idx,1);
        await saveState(); render();
      }
    });
  });
  document.querySelectorAll('.del[data-inc-id]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-inc-id');
      const inc = (state.currentPeriod.incomes||[]).find(i=>i.id===id);
      if(inc && !confirm(`¿Eliminar el ingreso de ${fmt(inc.amount)}?`)) return;
      state.currentPeriod.incomes = (state.currentPeriod.incomes||[]).filter(i=>i.id!==id);
      await saveState(); render();
    });
  });
}

function renderExtra(period){
  const cp = state.currentPeriod;
  normalizePeriod(cp);
  const total = extraPoolTotal(period, cp);
  const spent = cp.spent.extra;
  const remaining = total - spent;
  const pct = Math.round((spent/Math.max(1,total))*100);

  const movesHtml = cp.extraExpenses.length ? cp.extraExpenses.slice().reverse().map(e=>`
    <li>
      <span>${e.note || 'Gasto sin comprometer'}</span>
      <span style="display:flex;align-items:center;gap:8px;"><b>${fmt(e.amount)}</b><button class="del" data-extra-id="${e.id}">✕</button></span>
    </li>
  `).join('') : '<div class="empty">Todavía no has registrado nada de esta bolsa este período.</div>';

  return `
    <div class="sinasignar" style="margin-bottom:16px;">
      <div class="lbl">Te queda sin comprometer</div>
      <div class="amt">${fmt(remaining)}</div>
      <div class="note">De un total de ${fmt(total)} para este período, llevas ${fmt(spent)} registrado aquí (${pct}%).</div>
    </div>
    <div class="panel">
      <h2>Registra en qué se te fue</h2>
      <div class="bucket-detail" style="margin-bottom:12px;">
        Esta plata no tiene presupuesto fijo — es lo que te sobra después de Obligaciones y Gasto libre. Anota
        aquí cosas puntuales, tipo "Hamburguesa con un amigo" o "Se me antojó algo", para que no se te pierda de vista.
      </div>
      <div class="expense-form">
        <input type="number" id="extraAmount" placeholder="Monto">
        <input type="text" id="extraNote" placeholder="¿En qué? (ej: hamburguesa)">
        <button id="addExtra">Agregar</button>
      </div>
      <div class="err" id="extraErr"></div>
      <ul class="moves">${movesHtml}</ul>
    </div>
  `;
}

function bindExtra(period){
  document.getElementById('addExtra').addEventListener('click', async ()=>{
    const amount = Number(document.getElementById('extraAmount').value);
    const note = document.getElementById('extraNote').value.trim();
    const errEl = document.getElementById('extraErr');
    if(!amount || amount<=0){ errEl.textContent = 'Ingresa un monto válido.'; return; }
    errEl.textContent = '';
    const cp = state.currentPeriod;
    normalizePeriod(cp);
    const id = Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    cp.extraExpenses.push({id, amount, note});
    cp.spent.extra += amount;
    await saveState();
    render();
  });
  document.querySelectorAll('.del[data-extra-id]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-extra-id');
      const cp = state.currentPeriod;
      const idx = cp.extraExpenses.findIndex(e=>e.id===id);
      if(idx>-1){
        const e = cp.extraExpenses[idx];
        if(!confirm(`¿Eliminar el registro de ${fmt(e.amount)} (${e.note||'sin nota'})?`)) return;
        cp.spent.extra -= e.amount;
        cp.extraExpenses.splice(idx,1);
        await saveState(); render();
      }
    });
  });
}

// ==================== PRÉSTAMOS: funciones auxiliares (usadas por la skill y la pestaña) ====================
function loanTotals(){
  const original = state.loans.reduce((s,l)=>s+l.original,0);
  const returned = state.loans.reduce((s,l)=>s+l.returned,0);
  const pending = state.loans.reduce((s,l)=>s+l.pending,0);
  return {original, returned, pending};
}
// Extrae un nombre propio del texto con heurísticas simples (nunca inventa: si no encuentra, devuelve null)
function extractPersonName(text){
  let m = text.match(/\ba\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]*)/);
  if(m) return m[1];
  m = text.match(/me debe\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]*)/i);
  if(m) return m[1];
  m = text.match(/^([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]*)\s+(me|ya)\b/);
  if(m) return m[1];
  return null;
}

function renderLoans(){
  const t = loanTotals();
  const rowsHtml = state.loans.length ? state.loans.slice().reverse().map(l=>`
    <div class="goal">
      <button class="del" data-loan-id="${l.id}">✕</button>
      <div class="goal-top">
        <span class="name">${escapeHtml(l.person)} <span class="tag" style="background:${l.status==='Pagado'?'var(--mint-soft)':'var(--amber-soft)'};color:${l.status==='Pagado'?'#1F7A56':'#9C6B1A'};">${l.status}</span></span>
        <span class="amt">${fmt(l.pending)} pendiente</span>
      </div>
      <div class="bar"><div class="bar-fill" style="width:${Math.min(100, Math.round((l.returned/Math.max(1,l.original))*100))}%;background:var(--mint);"></div></div>
      <div class="bucket-detail" style="margin-top:6px;">Original: ${fmt(l.original)} · Devuelto: ${fmt(l.returned)} · ${l.date}</div>
      ${l.pending>0 ? `
        <div class="goal-add">
          <input type="number" placeholder="Monto que devolvió" id="pay-${l.id}">
          <button data-loan-pay="${l.id}">Registrar pago</button>
        </div>
      ` : ''}
    </div>
  `).join('') : '<div class="empty">Todavía no tienes préstamos registrados.</div>';

  return `
    <div class="buckets" style="grid-template-columns:repeat(3,1fr);">
      <div class="bucket libre">
        <div class="bucket-label">Total prestado</div>
        <div class="bucket-amt">${fmt(t.original)}</div>
      </div>
      <div class="bucket fijos">
        <div class="bucket-label">Recuperado</div>
        <div class="bucket-amt">${fmt(t.returned)}</div>
      </div>
      <div class="bucket libre">
        <div class="bucket-label">Pendiente</div>
        <div class="bucket-amt">${fmt(t.pending)}</div>
      </div>
    </div>
    <div class="panel">
      <h2>Préstamos</h2>
      <div class="bucket-detail" style="margin-bottom:14px;">
        Un préstamo que haces NO se cuenta como gasto — es plata que sigue siendo tuya, solo que está afuera.
        También puedes decírselo al Asistente en lenguaje natural: "Le presté $20.000 a Juan", "Juan me devolvió $10.000".
      </div>
      ${rowsHtml}
    </div>
    <div class="panel">
      <h2>Registrar préstamo nuevo</h2>
      <div class="row2">
        <div class="field"><label>Persona</label><input type="text" id="loanPerson" placeholder="Nombre"></div>
        <div class="field"><label>Monto</label><input type="number" id="loanAmount" placeholder="Monto"></div>
      </div>
      <button class="btn" id="addLoan">Registrar</button>
      <div class="err" id="loanErr"></div>
    </div>
  `;
}

function bindLoans(){
  document.getElementById('addLoan').addEventListener('click', async ()=>{
    const person = document.getElementById('loanPerson').value.trim();
    const amount = Number(document.getElementById('loanAmount').value);
    const errEl = document.getElementById('loanErr');
    if(!person){ errEl.textContent = 'Dime a quién le prestaste.'; return; }
    if(!amount || amount<=0){ errEl.textContent = 'Ingresa un monto válido.'; return; }
    errEl.textContent = '';
    state.loans.push({id: Date.now().toString(36), person, original:amount, returned:0, pending:amount, date: new Date().toISOString().slice(0,10), status:'Pendiente'});
    await saveState();
    render();
  });
  document.querySelectorAll('[data-loan-pay]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-loan-pay');
      const input = document.getElementById(`pay-${id}`);
      const monto = Number(input.value);
      if(!monto || monto<=0) return;
      const l = state.loans.find(x=>x.id===id);
      if(!l) return;
      const aplicado = Math.min(monto, l.pending);
      l.returned += aplicado;
      l.pending -= aplicado;
      if(l.pending<=0){ l.pending = 0; l.status = 'Pagado'; }
      await saveState();
      render();
    });
  });
  document.querySelectorAll('.del[data-loan-id]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-loan-id');
      const l = state.loans.find(x=>x.id===id);
      if(l && !confirm(`¿Eliminar el préstamo a ${l.person} por ${fmt(l.original)}?`)) return;
      state.loans = state.loans.filter(x=>x.id!==id);
      await saveState();
      render();
    });
  });
}

let chatHistory = [];
let pendingConfirm = null; // {skill, datos} — lo que quedó esperando confirmación en el paso 4 del pipeline
let pendingClarify = null; // {skill, datos, ambiguity} — monto ambiguo esperando que el usuario apruebe o corrija la sugerencia

function buildFinanceContext(period){
  const alloc = getAllocations();
  const cp = state.currentPeriod;
  const ingresoExtra = (cp.incomes||[]).reduce((s,i)=>s+i.amount,0);
  const guidance = computeSpendingGuidance(period, new Date());
  return {
    sueldo: state.salary,
    frecuenciaPago: state.payFrequency||'quincenal',
    diaPago: state.payDay,
    presupuestoFijosMensual: state.fijosMensual,
    presupuestoVariablesMensual: state.variablesMensual,
    periodoActual: {
      rango: period.label,
      diasTotales: period.totalDays,
      diaActual: period.elapsed,
      diasRestantes: period.remaining,
      presupuestoObligaciones: alloc.fijos,
      gastadoObligaciones: cp.spent.fijos,
      presupuestoGastoLibre: alloc.libre,
      gastadoGastoLibre: cp.spent.libre,
      ingresoExtraRegistrado: ingresoExtra,
      movimientos: cp.expenses.map(e=>({categoria:e.category, monto:e.amount, nota:e.note})),
      ingresosExtra: (cp.incomes||[]).map(i=>({monto:i.amount, nota:i.note}))
    },
    recomendacionGasto: {
      disponibleEnGastoLibre: guidance.availableVariable,
      diasRestantesIncluyendoHoy: guidance.daysLeft,
      gastoDiarioRecomendado: guidance.dailyRecommended,
      diasDeFinDeSemanaRestantes: guidance.weekendDays,
      gastoRecomendadoParaElFinDeSemana: guidance.weekendRecommended
    },
    metas: state.goals.map(g=>({nombre:g.name, objetivo:g.target, ahorrado:g.saved, fecha:g.date})),
    historialPeriodosAnteriores: state.history.slice(0,6)
  };
}

function renderAssistant(period){
  const log = chatHistory.length ? chatHistory.map(m=>`
    <div class="bubble ${m.role==='user'?'user':'bot'}">${escapeHtml(m.text)}</div>
  `).join('') : `<div class="empty">Pregúntame algo, o dime un movimiento como "Gasté $25.000 en comida".</div>`;

  const g = computeSpendingGuidance(period, new Date());
  const guidanceCard = `
    <div class="sinasignar" style="margin-bottom:16px;">
      <div class="lbl">Puedes gastar en Gasto libre</div>
      <div class="amt">${fmt(g.dailyRecommended)} <span style="font-size:14px;color:var(--muted);">/ día</span></div>
      <div class="note">
        ${g.weekendDays>0
          ? `Para este fin de semana (${g.weekendDays} día${g.weekendDays>1?'s':''} que quedan): <b>${fmt(g.weekendRecommended)}</b> en total.`
          : `No quedan días de fin de semana dentro de este período a partir de hoy.`}
        Calculado con lo que te queda disponible (${fmt(g.availableVariable)}) repartido entre los ${g.daysLeft} días que faltan.
      </div>
    </div>
  `;

  const pm = pendingConfirm ? pendingConfirm.datos : null;
  const pmSkill = pendingConfirm ? pendingConfirm.skill : null;
  const avisoFechaHtml = (pm && pm.avisoFecha) ? `<div style="font-size:12px;color:var(--amber);margin-top:6px;">⏱️ Ojo: dijiste "ayer", pero este sistema no distingue fecha por movimiento — se va a contar en el período que está abierto hoy, no en el de ayer.</div>` : '';

  const confirmBar = pmSkill==='gestionar_prestamo' && pm && pm.accion==='crear' ? `
    <div class="confirm-bar">
      <div class="bucket-detail" style="margin-bottom:10px;">
        💸 ¿Quieres registrar un préstamo de <b>${fmt(pm.amount)}</b> a <b>${escapeHtml(pm.persona)}</b>?
        Esto NO se cuenta como gasto — sigue siendo tu plata, solo que está afuera.
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn" id="confirmYes">✅ Confirmar</button>
        <button class="btn" id="confirmNo" style="background:var(--surface-2);color:var(--text);box-shadow:none;">❌ Cancelar</button>
      </div>
    </div>
  ` : pmSkill==='gestionar_prestamo' && pm && pm.accion==='pago' ? `
    <div class="confirm-bar">
      <div class="bucket-detail" style="margin-bottom:10px;">
        💸 ¿Registro que <b>${escapeHtml(pm.persona)}</b> te devolvió <b>${fmt(pm.amount)}</b>?
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn" id="confirmYes">✅ Confirmar</button>
        <button class="btn" id="confirmNo" style="background:var(--surface-2);color:var(--text);box-shadow:none;">❌ Cancelar</button>
      </div>
    </div>
  ` : pmSkill==='eliminar_movimiento' && pm ? `
    <div class="confirm-bar">
      <div class="bucket-detail" style="margin-bottom:10px;">
        🔎 Encontré este movimiento — <b>${pm.tipoLabel}</b> de <b>${fmt(pm.item.amount)}</b>${pm.item.note?` ("${escapeHtml(pm.item.note)}")`:''}${pm.item.category?` en ${pm.item.category}`:''}.
        <br>¿Quieres que lo elimine?
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn" id="confirmYes" style="background:var(--rust);box-shadow:0 6px 16px rgba(240,120,92,0.35);">🗑️ Sí, eliminarlo</button>
        <button class="btn" id="confirmNo" style="background:var(--surface-2);color:var(--text);box-shadow:none;">↩️ No, dejarlo</button>
      </div>
    </div>
  ` : pm && pm.multiple ? `
    <div class="confirm-bar">
      <div class="bucket-detail" style="margin-bottom:10px;">
        Detecté <b>${pm.movimientos.length} movimientos</b> en ese mensaje:
        <ul style="margin:8px 0 0;padding-left:18px;">
          ${pm.movimientos.map(mv=>`<li>${mv.type==='gasto'?'Gasto':'Ingreso'} de <b>${fmt(mv.amount)}</b>${mv.category?` — ${mv.category}`:''}</li>`).join('')}
        </ul>
        ${avisoFechaHtml}
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn" id="confirmYes">✅ Confirmar los ${pm.movimientos.length}</button>
        <button class="btn" id="confirmNo" style="background:var(--surface-2);color:var(--text);box-shadow:none;">❌ Cancelar</button>
      </div>
    </div>
  ` : pm && pm.type==='gasto' ? `
    <div class="confirm-bar">
      <div class="bucket-detail" style="margin-bottom:10px;">
        Voy a registrar un <b>gasto</b> de ${fmt(pm.amount)} en <b>${pm.category}</b>
        (${pm.bucket==='fijos'?'Obligaciones':'Gasto libre'}).
        ${pm.uncertain?' No estoy seguro de la categoría — revísala antes de confirmar.':''}
        ${avisoFechaHtml}
      </div>
      <div class="row2" style="margin-bottom:10px;">
        <select id="confirmBucket">
          <option value="fijos" ${pm.bucket==='fijos'?'selected':''}>Obligaciones</option>
          <option value="libre" ${pm.bucket==='libre'?'selected':''}>Gasto libre</option>
        </select>
        <select id="confirmCategory">
          ${[...CATS.fijos, ...CATS.libre].map(c=>`<option value="${c}" ${pm.category===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn" id="confirmYes">✅ Confirmar</button>
        <button class="btn" id="confirmNo" style="background:var(--surface-2);color:var(--text);box-shadow:none;">❌ Cancelar</button>
      </div>
    </div>
  ` : pm && pm.type==='ingreso' ? `
    <div class="confirm-bar">
      <div class="bucket-detail" style="margin-bottom:10px;">
        Voy a registrar un <b>ingreso</b> de ${fmt(pm.amount)}${pm.note?` ("${escapeHtml(pm.note)}")`:''}.
        ${avisoFechaHtml}
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn" id="confirmYes">✅ Confirmar</button>
        <button class="btn" id="confirmNo" style="background:var(--surface-2);color:var(--text);box-shadow:none;">❌ Cancelar</button>
      </div>
    </div>
  ` : '';

  const clarifyBar = pendingClarify ? `
    <div class="confirm-bar">
      <div class="bucket-detail" style="margin-bottom:10px;">
        Dijiste "${escapeHtml(pendingClarify.datos.note)}" — ¿te refieres a <b>${fmt(pendingClarify.ambiguity.suggestedAmount)}</b>?
        Confírmame el valor antes de registrarlo, no voy a asumirlo por mi cuenta.
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn" id="clarifyYes">✅ Sí, ${fmt(pendingClarify.ambiguity.suggestedAmount)}</button>
        <button class="btn" id="clarifyNo" style="background:var(--surface-2);color:var(--text);box-shadow:none;">✏️ No, otro valor</button>
      </div>
    </div>
  ` : '';

  return `
    <div class="panel">
      <h2>Tu asistente financiero</h2>
      <div class="bucket-detail" style="margin-bottom:14px;">
        Responde con reglas y cálculos locales sobre tus datos reales — no inventa cifras y no llama a ninguna
        API externa, así que funciona igual aquí, en tu celular o en cualquier navegador. También puedes decirle
        movimientos en lenguaje natural, como <b>"Gasté $35.000 en gasolina"</b> — te va a pedir confirmar antes de guardar.
      </div>
      ${guidanceCard}
      <div class="quick">
        <button class="qbtn" data-q="¿Cómo voy?">¿Cómo voy?</button>
        <button class="qbtn" data-q="¿Cuánto puedo gastar este fin de semana?">¿Cuánto puedo gastar este finde?</button>
        <button class="qbtn" data-q="¿Cuánto llevo gastado este mes?">¿Cuánto llevo gastado este mes?</button>
        <button class="qbtn" data-q="¿En qué estoy gastando demasiado?">¿En qué gasto demasiado?</button>
        <button class="qbtn" data-q="¿Cuánto debería ahorrar?">¿Cuánto debería ahorrar?</button>
        <button class="qbtn" data-q="¿Cómo cerré la quincena?">¿Cómo cerré el último período?</button>
        <button class="qbtn" data-q="¿Qué puedes hacer?">¿Qué puedes hacer?</button>
      </div>
      <div class="chat-log" id="chatLog">${log}</div>
      ${clarifyBar}
      ${confirmBar}
      <div class="chat-input">
        <input type="text" id="chatInput" placeholder="Escribe tu pregunta o un movimiento...">
        <button id="chatSend">Enviar</button>
      </div>
    </div>

    <div class="panel">
      <h3 style="margin-top:0;">Respaldo en Google Sheets</h3>
      <div class="bucket-detail" style="margin-bottom:14px;">
        Esto sí necesita a Claude conectado con tu Google Drive, así que <b>solo funciona cuando abres esta app
        aquí dentro de Claude.ai</b> (viendo la vista previa del artifact) — en el archivo guardado en tu celular
        este botón no va a responder, porque no hay forma segura de conectar esa API desde un archivo suelto.
      </div>
      <button class="btn btn-blue" id="backupBtn">📅 Actualizar respaldo semanal en Drive</button>
      <div class="err" id="assistErr"></div>
    </div>
  `;
}

function escapeHtml(s){
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

// ==================== SKILL DE HERRAMIENTAS: el agente sabe qué puede hacer y cómo ====================
// Cada entrada del registro es una herramienta completa que el agente puede operar:
//   puedeHacer        -> descripción (para "¿qué puedes hacer?" y auto-documentación)
//   detecta(text)      -> ¿esta herramienta aplica a lo que me dijeron?
//   datosRequeridos()  -> ¿qué datos necesito para operarla? (y cuáles faltan)
//   necesitaConfirmacion() -> ¿toca preguntar antes de ejecutar? (solo si escribe datos)
//   ejecutar()         -> la usa de verdad (lee o escribe en `state`)
//   verificar()        -> ¿el resultado quedó como se esperaba?
//   responder()        -> arma el texto final para el usuario

const SKILLS = {

  // Va PRIMERO en el registro (antes de registrar_gasto) para que frases como "Juan me debe 50 mil" o
  // "Juan me devolvió $20.000" no las robe registrar_gasto por sus propios patrones de ingreso/gasto.
  // No se tocó ninguna otra skill ni runAgent para lograr esto — solo el orden de inserción.
  gestionar_prestamo: {
    puedeHacer: 'Registrar préstamos que le haces a otras personas (y sus pagos/devoluciones), y consultarte quién te debe y cuánto.',
    detecta(text){
      return /\bprest[eé]|prestad|\bpresta\b|me debe|debe.*plata|le debo|qui[eé]n me debe|me devolvi[oó]|ya me pag[oó]|ya pag[oó] todo|pendiente por recuperar|cu[aá]nto tengo prestado|cu[aá]nto he prestado/i.test(text);
    },
    // "buscar/interpretar": decido si es crear un préstamo nuevo, registrar un pago, o una consulta de lectura.
    datosRequeridos(text){
      const esConsulta = isQuestionText(text) && !/me devolvi[oó]|ya me pag[oó]|ya pag[oó] todo/i.test(text);
      if(esConsulta){
        const persona = extractPersonName(text);
        return {datos:{accion:'consulta', text, persona}, missing:[]};
      }
      const esPago = /me devolvi[oó]|ya me pag[oó]|ya pag[oó] todo|me pag[oó] todo/i.test(text);
      const persona = extractPersonName(text);

      if(esPago){
        if(!persona) return {datos:{accion:'pago'}, missing:['a quién le estás registrando el pago (el nombre)']};
        const prestamosPersona = state.loans.filter(l=>l.person.toLowerCase()===persona.toLowerCase() && l.pending>0);
        if(!prestamosPersona.length){
          return {datos:{accion:'pago', persona, encontrado:false}, missing:[]};
        }
        const esTodo = /\btodo\b/i.test(text);
        let amount = parseAmountFromText(text);
        if(esTodo && !amount) amount = prestamosPersona.reduce((s,l)=>s+l.pending,0);
        if(!amount){
          const raw = detectAmbiguousShortAmount(text);
          if(raw) return {datos:{accion:'pago', persona, encontrado:true, prestamosIds:prestamosPersona.map(l=>l.id)}, missing:[], ambiguity:{rawNumber:raw, suggestedAmount:raw*1000}};
          return {datos:{accion:'pago', persona}, missing:['cuánto te devolvió (o dime "todo")']};
        }
        return {datos:{accion:'pago', persona, amount, encontrado:true, prestamosIds:prestamosPersona.map(l=>l.id)}, missing:[]};
      }

      // Crear préstamo nuevo
      const amount = parseAmountFromText(text);
      const missing = [];
      if(!persona) missing.push('a quién le prestaste (el nombre)');
      if(!amount && missing.length===0){
        const raw = detectAmbiguousShortAmount(text);
        if(raw) return {datos:{accion:'crear', persona}, missing:[], ambiguity:{rawNumber:raw, suggestedAmount:raw*1000}};
        missing.push('el monto');
      }
      return {datos:{accion:'crear', persona, amount}, missing};
    },
    necesitaConfirmacion(datos){ return datos.accion==='crear' || (datos.accion==='pago' && datos.encontrado); },
    ejecutar(datos){
      if(datos.accion==='consulta'){
        const t = loanTotals();
        const q = (datos.text||'').toLowerCase();
        if(/qui[eé]n me debe/.test(q)){
          const deudores = state.loans.filter(l=>l.pending>0);
          if(!deudores.length) return {texto:'Nadie te debe plata en este momento — no tienes préstamos pendientes.'};
          return {texto: deudores.map(l=>`${l.person}: ${fmt(l.pending)}`).join(', ')};
        }
        if(datos.persona){
          const prestamosPersona = state.loans.filter(l=>l.person.toLowerCase()===datos.persona.toLowerCase());
          if(!prestamosPersona.length) return {texto:`No tengo ningún préstamo registrado a nombre de ${datos.persona}.`};
          const pendiente = prestamosPersona.reduce((s,l)=>s+l.pending,0);
          return {texto: pendiente>0 ? `${datos.persona} te debe ${fmt(pendiente)}.` : `${datos.persona} ya te devolvió todo lo que le prestaste.`};
        }
        if(/pendiente por recuperar/.test(q)) return {texto:`Tienes ${fmt(t.pending)} pendiente por recuperar en total.`};
        if(/tengo prestado|he prestado/.test(q)) return {texto:`Has prestado ${fmt(t.original)} en total (histórico, incluyendo lo ya devuelto).`};
        return {texto:`Prestado en total: ${fmt(t.original)} · Recuperado: ${fmt(t.returned)} · Pendiente: ${fmt(t.pending)}.`};
      }
      if(datos.accion==='crear'){
        const id = Date.now().toString(36)+Math.random().toString(36).slice(2,6);
        state.loans.push({id, person:datos.persona, original:datos.amount, returned:0, pending:datos.amount, date: new Date().toISOString().slice(0,10), status:'Pendiente'});
        return {id};
      }
      // accion === 'pago'
      if(!datos.encontrado) return {ok:false, nada:true};
      let restante = datos.amount;
      let aplicado = 0;
      datos.prestamosIds.forEach(id=>{
        const l = state.loans.find(x=>x.id===id);
        if(!l || restante<=0) return;
        const usar = Math.min(restante, l.pending);
        l.returned += usar; l.pending -= usar; restante -= usar; aplicado += usar;
        if(l.pending<=0){ l.pending = 0; l.status = 'Pagado'; }
      });
      const quedaPendiente = datos.prestamosIds.reduce((s,id)=>{ const l=state.loans.find(x=>x.id===id); return s+(l?l.pending:0); },0);
      return {aplicado, quedaPendiente};
    },
    // Verifico contra el state real — no confío en que "ejecutar" haya funcionado solo porque no tiró error.
    verificar(datos, resultado){
      if(datos.accion==='consulta') return !!resultado.texto;
      if(datos.accion==='crear'){
        const l = state.loans.find(x=>x.id===resultado.id);
        return !!l && l.pending===datos.amount && l.person===datos.persona;
      }
      // pago
      if(!datos.encontrado) return true;
      return resultado.aplicado>0;
    },
    responder(datos, resultado, ok){
      if(datos.accion==='consulta') return resultado.texto;
      if(datos.accion==='crear'){
        if(!ok) return 'Algo falló registrando el préstamo — inténtalo de nuevo.';
        return `Listo, registré un préstamo de ${fmt(datos.amount)} a ${datos.persona}.`;
      }
      // pago
      if(!datos.encontrado) return `No tengo ningún préstamo pendiente registrado a nombre de ${datos.persona}.`;
      if(!ok) return 'Algo falló registrando el pago — inténtalo de nuevo.';
      return `Listo, registré que ${datos.persona} te devolvió ${fmt(resultado.aplicado)}. ${resultado.quedaPendiente>0 ? `Todavía te debe ${fmt(resultado.quedaPendiente)}.` : 'Quedó pagado por completo.'}`;
    }
  },

  registrar_gasto: {
    puedeHacer: 'Registrar uno o varios gastos/ingresos que me cuentes en lenguaje natural, pidiendo confirmación antes de guardar.',
    detecta(text){
      const t = text.trim();
      const esDesahogo = /^(siento que|creo que|me parece que|pienso que|no s[eé] si)/i.test(t);
      const esBorrado = /borra|elimina|quita|anula/i.test(t);
      if(esBorrado || esDesahogo) return false;
      if(isQuestionText(t)) return false;
      return detectMovementType(t)!==null || detectMultipleMovements(t)!==null;
    },
    datosRequeridos(text){
      // ¿Son varios movimientos en el mismo mensaje? -> los junto y pido confirmar todos de una vez
      const multi = detectMultipleMovements(text);
      if(multi){
        return {datos:{multiple:true, movimientos:multi, note:text, avisoFecha:/\bayer\b/i.test(text)}, missing:[]};
      }
      const type = detectMovementType(text);
      const amount = parseAmountFromText(text);
      const avisoFecha = /\bayer\b/i.test(text);
      const datos = {type, amount, note:text, avisoFecha};
      if(amount){
        if(type==='gasto'){
          const guess = guessCategory(text);
          datos.bucket = guess.bucket; datos.category = guess.cat; datos.uncertain = guess.cat==='Otro libre'||guess.cat==='Otro fijo';
        }
        return {datos, missing:[]};
      }
      const raw = detectAmbiguousShortAmount(text);
      if(raw){
        return {datos, missing:[], ambiguity:{rawNumber:raw, suggestedAmount: raw*1000}};
      }
      return {datos, missing:['el monto']};
    },
    necesitaConfirmacion(){ return true; },
    ejecutar(datos){
      if(datos.multiple){
        const ids = [];
        datos.movimientos.forEach(mv=>{
          const id = Date.now().toString(36)+Math.random().toString(36).slice(2,6);
          if(mv.type==='gasto'){
            state.currentPeriod.expenses.push({id, bucket:mv.bucket, amount:mv.amount, note:mv.note, category:mv.category});
            state.currentPeriod.spent[mv.bucket] += mv.amount;
          } else {
            state.currentPeriod.incomes = state.currentPeriod.incomes || [];
            state.currentPeriod.incomes.push({id, amount:mv.amount, note:mv.note});
          }
          mv.id = id;
          ids.push(id);
        });
        return {ids};
      }
      const id = Date.now().toString(36)+Math.random().toString(36).slice(2,6);
      if(datos.type==='gasto'){
        state.currentPeriod.expenses.push({id, bucket:datos.bucket, amount:datos.amount, note:datos.note, category:datos.category});
        state.currentPeriod.spent[datos.bucket] += datos.amount;
      } else {
        state.currentPeriod.incomes = state.currentPeriod.incomes || [];
        state.currentPeriod.incomes.push({id, amount:datos.amount, note:datos.note});
      }
      return {id};
    },
    verificar(datos, resultado){
      if(datos.multiple){
        return datos.movimientos.every(mv => mv.type==='gasto'
          ? state.currentPeriod.expenses.some(e=>e.id===mv.id)
          : (state.currentPeriod.incomes||[]).some(i=>i.id===mv.id));
      }
      if(datos.type==='gasto') return state.currentPeriod.expenses.some(e=>e.id===resultado.id);
      return (state.currentPeriod.incomes||[]).some(i=>i.id===resultado.id);
    },
    responder(datos, resultado, ok){
      if(!ok) return 'Algo falló guardando el movimiento — inténtalo de nuevo.';
      if(datos.multiple){
        const detalle = datos.movimientos.map(mv => `${mv.type==='gasto'?'gasto':'ingreso'} de ${fmt(mv.amount)}${mv.type==='gasto'?` (${mv.category})`:''}`).join(' y ');
        return `Listo, registré ${datos.movimientos.length} movimientos: ${detalle}.`;
      }
      return datos.type==='gasto' ? `Listo, registré ${fmt(datos.amount)} en ${datos.category}.` : `Listo, registré un ingreso de ${fmt(datos.amount)}.`;
    }
  },

  eliminar_movimiento: {
    puedeHacer: 'Buscar tu último gasto o ingreso registrado, mostrártelo y borrarlo solo si confirmas explícitamente que sí.',
    detecta(text){ return /borra|elimina|quita|anula/i.test(text) && !/meta/i.test(text); },
    // Paso "buscar movimiento": localizo el más reciente y lo dejo listo para MOSTRAR, sin tocar nada todavía.
    datosRequeridos(text){
      const wantsIngreso = /ingreso/i.test(text);
      const cp = state.currentPeriod;
      const lista = wantsIngreso ? (cp.incomes||[]) : cp.expenses;
      const tipoLabel = wantsIngreso ? 'ingreso' : 'gasto';
      if(!lista.length){
        return {datos:{tipoLabel, encontrado:false}, missing:[]};
      }
      const item = lista[lista.length-1]; // el registrado más recientemente
      return {datos:{tipoLabel, encontrado:true, isIncome:wantsIngreso, item}, missing:[]};
    },
    // Solo pido confirmación si de verdad encontré algo que mostrar; si no hay nada, respondo directo sin preguntar.
    necesitaConfirmacion(datos){ return datos.encontrado; },
    ejecutar(datos){
      if(!datos.encontrado) return {ok:false, nada:true};
      const cp = state.currentPeriod;
      if(datos.isIncome){
        const antes = (cp.incomes||[]).length;
        cp.incomes = (cp.incomes||[]).filter(i=>i.id!==datos.item.id);
        return {ok: cp.incomes.length===antes-1, id:datos.item.id};
      }
      const idx = cp.expenses.findIndex(e=>e.id===datos.item.id);
      if(idx===-1) return {ok:false};
      cp.spent[cp.expenses[idx].bucket] -= cp.expenses[idx].amount;
      cp.expenses.splice(idx,1);
      return {ok:true, id:datos.item.id};
    },
    // Verifico contra el state real que ya no esté — no confío en que "ejecutar" haya funcionado solo porque no tiró error.
    verificar(datos, resultado){
      if(!datos.encontrado) return true;
      const cp = state.currentPeriod;
      if(datos.isIncome) return !(cp.incomes||[]).some(i=>i.id===datos.item.id);
      return !cp.expenses.some(e=>e.id===datos.item.id);
    },
    responder(datos, resultado, ok){
      if(!datos.encontrado) return `No tengo ningún ${datos.tipoLabel} registrado en este período para borrar.`;
      if(!ok) return 'Algo falló al intentar borrarlo — sigue en tus registros, no se eliminó. Intenta de nuevo.';
      return `Listo, eliminé el ${datos.tipoLabel} de ${fmt(datos.item.amount)}${datos.item.note?` ("${datos.item.note}")`:''}. Ya verifiqué que no quede en tus registros.`;
    }
  },

  gestionar_meta_crear: {
    puedeHacer: 'Crear una meta de ahorro nueva a partir de lenguaje natural (monto total + para qué), distinguiendo un objetivo total de un ritmo recurrente.',
    detecta(text){ return /crea(r)?\s+(una\s+)?meta|nueva meta|quiero ahorrar|quiero (una\s+)?meta/i.test(text); },
    datosRequeridos(text){
      const amount = parseAmountFromText(text);
      const nameMatch = text.match(/para\s+(.+?)[.!]?$/i);
      const name = nameMatch ? nameMatch[1].trim() : null;
      const esRecurrente = /cada (quincena|mes|semana)/i.test(text);
      // "Quiero ahorrar $100 mil CADA quincena" no es un objetivo total, es un ritmo — no lo confundo con el monto de la meta.
      if(esRecurrente){
        return {
          datos:{amount, name, esRecurrente},
          missing:['el monto TOTAL de la meta (lo que dijiste es cuánto apartarías por período, no el objetivo final)']
        };
      }
      const missing = [];
      if(!amount) missing.push('el monto objetivo');
      if(!name) missing.push('el nombre (dime "...para <nombre>")');
      return {datos:{amount, name}, missing};
    },
    necesitaConfirmacion(){ return false; }, // crear una meta no mueve dinero, es reversible desde la pestaña Metas
    ejecutar(datos){
      const id = Date.now().toString(36);
      state.goals.push({id, name:datos.name, target:datos.amount, saved:0, date:null});
      saveState();
      return {id};
    },
    verificar(datos, resultado){ return state.goals.some(g=>g.id===resultado.id); },
    responder(datos, resultado, ok){
      if(!ok) return 'No pude crear la meta — inténtalo de nuevo.';
      return `Listo, creé la meta "${datos.name}" con objetivo ${fmt(datos.amount)}. Si quieres ponerle fecha, ve a la pestaña "Metas".`;
    }
  },

  planificacion: {
    puedeHacer: 'Decirte cuánto puedes gastar (hoy, el finde) o cuánto deberías ahorrar, evaluar si te alcanza para algo, o simular qué pasaría si gastas cierto monto.',
    detecta(text){
      return !/sin comprometer/i.test(text) &&
        /puedo (comprar|gastar)|me alcanza|alcanza para|fin de semana|finde|cu[aá]nto (puedo gastar|deber[ií]a ahorrar)|si gast[oó]|si gastara|me queda si gasto/i.test(text);
    },
    datosRequeridos(text){ return {datos:{text}, missing:[]}; },
    necesitaConfirmacion(){ return false; },
    ejecutar(datos, period){
      const q = datos.text.toLowerCase();
      const g = computeSpendingGuidance(period, new Date());
      const amt = parseAmountFromText(datos.text);
      // Simulación: "¿cuánto me queda SI gasto $X?" -> no es evaluar una compra puntual, es proyectar el saldo
      if(amt && /si gast[oó]|si gastara/.test(q)){
        const alloc = getAllocations();
        const cp = state.currentPeriod;
        const disponible = Math.max(0, alloc.libre - cp.spent.libre);
        const simulado = disponible - amt;
        if(simulado>=0) return {texto:`Si gastas ${fmt(amt)}, te quedarían ${fmt(simulado)} en Gasto libre para el resto del período.`};
        return {texto:`Si gastas ${fmt(amt)}, te pasarías del presupuesto de Gasto libre por ${fmt(Math.abs(simulado))}.`};
      }
      // Evaluación de compra puntual: solo si de verdad mencionan comprar/alcanzar Y dieron un monto
      if(amt && /puedo comprar|me alcanza|alcanza para/.test(q)){
        return {texto: evaluatePurchase(amt, period, /fin de semana|finde/.test(q))};
      }
      if(/fin de semana|finde/.test(q)){
        if(g.weekendDays===0) return {texto:`No quedan días de fin de semana en este período a partir de hoy. Te quedan ${fmt(g.availableVariable)} en Gasto libre para ${g.daysLeft} días (~${fmt(g.dailyRecommended)}/día).`};
        return {texto:`Para este fin de semana (${g.weekendDays} día${g.weekendDays>1?'s':''}) te recomiendo un tope de ${fmt(g.weekendRecommended)} en total, es decir ${fmt(g.dailyRecommended)} por día. Sale de repartir lo que te queda en Gasto libre (${fmt(g.availableVariable)}) entre los ${g.daysLeft} días que faltan.`};
      }
      if(/cu[aá]nto deber[ií]a ahorrar|cu[aá]nto tengo que ahorrar/.test(q)) return {texto: calcularRitmoAhorro()};
      // "¿puedo comprar/gastar...?" genérico sin monto -> no es una compra puntual, es la pregunta general de cuánto tiene disponible
      return {texto:`Hoy puedes gastar hasta ${fmt(g.dailyRecommended)} en Gasto libre sin desajustar el resto del período (te quedan ${fmt(g.availableVariable)} para ${g.daysLeft} días).`};
    },
    verificar(datos, resultado){ return !!resultado.texto; },
    responder(datos, resultado, ok){ return ok ? resultado.texto : 'No pude calcular eso con los datos que tengo.'; }
  },

  consultar_finanzas: {
    puedeHacer: 'Consultarte saldo disponible, ingresos, gastos, obligaciones, gasto libre o el resumen del período.',
    detecta(text){ return !/meta/i.test(text) && /cu[aá]nto (llevo|he gastado|gast[eé]|me queda|tengo)|sin comprometer|ingreso|obligacion|gastos? libres?|resumen|balance|como voy|c[oó]mo voy|saldo|disponible|finanzas/i.test(text); },
    datosRequeridos(text){ return {datos:{text}, missing:[]}; },
    necesitaConfirmacion(){ return false; },
    ejecutar(datos, period){
      const q = datos.text.toLowerCase();
      const alloc = getAllocations();
      const cp = state.currentPeriod;
      if(/sin comprometer|plata sobrante|dinero sobrante/.test(q)){
        const total = extraPoolTotal(period, cp), spent = cp.spent.extra||0;
        return {texto:`Del dinero sin comprometer tenías ${fmt(total)} este período, ya llevas ${fmt(spent)} registrado, te quedan ${fmt(total-spent)}. Ve a la pestaña "Sin comprometer" para el detalle.`};
      }
      // ¿La pregunta menciona una categoría específica? (ej: "cuánto gasté EN COMIDA")
      const catMencionada = findMentionedCategory(q);
      if(catMencionada && /cu[aá]nto (gast[eé]|llevo|he gastado)/.test(q)){
        const totalCat = cp.expenses.filter(e=>e.category===catMencionada).reduce((s,e)=>s+e.amount,0);
        let texto = `En ${catMencionada} llevas gastado ${fmt(totalCat)} este período.`;
        if(/me queda|disponible/.test(q)){
          texto += ` En general te quedan ${fmt(Math.max(0,alloc.libre-cp.spent.libre))} disponibles en Gasto libre.`;
        }
        return {texto};
      }
      if(/mes/.test(q) && /gastad|gast[eé]|llevo|voy/.test(q)){
        const mt = monthTotals(new Date());
        return {texto:`Este mes llevas gastado ${fmt(mt.total)} en total (Obligaciones ${fmt(mt.fijos)} + Gasto libre ${fmt(mt.libre)}).`};
      }
      if(/ingreso/.test(q)){
        const ingresoExtra = (cp.incomes||[]).reduce((s,i)=>s+i.amount,0);
        return {texto:`Tu sueldo base de este período es ${fmt(state.salary)}${ingresoExtra?`, más ${fmt(ingresoExtra)} de ingresos extra registrados`:''}. Total: ${fmt(state.salary+ingresoExtra)}.`};
      }
      if(/obligacion|fijos/.test(q)) return {texto:`Obligaciones: ${fmt(cp.spent.fijos)} gastado de ${fmt(alloc.fijos)} presupuestado.`};
      if(/gastos? libres?|^libre/.test(q) && !/sin comprometer/.test(q)) return {texto:`Gasto libre: ${fmt(cp.spent.libre)} gastado de ${fmt(alloc.libre)} presupuestado, te quedan ${fmt(Math.max(0,alloc.libre-cp.spent.libre))}.`};
      const fijosPct = Math.round((cp.spent.fijos/Math.max(1,alloc.fijos))*100);
      const librePct = Math.round((cp.spent.libre/Math.max(1,alloc.libre))*100);
      return {texto:`Obligaciones: ${fmt(cp.spent.fijos)} de ${fmt(alloc.fijos)} (${fijosPct}%). Gasto libre: ${fmt(cp.spent.libre)} de ${fmt(alloc.libre)} (${librePct}%). Período: ${period.label}, día ${period.elapsed} de ${period.totalDays}.`};
    },
    verificar(datos, resultado){ return !!resultado.texto; },
    responder(datos, resultado, ok){ return ok ? resultado.texto : 'No pude calcular eso con los datos que tengo.'; }
  },

  gestionar_meta: {
    puedeHacer: 'Mostrarte el avance de tus metas y cuánto deberías ahorrar por período para cumplirlas.',
    detecta(text){ return /meta|ahorro|voy bien/i.test(text); },
    datosRequeridos(text){ return {datos:{text}, missing:[]}; },
    necesitaConfirmacion(){ return false; },
    ejecutar(datos){
      const q = datos.text.toLowerCase();
      if(/cu[aá]nto deber[ií]a ahorrar|cu[aá]nto tengo que ahorrar|ritmo/.test(q)) return {texto: calcularRitmoAhorro()};
      if(!state.goals.length) return {texto:'Todavía no tienes metas creadas. Dime algo como "crea una meta de $500.000 para vacaciones", o ve a la pestaña "Metas".'};
      const texto = state.goals.map(gl=>{
        const pct = Math.round((gl.saved/Math.max(1,gl.target))*100);
        const falta = Math.max(0, gl.target - gl.saved);
        let ritmo = '';
        if(gl.date){
          const hoy = new Date(); const meta = new Date(gl.date);
          const mesesRestantes = Math.max(1, Math.round((meta-hoy)/(1000*60*60*24*30)));
          ritmo = ` Necesitas apartar cerca de ${fmt(Math.ceil(falta/mesesRestantes))}/mes para llegar a tiempo.`;
        }
        return `"${gl.name}": llevas ${fmt(gl.saved)} de ${fmt(gl.target)} (${pct}%). Te faltan ${fmt(falta)}.${ritmo}`;
      }).join('\n');
      return {texto};
    },
    verificar(datos, resultado){ return !!resultado.texto; },
    responder(datos, resultado, ok){ return ok ? resultado.texto : 'No pude calcular tus metas.'; }
  },

  analizar_quincena: {
    puedeHacer: 'Comparar tu presupuesto contra lo gastado, detectar excesos y darte recomendaciones sobre el período.',
    detecta(text){ return /c[oó]mo cerr[eé]|[uú]ltimo per[ií]odo|per[ií]odo anterior|gastando (mucho|demasiado)|en qu[eé] estoy gastando|d[oó]nde se me va|analiza|excesos?|recomendaci/i.test(text); },
    datosRequeridos(text){ return {datos:{text}, missing:[]}; },
    necesitaConfirmacion(){ return false; },
    ejecutar(datos, period){
      const q = datos.text.toLowerCase();
      const alloc = getAllocations();
      const cp = state.currentPeriod;
      if(/c[oó]mo cerr[eé]|[uú]ltimo per[ií]odo|per[ií]odo anterior/.test(q)){
        if(!state.history.length) return {texto:'Todavía no tienes ningún período cerrado en el historial.'};
        const h = state.history[0];
        return {texto:`El período "${h.label}" cerró así: Obligaciones ${fmt(h.fijosSpent)} de ${fmt(h.fijosAlloc)}, Gasto libre ${fmt(h.libreSpent)} de ${fmt(h.libreAlloc)}${h.ingresoExtra?`, con ${fmt(h.ingresoExtra)} de ingresos extra`:''}.`};
      }
      if(/gastando demasiado|en qu[eé] estoy gastando|d[oó]nde se me va/.test(q)){
        if(!cp.expenses.length) return {texto:'Todavía no tienes gastos registrados este período para analizar.'};
        const byCat = {};
        cp.expenses.forEach(e=>{ byCat[e.category] = (byCat[e.category]||0) + e.amount; });
        const sorted = Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
        const [topCat, topAmt] = sorted[0];
        return {texto:`Tu categoría con más gasto este período es "${topCat}" con ${fmt(topAmt)}. ${sorted.length>1?`Le sigue "${sorted[1][0]}" con ${fmt(sorted[1][1])}.`:''}`};
      }
      const alertObjs = buildAlerts(period, alloc, cp);
      const fijosPct = Math.round((cp.spent.fijos/Math.max(1,alloc.fijos))*100);
      const librePct = Math.round((cp.spent.libre/Math.max(1,alloc.libre))*100);
      let texto = `Obligaciones: ${fmt(cp.spent.fijos)} de ${fmt(alloc.fijos)} (${fijosPct}%). Gasto libre: ${fmt(cp.spent.libre)} de ${fmt(alloc.libre)} (${librePct}%).`;
      texto += alertObjs.length ? '\n' + alertObjs.map(a=>a.text).join('\n') : ' Vas bien, dentro de lo presupuestado.';
      return {texto};
    },
    verificar(datos, resultado){ return !!resultado.texto; },
    responder(datos, resultado, ok){ return ok ? resultado.texto : 'No pude analizar el período.'; }
  },

  analizar_extracto: {
    puedeHacer: 'Darte un resumen de un extracto bancario que hayas cargado en la pestaña "Importar extracto", antes de confirmarlo.',
    detecta(text){ return /extracto/i.test(text); },
    datosRequeridos(text){ return {datos:{}, missing:[]}; },
    necesitaConfirmacion(){ return false; },
    ejecutar(){
      if(pendingImport && pendingImport.length){
        const total = pendingImport.reduce((s,i)=>s+i.amount,0);
        const byCat = {};
        pendingImport.forEach(i=>{ byCat[i.category] = (byCat[i.category]||0) + i.amount; });
        const top = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([c,a])=>`${c}: ${fmt(a)}`).join(', ');
        return {texto:`Tienes un extracto cargado sin confirmar: ${pendingImport.length} movimientos por ${fmt(total)} en total. Top categorías: ${top}. Ve a la pestaña "Importar extracto" para revisarlo y confirmarlo.`};
      }
      return {texto:'Para analizar un extracto, súbelo en la pestaña "Importar extracto" (acepta CSV o Excel) — ahí te clasifico los movimientos automáticamente y me pides el resumen desde aquí antes de confirmarlos.'};
    },
    verificar(datos, resultado){ return !!resultado.texto; },
    responder(datos, resultado, ok){ return resultado.texto; }
  },

  capacidades: {
    puedeHacer: 'Contarte qué herramientas tiene disponibles este asistente.',
    detecta(text){ return /qu[eé] puedes hacer|qu[eé] sabes hacer|^ayuda$|qu[eé] herramientas tienes/i.test(text.trim()); },
    datosRequeridos(){ return {datos:{}, missing:[]}; },
    necesitaConfirmacion(){ return false; },
    ejecutar(){
      const lista = Object.entries(SKILLS)
        .filter(([key])=>key!=='capacidades')
        .map(([,s])=>`• ${s.puedeHacer}`).join('\n');
      return {texto:`Esto es lo que puedo hacer:\n${lista}`};
    },
    verificar(datos, resultado){ return !!resultado.texto; },
    responder(datos, resultado, ok){ return resultado.texto; }
  }
};

// Detecta si el texto menciona una categoría concreta (con algunos alias coloquiales)
function findMentionedCategory(text){
  const low = text.toLowerCase();
  if(/\bcomida\b/.test(low)) return 'Comida fuera';
  if(/\bmercado\b/.test(low)) return 'Mercado';
  if(/\btransporte\b|\btaxi\b|\buber\b/.test(low)) return 'Transporte';
  const all = [...CATS.fijos, ...CATS.libre];
  return all.find(c => low.includes(c.toLowerCase())) || null;
}

function calcularRitmoAhorro(){
  if(!state.goals.length) return 'No tienes metas creadas todavía. Dime algo como "crea una meta de $500.000 para vacaciones" y te la armo.';
  const porPeriodo = state.payFrequency==='mensual' ? 'mes' : 'quincena';
  const lines = state.goals.filter(gl=>gl.date).map(gl=>{
    const hoy=new Date(), meta=new Date(gl.date);
    const diasRestantes = Math.max(1, Math.round((meta-hoy)/(1000*60*60*24)));
    const periodosRestantes = Math.max(1, Math.round(diasRestantes/(state.payFrequency==='mensual'?30:15)));
    const falta = Math.max(0, gl.target-gl.saved);
    return `"${gl.name}": ${fmt(Math.ceil(falta/periodosRestantes))} por ${porPeriodo} para llegar el ${gl.date}.`;
  });
  if(!lines.length) return 'Tus metas no tienen fecha objetivo, así que no puedo calcular un ritmo. Ponles fecha en la pestaña "Metas".';
  return lines.join('\n');
}

// ==================== PIPELINE DEL AGENTE ====================
// ¿Qué puedo hacer? -> ¿qué datos necesito? -> ¿qué herramienta uso? -> ¿necesito confirmación? -> ejecutar -> verificar -> responder
function runAgent(text, period){
  // 1) ¿Qué puedo hacer? — detectar qué herramienta aplica
  const skillName = Object.keys(SKILLS).find(name => SKILLS[name].detecta(text));
  if(!skillName){
    const lista = Object.values(SKILLS).map(s=>`• ${s.puedeHacer}`).join('\n');
    return {type:'text', text:`No estoy seguro de qué necesitas. Esto es lo que puedo hacer:\n${lista}`, skill:'fallback'};
  }
  const tool = SKILLS[skillName];

  // 2) ¿Qué datos necesito? — extraer y detectar si falta algo
  const {datos, missing, ambiguity} = tool.datosRequeridos(text, period);
  if(missing.length){
    return {type:'text', text:`Para eso necesito que me digas ${missing.join(' y ')}. ¿Me lo das?`, skill:skillName};
  }

  // 2.5) ¿El dato que tengo es ambiguo? — no lo asumo, lo sugiero y pido confirmación explícita
  if(ambiguity){
    return {type:'clarify', skill:skillName, datos, ambiguity};
  }

  // 3) ¿Qué herramienta debo utilizar? — ya la tenemos: `tool` (skillName)

  // 4) ¿Necesito confirmación? — si sí, no ejecuto todavía: devuelvo la propuesta
  if(tool.necesitaConfirmacion(datos)){
    return {type:'confirm', skill:skillName, datos};
  }

  // 5) Ejecutar
  const resultado = tool.ejecutar(datos, period);

  // 6) Verificar resultado
  const ok = tool.verificar(datos, resultado);

  // 7) Responder
  return {type:'text', text: tool.responder(datos, resultado, ok), skill:skillName};
}

// Resuelve una aclaración de monto ambiguo. accept=true -> arma los datos finales con el monto sugerido
// (recalculando categoría si aplica). accept=false -> no se registra nada, se pide el monto exacto.
// Función pura: no toca `state`, por eso es fácil de probar.
function resolveAmbiguousAmount(skillName, datos, ambiguity, accept){
  if(!accept){
    return {type:'text', text:'Listo, no asumí nada. Dime el monto exacto y lo registro.', skill:skillName};
  }
  const finalDatos = {...datos, amount: ambiguity.suggestedAmount};
  if(finalDatos.type==='gasto'){
    const guess = guessCategory(finalDatos.note);
    finalDatos.bucket = guess.bucket; finalDatos.category = guess.cat; finalDatos.uncertain = guess.cat==='Otro libre'||guess.cat==='Otro fijo';
  }
  return {type:'confirm', skill:skillName, datos:finalDatos};
}

// Se llama tras el clic en "Confirmar" — retoma el pipeline en el paso 5 (ejecutar) con los datos ya aprobados
function runAgentConfirmed(skillName, datos){
  const tool = SKILLS[skillName];
  const resultado = tool.ejecutar(datos);
  const ok = tool.verificar(datos, resultado);
  return {type:'text', text: tool.responder(datos, resultado, ok), skill:skillName};
}

function bindAssistant(period){
  const log = document.getElementById('chatLog');
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSend');
  const errEl = document.getElementById('assistErr');
  const backupBtn = document.getElementById('backupBtn');

  function send(text){
    if(!text || !text.trim()) return;
    input.value = '';
    chatHistory.push({role:'user', text});

    const result = runAgent(text, period);
    if(result.type==='clarify'){
      pendingClarify = {skill: result.skill, datos: result.datos, ambiguity: result.ambiguity};
      chatHistory.push({role:'assistant', text: `¿Te refieres a ${fmt(result.ambiguity.suggestedAmount)}? Confírmame el valor antes de registrarlo.`});
    } else if(result.type==='confirm'){
      pendingConfirm = {skill: result.skill, datos: result.datos};
      const d = result.datos;
      if(result.skill==='gestionar_prestamo'){
        chatHistory.push({role:'assistant', text: d.accion==='crear'
          ? `¿Quieres registrar un préstamo de ${fmt(d.amount)} a ${d.persona}? Revisa abajo.`
          : `¿Registro que ${d.persona} te devolvió ${fmt(d.amount)}? Revisa abajo.`});
      } else if(result.skill==='eliminar_movimiento'){
        chatHistory.push({role:'assistant', text: `Encontré un ${d.tipoLabel} de ${fmt(d.item.amount)}${d.item.note?` ("${d.item.note}")`:''}. ¿Lo elimino? Revisa abajo.`});
      } else if(d.multiple){
        chatHistory.push({role:'assistant', text: `Detecté ${d.movimientos.length} movimientos en ese mensaje. Revisa abajo y confirma.`});
      } else {
        chatHistory.push({role:'assistant', text: d.type==='gasto'
          ? `Voy a registrar un gasto de ${fmt(d.amount)} en ${d.category}. Revisa abajo y confirma.`
          : `Voy a registrar un ingreso de ${fmt(d.amount)}. Confirma abajo.`});
      }
    } else {
      chatHistory.push({role:'assistant', text: result.text});
    }
    render();
    setTimeout(()=>{ const l = document.getElementById('chatLog'); if(l) l.scrollTop = l.scrollHeight; }, 30);
  }

  sendBtn.addEventListener('click', ()=> send(input.value));
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') send(input.value); });
  document.querySelectorAll('.qbtn').forEach(b=>b.addEventListener('click', ()=> send(b.getAttribute('data-q'))));

  const clarifyYes = document.getElementById('clarifyYes');
  const clarifyNo = document.getElementById('clarifyNo');
  if(clarifyYes){
    clarifyYes.addEventListener('click', ()=>{
      if(!pendingClarify) return;
      const result = resolveAmbiguousAmount(pendingClarify.skill, pendingClarify.datos, pendingClarify.ambiguity, true);
      pendingClarify = null;
      // resolveAmbiguousAmount siempre devuelve type:'confirm' cuando accept=true -> pasa al paso normal de confirmación
      pendingConfirm = {skill: result.skill, datos: result.datos};
      const d = result.datos;
      chatHistory.push({role:'assistant', text: d.type==='gasto'
        ? `Listo, ${fmt(d.amount)} en ${d.category}. Revisa abajo y confirma.`
        : `Listo, ingreso de ${fmt(d.amount)}. Confirma abajo.`});
      render();
    });
  }
  if(clarifyNo){
    clarifyNo.addEventListener('click', ()=>{
      if(!pendingClarify) return;
      const result = resolveAmbiguousAmount(pendingClarify.skill, pendingClarify.datos, pendingClarify.ambiguity, false);
      pendingClarify = null;
      chatHistory.push({role:'assistant', text: result.text});
      render();
    });
  }

  const confirmYes = document.getElementById('confirmYes');
  const confirmNo = document.getElementById('confirmNo');
  if(confirmYes){
    confirmYes.addEventListener('click', async ()=>{
      if(!pendingConfirm) return;
      const datos = {...pendingConfirm.datos};
      // si el usuario ajustó bolsillo/categoría en el formulario de confirmación, se respeta su edición
      const bucketSel = document.getElementById('confirmBucket');
      const catSel = document.getElementById('confirmCategory');
      if(bucketSel) datos.bucket = bucketSel.value;
      if(catSel) datos.category = catSel.value;

      const result = runAgentConfirmed(pendingConfirm.skill, datos);
      chatHistory.push({role:'assistant', text: result.text});
      pendingConfirm = null;
      await saveState();
      render();
    });
  }
  if(confirmNo){
    confirmNo.addEventListener('click', ()=>{
      pendingConfirm = null;
      chatHistory.push({role:'assistant', text:'Listo, no registré nada.'});
      render();
    });
  }

  backupBtn.addEventListener('click', async ()=>{
    errEl.textContent = '';
    backupBtn.textContent = 'Actualizando…';
    backupBtn.disabled = true;
    try{
      const context = buildFinanceContext(period);
      const systemPrompt = `Actualiza el respaldo financiero del usuario en Google Drive: busca todos los archivos cuyo `+
        `título empiece con "Finanzas Personales", identifica el número de versión más alto que exista (ej. V1), y crea `+
        `uno nuevo llamado "💰 Finanzas Personales — V{N+1}" (el siguiente número). Toma el contenido de la versión `+
        `anterior como base, mantén el mismo formato de columnas (Fecha, Tipo, Categoría, Descripción, Valor; y las `+
        `secciones de presupuestos y metas), y agrégale estos datos actuales en JSON (COP):\n${JSON.stringify(context)}\n`+
        `No borres el archivo anterior. Responde solo con el nombre final del archivo creado.`;
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          model:'claude-sonnet-4-6', max_tokens:1000, system: systemPrompt,
          messages:[{role:'user', content:'Actualiza el respaldo ahora.'}],
          mcp_servers:[{type:'url', url:'https://drivemcp.googleapis.com/mcp/v1', name:'google-drive'}]
        })
      });
      const data = await res.json();
      const textBlocks = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text);
      chatHistory.push({role:'assistant', text: textBlocks.join('\n').trim() || 'Listo, revisa tu Drive.'});
      render();
    }catch(e){
      errEl.textContent = 'No pude conectar con Google Drive. Esto solo funciona dentro de Claude.ai.';
      backupBtn.textContent = '📅 Actualizar respaldo semanal en Drive';
      backupBtn.disabled = false;
    }
  });
}

function renderGoals(){
  const goalsHtml = state.goals.length ? state.goals.map(g=>{
    const pct = Math.min(100, Math.round((g.saved/Math.max(1,g.target))*100));
    return `
      <div class="goal">
        <button class="del" data-id="${g.id}">✕</button>
        <div class="goal-top"><span class="name">${g.name}</span><span class="amt">${fmt(g.saved)} / ${fmt(g.target)}</span></div>
        <div class="bar"><div class="bar-fill" style="width:${pct}%;background:var(--gold);"></div></div>
        ${g.date ? `<div class="bucket-detail" style="margin-top:6px;">Meta para: ${g.date}</div>` : ''}
        <div class="goal-add">
          <input type="number" placeholder="Monto del aporte" id="add-${g.id}">
          <button data-goal="${g.id}" class="registerAporte">Registrar aporte</button>
        </div>
      </div>
    `;
  }).join('') : '<div class="empty">Aún no tienes metas. Crea una abajo.</div>';

  return `
    <div class="panel">
      <h2>Tus metas</h2>
      <div class="bucket-detail" style="margin-bottom:14px;">Estas metas ya no se alimentan automáticamente del presupuesto — regístralas manualmente cuando apartes o revises plata para ellas (por ejemplo, si retiras del fondo de empleados o guardas algo del "sin asignar").</div>
      ${goalsHtml}
    </div>
    <div class="panel">
      <h2>Nueva meta</h2>
      <div class="field"><label>Nombre</label><input type="text" id="goalName" placeholder="Ej: Viaje, colchón..."></div>
      <div class="field"><label>Monto objetivo</label><input type="number" id="goalTarget"></div>
      <div class="field"><label>Fecha meta (opcional)</label><input type="date" id="goalDate"></div>
      <button class="btn btn-gold" id="addGoal">Crear meta</button>
      <div class="err" id="goalErr"></div>
    </div>
  `;
}
function bindGoals(){
  document.getElementById('addGoal').addEventListener('click', async ()=>{
    const name = document.getElementById('goalName').value.trim();
    const target = Number(document.getElementById('goalTarget').value);
    const date = document.getElementById('goalDate').value;
    const errEl = document.getElementById('goalErr');
    if(!name){ errEl.textContent='Ponle un nombre a tu meta.'; return; }
    if(!target || target<=0){ errEl.textContent='Ingresa un monto válido.'; return; }
    state.goals.push({id: Date.now().toString(36), name, target, saved:0, date});
    await saveState(); render();
  });
  document.querySelectorAll('.goal .del').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const gid = btn.getAttribute('data-id');
      const g = state.goals.find(x=>x.id===gid);
      if(g && !confirm(`¿Eliminar la meta "${g.name}"? Perderás el registro de lo aportado (${fmt(g.saved)}).`)) return;
      state.goals = state.goals.filter(g=>g.id!==gid);
      await saveState(); render();
    });
  });
  document.querySelectorAll('.registerAporte').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const gid = btn.getAttribute('data-goal');
      const input = document.getElementById(`add-${gid}`);
      const amt = Number(input.value);
      if(!amt || amt<=0) return;
      const g = state.goals.find(x=>x.id===gid);
      g.saved += amt;
      await saveState(); render();
    });
  });
}

function guessCategory(desc){
  for(const [re,bucket,cat] of CAT_RULES){ if(re.test(desc)) return {bucket,cat}; }
  return {bucket:'libre', cat:'Otro libre'};
}

function renderImport(){
  return `
    <div class="panel">
      <h2>Importar extracto bancario</h2>
      <div class="bucket-detail" style="margin-bottom:14px;">
        Sube tu extracto en Excel (.xlsx/.xls) o CSV. Detecto fecha, descripción y valor, sugiero categoría
        automáticamente, y confirmas antes de que quede registrado. No se conecta en vivo a tu banco.
      </div>
      <label class="drop" id="dropZone">📄 Arrastra tu archivo aquí o haz clic para elegirlo
        <input type="file" id="fileInput" accept=".csv,.xlsx,.xls">
      </label>
      <div class="err" id="importErr"></div>
      <div id="previewWrap"></div>
    </div>
  `;
}
function parseCSV(text){
  const lines = text.split(/\r?\n/).filter(l=>l.trim().length);
  return lines.map(l=>{
    const cells=[]; let cur='', inQ=false;
    for(let i=0;i<l.length;i++){
      const c=l[i];
      if(c==='"'){ inQ=!inQ; continue; }
      if((c===','||c===';') && !inQ){ cells.push(cur); cur=''; continue; }
      cur+=c;
    }
    cells.push(cur);
    return cells;
  });
}
function rowsFromWorkbook(wb){
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, {header:1, raw:false, defval:''});
}
function detectColumns(rows){
  let headerIdx=-1, cols={date:0,desc:1,amount:2};
  for(let i=0;i<Math.min(5,rows.length);i++){
    const row = rows[i].map(c=>String(c).toLowerCase());
    const dIdx = row.findIndex(c=>/fecha/.test(c));
    const descIdx = row.findIndex(c=>/descrip|concepto|detalle/.test(c));
    const amtIdx = row.findIndex(c=>/valor|monto|importe|débito|debito|cargo/.test(c));
    if(dIdx>-1 || descIdx>-1 || amtIdx>-1){
      headerIdx=i; cols={date:dIdx>-1?dIdx:0, desc:descIdx>-1?descIdx:1, amount:amtIdx>-1?amtIdx:2};
      break;
    }
  }
  return {headerIdx, cols};
}
function parseAmount(v){
  if(typeof v === 'number') return v;
  let s = String(v).replace(/[^0-9,.\-]/g,'');
  if(s.includes(',') && s.includes('.')){ s = s.replace(/\./g,'').replace(',', '.'); }
  else if(s.includes(',') && !s.includes('.')){ s = s.replace(',', '.'); }
  return Number(s) || 0;
}
function processRows(rows){
  const {headerIdx, cols} = detectColumns(rows);
  const dataRows = rows.slice(headerIdx>-1 ? headerIdx+1 : 0);
  const items = [];
  dataRows.forEach(r=>{
    if(!r || r.every(c=>String(c).trim()==='')) return;
    const desc = String(r[cols.desc]||'').trim();
    const amt = parseAmount(r[cols.amount]);
    if(!desc || !amt) return;
    if(amt > 0) return;
    const abs = Math.abs(amt);
    const guess = guessCategory(desc);
    items.push({id: Date.now().toString(36)+Math.random().toString(36).slice(2,6), date:String(r[cols.date]||''), desc, amount:abs, bucket:guess.bucket, category:guess.cat, include:true});
  });
  return items;
}
function renderPreview(){
  const wrap = document.getElementById('previewWrap');
  if(!pendingImport.length){ wrap.innerHTML=''; return; }
  const rowsHtml = pendingImport.map((it,idx)=>`
    <tr>
      <td><input type="checkbox" data-idx="${idx}" class="incCk" ${it.include?'checked':''}></td>
      <td>${it.date}</td><td>${it.desc}</td><td>${fmt(it.amount)}</td>
      <td><select class="bucketSel" data-idx="${idx}">
        <option value="fijos" ${it.bucket==='fijos'?'selected':''}>Fijos</option>
        <option value="libre" ${it.bucket==='libre'?'selected':''}>Variables</option>
      </select></td>
      <td><select class="catSel" data-idx="${idx}">
        ${[...CATS.fijos, ...CATS.libre].map(c=>`<option value="${c}" ${it.category===c?'selected':''}>${c}</option>`).join('')}
      </select></td>
    </tr>
  `).join('');
  wrap.innerHTML = `
    <div class="prev-wrap"><table class="prev">
      <thead><tr><th></th><th>Fecha</th><th>Descripción</th><th>Valor</th><th>Bolsillo</th><th>Categoría</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
    <button class="btn btn-gold" id="confirmImport" style="margin-top:14px;">Confirmar e importar seleccionados</button>
    <div class="ok" id="importOk"></div>
  `;
  document.querySelectorAll('.bucketSel').forEach(s=>s.addEventListener('change', e=>{ pendingImport[Number(e.target.dataset.idx)].bucket = e.target.value; }));
  document.querySelectorAll('.catSel').forEach(s=>s.addEventListener('change', e=>{ pendingImport[Number(e.target.dataset.idx)].category = e.target.value; }));
  document.querySelectorAll('.incCk').forEach(c=>c.addEventListener('change', e=>{ pendingImport[Number(e.target.dataset.idx)].include = e.target.checked; }));
  document.getElementById('confirmImport').addEventListener('click', async ()=>{
    const today = new Date();
    const period = computePeriod(today, state.payDay, state.payFrequency||'quincenal');
    archiveIfNeeded(period);
    let count=0;
    pendingImport.filter(it=>it.include).forEach(it=>{
      state.currentPeriod.expenses.push({id:it.id, bucket:it.bucket, amount:it.amount, note:it.desc, category:it.category});
      state.currentPeriod.spent[it.bucket] += it.amount;
      count++;
    });
    await saveState();
    pendingImport = [];
    document.getElementById('importOk').textContent = `${count} movimientos importados a la quincena actual.`;
    document.getElementById('previewWrap').querySelector('table')?.remove();
    document.getElementById('confirmImport').remove();
  });
}
function bindImport(){
  const dz = document.getElementById('dropZone');
  const input = document.getElementById('fileInput');
  const errEl = document.getElementById('importErr');
  dz.addEventListener('dragover', e=>{ e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', ()=> dz.classList.remove('drag'));
  dz.addEventListener('drop', e=>{ e.preventDefault(); dz.classList.remove('drag'); if(e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });
  input.addEventListener('change', e=>{ if(e.target.files.length) handleFile(e.target.files[0]); });
  function handleFile(file){
    errEl.textContent='';
    const name = file.name.toLowerCase();
    const reader = new FileReader();
    reader.onload = (e)=>{
      try{
        let rows;
        if(name.endsWith('.csv')) rows = parseCSV(e.target.result);
        else { const wb = XLSX.read(e.target.result, {type:'binary'}); rows = rowsFromWorkbook(wb); }
        pendingImport = processRows(rows);
        if(!pendingImport.length) errEl.textContent = 'No encontré movimientos de gasto claros en el archivo.';
        renderPreview();
      }catch(err){ errEl.textContent = 'No pude leer ese archivo. Prueba exportarlo como CSV o Excel desde tu banco.'; }
    };
    if(name.endsWith('.csv')) reader.readAsText(file); else reader.readAsBinaryString(file);
  }
}

(async function init(){
  await loadState();
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  render();
})();

function switchMobileTab(tabId) {
  // 1. Resaltar botón activo en la barra inferior
  const items = document.querySelectorAll('.mobile-nav-item');
  items.forEach(item => item.classList.remove('active'));

  const activeBtn = Array.from(items).find(item => 
    item.getAttribute('onclick') && item.getAttribute('onclick').includes(`'${tabId}'`)
  );
  if (activeBtn) activeBtn.classList.add('active');

  const wrapPrincipal = document.querySelector('.wrap');
  const viewPrestado = document.getElementById('view-prestado');

  // 2. Alternar entre la vista de Préstamos y la app principal
  if (tabId === 'prestado') {
    if (wrapPrincipal) wrapPrincipal.style.display = 'none';
    if (viewPrestado) viewPrestado.style.display = 'block';
  } else {
    if (wrapPrincipal) wrapPrincipal.style.display = 'block';
    if (viewPrestado) viewPrestado.style.display = 'none';

    // 3. Buscar y desplazarse hacia la sección interna correspondiente si existe
    const targetSection = document.getElementById(tabId) || document.querySelector(`.${tabId}`);
    if (targetSection) {
      targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
}

function abrirModalGastoRapido() {
  // Si ya existe una función o modal de registro de gasto en tu app, la reutiliza
  if (typeof abrirModalGasto === 'function') {
    abrirModalGasto();
  } else {
    const modal = document.getElementById('modal-gasto') || document.getElementById('modalGasto');
    if (modal) modal.style.display = 'flex';
  }
}
// ==========================================
// FASE 5: Lógica del Módulo "Prestado"
// ==========================================

let prestamos = JSON.parse(localStorage.getItem('finanzas_prestamos')) || [];

function abrirModalPrestamo() {
  document.getElementById('modal-prestamo').style.display = 'flex';
  document.getElementById('prestamo-fecha').value = new Date().toISOString().split('T')[0];
}

function cerrarModalPrestamo() {
  document.getElementById('modal-prestamo').style.display = 'none';
  document.getElementById('form-prestamo').reset();
}

function guardarPrestamo(e) {
  e.preventDefault();
  const nuevoPrestamo = {
    id: Date.now(),
    persona: document.getElementById('prestamo-persona').value.trim(),
    monto: parseFloat(document.getElementById('prestamo-monto').value),
    fecha: document.getElementById('prestamo-fecha').value,
    notas: document.getElementById('prestamo-notas').value.trim(),
    estado: 'pendiente',
    fechaPago: null
  };

  prestamos.unshift(nuevoPrestamo);
  guardarYRenderizarPrestamos();
  cerrarModalPrestamo();
}

function marcarComoPagado(id) {
  const p = prestamos.find(item => item.id === id);
  if (p) {
    p.estado = 'pagado';
    p.fechaPago = new Date().toISOString().split('T')[0];
    guardarYRenderizarPrestamos();
  }
}

function guardarYRenderizarPrestamos() {
  localStorage.setItem('finanzas_prestamos', JSON.stringify(prestamos));
  renderizarPrestamos();
}

function renderizarPrestamos() {
  const contenedor = document.getElementById('lista-prestamos');
  if (!contenedor) return;

  let totalPorCobrar = 0;
  let totalCobrado = 0;

  if (prestamos.length === 0) {
    contenedor.innerHTML = `<p style="text-align: center; color: #64748b; margin-top: 20px;">No hay préstamos registrados</p>`;
  } else {
    contenedor.innerHTML = prestamos.map(p => {
      if (p.estado === 'pendiente') totalPorCobrar += p.monto;
      else totalCobrado += p.monto;

      const esPendiente = p.estado === 'pendiente';
      return `
        <div class="prestamo-card ${p.estado}">
          <div>
            <strong style="font-size: 1rem; color: #f8fafc;">${p.persona}</strong>
            <div style="font-size: 0.85rem; color: #38bdf8; font-weight: bold; margin-top: 2px;">
              $${p.monto.toLocaleString()}
            </div>
            <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 4px;">
              Prestado: ${p.fecha} ${p.notas ? '• ' + p.notas : ''}
            </div>
            ${p.fechaPago ? `<div style="font-size: 0.75rem; color: #4ade80;">Pagado el: ${p.fechaPago}</div>` : ''}
            <span class="badge-estado ${esPendiente ? 'badge-pendiente' : 'badge-pagado'}">
              ${esPendiente ? '🟡 Pendiente' : '🟢 Pagado'}
            </span>
          </div>
          ${esPendiente ? `
            <button onclick="marcarComoPagado(${p.id})" style="background: #22c55e; color: #fff; border: none; padding: 6px 10px; border-radius: 6px; font-size: 0.8rem; cursor: pointer;">
              Marcar Pagado
            </button>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  document.getElementById('total-por-cobrar').textContent = `$${totalPorCobrar.toLocaleString()}`;
  document.getElementById('total-cobrado').textContent = `$${totalCobrado.toLocaleString()}`;
}

// Inicializar la lista al cargar
document.addEventListener('DOMContentLoaded', () => {
  renderizarPrestamos();
});