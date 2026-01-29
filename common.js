// common.js — Supabase + Dexie sync for Budgetr
const SUPABASE_URL = 'https://srhmhrllhavckopoteui.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_toK5FMKwF-JeASs_9ifcAA_pOSszVCv';

// Try to initialize Supabase client, but don't let a failure stop the file
let supabaseClient = null;
try {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    console.warn('Supabase SDK not found before common.js loaded. Running in offline-limited mode until SDK loads.');
  }
} catch (e) {
  console.error('Error initializing supabaseClient (continuing in offline mode):', e);
}

// Local DB (Dexie) for offline/cache
const db = new Dexie('budgetr_db');
db.version(1).stores({
  expenditures: '++id, description, amount, category, priority, date, created_at',
  settings: 'key'
});

let hooksInitialized = false;

function initDbHooks() {
  if (hooksInitialized) return;
  hooksInitialized = true;

  db.expenditures.hook('creating', () => {
    window.dispatchEvent(new Event('expendituresUpdated'));
  });

  db.expenditures.hook('deleting', () => {
    window.dispatchEvent(new Event('expendituresUpdated'));
  });
}

initDbHooks();

/* ---------- simple app helpers (settings, formatting, misc) ---------- */

// ---------- Improved settings helpers (replace existing setSetting / getSetting) ----------

/**
 * Set a user-specific setting locally (Dexie) and in Supabase (user_settings).
 * Returns true on success, false on failure.
 */
async function setSetting(key, value) {
  try {
    // 1) Save locally (always)
    await db.settings.put({ key, value });

    // 2) Save to Supabase if user is logged in
    if (supabaseClient && supabaseClient.auth) {
      const { data: { user }, error: userErr } = await supabaseClient.auth.getUser();
      if (userErr) {
        console.warn('setSetting: auth.getUser error', userErr);
      }
      if (user) {
        // Ensure we get any server-side error and representation back
        const payload = { user_id: user.id, key, value };
        const { data: upsertData, error: upsertError } =
          await supabaseClient
            .from('user_settings')
            .upsert(payload, { returning: 'representation' });

        if (upsertError) {
          console.error('setSetting: Supabase upsert error', upsertError, { payload });
          // If upsert failed at server, don't throw (we already saved locally), but return false
          return false;
        } else {
          // success - optional: log or store returned row
          // console.debug('setSetting: upsert result', upsertData);
        }
      }
    }

    // notify listeners
    window.dispatchEvent(new CustomEvent('settingsChanged', { detail: { key, value } }));
    return true;
  } catch (e) {
    console.error('setSetting error', e);
    return false;
  }
}

/**
 * Get a setting: prefer local Dexie copy; fallback to Supabase for the signed-in user.
 * Returns the raw stored value or null if not found / error.
 */
async function getSetting(key) {
  try {
    // 1) Try local first
    const row = await db.settings.get(key);
    if (row && row.value !== undefined) {
      return row.value;
    }

    // 2) Fall back to Supabase if user is logged in
    if (supabaseClient && supabaseClient.auth) {
      const { data: { user }, error: userErr } = await supabaseClient.auth.getUser();
      if (userErr) {
        console.warn('getSetting: auth.getUser error', userErr);
      }
      if (user) {
        // maybeSingle avoids throwing when there are 0 rows. If there are multiple rows,
        // Supabase will return an error, which we check.
        const { data, error } = await supabaseClient
          .from('user_settings')
          .select('value')
          .eq('user_id', user.id)
          .eq('key', key)
          .maybeSingle();

        if (error) {
          console.error('getSetting: Supabase select error', error, { user_id: user.id, key });
          return null;
        }

        if (data && data.value !== undefined) {
          // update local cache for offline use
          await db.settings.put({ key, value: data.value });
          return data.value;
        }
      }
    }

    return null;
  } catch (e) {
    console.error('getSetting error', e);
    return null;
  }
}

// frequency helper used in UI (month/year/weekly/biweekly)
async function setFrequencyAndNotify(freq) {
  await setSetting('frequency', freq);
  window.dispatchEvent(new Event('frequencyChange'));
}

// multiplier: convert base monthly amounts depending on view frequency
function multiplierFor(freq) {
  switch ((freq || 'month').toLowerCase()) {
    case 'year': return 12;
    case 'biweekly': return 12 / 26;
    case 'weekly': return 12 / 52;
    case 'month':
    default: return 1;
  }
}

// small safe HTML escape for rendering
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// money formatting (USD-style). Adjust locale/currency as desired.
function formatMoney(n) {
  const num = Number(n || 0);
  try {
    return num.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  } catch (e) {
    return '$' + num.toFixed(2);
  }
}

/* expose helpers globally so page scripts can call them immediately */
window.getSetting = getSetting;
window.setSetting = setSetting;
window.setFrequencyAndNotify = setFrequencyAndNotify;
window.multiplierFor = multiplierFor;
window.escapeHtml = escapeHtml;
window.formatMoney = formatMoney;

/* AUTH (email + password) */
async function signIn(email, password){
  if (!supabaseClient || !supabaseClient.auth) throw new Error('Supabase client not initialized');
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if(error) throw error;
  return data;
}
async function signOut(){
  if (!supabaseClient || !supabaseClient.auth) {
    console.warn('Supabase client not initialized — signOut no-op');
    return;
  }
  const { error } = await supabaseClient.auth.signOut();
  if(error) console.error('Sign out error', error);
}
async function getCurrentUser(){
  if (!supabaseClient || !supabaseClient.auth) {
    // return null (not authenticated) if supabase isn't ready
    return null;
  }
  const { data } = await supabaseClient.auth.getUser();
  return data.user || null;
}

/* Server sync helpers */
async function syncFromSupabase(){
  if (!supabaseClient) {
    console.warn('syncFromSupabase: supabaseClient not initialized — skipping server sync');
    return;
  }

  const { data, error } = await supabaseClient
    .from('expenditures')
    .select('*')
    .order('created_at', { ascending: false });
  if(error) {
    console.error('Supabase fetch error', error);
    return;
  }
  await db.expenditures.clear();
  if(data && data.length) {
    await db.expenditures.bulkAdd(data.map(r => ({
      id: r.id,
      description: r.description,
      amount: Number(r.amount),
      category: r.category,
      priority: r.priority,
      date: r.date,
      created_at: r.created_at
    })));
  }
  window.dispatchEvent(new CustomEvent('expendituresUpdated'));
}

async function addExpenditureToServer(payload){
  if (!supabaseClient) throw new Error('Supabase client not initialized');
  const { data, error } = await supabaseClient.from('expenditures').insert([payload]).select();
  if(error) {
    console.error('Insert error', error);
    throw error;
  }
  return data && data[0];
}
async function deleteExpenditureFromServer(id){
  if (!supabaseClient) throw new Error('Supabase client not initialized');
  const { data, error } = await supabaseClient.from('expenditures').delete().eq('id', id);
  if(error) {
    console.error('Delete error', error);
    throw error;
  }
  return data;
}

/* Realtime */
let _realtimeSub = null;
function subscribeRealtime(){
  if(!supabaseClient) {
    console.warn('subscribeRealtime: supabaseClient not initialized');
    return;
  }
  if(_realtimeSub) return;
  _realtimeSub = supabaseClient.channel('public:expenditures')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenditures' }, payload => {
      const ev = payload.eventType;
      if(ev === 'INSERT' || ev === 'UPDATE'){
        const r = payload.new;
        db.expenditures.put({
          id: r.id,
          description: r.description,
          amount: Number(r.amount),
          category: r.category,
          priority: r.priority,
          date: r.date,
          created_at: r.created_at
        }).catch(console.error);
      } else if(ev === 'DELETE'){
        const o = payload.old;
        db.expenditures.delete(o.id).catch(console.error);
      }
      window.dispatchEvent(new CustomEvent('expendituresUpdated'));
    })
    .subscribe();
}

/* Init sync after login */
async function initSupabaseSync(){
  if (!window.db) return; // ⛑ safety net

  if (!supabaseClient || !supabaseClient.auth) {
    console.warn('initSupabaseSync: supabase client not ready');
    return;
  }

  const user = (await supabaseClient.auth.getUser()).data.user;
  if(!user) return;
  
  await syncFromSupabase();
  subscribeRealtime();
}

/* wrappers for page code */
async function addExpenditure(payload){
  try {
    await addExpenditureToServer(payload);
  } catch(err){
    console.error('Server add failed, saving local fallback', err);
    await db.expenditures.add({ ...payload, created_at: new Date().toISOString() });
    window.dispatchEvent(new CustomEvent('expendituresUpdated'));
  }
}
async function deleteExpenditure(id){
  try {
    await deleteExpenditureFromServer(id);
  } catch(err){
    console.error('Server delete failed, deleting locally', err);
    await db.expenditures.delete(id);
    window.dispatchEvent(new CustomEvent('expendituresUpdated'));
  }
}

/* helper to set active bottom nav button */
function setActiveNav(id) {
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  const el = document.getElementById(id);
  if(el) el.classList.add('active');
}

// expose globally
window.setActiveNav = setActiveNav;

/* exports */
window.supabaseClient = supabaseClient;
window.db = db;
window.signIn = signIn;
window.signOut = signOut;
window.getCurrentUser = getCurrentUser;
window.initSupabaseSync = initSupabaseSync;
window.addExpenditure = addExpenditure;
window.deleteExpenditure = deleteExpenditure;
window.syncFromSupabase = syncFromSupabase;
