// common.js — Supabase + Dexie sync for Budgetr
const SUPABASE_URL = 'https://srhmhrllhavckopoteui.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_toK5FMKwF-JeASs_9ifcAA_pOSszVCv';

/* ---------- Supabase init ---------- */
let supabaseClient = null;
try {
  if (window.supabase?.createClient) {
    supabaseClient = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    );
  } else {
    console.warn('Supabase SDK not loaded yet');
  }
} catch (e) {
  console.error('Supabase init error:', e);
}

/* ---------- Dexie ---------- */
const db = new Dexie('budgetr_db');
db.version(1).stores({
  expenditures: '++id, description, amount, category, priority, date, created_at',
  settings: 'key'
});

window.db = db;

/* ---------- Settings ---------- */

async function setSetting(key, value) {
  try {
    console.group('🔧 setSetting');
    console.log('key:', key);
    console.log('value:', value, typeof value);

    // 1️⃣ Save locally
    await db.settings.put({ key, value });

    // 2️⃣ Save remotely
    if (supabaseClient?.auth) {
      const { data: { user } } = await supabaseClient.auth.getUser();
      console.log('user:', user?.id);

      if (user) {
        const { data, error } = await supabaseClient
          .from('user_settings')
          .upsert(
            {
              user_id: user.id,
              key,
              value
            },
            { onConflict: 'user_id,key' }   // ✅ CRITICAL FIX
          )
          .select();

        console.log('upsert data:', data);
        console.log('upsert error:', error);
      }
    }

    window.dispatchEvent(
      new CustomEvent('settingsChanged', { detail: { key, value } })
    );

    console.groupEnd();
    return true;
  } catch (e) {
    console.error('setSetting failed:', e);
    return false;
  }
}

async function getSetting(key) {
  try {
    // 1️⃣ Local first
    const local = await db.settings.get(key);
    if (local?.value !== undefined) return local.value;

    // 2️⃣ Supabase fallback
    if (supabaseClient?.auth) {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabaseClient
        .from('user_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', key)
        .maybeSingle(); // ✅ FIX: no 406

      if (error) {
        console.warn('getSetting supabase error:', error);
        return null;
      }

      if (data) {
        await db.settings.put({ key, value: data.value });
        return data.value;
      }
    }

    return null;
  } catch (e) {
    console.error('getSetting failed:', e);
    return null;
  }
}

/* ---------- Helpers ---------- */

async function setFrequencyAndNotify(freq) {
  await setSetting('frequency', freq);
  window.dispatchEvent(new Event('frequencyChange'));
}

function multiplierFor(freq) {
  switch ((freq || 'month').toLowerCase()) {
    case 'biweekly': return 12 / 26;
    case 'weekly': return 12 / 52;
    case 'year': return 12;
    default: return 1;
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatMoney(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD'
  });
}

/* ---------- Auth ---------- */

async function signIn(email, password) {
  const { data, error } =
    await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  await supabaseClient.auth.signOut();
}

async function getCurrentUser() {
  const { data } = await supabaseClient.auth.getUser();
  return data.user ?? null;
}

/* ---------- Expenditures ---------- */

async function addExpenditure(payload) {
  const { error } =
    await supabaseClient.from('expenditures').insert([payload]);
  if (error) throw error;
}

async function deleteExpenditure(id) {
  await supabaseClient.from('expenditures').delete().eq('id', id);
}

/* ---------- Nav ---------- */

function setActiveNav(id) {
  document.querySelectorAll('.nav-btn')
    .forEach(b => b.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

/* ---------- Exports ---------- */
Object.assign(window, {
  supabaseClient,
  setSetting,
  getSetting,
  setFrequencyAndNotify,
  multiplierFor,
  escapeHtml,
  formatMoney,
  signIn,
  signOut,
  getCurrentUser,
  addExpenditure,
  deleteExpenditure,
  setActiveNav
});
