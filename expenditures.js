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

    const viewLabel = document.getElementById('viewLabel');
    function readableFreq(val){
      return ({
        month: 'Month',
        year: 'Year',
        biweekly: 'Every Other Week',
        weekly: 'Week'
      })[val] || String(val || '').replace(/^\w/, c=>c.toUpperCase());
    }
    
    function setViewLabel(val){
      if(!viewLabel) return;
      viewLabel.textContent = readableFreq(val);
    }

    setActiveViewItem(initialFreq);
    // show the human-friendly label on load
    setViewLabel(initialFreq);

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
    (async function wireViewToggleRobust() {
      try {
        const viewToggle = document.getElementById('viewToggle');
        const viewMenu = document.getElementById('viewMenu');
        const freqSelect = document.getElementById('freqExpend');
    
        console.log('[viewToggle] init', { viewToggle: !!viewToggle, viewMenu: !!viewMenu, freqSelect: !!freqSelect });
    
        if (!viewToggle) return console.warn('[viewToggle] button not found - aborting view toggle setup');
        if (!viewMenu) return console.warn('[viewToggle] menu (#viewMenu) not found - aborting view toggle setup');
    
        // Move menu to body so it won't be clipped by header/container overflow
        if (viewMenu.parentElement !== document.body) {
          document.body.appendChild(viewMenu);
          // ensure the menu uses fixed positioning (JS will set left/top)
          viewMenu.style.position = 'fixed';
        }
    
        // helper: mark active menu item
        function setActiveViewItem(val) {
          viewMenu.querySelectorAll('.view-item').forEach(b => {
            b.classList.toggle('active', b.dataset.value === val);
          });
        }
    
        // set initial active menu item from settings
        try {
          const v = await getSetting('frequency').catch(() => 'month');
          setActiveViewItem(v || 'month');
        } catch (e) {
          console.warn('[viewToggle] getSetting failed', e);
          setActiveViewItem('month');
        }
    
        // compute menu position under button
        function positionMenu() {
          const rect = viewToggle.getBoundingClientRect();
          const menuRect = viewMenu.getBoundingClientRect();
          // prefer aligning left edge of menu with button, but ensure menu stays on-screen
          let left = Math.max(8, rect.left);
          // if menu would overflow right, push it left
          if (left + menuRect.width > window.innerWidth - 8) {
            left = Math.max(8, window.innerWidth - menuRect.width - 8);
          }
          // place menu slightly below the button
          let top = rect.bottom + 8;
          // if menu would overflow bottom, place it above
          if (top + menuRect.height > window.innerHeight - 8) {
            top = Math.max(8, rect.top - 8 - menuRect.height);
          }
          viewMenu.style.left = `${Math.round(left)}px`;
          viewMenu.style.top = `${Math.round(top)}px`;
        }
    
        // toggle visibility and position
        function openMenu() {
          viewMenu.classList.add('open');
          viewMenu.setAttribute('aria-hidden', 'false');
          viewToggle.setAttribute('aria-expanded', 'true');
          viewMenu.style.display = 'block';
          // small delay to allow menu to render and measure
          requestAnimationFrame(() => positionMenu());
        }
        function closeMenu() {
          viewMenu.classList.remove('open');
          viewMenu.setAttribute('aria-hidden', 'true');
          viewToggle.setAttribute('aria-expanded', 'false');
          viewMenu.style.display = '';
        }
    
        // attach click handler to the toggle button
        viewToggle.addEventListener('click', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          // toggle open/close
          if (viewMenu.classList.contains('open')) {
            closeMenu();
          } else {
            openMenu();
            // focus first active item for a11y
            const active = viewMenu.querySelector('.view-item.active') || viewMenu.querySelector('.view-item');
            active && active.focus();
          }
        });

    // hook each menu item
    viewMenu.querySelectorAll('.view-item').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const val = btn.dataset.value;
        if (!val) return;
        try {
          if (freqSelect) freqSelect.value = val;
          // setFrequencyAndNotify is your existing helper
          await setFrequencyAndNotify(val);
        } catch (err) {
          console.error('[viewToggle] error while setting frequency', err);
        } finally {
          setActiveViewItem(val);
          closeMenu();
        }
      });
    });

    // close menu on outside click
    function onDocClick(e) {
      if (!viewMenu.classList.contains('open')) return;
      // if click was inside menu or toggle, ignore
      if (e.target === viewToggle || viewToggle.contains(e.target) || viewMenu.contains(e.target)) return;
      closeMenu();
    }
    document.addEventListener('click', onDocClick, { capture: true });

    // close on ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && viewMenu.classList.contains('open')) {
        closeMenu();
        viewToggle.focus();
      }
    });

    // reposition on resize/scroll (keeps it anchored)
    window.addEventListener('resize', () => {
      if (viewMenu.classList.contains('open')) positionMenu();
    });
    window.addEventListener('scroll', () => {
      if (viewMenu.classList.contains('open')) positionMenu();
    }, true);

    console.log('[viewToggle] wired successfully');
  } catch (err) {
    console.error('[viewToggle] initialization error:', err);
  }
})();

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
