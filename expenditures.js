// expenditures.js — robust version (replace existing file)
document.addEventListener('DOMContentLoaded', async () => {
  // --- HARD GATE: wait for auth + supabase sync before rendering ---
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session || !session.user) {
    location.href = 'login.html';
    return;
  }

  // Wait for server → Dexie sync to fully complete
  await initSupabaseSync();

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

    // Rendering guard and delegation guard (prevents duplicated DOM nodes / handlers)
    let _expendituresRenderToken = 0;
    let _expListDelegateAttached = false;
    let renderQueued = false;

    // --- Modal open/close logic (mobile-friendly) ---
    const bodyEl = document.body;

    function openAddModal() {
      addScreen.classList.remove('hidden');
      addScreen.classList.add('open', 'modal-visible');
      addScreen.setAttribute('aria-hidden', 'false');
      bodyEl.classList.add('body-modal-open');
      document.querySelector('.bottom-nav')?.classList.add('hidden');
      try { document.getElementById('fDesc')?.focus(); } catch(e){/* ignore */ }
    }

    function closeAddModal() {
      addScreen.classList.remove('open', 'modal-visible');
      addScreen.setAttribute('aria-hidden', 'true');
      bodyEl.classList.remove('body-modal-open');
      document.querySelector('.bottom-nav')?.classList.remove('hidden');
      setTimeout(()=>{ if (!addScreen.classList.contains('open')) addScreen.classList.add('hidden'); }, 350);
    }

    // Show/hide add screen (open modal)
    showAddBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openAddModal();
    });

    cancelAdd.addEventListener('click', (e) => {
      e.preventDefault();
      addForm.reset();
      closeAddModal();
    });

    // close modal when tapping outside (overlay)
    addScreen.addEventListener('click', (e) => {
      if (e.target === addScreen) {
        closeAddModal();
      }
    });

    // close modal on Escape key
    window.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape' && addScreen.classList.contains('open')) {
        closeAddModal();
      }
    });

    // Frequency init + listeners
    const freqSelect = document.getElementById('freqExpend');
    const f = await getSetting('frequency') || 'month';
    if (freqSelect) freqSelect.value = f;
    freqSelect.addEventListener('change', async (e) => {
      await setFrequencyAndNotify(e.target.value);
    });
    window.addEventListener('frequencyChange', () => {
      getSetting('frequency').then(val => { if (freqSelect) freqSelect.value = val; renderExpenditures(); });
    });

    // SUBMIT handler — robust, prevents reload, tolerant parsing
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation?.();

      const saveBtn = addForm.querySelector('button[type="submit"]');

      const desc = (document.getElementById('fDesc')?.value || '').trim();
      const amountRaw = (document.getElementById('fAmount')?.value || '').toString().trim();
      const amountNormalized = amountRaw.replace(/\s/g, '').replace(/[$€£]/g, '').replace(/,/g, '.').replace(/[^0-9.\-]/g,'');
      const amount = parseFloat(amountNormalized);
      const category = (document.getElementById('fCategory')?.value || '').trim() || 'Uncategorized';
      const priority = parseInt(document.getElementById('fPriority')?.value || 99, 10);

      if (!desc) { alert('Please add a description.'); return; }
      if (Number.isNaN(amount) || amount <= 0) { alert('Please enter a valid amount greater than 0.'); return; }

      const payload = {
        description: desc,
        amount: amount,
        category,
        priority,
        date: new Date().toISOString(),
        created_at: new Date().toISOString()
      };

      if (saveBtn) {
        saveBtn.disabled = true;
        const prevText = saveBtn.textContent;
        saveBtn.textContent = 'Saving...';

        try {
          await addExpenditure(payload); // wrapper in common.js: server then fallback
        } catch (err) {
          console.error('Add failed (caught in submit):', err);
          alert('Save failed (see console). Falling back to local storage.');
        } finally {
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
      closeAddModal();
      renderExpenditures();
    });

    // render function (idempotent + safe)
    async function renderExpenditures(){
      try {
        const myToken = ++_expendituresRenderToken;

        const el = document.getElementById('expList');
        if (!el) return;

        el.innerHTML = '';

        const items = await db.expenditures.orderBy('priority').toArray();

        if (myToken !== _expendituresRenderToken) return;

        if (!items || items.length === 0) {
          el.innerHTML = '<div class="chip">No expenditures</div>';
          return;
        }

        const freq = await getSetting('frequency') || 'month';
        if (myToken !== _expendituresRenderToken) return;
        const m = multiplierFor(freq);

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

        el.replaceChildren(frag);

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
            renderExpenditures();
          });
        }

      } catch (err) {
        console.error('renderExpenditures error:', err);
      }
    }

    // DB change hooks (debounced)
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

    // --- bottom-nav hide on scroll (show on scroll up) ---
    const mainEl = document.querySelector('.main');
    const bottomNav = document.querySelector('.bottom-nav');
    let lastScrollTop = mainEl ? mainEl.scrollTop : 0;
    let scrollTicking = false;

    function handleScroll() {
      if (!mainEl || !bottomNav) return;
      const st = mainEl.scrollTop;
      const diff = st - lastScrollTop;
      lastScrollTop = st;
      if (Math.abs(diff) < 8) return;
      if (diff > 0) {
        bottomNav.classList.add('hidden');
      } else {
        bottomNav.classList.remove('hidden');
      }
    }

    if (mainEl) {
      mainEl.addEventListener('scroll', (e) => {
        if (scrollTicking) return;
        scrollTicking = true;
        requestAnimationFrame(() => {
          handleScroll();
          scrollTicking = false;
        });
      }, { passive: true });
    }

    // initial render
    renderExpenditures();

  } catch (err) {
    console.error('Initialization error in expenditures page:', err);
  }
});
