// ===== State & Storage =====
const API = '/api';

let expenses = [];
let settings = { budget: 0, currency: '₹' };
let trendChart = null, categoryChart = null, monthlyChart = null;
let historyPage = 1;
const PAGE_SIZE = 10;
let confirmCallback = null;

const CATEGORY_COLORS = {
  '🍔 Food & Dining': '#ff6b6b', '🚗 Transport': '#ffa502',
  '🛒 Groceries': '#2dd4a0', '🎬 Entertainment': '#7c5cfc',
  '💊 Health': '#ff5c7c', '🛍️ Shopping': '#e056a0',
  '📱 Subscriptions': '#45b7d1', '🏠 Housing': '#96c93d',
  '📚 Education': '#f7b731', '✈️ Travel': '#4b7bec',
  '💡 Utilities': '#a55eea', '📦 Other': '#778ca3'
};

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  
  // Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.log('SW registration failed:', err);
    });
  }
});

async function initApp() {
  setupDate();
  setupNavigation();
  setupForm();
  setupSettings();
  setupHistory();
  setupConfirmModal();
  setupBudgetAlert();
  await loadData();
  setupCurrency();
  applyCurrency();
  renderAll();
}

// ===== Helpers =====
async function loadData() {
  try {
    const [expRes, setRes] = await Promise.all([
      fetch(`${API}/expenses`), fetch(`${API}/settings`)
    ]);
    expenses = await expRes.json();
    settings = await setRes.json();
  } catch (err) {
    console.warn('API unavailable, using empty data:', err.message);
  }
}
function getCurrency() { return settings.currency || '₹'; }
function fmt(n) { return getCurrency() + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }

function getMonthExpenses(date) {
  const d = date || new Date();
  const m = d.getMonth(), y = d.getFullYear();
  return expenses.filter(e => { const ed = new Date(e.date); return ed.getMonth() === m && ed.getFullYear() === y; });
}

function getTodayExpenses() {
  const today = new Date().toISOString().split('T')[0];
  return expenses.filter(e => e.date === today);
}

function showToast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
}

// ===== Date =====
function setupDate() {
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  document.getElementById('header-date').textContent = new Date().toLocaleDateString('en-IN', opts);
  document.getElementById('expense-date').value = new Date().toISOString().split('T')[0];
}

// ===== Currency =====
function setupCurrency() {
  const sel = document.getElementById('currency-select');
  sel.value = settings.currency || '₹';
  sel.addEventListener('change', async () => {
    settings.currency = sel.value;
    await fetch(`${API}/settings`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(settings) });
    applyCurrency();
    renderAll();
  });
}

function applyCurrency() {
  document.querySelectorAll('.currency-icon').forEach(el => el.textContent = getCurrency());
}

// ===== Navigation =====
function setupNavigation() {
  const btns = document.querySelectorAll('.nav-btn');
  const toggle = document.getElementById('menu-toggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById(`view-${view}`).classList.add('active');
      document.getElementById('page-title').textContent = btn.querySelector('span').textContent;
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
      if (view === 'analytics') renderAnalytics();
      if (view === 'history') { historyPage = 1; renderHistory(); }
    });
  });

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
  });
  
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
  });

  document.getElementById('btn-view-all').addEventListener('click', () => {
    document.querySelector('[data-view="history"]').click();
  });
}

// ===== Form =====
function setupForm() {
  const form = document.getElementById('expense-form');
  const chips = document.querySelectorAll('.payment-chip');

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('expense-amount').value);
    const category = document.getElementById('expense-category').value;
    const date = document.getElementById('expense-date').value;
    const description = document.getElementById('expense-description').value.trim();
    const payment = document.querySelector('input[name="payment"]:checked').value;
    const recurring = document.getElementById('expense-recurring').checked;

    if (!amount || amount <= 0 || !category || !date) {
      showToast('Please fill all required fields', 'error');
      return;
    }

    const expense = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      amount, category, date, description: description || category, payment, recurring,
      createdAt: new Date().toISOString()
    };

    try {
      await fetch(`${API}/expenses`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(expense) });
      expenses.push(expense);
    } catch (err) {
      showToast('Failed to save expense', 'error'); return;
    }
    form.reset();
    document.getElementById('expense-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('expense-recurring').checked = false;
    chips.forEach(c => c.classList.remove('active'));
    chips[0].classList.add('active');
    chips[0].querySelector('input').checked = true;
    showToast(`${fmt(amount)} expense added!`);
    renderAll();
  });
}

// ===== Settings =====
function setupSettings() {
  const modal = document.getElementById('settings-modal');
  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('budget-input').value = settings.budget || '';
    modal.classList.add('active');
  });
  document.getElementById('settings-close').addEventListener('click', () => modal.classList.remove('active'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    settings.budget = parseFloat(document.getElementById('budget-input').value) || 0;
    await fetch(`${API}/settings`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(settings) });
    modal.classList.remove('active');
    showToast('Settings saved!');
    renderAll();
  });

  document.getElementById('btn-export').addEventListener('click', exportCSV);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('csv-file-input').click();
  });
  document.getElementById('csv-file-input').addEventListener('change', importCSV);
  document.getElementById('btn-clear-data').addEventListener('click', () => {
    showConfirm('Clear All Data', 'Are you sure you want to delete ALL expenses? This cannot be undone.', async () => {
      await fetch(`${API}/expenses`, { method: 'DELETE' });
      expenses = [];
      modal.classList.remove('active');
      showToast('All data cleared');
      renderAll();
    });
  });
}

function exportCSV() {
  if (!expenses.length) { showToast('No data to export', 'error'); return; }
  const headers = ['Date', 'Category', 'Description', 'Amount', 'Payment Method'];
  const rows = expenses
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map(e => [e.date, e.category, `"${e.description}"`, e.amount, e.payment]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `expenseflow_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  showToast('CSV exported!');
}

// ===== History =====
function setupHistory() {
  document.getElementById('search-input').addEventListener('input', renderHistory);
  document.getElementById('filter-category').addEventListener('change', renderHistory);
  document.getElementById('filter-sort').addEventListener('change', renderHistory);

  // Edit modal
  document.getElementById('edit-close').addEventListener('click', () => {
    document.getElementById('edit-modal').classList.remove('active');
  });
  document.getElementById('btn-cancel-edit').addEventListener('click', () => {
    document.getElementById('edit-modal').classList.remove('active');
  });
  document.getElementById('edit-modal').addEventListener('click', (e) => {
    if (e.target.id === 'edit-modal') e.target.classList.remove('active');
  });
  document.getElementById('btn-save-edit').addEventListener('click', saveEdit);
}

async function saveEdit() {
  const id = document.getElementById('edit-id').value;
  const idx = expenses.findIndex(e => e.id === id);
  if (idx === -1) return;
  const updated = {
    amount: parseFloat(document.getElementById('edit-amount').value),
    category: document.getElementById('edit-category').value,
    date: document.getElementById('edit-date').value,
    description: document.getElementById('edit-description').value || expenses[idx].category
  };
  await fetch(`${API}/expenses/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(updated) });
  Object.assign(expenses[idx], updated);
  document.getElementById('edit-modal').classList.remove('active');
  showToast('Expense updated!');
  renderAll();
}

function openEdit(id) {
  const e = expenses.find(ex => ex.id === id);
  if (!e) return;
  document.getElementById('edit-id').value = e.id;
  document.getElementById('edit-amount').value = e.amount;
  document.getElementById('edit-category').value = e.category;
  document.getElementById('edit-date').value = e.date;
  document.getElementById('edit-description').value = e.description;
  document.getElementById('edit-modal').classList.add('active');
}

function deleteExpense(id) {
  showConfirm('Delete Expense', 'Are you sure you want to delete this expense?', async () => {
    await fetch(`${API}/expenses/${id}`, { method: 'DELETE' });
    expenses = expenses.filter(e => e.id !== id);
    showToast('Expense deleted');
    renderAll();
  });
}

// ===== Render =====
function renderAll() {
  renderStats();
  renderBudget();
  renderBudgetAlert();
  renderRecent();
  renderTrendChart();
  renderCategoryChart();
  renderTodayStats();
  renderHistory();
}

function renderStats() {
  const monthly = getMonthExpenses();
  const total = monthly.reduce((s, e) => s + e.amount, 0);
  const now = new Date();
  const dayOfMonth = now.getDate();

  document.getElementById('stat-total').textContent = fmt(total);
  document.getElementById('stat-avg').textContent = fmt(dayOfMonth > 0 ? total / dayOfMonth : 0);
  document.getElementById('stat-count').textContent = monthly.length;

  // Top category
  const cats = {};
  monthly.forEach(e => { cats[e.category] = (cats[e.category] || 0) + e.amount; });
  const topCat = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  document.getElementById('stat-top').textContent = topCat ? topCat[0].split(' ').slice(1).join(' ') : '—';
}

function renderBudget() {
  const budget = settings.budget || 0;
  const monthly = getMonthExpenses();
  const spent = monthly.reduce((s, e) => s + e.amount, 0);

  document.getElementById('sidebar-budget').textContent = budget ? fmt(budget) : 'Not set';
  document.getElementById('sidebar-budget-spent').textContent = `${fmt(spent)} spent`;

  const bar = document.getElementById('sidebar-budget-bar');
  if (budget > 0) {
    const pct = Math.min((spent / budget) * 100, 100);
    bar.style.width = pct + '%';
    bar.style.background = pct > 90 ? 'linear-gradient(90deg, #ff5c7c, #ff3355)' :
      pct > 70 ? 'linear-gradient(90deg, #ffb347, #ff5c7c)' :
      'linear-gradient(90deg, var(--accent), var(--success))';
  } else {
    bar.style.width = '0%';
  }
}

function renderTodayStats() {
  const today = getTodayExpenses();
  const total = today.reduce((s, e) => s + e.amount, 0);
  document.getElementById('today-spent').textContent = fmt(total);
  document.getElementById('today-count').textContent = today.length;
  const cats = {};
  today.forEach(e => { cats[e.category] = (cats[e.category] || 0) + e.amount; });
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  document.getElementById('today-top-cat').textContent = top ? top[0] : '—';
}

function renderExpenseItem(e) {
  const emoji = e.category.split(' ')[0];
  const catName = e.category.split(' ').slice(1).join(' ');
  const dateStr = new Date(e.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const recurBadge = e.recurring ? ' <span class="recurring-badge">↻ Monthly</span>' : '';
  return `
    <div class="expense-item" data-id="${e.id}">
      <div class="expense-emoji">${emoji}</div>
      <div class="expense-details">
        <div class="expense-desc">${e.description || catName}${recurBadge}</div>
        <div class="expense-meta">${catName} · ${dateStr}${e.payment ? ' · ' + e.payment : ''}</div>
      </div>
      <div class="expense-amount">${fmt(e.amount)}</div>
      <div class="expense-actions">
        <button onclick="openEdit('${e.id}')" title="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-delete" onclick="deleteExpense('${e.id}')" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div>
    </div>`;
}

function renderRecent() {
  const container = document.getElementById('recent-expenses');
  const sorted = [...expenses].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  if (!sorted.length) {
    container.innerHTML = '<div class="empty-state"><p>No expenses yet</p><span>Add your first expense to get started</span></div>';
    return;
  }
  container.innerHTML = sorted.map(renderExpenseItem).join('');
}

function renderHistory() {
  const search = (document.getElementById('search-input').value || '').toLowerCase();
  const catFilter = document.getElementById('filter-category').value;
  const sort = document.getElementById('filter-sort').value;

  let filtered = [...expenses];
  if (search) filtered = filtered.filter(e =>
    e.description.toLowerCase().includes(search) ||
    e.category.toLowerCase().includes(search)
  );
  if (catFilter) filtered = filtered.filter(e => e.category === catFilter);

  switch (sort) {
    case 'newest': filtered.sort((a, b) => new Date(b.date) - new Date(a.date)); break;
    case 'oldest': filtered.sort((a, b) => new Date(a.date) - new Date(b.date)); break;
    case 'highest': filtered.sort((a, b) => b.amount - a.amount); break;
    case 'lowest': filtered.sort((a, b) => a.amount - b.amount); break;
  }

  const container = document.getElementById('history-expenses');
  const empty = document.getElementById('history-empty');
  const pagination = document.getElementById('pagination');
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
  if (historyPage > totalPages) historyPage = totalPages;

  if (!filtered.length) {
    container.innerHTML = '';
    empty.style.display = 'block';
    pagination.innerHTML = '';
  } else {
    empty.style.display = 'none';
    const start = (historyPage - 1) * PAGE_SIZE;
    const paged = filtered.slice(start, start + PAGE_SIZE);
    container.innerHTML = paged.map(renderExpenseItem).join('');
    renderPagination(totalPages, filtered.length);
  }
}

function renderPagination(totalPages, totalItems) {
  const pagination = document.getElementById('pagination');
  if (totalPages <= 1) { pagination.innerHTML = ''; return; }
  let html = `<button class="page-btn" onclick="goPage(${historyPage - 1})" ${historyPage === 1 ? 'disabled' : ''}>‹</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 7 && i > 2 && i < totalPages - 1 && Math.abs(i - historyPage) > 1) {
      if (i === 3 || i === totalPages - 2) html += '<span class="page-info">…</span>';
      continue;
    }
    html += `<button class="page-btn ${i === historyPage ? 'active' : ''}" onclick="goPage(${i})">${i}</button>`;
  }
  html += `<button class="page-btn" onclick="goPage(${historyPage + 1})" ${historyPage === totalPages ? 'disabled' : ''}>›</button>`;
  html += `<span class="page-info">${totalItems} items</span>`;
  pagination.innerHTML = html;
}

function goPage(p) { historyPage = p; renderHistory(); }

// ===== Charts =====
function renderTrendChart(days = 7) {
  const canvas = document.getElementById('trend-chart');
  const ctx = canvas.getContext('2d');

  const labels = [];
  const data = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    labels.push(d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
    const dayTotal = expenses.filter(e => e.date === dateStr).reduce((s, e) => s + e.amount, 0);
    data.push(dayTotal);
  }

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#7c5cfc',
        backgroundColor: 'rgba(124,92,252,0.1)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#7c5cfc',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#1a1a2e', titleColor: '#f0f0f5', bodyColor: '#f0f0f5',
        borderColor: 'rgba(255,255,255,.1)', borderWidth: 1, cornerRadius: 8, padding: 12,
        callbacks: { label: (ctx) => getCurrency() + ctx.parsed.y.toLocaleString() }
      }},
      scales: {
        x: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#55556a', font: { size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#55556a', font: { size: 11 }, callback: v => getCurrency() + v } }
      }
    }
  });

  // Chart toggle buttons
  document.querySelectorAll('.chart-toggle .chip').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.chart-toggle .chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTrendChart(parseInt(btn.dataset.range));
    };
  });
}

function renderCategoryChart() {
  const canvas = document.getElementById('category-chart');
  const ctx = canvas.getContext('2d');
  const monthly = getMonthExpenses();
  const cats = {};
  monthly.forEach(e => { cats[e.category] = (cats[e.category] || 0) + e.amount; });

  const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const labels = entries.map(e => e[0].split(' ').slice(1).join(' '));
  const data = entries.map(e => e[1]);
  const colors = entries.map(e => CATEGORY_COLORS[e[0]] || '#778ca3');

  if (categoryChart) categoryChart.destroy();

  if (!data.length) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById('category-legend').innerHTML = '<span style="color:var(--text-muted);font-size:.85rem">No data this month</span>';
    return;
  }

  categoryChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '70%',
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#1a1a2e', titleColor: '#f0f0f5', bodyColor: '#f0f0f5',
        borderColor: 'rgba(255,255,255,.1)', borderWidth: 1, cornerRadius: 8, padding: 12,
        callbacks: { label: (ctx) => ` ${getCurrency()}${ctx.parsed.toLocaleString()} (${((ctx.parsed / data.reduce((a,b)=>a+b,0))*100).toFixed(1)}%)` }
      }}
    }
  });

  const legend = document.getElementById('category-legend');
  legend.innerHTML = entries.map(([cat], i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${colors[i]}"></div>
      <span>${cat}</span>
    </div>`).join('');
}

// ===== Analytics =====
function renderAnalytics() {
  renderMonthlyChart();
  renderCategoryBars();
  renderHeatmap();
}

function renderMonthlyChart() {
  const canvas = document.getElementById('monthly-chart');
  const ctx = canvas.getContext('2d');
  const labels = [];
  const data = [];
  const now = new Date();

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }));
    const total = getMonthExpenses(d).reduce((s, e) => s + e.amount, 0);
    data.push(total);
  }

  if (monthlyChart) monthlyChart.destroy();
  monthlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data, backgroundColor: 'rgba(124,92,252,0.6)', hoverBackgroundColor: '#7c5cfc',
        borderRadius: 6, borderSkipped: false, barPercentage: 0.5
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#1a1a2e', titleColor: '#f0f0f5', bodyColor: '#f0f0f5',
        borderColor: 'rgba(255,255,255,.1)', borderWidth: 1, cornerRadius: 8,
        callbacks: { label: (ctx) => getCurrency() + ctx.parsed.y.toLocaleString() }
      }},
      scales: {
        x: { grid: { display: false }, ticks: { color: '#55556a', font: { size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#55556a', font: { size: 11 }, callback: v => getCurrency() + v } }
      }
    }
  });
}

function renderCategoryBars() {
  const monthly = getMonthExpenses();
  const cats = {};
  monthly.forEach(e => { cats[e.category] = (cats[e.category] || 0) + e.amount; });
  const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const max = entries[0] ? entries[0][1] : 1;

  const container = document.getElementById('category-bars');
  if (!entries.length) {
    container.innerHTML = '<span style="color:var(--text-muted);font-size:.85rem;padding:20px 0;display:block">No data this month</span>';
    return;
  }

  container.innerHTML = entries.map(([cat, amount]) => {
    const color = CATEGORY_COLORS[cat] || '#778ca3';
    const pct = (amount / max * 100).toFixed(1);
    return `
      <div class="cat-bar-item">
        <div class="cat-bar-header">
          <span class="cat-bar-name">${cat}</span>
          <span class="cat-bar-amount">${fmt(amount)}</span>
        </div>
        <div class="cat-bar-track">
          <div class="cat-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>`;
  }).join('');
}

function renderHeatmap() {
  const container = document.getElementById('heatmap-container');
  const now = new Date();
  const cells = [];

  for (let i = 89; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const total = expenses.filter(e => e.date === dateStr).reduce((s, e) => s + e.amount, 0);
    cells.push({ date: dateStr, total, label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) });
  }

  const maxVal = Math.max(...cells.map(c => c.total), 1);
  container.innerHTML = cells.map(c => {
    const intensity = c.total / maxVal;
    const bg = c.total === 0 ? 'rgba(255,255,255,.04)' :
      `rgba(124,92,252,${0.2 + intensity * 0.8})`;
    return `<div class="heatmap-cell" style="background:${bg}" data-tooltip="${c.label}: ${fmt(c.total)}"></div>`;
  }).join('');
}

// ===== Confirm Modal =====
function setupConfirmModal() {
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-cancel').addEventListener('click', () => modal.classList.remove('active'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
  document.getElementById('confirm-ok').addEventListener('click', () => {
    modal.classList.remove('active');
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
  });
}

function showConfirm(title, message, callback) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  confirmCallback = callback;
  document.getElementById('confirm-modal').classList.add('active');
}

// ===== Budget Alert =====
function setupBudgetAlert() {
  document.getElementById('budget-alert-dismiss').addEventListener('click', () => {
    document.getElementById('budget-alert').style.display = 'none';
  });
}

function renderBudgetAlert() {
  const budget = settings.budget || 0;
  const alert = document.getElementById('budget-alert');
  if (!budget) { alert.style.display = 'none'; return; }

  const spent = getMonthExpenses().reduce((s, e) => s + e.amount, 0);
  const pct = (spent / budget) * 100;
  const text = document.getElementById('budget-alert-text');

  if (pct >= 100) {
    alert.style.display = 'flex';
    alert.className = 'budget-alert danger';
    text.textContent = `You've exceeded your monthly budget by ${fmt(spent - budget)}!`;
  } else if (pct >= 80) {
    alert.style.display = 'flex';
    alert.className = 'budget-alert';
    text.textContent = `You've used ${pct.toFixed(0)}% of your monthly budget. ${fmt(budget - spent)} remaining.`;
  } else {
    alert.style.display = 'none';
  }
}

// ===== Import CSV =====
function importCSV(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(ev) {
    try {
      const lines = ev.target.result.split('\n').filter(l => l.trim());
      if (lines.length < 2) { showToast('CSV file is empty', 'error'); return; }
      const newExpenses = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].match(/(".*?"|[^,]+)/g);
        if (!cols || cols.length < 4) continue;
        const date = cols[0].replace(/"/g, '').trim();
        const category = cols[1].replace(/"/g, '').trim();
        const description = cols[2].replace(/"/g, '').trim();
        const amount = parseFloat(cols[3].replace(/"/g, '').trim());
        const payment = cols[4] ? cols[4].replace(/"/g, '').trim() : '💳 Card';
        if (!date || !category || isNaN(amount)) continue;
        newExpenses.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + i,
          amount, category, date,
          description: description || category,
          payment,
          createdAt: new Date().toISOString()
        });
      }
      if (newExpenses.length) {
        const res = await fetch(`${API}/expenses/bulk`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ expenses: newExpenses }) });
        const data = await res.json();
        expenses.push(...newExpenses);
        showToast(`${data.imported} expenses imported!`);
        renderAll();
      }
    } catch (err) {
      showToast('Failed to parse CSV file', 'error');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

// ===== Sidebar Overlay =====
function setupSidebarOverlay() {
  document.getElementById('sidebar-overlay').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('active');
  });
}
