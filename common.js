// common.js — shared DB, settings, multi-page helpers

const db = new Dexie('budgetr_db');
db.version(1).stores({
  expenditures: '++id, description, amount, category, priority, date, created_at',
  settings: 'key'
});

// settings helpers
async function getSetting(key, fallback = null){
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}
async function setSetting(key, value){
  await db.settings.put({key, value});
  return value;
}

// frequency multipliers (base stored amounts are monthly)
function multiplierFor(freq){
  switch(freq){
    case 'month': return 1;
    case 'year': return 12;
    case 'biweekly': return 12/26;
    case 'weekly': return 12/52;
    default: return 1;
  }
}

// set frequency and notify other pages (CustomEvent)
async function setFrequencyAndNotify(freq){
  await setSetting('frequency', freq);
  // dispatch event so script on the same page can react
  window.dispatchEvent(new CustomEvent('frequencyChange', {detail:{frequency:freq}}));
  // also try to use storage event (useful if multiple tabs open)
  try { localStorage.setItem('budgetr-frequency', freq); } catch(e){}
}

// When other tab/page updates localStorage, forward event
window.addEventListener('storage', (ev) => {
  if(ev.key === 'budgetr-frequency'){
    const f = ev.newValue;
    window.dispatchEvent(new CustomEvent('frequencyChange', {detail:{frequency:f}}));
  }
});

// formatting and escaping
function formatMoney(n){
  return `$${Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}
function escapeHtml(s){ return (s+'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// helper to set active bottom nav (call on page load)
function setActiveNav(id){
  document.querySelectorAll('.nav-btn').forEach(el=>{
    el.classList.toggle('active', el.id === id);
  });
}

// helper: ensure a sane default frequency exists
(async function ensureDefaultFrequency(){
  const f = await getSetting('frequency');
  if(!f) await setSetting('frequency','month');
})();
