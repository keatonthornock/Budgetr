// expenditures.js
document.addEventListener('DOMContentLoaded', async ()=>{
  setActiveNav('navExpend');

  const freqSelect = document.getElementById('freqExpend');
  const f = await getSetting('frequency') || 'month';
  freqSelect.value = f;

  // sent to server to realtime sync added data in the table
  try {
    await addExpenditure({ description: desc, amount, category, priority, date });
  } catch(err){
    console.error('Add failed, storing locally', err);
    await db.expenditures.add({ description: desc, amount, category, priority, date, created_at: new Date().toISOString() });
  }

  // sent to server to realtime sync deletion data in the table
  try {
    await deleteExpenditure(id);
  } catch(err){
    console.error('Delete failed', err);
    await db.expenditures.delete(id);
  }
  
  // change frequency
  freqSelect.addEventListener('change', async (e)=>{
    await setFrequencyAndNotify(e.target.value);
    renderExpenditures();
  });
  // listen to changes
  window.addEventListener('frequencyChange', ()=> {
    getSetting('frequency').then(val => { freqSelect.value = val; renderExpenditures(); });
  });

  const showAddBtn = document.getElementById('showAddBtn');
  const addScreen = document.getElementById('addScreen');
  const addForm = document.getElementById('addForm');
  const cancelAdd = document.getElementById('cancelAdd');

  showAddBtn.addEventListener('click', ()=> {
    addScreen.classList.remove('hidden');
    addScreen.scrollIntoView({behavior:'smooth', block:'center'});
  });
  cancelAdd.addEventListener('click', ()=> {
    addForm.reset();
    addScreen.classList.add('hidden');
  });

  addForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const desc = document.getElementById('fDesc').value.trim();
    const amount = parseFloat(document.getElementById('fAmount').value || 0);
    const date = document.getElementById('fDate').value ? new Date(document.getElementById('fDate').value).toISOString() : new Date().toISOString();
    const category = document.getElementById('fCategory').value.trim() || 'Uncategorized';
    const priority = parseInt(document.getElementById('fPriority').value || 99);
    if(!desc || !amount) return alert('Please add description and amount');
    await db.expenditures.add({ description: desc, amount, category, priority, date, created_at: new Date().toISOString() });
    addForm.reset(); addScreen.classList.add('hidden');
    renderExpenditures();
  });

  async function renderExpenditures(){
    const items = await db.expenditures.orderBy('priority').toArray();
    const el = document.getElementById('expList');
    el.innerHTML = '';
    if(items.length === 0){ el.innerHTML = '<div class="chip">No expenditures</div>'; return; }
    const freq = await getSetting('frequency') || 'month';
    const m = multiplierFor(freq);
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
      el.appendChild(row);
    });
    // attach delete handlers
    document.querySelectorAll('.del').forEach(btn=>{
      btn.addEventListener('click', async (e)=>{
        const id = Number(e.currentTarget.dataset.id);
        if(confirm('Delete this entry?')) {
          await db.expenditures.delete(id);
          renderExpenditures();
        }
      });
    });
  }

  // update UI when DB changes
  db.expenditures.hook('creating', ()=> setTimeout(renderExpenditures, 80));
  db.expenditures.hook('deleting', ()=> setTimeout(renderExpenditures, 80));

  renderExpenditures();
});
