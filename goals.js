// goals.js
document.addEventListener('DOMContentLoaded', ()=>{
  setActiveNav('navGoals');

  const calcBtn = document.getElementById('calcGoal');
  const goalAmount = document.getElementById('goalAmount');
  const goalDate = document.getElementById('goalDate');
  const goalResult = document.getElementById('goalResult');
  const useAvg = document.getElementById('useAvg');

  calcBtn.addEventListener('click', async ()=>{
    const goal = parseFloat(goalAmount.value || 0);
    const dateStr = goalDate.value;
    if(!goal || !dateStr) return alert('Set goal amount and date');
    const until = new Date(dateStr);
    const now = new Date();
    const months = Math.max(1, Math.abs((until.getFullYear()-now.getFullYear())*12 + (until.getMonth()-now.getMonth())));
    const saved = parseFloat(await getSetting('currentSavings') || 0);
    const remaining = Math.max(0, goal - saved);
    const required = remaining / months;
    const items = await db.expenditures.toArray();
    const avgMonthly = useAvg.checked ? (function computeAvgMonthly(items){
      if(!items || items.length===0) return 0;
      const dates = items.map(i => new Date(i.date || i.created_at));
      const min = new Date(Math.min(...dates.map(d=>d.getTime())));
      const max = new Date(Math.max(...dates.map(d=>d.getTime())));
      const months = Math.abs((max.getFullYear()-min.getFullYear())*12 + (max.getMonth()-min.getMonth())) + 1;
      const total = items.reduce((s,i)=>s + Number(i.amount || 0), 0);
      return total / Math.max(1, months);
    })(items) : 0;
    const net = parseFloat(await getSetting('netMonthly') || 0);
    const available = Math.max(0, net - avgMonthly);
    goalResult.innerHTML = `
      <div>Months: ${months}</div>
      <div>Remaining: ${formatMoney(remaining)}</div>
      <div>Required / month: ${formatMoney(required)}</div>
      <div>Estimated available / month: ${formatMoney(available)}</div>
      <div style="margin-top:8px;font-weight:700">${available >= required ? 'On track ✅' : 'Shortfall — consider trimming'}</div>
    `;
  });
});
