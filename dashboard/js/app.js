// ─── AUTH ─────────────────────────────────────────────────────────────────────
const token = localStorage.getItem('adminToken');
if (!token) window.location.href = '/dashboard/index.html';

const API = (path) => `/api/admin${path}`;
const headers = () => ({ 'Content-Type': 'application/json', 'x-admin-token': token });

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
const pageTitles = {
  dashboard: ['Dashboard', 'Selamat datang kembali, Admin! 👋'],
  orders:    ['Semua Order', 'Kelola dan konfirmasi order masuk'],
  stock:     ['Stok Akun', 'Pantau ketersediaan akun TikTok'],
  upload:    ['Upload Akun', 'Tambah stok akun baru ke sistem'],
  prices:    ['Atur Harga', 'Konfigurasi harga per kategori akun'],
};

function showPage(page) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.getElementById(`nav-${page}`)?.classList.add('active');

  const [title, subtitle] = pageTitles[page] || ['', ''];
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('pageSubtitle').textContent = subtitle;

  if (page === 'dashboard') loadDashboard();
  if (page === 'orders')    loadOrders();
  if (page === 'stock')     loadStock();
  if (page === 'prices')    loadPrices();
}

// ─── FORMAT HELPERS ───────────────────────────────────────────────────────────
function rupiah(num) {
  return 'Rp ' + Number(num).toLocaleString('id-ID');
}

function timeAgo(timestamp) {
  if (!timestamp) return '—';
  const ts = timestamp._seconds ? timestamp._seconds * 1000 : new Date(timestamp).getTime();
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} jam lalu`;
  return `${Math.floor(hrs / 24)} hari lalu`;
}

function statusBadge(status) {
  const map = {
    pending:    ['⏳', 'pending', 'Pending'],
    paid:       ['💳', 'paid', 'Paid'],
    processing: ['⚙️', 'processing', 'Processing'],
    done:       ['✅', 'done', 'Selesai'],
    error:      ['❌', 'error', 'Error'],
    out_of_stock: ['⚠️', 'error', 'Kehabisan Stok'],
  };
  const [icon, cls, label] = map[status] || ['❓', 'pending', status];
  return `<span class="badge badge-${cls}">${icon} ${label}</span>`;
}

function orderRow(order, compact = false) {
  const typeName = order.type === 'muda' ? '🧒 Fresh Usia 0 Day' : '👴 Fresh Usia 2-8 Day';
  const garansiName = order.garansi ? '✅ Garansi' : '❌ No Garansi';
  const shortId = order.id.slice(0, 8) + '...';

  const confirmBtn = (order.status === 'pending' || order.status === 'paid')
    ? `<button class="btn btn-success" onclick="confirmOrder('${order.id}')">✅ Konfirmasi</button>`
    : '';

  if (compact) {
    return `<tr>
      <td><code style="font-size:.78rem">${shortId}</code></td>
      <td>@${order.username || '—'}</td>
      <td>${typeName} ${garansiName}</td>
      <td>${order.qty}</td>
      <td>${rupiah(order.totalPrice)}</td>
      <td>${statusBadge(order.status)}</td>
      <td>${confirmBtn}</td>
    </tr>`;
  }

  return `<tr>
    <td><code style="font-size:.78rem">${shortId}</code></td>
    <td>@${order.username || '—'}</td>
    <td>${typeName} ${garansiName}</td>
    <td>${order.qty}</td>
    <td>${rupiah(order.totalPrice)}</td>
    <td style="font-size:.8rem;color:#888">${timeAgo(order.createdAt)}</td>
    <td>${statusBadge(order.status)}</td>
    <td>${confirmBtn}</td>
  </tr>`;
}

// ─── LOAD DASHBOARD ───────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const res = await fetch(API('/stats'), { headers: headers() });
    const { stats, stock } = await res.json();

    document.getElementById('stat-today-orders').textContent = stats.todayOrders;
    document.getElementById('stat-today-revenue').textContent = rupiah(stats.todayRevenue);
    document.getElementById('stat-total-orders').textContent = stats.totalOrders;
    document.getElementById('stat-total-revenue').textContent = rupiah(stats.totalRevenue);

    const stockMap = {
      'muda_garansi': 's-muda-garansi',
      'muda_no_garansi': 's-muda-no',
      'tua_garansi': 's-tua-garansi',
      'tua_no_garansi': 's-tua-no',
    };

    stock.forEach(s => {
      const key = `${s.type}_${s.garansi ? 'garansi' : 'no_garansi'}`;
      const el = document.getElementById(stockMap[key]);
      if (el) el.textContent = s.count;
    });
  } catch (e) {
    console.error('Load dashboard error:', e);
  }

  // Load recent orders
  loadOrders(true);
}

// ─── LOAD ORDERS ──────────────────────────────────────────────────────────────
async function loadOrders(compact = false) {
  const tbody = document.getElementById(compact ? 'recentOrdersBody' : 'allOrdersBody');
  try {
    const res = await fetch(API('/orders'), { headers: headers() });
    const { orders } = await res.json();
    const list = compact ? orders.slice(0, 8) : orders;

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="8">
        <div class="empty-state"><div class="empty-icon">📭</div><h3>Belum ada order</h3><p>Order akan muncul di sini.</p></div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(o => orderRow(o, compact)).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#e11d48;">Gagal memuat data.</td></tr>`;
  }
}

// ─── CONFIRM ORDER ────────────────────────────────────────────────────────────
async function confirmOrder(orderId) {
  if (!confirm('Konfirmasi order ini dan kirim akun ke pembeli?')) return;
  try {
    const res = await fetch(API(`/orders/${orderId}/confirm`), {
      method: 'POST', headers: headers(),
    });
    const data = await res.json();
    if (data.success) {
      showToast('✅ Order dikonfirmasi! Akun sedang dikirim...', 'success');
      setTimeout(() => loadOrders(), 1500);
    } else {
      showToast('❌ Gagal konfirmasi order.', 'error');
    }
  } catch {
    showToast('❌ Terjadi kesalahan.', 'error');
  }
}

// ─── LOAD STOCK ───────────────────────────────────────────────────────────────
async function loadStock() {
  const grid = document.getElementById('stockDetailGrid');
  try {
    const res = await fetch(API('/stock'), { headers: headers() });
    const { stock } = await res.json();

    grid.innerHTML = stock.map(s => `
      <div class="stock-card">
        <div class="stock-emoji">${s.type === 'muda' ? '🧒' : '👴'}</div>
        <div class="stock-info">
          <h3>${s.label}</h3>
          <div class="stock-num" style="color: ${s.count > 5 ? '#A855F7' : s.count > 0 ? '#f59e0b' : '#ef4444'}">${s.count}</div>
          <div class="stock-unit">akun tersedia</div>
        </div>
      </div>
    `).join('');
  } catch {
    grid.innerHTML = '<div style="text-align:center;color:#e11d48;">Gagal memuat stok.</div>';
  }
}

// ─── UPLOAD ───────────────────────────────────────────────────────────────────
let selectedFiles = [];

function handleFileSelect(files) {
  selectedFiles = Array.from(files);
  const preview = document.getElementById('uploadPreview');
  const list = document.getElementById('uploadFileList');
  const title = document.getElementById('uploadPreviewTitle');

  title.textContent = `${selectedFiles.length} file dipilih`;
  list.innerHTML = selectedFiles.map((f, i) => `
    <div style="display:flex;align-items:center;gap:.4rem;background:#f8f7ff;border:1px solid #f0e6ff;padding:.4rem .75rem;border-radius:8px;font-size:.8rem;">
      📄 ${f.name}
      <button onclick="removeFile(${i})" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:.9rem;padding:0 .2rem;">✕</button>
    </div>
  `).join('');

  preview.style.display = 'block';
}

function removeFile(idx) {
  selectedFiles.splice(idx, 1);
  if (selectedFiles.length === 0) clearUpload();
  else handleFileSelect(selectedFiles);
}

function clearUpload() {
  selectedFiles = [];
  document.getElementById('uploadPreview').style.display = 'none';
  document.getElementById('fileInput').value = '';
}

async function doUpload() {
  if (!selectedFiles.length) return;
  const type = document.getElementById('uploadType').value;
  const garansi = document.getElementById('uploadGaransi').value;

  const formData = new FormData();
  formData.append('type', type);
  formData.append('garansi', garansi);
  selectedFiles.forEach(f => formData.append('files', f));

  document.getElementById('uploadProgress').style.display = 'block';
  document.getElementById('uploadBtn').disabled = true;

  // Simulate progress (real progress would need XMLHttpRequest)
  let prog = 0;
  const interval = setInterval(() => {
    prog = Math.min(prog + 10, 90);
    document.getElementById('uploadProgressBar').style.width = prog + '%';
  }, 200);

  try {
    const res = await fetch(API('/stock/upload'), {
      method: 'POST',
      headers: { 'x-admin-token': token },
      body: formData,
    });
    const data = await res.json();
    clearInterval(interval);
    document.getElementById('uploadProgressBar').style.width = '100%';

    if (data.success) {
      showToast(`✅ Berhasil upload ${data.uploaded} file akun!`, 'success');
      setTimeout(() => {
        document.getElementById('uploadProgress').style.display = 'none';
        document.getElementById('uploadProgressBar').style.width = '0%';
        document.getElementById('uploadBtn').disabled = false;
        clearUpload();
      }, 800);
    } else {
      showToast('❌ Upload gagal: ' + (data.error || 'Unknown error'), 'error');
    }
  } catch {
    clearInterval(interval);
    showToast('❌ Terjadi kesalahan saat upload.', 'error');
    document.getElementById('uploadBtn').disabled = false;
  }
}

// Drag and drop
const uploadZone = document.getElementById('uploadZone');
uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  handleFileSelect(e.dataTransfer.files);
});

// ─── PRICES ───────────────────────────────────────────────────────────────────
async function loadPrices() {
  try {
    const res = await fetch(API('/prices'), { headers: headers() });
    const { prices } = await res.json();
    document.getElementById('price-muda-garansi').value = prices.muda_garansi || '';
    document.getElementById('price-muda-no').value = prices.muda_no_garansi || '';
    document.getElementById('price-tua-garansi').value = prices.tua_garansi || '';
    document.getElementById('price-tua-no').value = prices.tua_no_garansi || '';
  } catch {
    showToast('❌ Gagal memuat harga.', 'error');
  }
}

async function savePrices() {
  const prices = {
    muda_garansi:    parseInt(document.getElementById('price-muda-garansi').value) || 0,
    muda_no_garansi: parseInt(document.getElementById('price-muda-no').value) || 0,
    tua_garansi:     parseInt(document.getElementById('price-tua-garansi').value) || 0,
    tua_no_garansi:  parseInt(document.getElementById('price-tua-no').value) || 0,
  };

  try {
    const res = await fetch(API('/prices'), {
      method: 'POST', headers: headers(), body: JSON.stringify({ prices }),
    });
    const data = await res.json();
    if (data.success) showToast('✅ Harga berhasil disimpan!', 'success');
    else showToast('❌ Gagal menyimpan harga.', 'error');
  } catch {
    showToast('❌ Terjadi kesalahan.', 'error');
  }
}

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
function logout() {
  if (confirm('Yakin mau keluar?')) {
    localStorage.removeItem('adminToken');
    window.location.href = '/dashboard/index.html';
  }
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(40px)'; toast.style.transition = '.3s'; setTimeout(() => toast.remove(), 300); }, 3500);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
loadDashboard();
