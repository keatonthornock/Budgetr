// dashboard.js
document.addEventListener('DOMContentLoaded', async ()=>{
  setActiveNav('navDashboard');

  const freqSelect = document.getElementById('freqDashboard');
  // initialize value from DB
  const f = await getSetting('frequency') || 'month';
  freqSelect.value = f;

  // when user changes, update DB and notify
  freqSelect.addEventListener('change', async (e)=>{
    await setFrequencyAndNotify(e.target.value);
  });

  // react when other pages/tabs change frequency
  window.addEventListener('frequencyChange', () => {
    getSetting('frequency').then(val => { freqSelect.value = val; renderAll(); });
  });

  document.getElementById('openSettings').addEventListener('click', async ()=>{
    const currentNet = await getSetting('netMonthly') || '';
    const currentSaved = await getSetting('currentSavings') || '';
    const net = prompt('Set your net monthly income (number):', currentNet);
    if(net !== null) await setSetting('netMonthly', parseFloat(net) || 0);
    const saved = prompt('Set current savings (optional):', currentSaved);
    if(saved !== null) await setSetting('currentSavings', parseFloat(saved) || 0);
    renderAll();
  });

  async function renderAll(){
    const items = await db.expenditures.toArray();
    renderTotals(items);
    renderCategory(items);
  }

  function computeAvgMonthly(items){
    if(!items || items.length===0) return 0;
    const dates = items.map(i => new Date(i.date || i.created_at));
    const min = new Date(Math.min(...dates.map(d=>d.getTime())));
    const max = new Date(Math.max(...dates.map(d=>d.getTime())));
    const months = Math.abs((max.getFullYear()-min.getFullYear())*12 + (max.getMonth()-min.getMonth())) + 1;
    const total = items.reduce((s,i)=>s + Number(i.amount || 0), 0);
    return total / Math.max(1, months);
  }

  async function renderTotals(items){
    const freq = await getSetting('frequency') || 'month';
    const m = multiplierFor(freq);
    const totalMonthly = items.reduce((s,i)=>s + Number(i.amount||0), 0);
    document.getElementById('totalSpent').textContent = formatMoney(totalMonthly * m);

    const netMonthly = parseFloat(await getSetting('netMonthly') || 0);
    document.getElementById('netIncome').textContent = formatMoney(netMonthly * m);

    const avgMonthly = computeAvgMonthly(items);
    document.getElementById('remaining').textContent = formatMoney(Math.max(0, (netMonthly - avgMonthly) * m));
  }

  function renderCategory(items){
    const map = {};
    items.forEach(it => {
      const c = it.category || 'Uncategorized';
      map[c] = (map[c] || 0) + Number(it.amount || 0);
    });
    const entries = Object.entries(map).sort((a,b)=>b[1]-a[1]);
    const el = document.getElementById('categoryList');
    el.innerHTML = '';
    if(entries.length === 0){ el.innerHTML = '<div class="chip">No expenditures yet</div>'; return; }
    getSetting('frequency').then(freq=>{
      const m = multiplierFor(freq || 'month');
      const total = entries.reduce((s,e)=>s+e[1],0) || 1;
      entries.forEach(([cat,amt])=>{
        const pct = Math.round((amt/total)*100);
        const row = document.createElement('div');
        row.className = 'cat-row';
        row.innerHTML = `
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
        el.appendChild(row);
      });
    });
  }

  // initial render
  renderAll();
});
