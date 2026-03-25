// expenditures.js — robust + view-toggle
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session || !session.user) {
    location.href = 'login.html';
    return;
  }

  let renderQueued = false;
  let editMode = false;

  await initSupabaseSync();

  try {
    if (typeof setActiveNav === 'function') setActiveNav('navExpend');

    const showAddBtn = document.getElementById('showAddBtn');
    const editModeBtn = document.getElementById('editModeBtn');

    const viewToggle = document.getElementById('viewToggle');
    const viewMenu = document.getElementById('viewMenu');
    const freqSelect = document.getElementById('freqExpend');

    const viewLabel = document.getElementById('viewLabel');
    function readableFreq(val){
      return ({
        month: 'Month',
        year: 'Year',
        biweekly: 'Bi-Week',
        weekly: 'Week'
      })[val] || String(val || '').replace(/^\w/, c => c.toUpperCase());
    }
    function setViewLabel(val){
      if(!viewLabel) return;
      viewLabel.textContent = readableFreq(val);
    }

    function setEditMode(nextValue) {
      editMode = !!nextValue;
      document.body.classList.toggle('exp-edit-mode', editMode);
      if (editModeBtn) {
        editModeBtn.textContent = editMode ? 'Done' : 'Edit';
        editModeBtn.setAttribute('aria-pressed', String(editMode));
      }
      renderExpenditures();
    }

    function promptForExpense() {
      const description = window.prompt('Expense description');
      if (description === null) return null;
      const desc = description.trim();
      if (!desc) {
        alert('Please enter a description.');
        return null;
      }

      const amountRaw = window.prompt('Amount', '0.00');
      if (amountRaw === null) return null;
      const amount = parseFloat(String(amountRaw).trim().replace(/\s/g, '').replace(/[$€£]/g, '').replace(/,/g, '.').replace(/[^0-9.\-]/g, ''));
      if (Number.isNaN(amount) || amount <= 0) {
        alert('Please enter a valid amount greater than 0.');
        return null;
      }

      const categoryRaw = window.prompt('Category', 'Uncategorized');
      if (categoryRaw === null) return null;
      const priorityRaw = window.prompt('Priority (1 = highest)', '99');
      if (priorityRaw === null) return null;

      return {
        description: desc,
        amount,
        category: categoryRaw.trim() || 'Uncategorized',
        priority: parseInt(priorityRaw, 10) || 99,
        date: new Date().toISOString(),
        created_at: new Date().toISOString()
      };
    }

    let _expendituresRenderToken = 0;
    let _expListDelegateAttached = false;

    if (showAddBtn) {
      showAddBtn.addEventListener('click', async () => {
        const payload = promptForExpense();
        if (!payload) return;

        showAddBtn.disabled = true;
        try {
          await addExpenditure(payload);
          renderExpenditures();
        } catch (err) {
          console.error('Add failed:', err);
          alert('Could not save expense. Please try again.');
        } finally {
          showAddBtn.disabled = false;
        }
      });
    }

    if (editModeBtn) {
      editModeBtn.addEventListener('click', () => setEditMode(!editMode));
    }

    (async function wireViewToggleRobust() {
      try {
        console.log('[viewToggle] init', { viewToggle: !!viewToggle, viewMenu: !!viewMenu, freqSelect: !!freqSelect });

        if (!viewToggle) return console.warn('[viewToggle] button not found - aborting view toggle setup');
        if (!viewMenu) return console.warn('[viewToggle] menu (#viewMenu) not found - aborting view toggle setup');

        if (viewMenu.parentElement !== document.body) {
          document.body.appendChild(viewMenu);
          viewMenu.style.position = 'fixed';
        }

        function setActiveViewItem(val) {
          viewMenu.querySelectorAll('.view-item').forEach(b => {
            b.classList.toggle('active', b.dataset.value === val);
          });
        }

        try {
          const v = await getSetting('frequency').catch(() => 'month');
          setActiveViewItem(v || 'month');
          setViewLabel(v || 'month');
        } catch (e) {
          console.warn('[viewToggle] getSetting failed', e);
          setActiveViewItem('month');
          setViewLabel('month');
        }

        function positionMenu() {
          const rect = viewToggle.getBoundingClientRect();
          const menuRect = viewMenu.getBoundingClientRect();
          let left = Math.max(8, rect.left);
          if (left + menuRect.width > window.innerWidth - 8) {
            left = Math.max(8, window.innerWidth - menuRect.width - 8);
          }
          let top = rect.bottom + 8;
          if (top + menuRect.height > window.innerHeight - 8) {
            top = Math.max(8, rect.top - 8 - menuRect.height);
          }
          viewMenu.style.left = `${Math.round(left)}px`;
          viewMenu.style.top = `${Math.round(top)}px`;
        }

        function openMenu() {
          viewMenu.classList.add('open');
          viewMenu.setAttribute('aria-hidden', 'false');
          viewToggle.setAttribute('aria-expanded', 'true');
          viewMenu.style.display = 'block';
          requestAnimationFrame(() => positionMenu());
        }
        function closeMenu() {
          viewMenu.classList.remove('open');
          viewMenu.setAttribute('aria-hidden', 'true');
          viewToggle.setAttribute('aria-expanded', 'false');
          viewMenu.style.display = '';
        }

        viewToggle.addEventListener('click', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          if (viewMenu.classList.contains('open')) {
            closeMenu();
          } else {
            openMenu();
            const active = viewMenu.querySelector('.view-item.active') || viewMenu.querySelector('.view-item');
            active && active.focus();
          }
        });

        viewMenu.querySelectorAll('.view-item').forEach(btn => {
          btn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const val = btn.dataset.value;
            if (!val) return;
            try {
              if (freqSelect) freqSelect.value = val;
              await setFrequencyAndNotify(val);
            } catch (err) {
              console.error('[viewToggle] error while setting frequency', err);
            } finally {
              setActiveViewItem(val);
              setViewLabel(val);
              closeMenu();
            }
          });
        });

        function onDocClick(e) {
          if (!viewMenu.classList.contains('open')) return;
          if (e.target === viewToggle || viewToggle.contains(e.target) || viewMenu.contains(e.target)) return;
          closeMenu();
        }
        document.addEventListener('click', onDocClick, { capture: true });

        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && viewMenu.classList.contains('open')) {
            closeMenu();
            viewToggle.focus();
          }
        });

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

    const freqEl = document.getElementById('freqExpend');
    if (freqEl) {
      const f = await getSetting('frequency') || 'month';
      freqEl.value = f;
      setViewLabel(f);
    }

    async function renderExpenditures() {
      try {
        const myToken = ++_expendituresRenderToken;
        const el = document.getElementById('expList');
        if (!el) return;

        el.innerHTML = '';

        const items = await db.expenditures.orderBy('priority').toArray();
        if (myToken !== _expendituresRenderToken) return;

        if (!items || items.length === 0) {
          el.innerHTML = '<div class="chip empty-state">No expenditures yet</div>';
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
            <div class="priority"><span class="priority-pill">P${escapeHtml(String(it.priority))}</span></div>
            <div class="exp-meta-cell">
              <span class="exp-cat">${escapeHtml(it.category)}</span>
              ${editMode ? `<button data-id="${it.id}" class="btn ghost small del">Delete</button>` : ''}
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

    setEditMode(false);

    window.addEventListener('frequencyChange', async () => {
      const val = await getSetting('frequency');
      if (freqSelect) freqSelect.value = val;
      setViewLabel(val);
      renderExpenditures();
    });

  } catch (err) {
    console.error('Initialization error in expenditures page:', err);
  }
});
