// dashboard.js
document.addEventListener('DOMContentLoaded', async ()=>{
  setActiveNav('navDashboard');

  // small flag to avoid double-rendering when we perform local settings updates
  let suppressSettingsEvent = false;

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

  // react when settings change (from this tab or others)
  window.addEventListener('settingsChanged', (ev) => {
    try {
      // if we're currently doing an intentional local settings update, skip this event
      if (suppressSettingsEvent) return;

      const detail = ev?.detail || {};
      const key = detail.key;
      // only re-render for keys that affect this screen
      if (['netMonthly', 'currentSavings', 'frequency'].includes(key)) {
        renderAll();
      }
    } catch(e) { console.error('settingsChanged handler error', e); }
  });

  document.getElementById('openSettings').addEventListener('click', async ()=>{
    const currentNet = (await getSetting('netMonthly'));
    const currentSaved = (await getSetting('currentSavings'));
    
    // suppress the cross-tab handler while we update locally in this flow
    suppressSettingsEvent = true;
    try {
      const netRaw = prompt('Set your net monthly income (number):', currentNet != null ? String(currentNet) : '');
      if (netRaw !== null) {
        const parsed = parseFloat(netRaw.replace(/[^\d.\-]/g, ''));
        if (!Number.isNaN(parsed)) {
          await setSetting('netMonthly', parsed);
        } else {
          // user submitted an invalid number — keep previous value
          alert('Net income not saved: invalid number.');
        }
      }
      
      const savedRaw = prompt('Set current savings (optional):', currentSaved != null ? String(currentSaved) : '');
      if (savedRaw !== null) {
        const parsedSaved = parseFloat(savedRaw.replace(/[^\d.\-]/g, ''));
        if (!Number.isNaN(parsedSaved)) {
          await setSetting('currentSavings', parsedSaved);
        } else if (savedRaw.trim() === '') {
          // allow empty -> 0
          await setSetting('currentSavings', 0);
        } else {
          alert('Current savings not saved: invalid number.');
        }
      }
    } finally {
      // re-enable settings event handling and perform a single UI refresh
      suppressSettingsEvent = false;
      renderAll();
    }
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
