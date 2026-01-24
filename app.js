/* app.js
   - Uses Dexie.js for indexedDB storage
   - Handles add/edit/list of expenditures
   - Settings stored as key/value
   - Savings planner calculation
*/

const db = new Dexie('housesave_db');
db.version(1).stores({
  expenditures: '++id, desc, amount, category, priority, date',
  settings: 'key'
});

// simple settings helper
async function getSetting(key, fallback=null){
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}
async function setSetting(key, value){
  await db.settings.put({key, value});
}

const el = {
  monthlyExpenses: document.getElementById('monthlyExpenses'),
  netIncome: document.getElementById('netIncome'),
  availableMonthly: document.getElementById('availableMonthly'),
  currentSavings: document.getElementById('currentSavings'),
  categoryBreakdown: document.getElementById('categoryBreakdown'),
  entryForm: document.getElementById('entryForm'),
  list: document.getElementById('list'),
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),
  settingsModal: document.getElementById('settingsModal'),
  settingNetIncome: document.getElementById('settingNetIncome'),
  settingCurrentSavings: document.getElementById('settingCurrentSavings'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  calcGoalBtn: document.getElementById('calcGoalBtn'),
  goalAmount: document.getElementById('goalAmount'),
  goalDate: document.getElementById('goalDate'),
  useAvgMonthlyExpenses: document.getElementById('useAvgMonthlyExpenses'),
  planResult: document.getElementById('planResult')
};

async function refreshDashboard(){
  const net = parseFloat(await getSetting('netMonthly') || 0);
  const saved = parseFloat(await getSetting('currentSavings') || 0);

  const monthlyAvg = await computeAverageMonthlyExpenses();
  const available = Math.max(0, net - monthlyAvg);

  el.monthlyExpenses.textContent = formatMoney(monthlyAvg);
  el.netIncome.textContent = formatMoney(net);
  el.availableMonthly.textContent = formatMoney(available);
  el.currentSavings.textContent = formatMoney(saved);

  renderCategoryBreakdown();
  renderList();
}

function formatMoney(n){
  return `$${Number(n || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`;
}

// compute average monthly expenses across the time range of data
async function computeAverageMonthlyExpenses(){
  const items = await db.expenditures.toArray();
  if(items.length === 0) return 0;
  // find first entry and last entry months
  const dates = items.map(i => new Date(i.date || i.ts || Date.now()));
  const minDate = new Date(Math.min(...dates.map(d=>d.getTime())));
  const maxDate = new Date(Math.max(...dates.map(d=>d.getTime())));
  const months = monthsBetweenInclusive(minDate, maxDate);
  const total = items.reduce((s,i)=>s + Number(i.amount || 0), 0);
  const monthsCount = Math.max(1, months);
  return total / monthsCount;
}

function monthsBetweenInclusive(a, b){
  // approximate number of months between two dates, inclusive of both endpoints
  const ay = a.getFullYear(), am = a.getMonth();
  const by = b.getFullYear(), bm = b.getMonth();
  return Math.abs((by - ay) * 12 + (bm - am)) + 1;
}

async function renderCategoryBreakdown(){
  const items = await db.expenditures.toArray();
  const map = {};
  items.forEach(it=>{
    const cat = it.category || 'Uncategorized';
    map[cat] = (map[cat] || 0) + Number(it.amount || 0);
  });
  el.categoryBreakdown.innerHTML = '';
  Object.keys(map).sort((a,b)=>map[b]-map[a]).forEach(cat=>{
    const div = document.createElement('div');
    div.className = 'chip';
    div.textContent = `${cat} — ${formatMoney(map[cat])}`;
    el.categoryBreakdown.appendChild(div);
  });
}

async function renderList(){
  const items = await db.expenditures.orderBy('priority').then(all=>all.sort((a,b)=>a.priority - b.priority));
  el.list.innerHTML = '';
  items.slice().reverse().forEach(it=>{ // recent first visually
    const li = document.createElement('li');
    const left = document.createElement('div');
    left.innerHTML = `<strong>${it.desc}</strong><div class="meta">${it.category} · priority ${it.priority} · ${new Date(it.date || it.ts).toLocaleDateString()}</div>`;
    const right = document.createElement('div');
    right.innerHTML = `<div>${formatMoney(it.amount)}</div><div><button data-id="${it.id}" class="delBtn">Delete</button></div>`;
    li.appendChild(left); li.appendChild(right);
    el.list.appendChild(li);
  });
}

// add entry
el.entryForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const desc = document.getElementById('desc').value.trim();
  const amount = parseFloat(document.getElementById('amount').value || 0);
  const category = document.getElementById('category').value.trim() || 'Uncategorized';
  const priority = parseInt(document.getElementById('priority').value || 99);
  const date = document.getElementById('date').value ? new Date(document.getElementById('date').value).toISOString() : new Date().toISOString();
  if(!desc || !amount) return alert('Please add description and amount.');
  await db.expenditures.add({desc, amount, category, priority, date, ts: Date.now()});
  el.entryForm.reset();
  refreshDashboard();
});

// delete handler (event delegation)
el.list.addEventListener('click', async (e)=>{
  if(e.target.matches('.delBtn')){
    const id = Number(e.target.dataset.id);
    if(confirm('Delete this entry?')) {
      await db.expenditures.delete(id);
      refreshDashboard();
    }
  }
});

// export
el.exportBtn.addEventListener('click', async ()=>{
  const allEx = await db.expenditures.toArray();
  const settings = await db.settings.toArray();
  const data = {expenditures: allEx, settings};
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `housesave-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
  URL.revokeObjectURL(url);
});

// import
el.importBtn.addEventListener('click', ()=> el.importFile.click());
el.importFile.addEventListener('change', async e=>{
  const f = e.target.files[0];
  if(!f) return;
  const text = await f.text();
  try {
    const parsed = JSON.parse(text);
    if(parsed.expenditures){
      // replace strategy: clear and import
      await db.expenditures.clear();
      await db.expenditures.bulkAdd(parsed.expenditures.map(it=>{
        // ensure shape
        return {
          desc: it.desc,
          amount: Number(it.amount || 0),
          category: it.category || 'Uncategorized',
          priority: Number(it.priority || 99),
          date: it.date || it.ts || new Date().toISOString(),
          ts: it.ts || Date.now()
        };
      }));
    }
    if(parsed.settings){
      await db.settings.clear();
      for(const s of parsed.settings){
        await db.settings.put({key: s.key, value: s.value});
      }
    }
    alert('Import completed');
    refreshDashboard();
  } catch(err){
    alert('Invalid JSON');
  }
});

// Settings modal
el.openSettingsBtn.addEventListener('click', async ()=>{
  el.settingsModal.setAttribute('aria-hidden', 'false');
  el.settingNetIncome.value = await getSetting('netMonthly') || '';
  el.settingCurrentSavings.value = await getSetting('currentSavings') || '';
});
el.closeSettingsBtn.addEventListener('click', ()=> el.settingsModal.setAttribute('aria-hidden','true'));
el.saveSettingsBtn.addEventListener('click', async ()=>{
  const net = parseFloat(el.settingNetIncome.value || 0);
  const saved = parseFloat(el.settingCurrentSavings.value || 0);
  await setSetting('netMonthly', net);
  await setSetting('currentSavings', saved);
  el.settingsModal.setAttribute('aria-hidden','true');
  refreshDashboard();
});

// Planner calculations
el.calcGoalBtn.addEventListener('click', async ()=>{
  const goalAmount = parseFloat(el.goalAmount.value || 0);
  const goalDateStr = el.goalDate.value;
  if(!goalAmount || !goalDateStr) return alert('Please set a goal amount and a goal date.');
  const goalDate = new Date(goalDateStr);
  const now = new Date();
  const months = monthsBetweenInclusive(now, goalDate);
  const currentSaved = parseFloat(await getSetting('currentSavings') || 0);
  const remaining = Math.max(0, goalAmount - currentSaved);
  const requiredMonthly = remaining / Math.max(1, months);

  const useAvg = el.useAvgMonthlyExpenses.checked;
  const monthlyExpenses = useAvg ? await computeAverageMonthlyExpenses() : 0;
  const netMonthly = parseFloat(await getSetting('netMonthly') || 0);
  const available = Math.max(0, netMonthly - monthlyExpenses);

  const onTrack = available >= requiredMonthly;

  el.planResult.innerHTML = `
    <div><strong>Months until goal:</strong> ${months}</div>
    <div><strong>Remaining to save:</strong> ${formatMoney(remaining)}</div>
    <div><strong>Required per month to hit goal:</strong> ${formatMoney(requiredMonthly)}</div>
    <div><strong>Estimated available per month:</strong> ${formatMoney(available)}</div>
    <div style="margin-top:8px;"><strong>${onTrack ? 'Good — you\'re on track ✅' : 'Shortfall — consider trimming lower-priority items or increasing savings'}</strong></div>
    ${!onTrack ? `<div style="margin-top:6px">Shortfall per month: ${formatMoney(requiredMonthly - available)}</div>` : ''}
  `;
});

// initial load
refreshDashboard();
