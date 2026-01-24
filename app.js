/* app.js
   - Dexie DB (expenditures + settings)
   - Global frequency setting (month/year/biweekly/weekly)
   - Add form is inside expenditures view (shown/hidden)
*/

const db = new Dexie('budgetr_db');
db.version(1).stores({
  expenditures: '++id, description, amount, category, priority, date, created_at',
  settings: 'key'
});

// helpers for settings
async function getSetting(key, fallback = null){
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}
async function setSetting(key, value){
  await db.settings.put({key, value});
}

// DOM refs
const views = {
  dashboard: document.getElementById('view-dashboard'),
  expenditures: document.getElementById('view-expenditures'),
  goals: document.getElementById('view-goals')
};
const navBtns = document.querySelectorAll('.nav-btn');

const totalSpentEl = document.getElementById('totalSpent');
const netIncomeEl = document.getElementById('netIncome');
const remainingEl = document.getElementById('remaining');
const categoryListEl = document.getElementById('categoryList');

const expListEl = document.getElementById('expList');
const freqDashboard = document.getElementById('freqDashboard');
const freqExpend = document.getElementById('freqExpend');

const showAddBtn = document.getElementById('showAddBtn');
const addScreen = document.getElementById('addScreen');
const addForm = document.getElementById('addForm');
const cancelAdd = document.getElementById('cancelAdd');

const goalAmount = document.getElementById('goalAmount');
const goalDate = document.getElementById('goalDate');
const calcGoalBtn = document.getElementById('calcGoal');
const goalResult = document.getElementById('goalResult');
const useAvg = document.getElementById('useAvg');

const openSettingsBtn = document.getElementById('openSettings');

/* Navigation */
function showView(name){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  navBtns.forEach(b => b.classList.toggle('active', b.dataset.view === name));
  // when switching to expenditures, hide add screen and show list by default
  if(name === 'expenditures') {
    hideAddScreen();
    renderExpenditures();
  }
  if(name === 'dashboard') refreshDashboard();
}
navBtns.forEach((btn, idx) => {
  // assign view attribute for each button
  const mapping = ['dashboard','expenditures','goals'][idx];
  btn.dataset.view = mapping;
  btn.addEventListener('click', ()=> showView(mapping));
});

/* Frequency helpers + synchronization
   Frequency values: 'month' (default), 'year', 'biweekly', 'weekly'
*/
async function initFrequency(){
  const saved = await getSetting('frequency') || 'month';
  setFrequencyUI(saved);
  await setSetting('frequency', saved);
}
function setFrequencyUI(val){
  freqDashboard.value = val;
  freqExpend.value = val;
}
async function updateFrequency(val){
  await setSetting('frequency', val);
  setFrequencyUI(val);
  // refresh views that display amounts
  refreshDashboard();
  renderExpenditures();
}
freqDashboard.addEventListener('change', e => updateFrequency(e.target.value));
freqExpend.addEventListener('change', e => updateFrequency(e.target.value));

/* conversion multipliers from monthly (base) */
function multiplierFor(freq){
  switch(freq){
    case 'month': return 1;
    case 'year': return 12;
    case 'biweekly': return 12/26; // ≈0.461538, per biweekly
    case 'weekly': return 12/52;   // ≈0.230769, per week
    default: return 1;
  }
}
async function getActiveMultiplier(){
  const freq = await getSetting('frequency') || 'month';
  return multiplierFor(freq);
}
async function formatForFrequency(amount){
  const m = await getActiveMultiplier();
  return formatMoney(amount * m);
}
function formatMoney(n){
  return `$${Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}

/* Add screen toggles */
showAddBtn.addEventListener('click', ()=> {
  // show add screen instead of list
  addScreen.classList.remove('hidden');
  // scroll into view on small devices
  addScreen.scrollIntoView({behavior:'smooth', block:'center'});
});
cancelAdd.addEventListener('click', hideAddScreen);
function hideAddScreen(){
  addForm.reset();
  addScreen.classList.add('hidden');
}

/* Add form submit (adds a monthly-base amount) */
addForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const desc = document.getElementById('fDesc').value.trim();
  const amount = parseFloat(document.getElementById('fAmount').value || 0);
  const date = document.getElementById('fDate').value ? new Date(document.getElementById('fDate').value).toISOString() : new Date().toISOString();
  const category = document.getElementById('fCategory').value.trim() || 'Uncategorized';
  const priority = parseInt(document.getElementById('fPriority').value || 99);
  if(!desc || !amount) return alert('Please add description and amount');
  await db.expenditures.add({ description: desc, amount, category, priority, date, created_at: new Date().toISOString() });
  hideAddScreen();
  refreshDashboard();
  renderExpenditures();
});

/* Dashboard rendering (keeps amounts converted to selected frequency) */
async function refreshDashboard(){
  const items = await db.expenditures.toArray();
  const totalMonthly = items.reduce((s,i) => s + Number(i.amount || 0), 0);
  const freq = await getSetting('frequency') || 'month';
  const m = multiplierFor(freq);
  totalSpentEl.textContent = formatMoney(totalMonthly * m);

  const netMonthly = parseFloat(await getSetting('netMonthly') || 0);
  netIncomeEl.textContent = formatMoney(netMonthly * m);

  const avgMonthly = computeAvgMonthly(items);
  const remaining = Math.max(0, (netMonthly - avgMonthly) * m);
  remainingEl.textContent = formatMoney(remaining);

  renderCategory(items);
}

/* Category breakdown (percentages computed on monthly basis, then converted for display) */
function renderCategory(items){
  const map = {};
  items.forEach(it => {
    const c = it.category || 'Uncategorized';
    map[c] = (map[c] || 0) + Number(it.amount || 0);
  });
  const entries = Object.entries(map).sort((a,b)=>b[1]-a[1]);
  categoryListEl.innerHTML = '';
  const total = entries.reduce((s,e)=>s+e[1],0) || 1;
  getSetting('frequency').then(freq => {
    const m = multiplierFor(freq || 'month');
    entries.forEach(([cat,amt])=>{
      const pct = Math.round((amt/total)*100);
      const el = document.createElement('div');
      el.className = 'cat-row';
      el.innerHTML = `
        <div class="cat-left">
          <div class="cat-dot" style="background:linear-gradient(90deg,#1e90ff,#3ddc84)"></div>
          <div>
            <div class="cat-name">${escapeHtml(cat)}</div>
            <div class="progress"><div class="progress-inner" style="width:${pct}%"></div></div>
          </div>
        </div>
        <div>
          <div class="cat-amount">${formatMoney(amt * m)}</div>
          <div class="meta" style="font-size:12px;color:var(--muted)">${pct}%</div>
        </div>
      `;
      categoryListEl.appendChild(el);
    });
    if(entries.length===0) categoryListEl.innerHTML = `<div class="chip">No expenditures yet</div>`;
  });
}

/* Expenditures rendering into table with columns */
async function renderExpenditures(){
  let items = await db.expenditures.orderBy('priority').toArray();
  // render rows
  expListEl.innerHTML = '';
  const freq = await getSetting('frequency') || 'month';
  const m = multiplierFor(freq);
  if(items.length === 0){
    expListEl.innerHTML = `<div class="chip">No expenditures</div>`;
    return;
  }
  items.forEach(it => {
    const row = document.createElement('div');
    row.className = 'exp-row';
    row.innerHTML = `
      <div>
        <div class="exp-title">${escapeHtml(it.description)}</div>
        <div class="exp-category">${escapeHtml(it.category)}</div>
      </div>
      <div class="exp-cost">${formatMoney(it.amount * m)}</div>
      <div class="priority">${escapeHtml(String(it.priority))}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <div class="exp-cat">${escapeHtml(it.category)}</div>
        <button data-id="${it.id}" class="btn ghost small del">Delete</button>
      </div>
    `;
    expListEl.appendChild(row);
  });

  // delete buttons
  document.querySelectorAll('.del').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const id = Number(e.currentTarget.dataset.id);
      if(confirm('Delete this entry?')) {
        await db.expenditures.delete(id);
        renderExpenditures();
        refreshDashboard();
      }
    });
  });
}

/* Compute average monthly (base) */
function computeAvgMonthly(items){
  if(!items || items.length===0) return 0;
  const dates = items.map(i => new Date(i.date || i.created_at));
  const min = new Date(Math.min(...dates.map(d=>d.getTime())));
  const max = new Date(Math.max(...dates.map(d=>d.getTime())));
  const months = Math.abs((max.getFullYear()-min.getFullYear())*12 + (max.getMonth()-min.getMonth())) + 1;
  const total = items.reduce((s,i)=>s + Number(i.amount || 0), 0);
  return total / Math.max(1, months);
}

/* Goals handling moved to goals tab */
calcGoalBtn.addEventListener('click', async ()=>{
  const goal = parseFloat(goalAmount.value || 0);
  const dateStr = goalDate.value;
  if(!goal || !dateStr) return alert('Set goal amount and date');
  const until = new Date(dateStr);
  const now = new Date();
  const months = Math.max(1, Math.abs((until.getFullYear()-now.getFullYear())*12 + (until.getMonth()-now.getMonth())));
  const saved = parseFloat(await getSetting('currentSavings') || 0);
  const remaining = Math.max(0, goal - saved);
  const required = remaining / months;
  const items = await db.expenditures.toArray();
  const avgMonthly = useAvg.checked ? computeAvgMonthly(items) : 0;
  const net = parseFloat(await getSetting('netMonthly') || 0);
  const available = Math.max(0, net - avgMonthly);
  goalResult.innerHTML = `
    <div>Months: ${months}</div>
    <div>Remaining: ${formatMoney(remaining)}</div>
    <div>Required / month: ${formatMoney(required)}</div>
    <div>Estimated available / month: ${formatMoney(available)}</div>
    <div style="margin-top:8px;font-weight:700">${available >= required ? 'On track ✅' : 'Shortfall — consider trimming'}</div>
  `;
});

/* tiny settings UI (prompt based) */
openSettingsBtn.addEventListener('click', async ()=> {
  const currentNet = await getSetting('netMonthly') || '';
  const currentSaved = await getSetting('currentSavings') || '';
  const net = prompt('Set your net monthly income (number):', currentNet);
  if(net !== null) await setSetting('netMonthly', parseFloat(net) || 0);
  const saved = prompt('Set current savings (optional):', currentSaved);
  if(saved !== null) await setSetting('currentSavings', parseFloat(saved) || 0);
  refreshDashboard();
});

/* escaping helper */
function escapeHtml(s){ return (s+'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* init */
(async function init(){
  // ensure default frequency exists
  const f = await getSetting('frequency');
  if(!f) await setSetting('frequency','month');
  await initFrequency();
  refreshDashboard();
  renderExpenditures();
})();
