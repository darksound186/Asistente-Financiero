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
  return ingresoTotal - alloc.fijos - alloc.libre;
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
  const titleEl = document.getElementById('mainTitle');
  if(titleEl) titleEl.textContent = freq==='mensual' ? 'Mes en curso' : 'Quincena en curso';

  app.innerHTML = `
    <div class="tabs">
      <button class="tab ${currentTab==='dashboard'?'active':''}" data-tab="dashboard">${freq==='mensual'?'Mes':'Quincena'}</button>
      <button class="tab ${currentTab==='extra'?'active':''}" data-tab="extra">Sin comprometer</button>
      <button class="tab ${currentTab==='loans'?'active':''}" data-tab="loans">🤝 Préstamos</button>
      <button class="tab ${currentTab==='assistant'?'active':''}" data-tab="assistant">🤖 Asistente</button>
      <button class="tab ${currentTab==='goals'?'active':''}" data-tab="goals">🎯 Metas</button>
      <button class="tab ${currentTab==='settings'?'active':''}" data-tab="settings">⚙️ Ajustes</button>
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
  const apiKey = getGeminiKey();

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
    const apiKey = document.getElementById('inApiKey').value.trim();
    const errEl = document.getElementById('setupErr');

    if(!salary || salary<=0){ errEl.textContent = 'Ingresa un sueldo válido.'; return; }

    if(apiKey) {
      localStorage.setItem('gemini_api_key', apiKey);
    }

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
      state.goals = [{id:'seed-1', name:'Fondo de emergencia', target:800000, saved:0}];
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

  const movesHtml = (cp.expenses && cp.expenses.length) ? cp.expenses.slice().reverse().map(e => `
    <li>
      <span>${e.note ? escapeHtml(e.note) : e.category}<span class="tag">${e.category}</span></span>
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

    <div class="panel" style="margin-bottom: 16px;">
      <h2>💰 Registrar Ingreso Extra</h2>
      <div class="expense-form">
        <input type="number" id="incAmount" placeholder="Monto extra">
        <input type="text" id="incNote" placeholder="Concepto (ej. Trabajo freelance, regalo...)">
        <button id="addIncome">Agregar Ingreso</button>
      </div>
      <div class="err" id="incErr"></div>
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

  document.getElementById('addIncome')?.addEventListener('click', ()=>{
    const amount = Number(document.getElementById('incAmount').value);
    const note = document.getElementById('incNote').value.trim();
    const errEl = document.getElementById('incErr');

    if(!amount || amount <= 0){
      if(errEl) errEl.textContent = 'Ingresa un monto válido.';
      return;
    }

    if(!state.currentPeriod.incomes) state.currentPeriod.incomes = [];
    const id = Date.now().toString(36);
    state.currentPeriod.incomes.push({ id, amount, note });

    saveState();
    render();
  });

  document.getElementById('addExpense')?.addEventListener('click', ()=>{
    const bucket = bucketSel.value;
    const category = catSel.value;
    const amount = Number(document.getElementById('expAmount').value);
    const note = document.getElementById('expNote').value.trim();
    const errEl = document.getElementById('expErr');

    if(!amount || amount<=0){ errEl.textContent='Ingresa un monto válido.'; return; }

    const id = Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    state.currentPeriod.expenses.push({id, bucket, amount, note, category});
    state.currentPeriod.spent[bucket] += amount;

    saveState();
    render();
  });

  document.querySelectorAll('.del[data-id]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-id');
      const idx = state.currentPeriod.expenses.findIndex(e=>e.id===id);
      if(idx>-1){
        state.currentPeriod.spent[state.currentPeriod.expenses[idx].bucket] -= state.currentPeriod.expenses[idx].amount;
        state.currentPeriod.expenses.splice(idx,1);
        saveState(); 
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
  document.getElementById('addExtra')?.addEventListener('click', ()=>{
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

function renderLoans(){
  const loansHtml = (state.loans && state.loans.length) ? state.loans.map(l => `
    <li>
      <span><b>${escapeHtml(l.person)}</b> - Pendiente: ${fmt(l.pending)}</span>
      <span class="tag">${l.status}</span>
    </li>
  `).join('') : '<div class="empty">No tienes préstamos registrados.</div>';

  return `
    <div class="panel">
      <h2>Préstamos</h2>
      <div class="row2">
        <div class="field"><label>Persona</label><input type="text" id="loanPerson" placeholder="Nombre"></div>
        <div class="field"><label>Monto</label><input type="number" id="loanAmount" placeholder="Monto"></div>
      </div>
      <button class="btn" id="addLoan">Registrar Préstamo</button>
      <ul class="moves" style="margin-top:16px;">${loansHtml}</ul>
    </div>
  `;
}

function bindLoans(){
  document.getElementById('addLoan')?.addEventListener('click', ()=>{
    const person = document.getElementById('loanPerson').value.trim();
    const amount = Number(document.getElementById('loanAmount').value);
    if(!person || !amount || amount<=0) return;

    state.loans.push({id: Date.now().toString(36), person, original:amount, returned:0, pending:amount, status:'Pendiente'});
    saveState();
    render();
  });
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
    .filter(l => l.pending > 0)
    .map(l => `${l.person}: debe ${fmt(l.pending)}`)
    .join(', ') || 'Ninguno';

  const ultimosGastos = (cp.expenses || [])
    .slice(-5)
    .map(e => `- ${e.category} (${e.bucket}): ${fmt(e.amount)} ${e.note ? '('+e.note+')' : ''}`)
    .join('\n') || 'Sin gastos recientes';

  return `
Eres el asistente financiero personal en la app "Control Quincenal".
Responde de forma concisa, empática, clara y muy práctica. Utiliza pesos colombianos (COP).

ESTADO FINANCIERO ACTUAL DEL USUARIO (${period.label}):
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
      <div class="chat-input">
        <input type="text" id="chatInput" placeholder="Ej: ¿Cuánto dinero me queda libre para salir?">
        <button id="chatSendBtn">Enviar</button>
      </div>
    </div>
  `;
}

function bindAssistant(period){
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSendBtn');
  const chatLog = document.getElementById('chatLog');

  if (!chatInput || !sendBtn || !chatLog) return;

  async function handleSend() {
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

      // Usando gemini-3.5-flash como el modelo principal
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
  }

  sendBtn.addEventListener('click', handleSend);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
  });
}

function renderGoals(){
  if (!state.goals) state.goals = [];

  const goalsList = state.goals.length ? state.goals.map(g => {
    const pct = Math.min(100, Math.round((g.saved / Math.max(1, g.target)) * 100));
    return `
      <div class="panel" style="margin-bottom: 12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
          <b style="font-size: 1.1rem;">🎯 ${escapeHtml(g.name)}</b>
          <button class="del" data-goal-del="${g.id}">✕</button>
        </div>
        <div style="font-size: 0.9rem; color: #666; margin-bottom: 6px;">
          Ahorrado: <b>${fmt(g.saved)}</b> de <b>${fmt(g.target)}</b> (${pct}%)
        </div>
        <div class="bar" style="margin-bottom: 12px;"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="expense-form">
          <input type="number" id="addSaved_${g.id}" placeholder="Abonar monto">
          <button data-goal-add="${g.id}">Abonar</button>
        </div>
      </div>
    `;
  }).join('') : '<div class="empty">No tienes metas de ahorro registradas.</div>';

  return `
    <div class="panel" style="margin-bottom: 16px;">
      <h2>🎯 Crear nueva meta de ahorro</h2>
      <div class="expense-form">
        <input type="text" id="goalName" placeholder="Ej: Viaje, Moto, Fondo de emergencia">
        <input type="number" id="goalTarget" placeholder="Meta ($)">
        <button id="addGoalBtn">Crear Meta</button>
      </div>
      <div class="err" id="goalErr"></div>
    </div>
    <h2>Tus Metas</h2>
    ${goalsList}
  `;
}

function bindGoals(){
  document.getElementById('addGoalBtn')?.addEventListener('click', ()=>{
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

  document.querySelectorAll('[data-goal-add]').forEach(btn => {
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-goal-add');
      const input = document.getElementById(`addSaved_${id}`);
      const amount = Number(input?.value);
      if(!amount || amount <= 0) return;

      const goal = state.goals.find(g => g.id === id);
      if(goal){
        goal.saved += amount;
        saveState();
        render();
      }
    });
  });

  document.querySelectorAll('[data-goal-del]').forEach(btn => {
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-goal-del');
      state.goals = state.goals.filter(g => g.id !== id);
      saveState();
      render();
    });
  });
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