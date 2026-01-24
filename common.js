// common.js — Supabase + Dexie sync for Budgetr
// REPLACE these two with your actual Supabase project values:
const SUPABASE_URL = 'https://srhmhrllhavckopoteui.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_toK5FMKwF-JeASs_9ifcAA_pOSszVCv';

const supabase = supabaseJs.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Local DB (Dexie) for offline/cache
const db = new Dexie('budgetr_db');
db.version(1).stores({
  expenditures: '++id, description, amount, category, priority, date, created_at',
  settings: 'key'
});

/* AUTH (email + password) */
async function signIn(email, password){
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if(error) throw error;
  return data;
}
async function signOut(){
  const { error } = await supabase.auth.signOut();
  if(error) console.error('Sign out error', error);
}
async function getCurrentUser(){
  const { data } = await supabase.auth.getUser();
  return data.user || null;
}

/* Server sync helpers */
async function syncFromSupabase(){
  const { data, error } = await supabase
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
  const { data, error } = await supabase.from('expenditures').insert([payload]).select();
  if(error) {
    console.error('Insert error', error);
    throw error;
  }
  return data && data[0];
}
async function deleteExpenditureFromServer(id){
  const { data, error } = await supabase.from('expenditures').delete().eq('id', id);
  if(error) {
    console.error('Delete error', error);
    throw error;
  }
  return data;
}

/* Realtime */
let _realtimeSub = null;
function subscribeRealtime(){
  if(_realtimeSub) return;
  _realtimeSub = supabase.channel('public:expenditures')
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
  const user = (await supabase.auth.getUser()).data.user;
  if(!user){
    return;
  }
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

/* auth state change */
supabase.auth.onAuthStateChange((event, session) => {
  if(event === 'SIGNED_IN') {
    initSupabaseSync().catch(console.error);
  }
  if(event === 'SIGNED_OUT') {
    console.log('Signed out');
  }
});

/* exports */
window.supabase = supabase;
window.db = db;
window.signIn = signIn;
window.signOut = signOut;
window.getCurrentUser = getCurrentUser;
window.initSupabaseSync = initSupabaseSync;
window.addExpenditure = addExpenditure;
window.deleteExpenditure = deleteExpenditure;
window.syncFromSupabase = syncFromSupabase;
