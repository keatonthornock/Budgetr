// expenditures.js — robust version
document.addEventListener('DOMContentLoaded', async () => {
  try {
    if (typeof setActiveNav === 'function') setActiveNav('navExpend');

    // Elements
    const showAddBtn = document.getElementById('showAddBtn');
    const addScreen = document.getElementById('addScreen');
    const addForm = document.getElementById('addForm');
    const cancelAdd = document.getElementById('cancelAdd');

    // Basic sanity
    if (!showAddBtn || !addScreen || !addForm || !cancelAdd) {
      console.error('Missing required elements:', {
        showAddBtn: !!showAddBtn,
        addScreen: !!addScreen,
        addForm: !!addForm,
        cancelAdd: !!cancelAdd
      });
      return;
    }

    // Show/hide add screen
    showAddBtn.addEventListener('click', () => {
      console.log('Add button clicked');
      addScreen.classList.remove('hidden');
      // If the card is modal-like, scrollIntoView is optional
      try { addScreen.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e){/* ignore */ }
    });
    cancelAdd.addEventListener('click', () => {
      addForm.reset();
      addScreen.classList.add('hidden');
    });

    // Frequency init + listeners (unchanged)
    const freqSelect = document.getElementById('freqExpend');
    const f = await getSetting('frequency') || 'month';
    if (freqSelect) freqSelect.value = f;
    freqSelect.addEventListener('change', async (e) => {
      await setFrequencyAndNotify(e.target.value);
      renderExpenditures();
    });
    window.addEventListener('frequencyChange', () => {
      getSetting('frequency').then(val => { if (freqSelect) freqSelect.value = val; renderExpenditures(); });
    });

    // SUBMIT handler — robust, prevents reload, tolerant parsing
    addForm.addEventListener('submit', async (e) => {
      // Prevent default immediately
      e.preventDefault();
      e.stopPropagation?.();

      console.log('Submit handler fired');

      // e.submitter gives the clicked button (supported in modern browsers)
      const saveBtn = (e && e.submitter) || addForm.querySelector('button[type="submit"]');

      // Read + normalize inputs
      const desc = (document.getElementById('fDesc')?.value || '').trim();
      const amountRaw = (document.getElementById('fAmount')?.value || '').trim();
      // Normalize: accept commas or dots; strip currency / spaces
      const amountNormalized = amountRaw.replace(/\s/g, '').replace(/[$€£]/g, '').replace(/,/g, '.').replace(/[^0-9.\-]/g,'');
      const amount = parseFloat(amountNormalized);
      const category = (document.getElementById('fCategory')?.value || '').trim() || 'Uncategorized';
      const priority = parseInt(document.getElementById('fPriority')?.value || 99, 10);

      // Validation
      if (!desc) { alert('Please add a description.'); return; }
      if (Number.isNaN(amount) || amount <= 0) { alert('Please enter a valid amount greater than 0.'); return; }

      // Prepare payload (no date field supplied by user)
      const payload = {
        description: desc,
        amount: amount,
        category,
        priority,
        date: new Date().toISOString(),
        created_at: new Date().toISOString()
      };

      // UI feedback: disable Save
      if (saveBtn) {
        saveBtn.disabled = true;
        const prevText = saveBtn.textContent;
        saveBtn.textContent = 'Saving...';

        try {
          await addExpenditure(payload); // wrapper in common.js: server then fallback
          console.log('Expense saved (attempted server + fallback).', payload);
        } catch (err) {
          console.error('Add failed (caught in submit):', err);
          alert('Save failed (see console). Falling back to local storage.');
        } finally {
          // restore button state
          saveBtn.disabled = false;
          saveBtn.textContent = prevText || 'Save';
        }
      } else {
        // If no saveBtn found, still attempt to save
        try {
          await addExpenditure(payload);
        } catch (err) {
          console.error('Add failed (no saveBtn):', err);
          alert('Save failed (see console).');
        }
      }

      // tidy up UI and refresh
      addForm.reset();
      addScreen.classList.add('hidden');
      renderExpenditures();
    });

    // render function (unchanged behavior)
    async function renderExpenditures(){
      try {
        const items = await db.expenditures.orderBy('priority').toArray();
        const el = document.getElementById('expList');
        el.innerHTML = '';
        if (!items || items.length === 0) { el.innerHTML = '<div class="chip">No expenditures</div>'; return; }
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
              try {
                await deleteExpenditure(id);
              } catch(err){
                console.error('Delete failed, deleting locally', err);
                await db.expenditures.delete(id);
              }
              renderExpenditures();
            }
          });
        });
      } catch (err) {
        console.error('renderExpenditures error:', err);
      }
    }

    // DB change hooks
    window.addEventListener('expendituresUpdated', renderExpenditures);
    db.expenditures.hook('creating', ()=> setTimeout(renderExpenditures, 80));
    db.expenditures.hook('deleting', ()=> setTimeout(renderExpenditures, 80));

    // initial render
    renderExpenditures();

  } catch (err) {
    console.error('Initialization error in expenditures page:', err);
  }
});
