// app.js — mobile-first UI with Dexie storage
const db = new Dexie('budgetr_db');
db.version(1).stores({
  expenditures: '++id, description, amount, category, priority, date, created_at',
  settings: 'key'
});

async function getSetting(key, fallback = null){
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}
async function setSetting(key, value){
  await db.settings.put({key, value});
}

/* DOM */
const views = {
  dashboard: document.getElementById('view-dashboard'),
  expenditures: document.getElementById('view-expenditures'),
  goals: document.getElementById('view-goals')
};
const navBtns = document.querySelectorAll('.nav-btn');
const addFab = document.getElementById('addFab');
const addOverlay = document.getElementById('addOverlay');
const addForm = document.getElementById('addForm');

const totalSpentEl = document.getElementById('totalSpent');
const netIncomeEl = document.getElementById('netIncome');
const remainingEl = document.getElementById('remaining');
const categoryListEl = document.getElementById('categoryList');
const recentListEl = document.getElementById('recentList');
const expListEl = document.getElementById('expList');
const searchInput = document.getElementById('searchInput');

const goalAmount = document.getElementById('goalAmount');
const goalDate = document.getElementById('goalDate');
const calcGoalBtn = document.getElementById('calcGoal');
const goalResult = document.getElementById('goalResult');
const useAvg = document.getElementById('useAvg');

/* Navigation */
function showView(name){
  Object.values(views).forEach(v => v.classList.remove('active'));
  document.querySelector(`#view-${name}`).classList.add('active');
  navBtns.forEach(b => b.classList.toggle('active', b.dataset.view === name));
  // refresh when switching
  if(name === 'dashboard') refreshDashboard();
  if(name === 'expenditures') renderExpenditures();
}

/* Nav buttons */
navBtns.forEach(b => {
  b.addEventListener('click', () => showView(b.dataset.view));
});

/* FAB opens add overlay */
addFab.addEventListener('click', () => openAdd());

function openAdd(){
  addOverlay.classList.remove('hidden');
  addOverlay.setAttribute('aria-hidden','false');
}
document.getElementById('cancelAdd').addEventListener('click', closeAdd);
function closeAdd(){
  addForm.reset();
  addOverlay.classList.add('hidden');
  addOverlay.setAttribute('aria-hidden','true');
}

/* Add form submit */
addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const desc = document.getElementById('fDesc').value.trim();
  const amount = parseFloat(document.getElementById('fAmount').value || 0);
  const date = document.getElementById('fDate').value ? new Date(document.getElementById('fDate').value).toISOString() : new Date().toISOString();
  const category = document.getElementById('fCategory').value.trim() || 'Uncategorized';
  const priority = parseInt(document.getElementById('fPriority').value || 99);
  if(!desc || !amount) return alert('Please add description and amount');
  await db.expenditures.add({ description: desc, amount, category, priority, date, created_at: new Date().toISOString() });
  closeAdd();
  refreshDashboard();
  renderExpenditures();
});

/* Compute totals and render dashboard */
async function refreshDashboard(){
  const items = await db.expenditures.toArray();
  const total = items.reduce((s,i) => s + Number(i.amount || 0), 0);
  totalSpentEl.textContent = formatMoney(total);

  const net = parseFloat(await getSetting('netMonthly') || 0);
  netIncomeEl.textContent = formatMoney(net);

  const avgMonthly = computeAvgMonthly(items);
  const remaining = Math.max(0, net - avgMonthly);
  remainingEl.textContent = formatMoney(remaining);

  renderCategory(items);
  renderRecent(items);
}

/* category breakdown */
function renderCategory(items){
  const map = {};
  items.forEach(it => {
    const c = it.category || 'Uncategorized';
    map[c] = (map[c] || 0) + Number(it.amount || 0);
  });
  const entries = Object.entries(map).sort((a,b)=>b[1]-a[1]);
  categoryListEl.innerHTML = '';
  const total = entries.reduce((s,e)=>s+e[1],0) || 1;
  entries.forEach(([cat,amt]) => {
    const pct = Math.round((amt/total)*100);
    const row = document.createElement('div');
    row.className = 'cat-row';
    row.innerHTML = `
      <div class="cat-left">
        <div class="cat-dot" style="background:linear-gradient(90deg,#1e90ff,#3ddc84)"></div>
        <div>
          <div class="cat-name">${escapeHtml(cat)}</div>
          <div class="progress">
            <div class="progress-inner" style="width:${pct}%"></div>
          </div>
        </div>
      </div>
      <div>
        <div class="cat-amount">${formatMoney(amt)}</div>
        <div class="meta" style="font-size:12px;color:var(--muted)">${pct}%</div>
      </div>
    `;
    categoryListEl.appendChild(row);
  });
  if(entries.length===0){
    categoryListEl.innerHTML = `<div class="chip">No expenditures yet</div>`;
  }
}

/* Recent list */
function renderRecent(items){
  const sorted = items.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,6);
  recentListEl.innerHTML = '';
  sorted.forEach(it => {
    const li = document.createElement('li');
    li.className = 'recent-item';
    li.innerHTML = `
      <div class="exp-meta">
        <div class="exp-title">${escapeHtml(it.description)}</div>
        <div class="exp-sub"><span class="chip">${escapeHtml(it.category)}</span><span class="exp-date">${new Date(it.date).toLocaleDateString()}</span><span class="chip">Priority ${it.priority}</span></div>
      </div>
      <div class="amount">${formatMoney(it.amount)}</div>
    `;
    recentListEl.appendChild(li);
  });
  if(sorted.length===0){
    recentListEl.innerHTML = `<div class="chip">No recent expenses</div>`;
  }
}

/* Expenditures view rendering */
async function renderExpenditures(){
  const q = (searchInput.value || '').toLowerCase().trim();
  let items = await db.expenditures.orderBy('priority').toArray();
  if(q) items = items.filter(it => (it.description||'').toLowerCase().includes(q) || (it.category||'').toLowerCase().includes(q));
  expListEl.innerHTML = '';
  if(items.length===0){
    expListEl.innerHTML = `<div class="chip">No expenditures</div>`;
    return;
  }
  items.forEach(it => {
    const li = document.createElement('li');
    li.className = 'exp-item';
    li.innerHTML = `
      <div style="display:flex;flex-direction:column">
        <div class="exp-title">${escapeHtml(it.description)}</div>
        <div class="exp-sub"><span class="chip">${escapeHtml(it.category)}</span><span class="exp-date">${new Date(it.date).toLocaleDateString()}</span></div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
        <div class="amount">${formatMoney(it.amount)}</div>
        <div style="display:flex;gap:8px">
          <button data-id="${it.id}" class="btn small del">Delete</button>
        </div>
      </div>
    `;
    expListEl.appendChild(li);
  });

  // attach delete events
  document.querySelectorAll('.del').forEach(btn => {
    btn.onclick = async (e) => {
      const id = Number(e.currentTarget.dataset.id);
      if(confirm('Delete this entry?')) {
        await db.expenditures.delete(id);
        refreshDashboard();
        renderExpenditures();
      }
    };
  });
}

/* Search input */
searchInput?.addEventListener('input', () => renderExpenditures());

/* Utility: compute average monthly total across months represented */
function computeAvgMonthly(items){
  if(!items || items.length===0) return 0;
  const dates = items.map(i => new Date(i.date || i.created_at));
  const min = new Date(Math.min(...dates.map(d=>d.getTime())));
  const max = new Date(Math.max(...dates.map(d=>d.getTime())));
  const months = Math.abs((max.getFullYear()-min.getFullYear())*12 + (max.getMonth()-min.getMonth())) + 1;
  const total = items.reduce((s,i)=>s+Number(i.amount||0),0);
  return total / Math.max(1, months);
}

/* Formatting */
function formatMoney(n){
  return `${Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`.replace(/^/, '$');
}
function escapeHtml(s){ return (s+'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* Settings helpers — quick small settings UI (modal simplicity) */
document.getElementById('openSettings').addEventListener('click', async () => {
  const currentNet = await getSetting('netMonthly') || '';
  const currentSaved = await getSetting('currentSavings') || '';
  const email = prompt('Set your net monthly income (number):', currentNet);
  if(email !== null) {
    await setSetting('netMonthly', parseFloat(email) || 0);
  }
  const saved = prompt('Set current savings (optional):', currentSaved);
  if(saved !== null) await setSetting('currentSavings', parseFloat(saved) || 0);
  refreshDashboard();
});

/* Goals calculation */
calcGoalBtn.addEventListener('click', async () => {
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

/* initial load */
refreshDashboard();
renderExpenditures();

/* simple live UI update on DB changes */
db.expenditures.hook('creating', ()=>{ setTimeout(()=>{refreshDashboard(); renderExpenditures();}, 80); });
db.expenditures.hook('deleting', ()=>{ setTimeout(()=>{refreshDashboard(); renderExpenditures();}, 80); });
