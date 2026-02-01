// expenditures.js — robust + view-toggle
document.addEventListener('DOMContentLoaded', async () => {
  // --- HARD GATE: wait for auth + supabase sync before rendering ---
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session || !session.user) {
    location.href = 'login.html';
    return;
  }

  let renderQueued = false;

  // Wait for server → Dexie sync to fully complete
  await initSupabaseSync();

  try {
    // set active nav for expenditures page
    if (typeof setActiveNav === 'function') setActiveNav('navExpend');

    // Elements
    const showAddBtn = document.getElementById('showAddBtn');
    const addScreen = document.getElementById('addScreen');
    const addForm = document.getElementById('addForm');
    const cancelAdd = document.getElementById('cancelAdd');

    // View toggle / menu elements (left calendar popup)
    const viewToggle = document.getElementById('viewToggle');
    const viewMenu = document.getElementById('viewMenu');
    const freqSelect = document.getElementById('freqExpend'); // hidden select for compatibility

    // Basic sanity
    if (!showAddBtn || !addScreen || !addForm || !cancelAdd) {
      console.error('Missing required elements:', {
        showAddBtn: !!showAddBtn,
        addScreen: !!addScreen,
        addForm: !!addForm,
        cancelAdd: !!cancelAdd
      });
      // don't return — the page can still render, but we log the error
    }

    // Rendering guard and delegation guard (prevents duplicated DOM nodes / handlers)
    let _expendituresRenderToken = 0;
    let _expListDelegateAttached = false;

    // Show/hide add screen (keeps your previous behavior)
    if (showAddBtn) {
      showAddBtn.addEventListener('click', () => {
        addScreen.classList.remove('hidden');
        try { addScreen.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* ignore */ }
      });
    }
    if (cancelAdd) {
      cancelAdd.addEventListener('click', () => {
        addForm.reset();
        addScreen.classList.add('hidden');
      });
    }

    // VIEW TOGGLE: popup menu handling (safe guards if elements missing)
    (function wireViewToggle() {
      // if freqSelect missing, we still let the view-menu set frequency via setFrequencyAndNotify
      const initialFreq = awaitGetSettingSync();

      function awaitGetSettingSync() {
        // can't use top-level await inside this helper easily — return a promise that resolves quickly
        let p = getSetting('frequency').catch(() => 'month');
        return p;
      }

      // mark active menu item helper
      function setActiveViewItem(val) {
        viewMenu?.querySelectorAll('.view-item').forEach(b => {
          b.classList.toggle('active', b.dataset.value === val);
        });
      }

      // open/close and selection wiring
      if (viewToggle && viewMenu) {
        // set initial active based on DB value
        getSetting('frequency').then(v => setActiveViewItem(v || 'month'));

        viewToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const opened = viewMenu.classList.toggle('open');
          viewToggle.setAttribute('aria-expanded', opened ? 'true' : 'false');
          if (opened) {
            const active = viewMenu.querySelector('.view-item.active') || viewMenu.querySelector('.view-item');
            active && active.focus();
          }
        });

        viewMenu.querySelectorAll('.view-item').forEach(btn => {
          btn.addEventListener('click', async (ev) => {
            const val = btn.dataset.value;
            if (!val) return;
            if (freqSelect) freqSelect.value = val;
            await setFrequencyAndNotify(val);   // updates DB & fires frequencyChange
            setActiveViewItem(val);
            viewMenu.classList.remove('open');
            viewToggle.setAttribute('aria-expanded', 'false');
          });
        });

        // close menu on outside click or Escape
        document.addEventListener('click', () => {
          if (viewMenu.classList.contains('open')) {
            viewMenu.classList.remove('open');
            viewToggle.setAttribute('aria-expanded', 'false');
          }
        });
        viewMenu.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            viewMenu.classList.remove('open');
            viewToggle.setAttribute('aria-expanded', 'false');
            viewToggle.focus();
          }
        });
      } else {
        // fallback: if no view toggle/menu, attach change handler to hidden select (if present)
        if (freqSelect) {
          freqSelect.addEventListener('change', async (e) => {
            await setFrequencyAndNotify(e.target.value);
          });
        }
      }
    })(); // immediate invocation

    // Frequency UI: sync hidden select with settings (also used for restoring UI if other tabs change)
    const freqEl = document.getElementById('freqExpend');
    if (freqEl) {
      const f = await getSetting('frequency') || 'month';
      freqEl.value = f;
    }

    // SUBMIT handler — robust, prevents reload, tolerant parsing
    if (addForm) {
      addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        e.stopPropagation?.();

        // e.submitter gives the clicked button (supported in modern browsers)
        const saveBtn = (e && e.submitter) || addForm.querySelector('button[type="submit"]');

        // Read + normalize inputs
        const desc = (document.getElementById('fDesc')?.value || '').trim();
        const amountRaw = (document.getElementById('fAmount')?.value || '').trim();
        const amountNormalized = amountRaw.replace(/\s/g, '').replace(/[$€£]/g, '').replace(/,/g, '.').replace(/[^0-9.\-]/g, '');
        const amount = parseFloat(amountNormalized);
        const category = (document.getElementById('fCategory')?.value || '').trim() || 'Uncategorized';
        const priority = parseInt(document.getElementById('fPriority')?.value || 99, 10);

        // Validation
        if (!desc) { alert('Please add a description.'); return; }
        if (Number.isNaN(amount) || amount <= 0) { alert('Please enter a valid amount greater than 0.'); return; }

        // Prepare payload
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
    }

    // render function
    async function renderExpenditures() {
      try {
        const myToken = ++_expendituresRenderToken;
        const el = document.getElementById('expList');
        if (!el) return;

        // clear immediately to avoid visible duplicates while waiting
        el.innerHTML = '';

        // fetch items
        const items = await db.expenditures.orderBy('priority').toArray();

        // if another render started, abort this one
        if (myToken !== _expendituresRenderToken) return;

        if (!items || items.length === 0) {
          el.innerHTML = '<div class="chip">No expenditures</div>';
          return;
        }

        const freq = await getSetting('frequency') || 'month';
        if (myToken !== _expendituresRenderToken) return;
        const m = multiplierFor(freq);

        // build fragment
        const frag = document.createDocumentFragment();
        for (const it of items) {
          const row = document.createElement('div');
          row.className = 'exp-row';
          row.dataset.id = String(it.id);
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
          frag.appendChild(row);
        }

        // atomic replace
        el.replaceChildren(frag);

        // attach delegated delete handler once
        if (!_expListDelegateAttached) {
          _expListDelegateAttached = true;
          el.addEventListener('click', async (e) => {
            const btn = e.target.closest ? e.target.closest('.del') : (e.target.classList && e.target.classList.contains('del') ? e.target : null);
            if (!btn) return;
            const id = Number(btn.dataset.id);
            if (!id) return;
            if (!confirm('Delete this entry?')) return;
            try {
              await deleteExpenditure(id);
            } catch (err) {
              console.error('Delete failed, deleting locally', err);
              await db.expenditures.delete(id);
            }
            // fresh render
            renderExpenditures();
          });
        }

      } catch (err) {
        console.error('renderExpenditures error:', err);
      }
    }

    // DB change hooks
    if (!window._expendituresUpdatedListenerAttached) {
      window._expendituresUpdatedListenerAttached = true;
      window.addEventListener('expendituresUpdated', () => {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => {
          renderQueued = false;
          renderExpenditures();
        });
      });
    }

    // initial render
    renderExpenditures();

    // keep hidden freq select in sync with changes from other pages
    window.addEventListener('frequencyChange', async () => {
      const val = await getSetting('frequency');
      if (freqSelect) freqSelect.value = val;
      renderExpenditures();
    });

  } catch (err) {
    console.error('Initialization error in expenditures page:', err);
  }
});
