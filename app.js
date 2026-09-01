const STORE_KEY = 'quincena-state-v3';
let state = null;
let currentTab = 'dashboard';

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

async function loadState(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(raw) state = JSON.parse(raw);
  }catch(e){ state = null; }
}

async function saveState(){
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
  return ingresoTotal - alloc.fijos - alloc.libre;
}

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

function switchMobileTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll('.mobile-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('onclick').includes(tabName));
  });
  render();
}

function abrirModalGastoRapido() {
  currentTab = 'dashboard';
  render();
  const expAmount = document.getElementById('expAmount');
  if (expAmount) expAmount.focus();
}

function render(){
  const app = document.getElementById('app');
  const loading = document.getElementById('loading');
  if(loading) loading.classList.add('hidden');
  if(app) app.classList.remove('hidden');

  if(!state){ if(app) app.innerHTML = renderSetup(null); bindSetup(); return; }
  if(!state.loans) state.loans = [];

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
      <button class="tab ${currentTab==='loans'?'active':''}" data-tab="loans">🤝 Préstamos</button>
      <button class="tab ${currentTab==='assistant'?'active':''}" data-tab="assistant">Asistente</button>
      <button class="tab ${currentTab==='goals'?'active':''}" data-tab="goals">Metas</button>
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
  else if(currentTab==='settings'){ tc.innerHTML = renderSetup({salary:state.salary, payDay:state.payDay, fijosMensual:state.fijosMensual, variablesMensual:state.variablesMensual, payFrequency:state.payFrequency||'quincenal'}); bindSetup(); }
}

function renderSetup(prefill){
  const s = prefill || {salary:950000, payDay:15, fijosMensual:710000, variablesMensual:300000, payFrequency:'quincenal'};
  const freq = s.payFrequency || 'quincenal';
  const apiKeyGuardada = getGeminiKey();
  return `
    <div class="panel" id="setupPanel">
      <h2>${state ? 'Ajustar tu sistema' : 'Arma tu sistema financiero'}</h2>
      <div class="field">
        <label>¿Cómo te pagan?</label>
        <label>Gemini API Key</label>
        <input type="password" id="inApiKey" value="${apiKeyGuardada}" placeholder="AIzaSy...">
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
    });
  });

  document.getElementById('saveSetup')?.addEventListener('click', ()=>{
    const salary = Number(document.getElementById('inSalary').value);
    const cutoff = Number(document.getElementById('inCutoff').value);
    const fijosMensual = Number(document.getElementById('inFijos').value);
    const variablesMensual = Number(document.getElementById('inVar').value);
    const errEl = document.getElementById('setupErr');  
const apiKey = document.getElementById('inApiKey').value.trim();
if (apiKey) {
  localStorage.setItem('gemini_api_key', apiKey);
}

    if(!salary || salary<=0){ errEl.textContent = 'Ingresa un sueldo válido.'; return; }

    const wasSetUp = !!state;
    state = state || {history:[], currentPeriod:null, goals:[], loans:[]};
    state.payFrequency = selectedFreq;
    state.salary = salary; 
    state.payDay = cutoff;
    state.fijosMensual = fijosMensual; 
    state.variablesMensual = variablesMensual;

    if(!wasSetUp){
      state.history = []; 
      state.currentPeriod = null;
      state.goals = [{id:'seed-1', name:'Fondo de emergencia', target:800000, saved:0, date:''}];
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

  const fijosPct = Math.round((cp.spent.fijos/Math.max(1,alloc.fijos))*100);
  const librePct = Math.round((cp.spent.libre/Math.max(1,alloc.libre))*100);

  const catOptionsLibre = CATS.libre.map(c=>`<option value="${c}">${c}</option>`).join('');

  const movesHtml = cp.expenses.length ? cp.expenses.slice().reverse().map(e => `
    <li>
      <span>${e.note ? e.note : e.category}<span class="tag">${e.category}</span></span>
      <span style="display:flex;align-items:center;gap:8px;"><b>${fmt(e.amount)}</b><button class="del" data-id="${e.id}">✕</button></span>
    </li>
  `).join('') : '<div class="empty">Sin movimientos todavía en este período.</div>';

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

  document.getElementById('addExpense')?.addEventListener('click', async ()=>{
    const bucket = bucketSel.value;
    const category = catSel.value;
    const amount = Number(document.getElementById('expAmount').value);
    const note = document.getElementById('expNote').value.trim();
    const errEl = document.getElementById('expErr');

    if(!amount || amount<=0){ errEl.textContent='Ingresa un monto válido.'; return; }

    const id = Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    state.currentPeriod.expenses.push({id, bucket, amount, note, category});
    state.currentPeriod.spent[bucket] += amount;

    await saveState();
    render();
  });

  document.querySelectorAll('.del[data-id]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-id');
      const idx = state.currentPeriod.expenses.findIndex(e=>e.id===id);
      if(idx>-1){
        state.currentPeriod.spent[state.currentPeriod.expenses[idx].bucket] -= state.currentPeriod.expenses[idx].amount;
        state.currentPeriod.expenses.splice(idx,1);
        await saveState(); 
        render();
      }
    });
  });
}

function renderExtra(period){
  const cp = state.currentPeriod;
  normalizePeriod(cp);
  const total = extraPoolTotal(period, cp);
  const spent = cp.spent.extra;
  const remaining = total - spent;

  return `
    <div class="sinasignar">
      <div class="lbl">Te queda sin comprometer</div>
      <div class="amt">${fmt(remaining)}</div>
    </div>
    <div class="panel">
      <h2>Registra un desembolso libre</h2>
      <div class="expense-form">
        <input type="number" id="extraAmount" placeholder="Monto">
        <input type="text" id="extraNote" placeholder="¿En qué?">
        <button id="addExtra">Agregar</button>
      </div>
    </div>
  `;
}

function bindExtra(period){
  document.getElementById('addExtra')?.addEventListener('click', async ()=>{
    const amount = Number(document.getElementById('extraAmount').value);
    const note = document.getElementById('extraNote').value.trim();
    if(!amount || amount<=0) return;

    const cp = state.currentPeriod;
    normalizePeriod(cp);
    const id = Date.now().toString(36);
    cp.extraExpenses.push({id, amount, note});
    cp.spent.extra += amount;

    await saveState();
    render();
  });
}

function renderLoans(){
  return `
    <div class="panel">
      <h2>Préstamos</h2>
      <div class="row2">
        <div class="field"><label>Persona</label><input type="text" id="loanPerson" placeholder="Nombre"></div>
        <div class="field"><label>Monto</label><input type="number" id="loanAmount" placeholder="Monto"></div>
      </div>
      <button class="btn" id="addLoan">Registrar Préstamo</button>
    </div>
  `;
}

function bindLoans(){
  document.getElementById('addLoan')?.addEventListener('click', async ()=>{
    const person = document.getElementById('loanPerson').value.trim();
    const amount = Number(document.getElementById('loanAmount').value);
    if(!person || !amount || amount<=0) return;

    state.loans.push({id: Date.now().toString(36), person, original:amount, returned:0, pending:amount, status:'Pendiente'});
    await saveState();
    render();
  });
}

function renderAssistant(period){
  return `
    <div class="panel">
      <h2>Tu asistente financiero</h2>
      <div class="chat-log"><div class="bubble bot">¡Hola Darik! ¿En qué te ayudo hoy con tus finanzas?</div></div>
      <div class="chat-input">
        <input type="text" placeholder="Pregúntame algo...">
        <button>Enviar</button>
      </div>
    </div>
  `;
}

function bindAssistant(period){}
const apiKey = getGeminiKey();
if (!apiKey) {
  loadingEl.textContent = 'Por favor configura tu Gemini API Key en la pestaña Ajustes.';
  return;
}

const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
  // ... resto del fetch igual ...
});

function renderGoals(){
  return `<div class="panel"><h2>Metas de Ahorro</h2><div class="empty">No tienes metas configuradas.</div></div>`;
}

function bindGoals(){}

window.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  render();
});
// Configuración de la API (Puedes usar Gemini o la API de tu preferencia)
// Obtiene la API Key guardada localmente en el navegador
function getGeminiKey() {
  return localStorage.getItem('gemini_api_key') || '';
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

  // Resumen de préstamos activos
  const prestamosActivos = (state.loans || [])
    .filter(l => l.pending > 0)
    .map(l => `${l.person}: debe ${fmt(l.pending)}`)
    .join(', ') || 'Ninguno';

  // Desglose de los últimos 5 gastos
  const ultimosGastos = (cp.expenses || [])
    .slice(-5)
    .map(e => `- ${e.category} (${e.bucket}): ${fmt(e.amount)} ${e.note ? '('+e.note+')' : ''}`)
    .join('\n') || 'Sin gastos recientes';

  return `
Eres el asistente financiero personal de Darik en su aplicación PWA "Control Quincenal".
Responde de forma concisa, empática, clara y muy práctica. Utiliza pesos colombianos (COP).

ESTADO FINANCIERO ACTUAL DE DARIK (${period.label}):
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
3. Dinero Sin Comprometer / Extra:
   - Total disponible: ${fmt(extraDisp)}

OTRO DETALLE:
- Préstamos pendientes por cobrar: ${prestamosActivos}
- Últimos gastos registrados:
${ultimosGastos}

Analiza este contexto financiero completo para responder a las preguntas del usuario y darle buenas sugerencias.
`;
}

function renderAssistant(period) {
  return `
    <div class="panel">
      <h2>Asistente Financiero IA</h2>
      <div class="sub">Analizando en tiempo real tu estado financiero del período.</div>
      <div class="chat-log" id="chatLog">
        <div class="bubble bot">¡Hola Darik! Analicé tus finanzas de esta quincena. ¿En qué te puedo ayudar hoy?</div>
      </div>
      <div class="chat-input">
        <input type="text" id="chatInput" placeholder="Ej: ¿Cuánto me queda disponible para salir el fin de semana?">
        <button id="chatSendBtn">Enviar</button>
      </div>
    </div>
  `;
}

function bindAssistant(period) {
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSendBtn');
  const chatLog = document.getElementById('chatLog');

  if (!chatInput || !sendBtn || !chatLog) return;

  async function handleSend() {
    const userText = chatInput.value.trim();
    if (!userText) return;

    // Mostrar mensaje del usuario
    chatLog.innerHTML += `<div class="bubble user">${escapeHtml(userText)}</div>`;
    chatInput.value = '';
    chatLog.scrollTop = chatLog.scrollHeight;

    // Indicador de carga
    const loadingId = 'loading-' + Date.now();
    chatLog.innerHTML += `<div class="bubble bot" id="${loadingId}">Pensando y calculando...</div>`;
    chatLog.scrollTop = chatLog.scrollHeight;

    try {
      const systemContext = buildFinancialContext(period);

      // Llamada a la API de Gemini 1.5 Flash
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: systemContext },
                { text: `Pregunta del usuario: ${userText}` }
              ]
            }
          ]
        })
      });

      const data = await response.json();
      const botReply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No pude obtener una respuesta en este momento. Intenta de nuevo.';

      const loadingEl = document.getElementById(loadingId);
      if (loadingEl) {
        loadingEl.textContent = botReply;
      }
    } catch (err) {
      console.error(err);
      const loadingEl = document.getElementById(loadingId);
      if (loadingEl) {
        loadingEl.textContent = 'Hubo un problema conectando con el servicio de IA. Revisa tu conexión o tu API Key.';
      }
    }
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  sendBtn.addEventListener('click', handleSend);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}