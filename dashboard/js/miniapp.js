// ─── TELEGRAM WEBAPP INIT ─────────────────────────────────────────────────────
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Set header color to match theme
tg.setHeaderColor('#A855F7');
tg.setBackgroundColor('#F8F7FF');

const ADMIN_IDS = (window.__ADMIN_IDS__ || '').split(',').map(s => s.trim());
const initData = tg.initData;
const user = tg.initDataUnsafe?.user;

// ─── AUTH CHECK ───────────────────────────────────────────────────────────────
async function checkAuth() {
  if (!user) {
    showUnauthorized();
    return;
  }

  try {
    const res = await apiFetch('/api/admin/miniapp-auth', {
      method: 'POST',
      body: JSON.stringify({ initData }),
    });

    if (res.ok) {
      const data = await res.json();
      window._adminToken = data.token;
      initApp();
    } else {
      showUnauthorized();
    }
  } catch (e) {
    // Dev fallback: if server not reachable, use local check
    console.warn('Auth server unreachable, using local check');
    if (ADMIN_IDS.includes(String(user.id))) {
      window._adminToken = 'dev-token';
      initApp();
    } else {
      showUnauthorized();
    }
  }
}

function showUnauthorized() {
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('unauthorizedScreen').style.display = 'flex';
}

window._categories = [];
window._prices = {};

function getCategory(typeId) {
  if (window._categories && window._categories.length) {
    const found = window._categories.find(c => c.id === typeId);
    if (found) return found;
  }
  if (typeId === 'muda') {
    return { id: 'muda', name: window._prices?.muda_name || 'Fresh Usia 0 Day', emoji: '🧒' };
  }
  if (typeId === 'tua') {
    return { id: 'tua', name: window._prices?.tua_name || 'Fresh Usia 2-8 Day', emoji: '👴' };
  }
  return { id: typeId, name: typeId || 'Akun TikTok', emoji: '📦' };
}

function renderUploadCategorySelector() {
  const container = document.getElementById('uploadCategorySegmented');
  if (!container) return;
  if (!window._categories || !window._categories.length) return;

  const isValidSelected = window._categories.some(c => c.id === selectedType);
  if (!isValidSelected) {
    selectedType = window._categories[0].id;
  }

  container.innerHTML = window._categories.map(c => `
    <button class="seg-btn ${c.id === selectedType ? 'active' : ''}" id="seg-cat-${c.id}" onclick="selectType('${c.id}', this)">
      ${c.emoji || '📦'} ${c.name}
    </button>
  `).join('');
}

async function fetchCategoriesGlobally() {
  try {
    const res = await apiFetch('/api/admin/categories');
    if (res.ok) {
      const data = await res.json();
      window._categories = data.categories || [];
      renderUploadCategorySelector();
    }
  } catch (e) {
    console.error('Gagal memuat kategori', e);
  }
}

async function fetchPricesGlobally() {
  try {
    const res = await apiFetch('/api/admin/prices');
    if (res.ok) {
      const data = await res.json();
      window._prices = data.prices || {};
    }
  } catch (e) {
    console.error('Gagal memuat harga secara global', e);
  }
}

async function initApp() {
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';

  // Greet
  const name = user?.first_name || 'Admin';
  document.getElementById('greetText').textContent = `Halo, ${name}! 👋`;

  await Promise.all([
    fetchCategoriesGlobally(),
    fetchPricesGlobally(),
  ]);

  renderUploadCategorySelector();
  loadHome();
}

// ─── API HELPER ───────────────────────────────────────────────────────────────
function apiFetch(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': window._adminToken || '',
      'x-tg-init-data': initData || '',
      ...(opts.headers || {}),
    },
  });
}

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
let currentTab = 'home';
let allOrders = [];
let currentFilter = 'all';

function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.getElementById(`nav-${tab}`).classList.add('active');
  currentTab = tab;

  tg.BackButton.isVisible = false;

  // Stop polling if moving away from upload tab
  if (tab !== 'upload') {
    stopSyncStatusPolling();
  }

  if (tab === 'home')     loadHome();
  if (tab === 'orders')   loadOrders();
  if (tab === 'stock')    loadStock();
  if (tab === 'settings') loadCategorySettings();
  if (tab === 'users')    loadUsers();
  if (tab === 'upload')   {
    renderUploadCategorySelector();
    startSyncStatusPolling();
  }
}

// ─── FORMAT HELPERS ───────────────────────────────────────────────────────────
function rupiah(num) {
  return 'Rp ' + Number(num).toLocaleString('id-ID');
}

function shortRupiah(num) {
  if (num >= 1000000) return 'Rp ' + (num / 1000000).toFixed(1) + 'jt';
  if (num >= 1000)    return 'Rp ' + (num / 1000).toFixed(0) + 'rb';
  return 'Rp ' + num;
}

function timeAgo(timestamp) {
  if (!timestamp) return '—';
  const ts = timestamp._seconds ? timestamp._seconds * 1000 : new Date(timestamp).getTime();
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Baru saja';
  if (mins < 60) return `${mins} mnt lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} jam lalu`;
  return `${Math.floor(hrs / 24)} hr lalu`;
}

function statusBadge(status) {
  const map = {
    pending:    ['⏳', 'pending', 'Pending'],
    paid:       ['💳', 'paid', 'Paid'],
    processing: ['⚙️', 'processing', 'Proses'],
    done:       ['✅', 'done', 'Selesai'],
    error:      ['❌', 'error', 'Error'],
    out_of_stock: ['⚠️', 'error', 'Habis'],
  };
  const [icon, cls, label] = map[status] || ['❓', 'pending', status];
  return `<span class="badge badge-${cls}">${icon} ${label}</span>`;
}

// ─── HOME ─────────────────────────────────────────────────────────────────────
async function loadHome() {
  try {
    const res = await apiFetch('/api/admin/stats');
    const { stats, stock } = await res.json();

    document.getElementById('m-today-orders').textContent = stats.todayOrders;
    document.getElementById('m-today-rev').textContent = shortRupiah(stats.todayRevenue);
    document.getElementById('m-total-orders').textContent = stats.totalOrders;
    document.getElementById('m-total-rev').textContent = shortRupiah(stats.totalRevenue);

    // Stock
    currentStockData = stock;
    const stockEl = document.getElementById('homeStockList');
    stockEl.innerHTML = stock.map((s, i) => stockItemHTML(s, i)).join('');

  } catch (e) {
    console.error('Load home error:', e);
  }

  // Recent orders
  try {
    const res = await apiFetch('/api/admin/orders');
    const { orders } = await res.json();
    allOrders = orders;

    const pending = orders.filter(o => o.status === 'pending').length;
    const badge = document.getElementById('pendingBadge');
    if (pending > 0) {
      badge.textContent = pending;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }

    const homeOrderEl = document.getElementById('homeOrderList');
    const recent = orders.slice(0, 5);
    homeOrderEl.innerHTML = recent.length
      ? recent.map(o => orderItemHTML(o)).join('')
      : '<p style="text-align:center;color:#999;padding:1rem;">Belum ada order</p>';

  } catch (e) {
    console.error('Load orders error:', e);
  }
}

let currentStockData = [];

function stockItemHTML(s, index) {
  const cat = getCategory(s.type);
  const emoji = s.emoji || cat.emoji || (s.type === 'muda' ? '🧒' : s.type === 'tua' ? '👴' : '📦');
  const color = s.count > 5 ? '#A855F7' : s.count > 0 ? '#f59e0b' : '#ef4444';
  
  return `<div class="stock-item" onclick="showStockModal(${index})" style="cursor:pointer; position:relative;">
    <div class="stock-emoji">${emoji}</div>
    <div class="stock-info">
      <h4>${s.label}</h4>
      <p>${s.count > 0 ? 'Tersedia' : 'Habis'}</p>
    </div>
    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0.4rem;">
      <div class="stock-count" style="color:${color}; text-align:right;">${s.count}</div>
      <button onclick="event.stopPropagation(); gotoRestock('${s.type}', ${s.garansi})" style="background:var(--primary); color:#fff; border:none; padding:4px 12px; border-radius:12px; font-size:0.7rem; font-weight:700; cursor:pointer; box-shadow:0 4px 12px rgba(168,85,247,0.3); transition:all 0.2s;">+ Restock</button>
    </div>
  </div>`;
}

function gotoRestock(type, garansi) {
  switchTab('upload');
  selectedType = type;
  renderUploadCategorySelector();
  const btn = document.getElementById(`seg-cat-${type}`);
  if (btn) selectType(type, btn);
  const garBtn = document.getElementById(garansi ? 'seg-yes' : 'seg-no');
  if (garBtn) selectGaransi(garansi ? 'true' : 'false', garBtn);
}

function showStockModal(index) {
  const s = currentStockData[index];
  if (!s) return;
  
  document.getElementById('stockModalTitle').textContent = s.label;
  document.getElementById('stockModalCount').textContent = s.count;
  
  const listEl = document.getElementById('stockFileList');
  if (s.items && s.items.length > 0) {
    listEl.innerHTML = s.items.map(i => `
      <div style="background:rgba(255,255,255,0.05); padding:0.75rem; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:0.85rem; color:#fff; word-break:break-all;">📄 ${i.fileName}</span>
        <span style="font-size:0.7rem; color:#999; white-space:nowrap; margin-left:0.5rem;">${timeAgo(i.createdAt)}</span>
      </div>
    `).join('');
    
    const btnDel = document.getElementById('btnDeleteStock');
    btnDel.style.display = 'block';
    btnDel.onclick = () => confirmDeleteStock(s.type, s.garansi, s.label);
  } else {
    listEl.innerHTML = '<p style="text-align:center; color:#999; font-size:0.9rem; margin-top:1rem;">Stok kosong.</p>';
    document.getElementById('btnDeleteStock').style.display = 'none';
  }
  
  document.getElementById('stockModal').style.display = 'flex';
}

function closeStockModal() {
  document.getElementById('stockModal').style.display = 'none';
}

async function confirmDeleteStock(type, garansi, label) {
  if (!confirm(`Yakin ingin MENGHAPUS SEMUA sisa stok untuk kategori:\n"${label}"?\n\nFile ZIP akan dihapus dari server dan tidak bisa dikembalikan!`)) return;
  
  closeStockModal();
  showToast(`⏳ Menghapus stok ${label}...`);
  
  try {
    const res = await apiFetch('/api/admin/stock', {
      method: 'DELETE',
      body: JSON.stringify({ type, garansi })
    });
    const data = await res.json();
    if (data.success) {
      showToast('✅ Stok berhasil dihapus!');
      loadHome();
      loadStock();
    } else {
      showToast('❌ Gagal menghapus: ' + data.error);
    }
  } catch (e) {
    showToast('❌ Terjadi kesalahan saat menghapus stok.');
  }
}

async function loadStock() {
  const el = document.getElementById('stockDetailList');
  try {
    const res = await apiFetch('/api/admin/stock');
    const { stock } = await res.json();
    currentStockData = stock;
    el.innerHTML = stock.map((s, i) => stockItemHTML(s, i)).join('');
  } catch {
    el.innerHTML = '<p style="color:#ef4444;text-align:center;padding:1rem;">Gagal memuat stok.</p>';
  }
}

// ─── ORDERS ───────────────────────────────────────────────────────────────────
function orderItemHTML(order) {
  const cat = getCategory(order.type);
  const typeName = `${cat.emoji || '📦'} ${cat.name}`;
  const garansiName = order.garansi ? '✅' : '❌';
  return `<div class="order-item" onclick="showOrderDetail('${order.id}')">
    <div class="order-item-top">
      <span class="order-item-id">#${order.panzzpayInvoiceId || order.pakasirOrderId || order.id.slice(0,8)}</span>
      ${statusBadge(order.status)}
    </div>
    <div class="order-item-user">@${order.username || 'unknown'}</div>
    <div class="order-item-product">${typeName} ${garansiName} — ${order.qty} akun</div>
    <div class="order-item-bottom">
      <span class="order-item-price">${rupiah(order.totalPrice)}</span>
      <span style="font-size:.7rem;color:#999">${timeAgo(order.createdAt)}</span>
    </div>
  </div>`;
}

async function loadOrders() {
  const el = document.getElementById('allOrderList');
  try {
    const res = await apiFetch('/api/admin/orders');
    const { orders } = await res.json();
    allOrders = orders;
    renderFilteredOrders();
  } catch {
    el.innerHTML = '<p style="color:#ef4444;text-align:center;padding:1rem;">Gagal memuat order.</p>';
  }
}

function renderFilteredOrders() {
  const el = document.getElementById('allOrderList');
  const filtered = currentFilter === 'all'
    ? allOrders
    : allOrders.filter(o => o.status === currentFilter);

  el.innerHTML = filtered.length
    ? filtered.map(o => orderItemHTML(o)).join('')
    : '<p style="text-align:center;color:#999;padding:2rem;">Tidak ada order.</p>';
}

function filterOrders(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderFilteredOrders();
}

// ─── ORDER DETAIL MODAL ───────────────────────────────────────────────────────
function showOrderDetail(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const cat = getCategory(order.type);
  const typeName = `${cat.emoji || '📦'} ${cat.name}`;
  const garansiName = order.garansi ? '✅ Garansi' : '❌ No Garansi';

  const canConfirm = order.status === 'pending' || order.status === 'paid';

  document.getElementById('modalBody').innerHTML = `
    <div class="modal-row">
      <span class="modal-row-label">Order ID (System)</span>
      <span class="modal-row-val" style="font-family:monospace;font-size:.75rem">${order.id}</span>
    </div>
    <div class="modal-row">
      <span class="modal-row-label">Invoice ID (PanzzPay)</span>
      <span class="modal-row-val" style="font-family:monospace;font-size:.75rem;color:#A855F7;font-weight:bold">${order.panzzpayInvoiceId || order.pakasirOrderId || '—'}</span>
    </div>
    <div class="modal-row">
      <span class="modal-row-label">Pembeli</span>
      <span class="modal-row-val">@${order.username || '—'}</span>
    </div>
    <div class="modal-row">
      <span class="modal-row-label">Produk</span>
      <span class="modal-row-val">${typeName} ${garansiName}</span>
    </div>
    <div class="modal-row">
      <span class="modal-row-label">Jumlah</span>
      <span class="modal-row-val">${order.qty} akun</span>
    </div>
    <div class="modal-row">
      <span class="modal-row-label">Total</span>
      <span class="modal-row-val" style="color:#A855F7">${rupiah(order.totalPrice)}</span>
    </div>
    <div class="modal-row">
      <span class="modal-row-label">Status</span>
      <span class="modal-row-val">${statusBadge(order.status)}</span>
    </div>
    <div class="modal-row">
      <span class="modal-row-label">Waktu</span>
      <span class="modal-row-val">${timeAgo(order.createdAt)}</span>
    </div>
    ${canConfirm ? `
    <button class="btn-primary full" style="margin-top:1rem;" onclick="confirmOrder('${order.id}')">
      ✅ Konfirmasi & Kirim Akun
    </button>` : ''}
  `;

  document.getElementById('orderModal').style.display = 'flex';
  tg.BackButton.show();
  tg.BackButton.onClick(() => closeModal());
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('orderModal')) return;
  document.getElementById('orderModal').style.display = 'none';
  tg.BackButton.hide();
}

async function confirmOrder(orderId) {
  tg.showConfirm('Konfirmasi order ini dan kirim akun ke pembeli?', async (confirmed) => {
    if (!confirmed) return;

    try {
      const res = await apiFetch(`/api/admin/orders/${orderId}/confirm`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('✅ Dikonfirmasi! Akun sedang dikirim...');
        closeModal();
        setTimeout(() => loadOrders(), 1500);
      } else {
        showToast('❌ Gagal konfirmasi.');
      }
    } catch {
      showToast('❌ Terjadi kesalahan.');
    }
  });
}

// ─── UPLOAD ───────────────────────────────────────────────────────────────────
let selectedFiles = [];
let selectedType = 'muda';
let selectedGaransi = 'true';

function selectType(val, btn) {
  selectedType = val;
  document.querySelectorAll('#uploadCategorySegmented .seg-btn').forEach(b => {
    b.classList.remove('active');
  });
  if (btn) {
    btn.classList.add('active');
  } else {
    const el = document.getElementById(`seg-cat-${val}`);
    if (el) el.classList.add('active');
  }
}

function selectGaransi(val, btn) {
  selectedGaransi = val;
  document.getElementById('seg-yes').classList.remove('active');
  document.getElementById('seg-no').classList.remove('active');
  btn.classList.add('active');
}

async function handleFiles(files) {
  if (!files || files.length === 0) return;
  
  if (files.length === 1 && files[0].name.endsWith('.zip')) {
    setOverlay('Mengekstrak ZIP...', 'Membaca struktur folder...', 0);
    try {
      const zip = new JSZip();
      await zip.loadAsync(files[0]);
      
      const validPaths = Object.keys(zip.files).filter(p => !zip.files[p].dir && !p.includes('.DS_Store') && !p.includes('__MACOSX'));
      
      if (validPaths.length > 0) {
        // Cari prefix (folder awal) yang sama di semua file
        let commonPrefix = validPaths[0].includes('/') ? validPaths[0].substring(0, validPaths[0].lastIndexOf('/') + 1) : '';
        for (let i = 1; i < validPaths.length; i++) {
          while (commonPrefix !== '' && validPaths[i].indexOf(commonPrefix) !== 0) {
            commonPrefix = commonPrefix.substring(0, commonPrefix.length - 1);
            const lastSlash = commonPrefix.lastIndexOf('/');
            commonPrefix = commonPrefix.substring(0, lastSlash + 1);
          }
        }
        
        const folders = {};
        validPaths.forEach(path => {
          const relPath = path.substring(commonPrefix.length);
          const parts = relPath.split('/');
          if (parts.length > 1) {
            const folderName = parts[0];
            if (!folders[folderName]) folders[folderName] = [];
            folders[folderName].push({ 
              originalPath: path, 
              relPathInsideNewZip: parts.slice(1).join('/') 
            });
          }
        });
        
        const folderNames = Object.keys(folders);
        
        // Jika ada lebih dari 1 folder unik, ini adalah Master ZIP!
        if (folderNames.length > 1) {
          selectedFiles = [];
          let processed = 0;
          
          for (let folderName of folderNames) {
            const newZip = new JSZip();
            const items = folders[folderName];
            
            for (let item of items) {
              const fileData = await zip.files[item.originalPath].async('blob');
              newZip.file(item.relPathInsideNewZip, fileData);
            }
            
            const newBlob = await newZip.generateAsync({ type: 'blob' });
            selectedFiles.push(new File([newBlob], `${folderName}.zip`, { type: 'application/zip' }));
            
            processed++;
            setOverlay('Memecah ZIP...', `Membuat ${processed} dari ${folderNames.length} akun...`, Math.round((processed / folderNames.length) * 100));
          }
          
          hideOverlay();
          renderFilePreview();
          return;
        }
      }
    } catch (e) {
      console.error('Master ZIP error', e);
    }
    hideOverlay();
  }
  
  selectedFiles = Array.from(files);
  renderFilePreview();
}

function setOverlay(title, desc, percent) {
  const ov = document.getElementById('loadingOverlay');
  if (ov) {
    ov.style.display = 'flex';
    document.getElementById('loadingTitle').textContent = title;
    document.getElementById('loadingDesc').textContent = desc;
    document.getElementById('loadingProgBar').style.width = percent + '%';
  }
}

function hideOverlay() {
  const ov = document.getElementById('loadingOverlay');
  if (ov) ov.style.display = 'none';
}

async function handleFolder(files) {
  if (!files || !files.length) return;
  
  // Mobile / Direct File check
  const isFlatFiles = !files[0].webkitRelativePath;
  
  if (isFlatFiles) {
    // On mobile, they just pick files (like .zip or .txt). Treat each as a separate account file.
    for (let file of files) {
      selectedFiles.push(file);
    }
    renderFilePreview();
    return;
  }

  const folders = {};
  
  let isSingleAccount = true;
  for(let file of files) {
    if (file.webkitRelativePath.split('/').length > 2) {
      isSingleAccount = false;
      break;
    }
  }

  for(let file of files) {
    const parts = file.webkitRelativePath.split('/');
    if (isSingleAccount) {
      const accountName = parts[0] || 'Unknown';
      if (!folders[accountName]) folders[accountName] = [];
      folders[accountName].push({ file: file, relativePath: parts.slice(1).join('/') });
    } else {
      if (parts.length >= 3) {
        const accountName = parts[1];
        if (!folders[accountName]) folders[accountName] = [];
        folders[accountName].push({ file: file, relativePath: parts.slice(2).join('/') });
      }
    }
  }

  const accountNames = Object.keys(folders);
  if (accountNames.length === 0) {
    showToast('❌ Tidak ada folder akun yang valid!');
    return;
  }

  setOverlay('Mengkompres ZIP', `Menyiapkan ${accountNames.length} folder...`, 0);
  await new Promise(r => setTimeout(r, 50)); // let UI render
  
  const zipBlobs = [];
  let processed = 0;
  for (const accountName of accountNames) {
    const zip = new window.JSZip();
    folders[accountName].forEach(item => {
      zip.file(item.relativePath, item.file);
    });
    const blob = await zip.generateAsync({type:"blob"});
    const zipFile = new File([blob], `${accountName}.zip`, { type: "application/zip" });
    zipBlobs.push(zipFile);
    
    processed++;
    const pct = Math.floor((processed / accountNames.length) * 100);
    setOverlay('Mengkompres ZIP', `Proses ${processed} dari ${accountNames.length} folder...`, pct);
  }

  selectedFiles = selectedFiles.concat(zipBlobs);
  renderFilePreview();
  hideOverlay();
  showToast(`✅ ${zipBlobs.length} folder siap di-upload!`);
  document.getElementById('folderInput').value = ''; // reset
}

function renderFilePreview() {
  const preview = document.getElementById('filePreview');
  const list = document.getElementById('fileList');
  const count = document.getElementById('fileCount');

  count.textContent = `${selectedFiles.length} file dipilih`;
  list.innerHTML = selectedFiles.map((f, i) => `
    <div class="file-item">
      <span>📄 ${f.name}</span>
      <button onclick="removeFile(${i})">✕</button>
    </div>
  `).join('');

  preview.style.display = selectedFiles.length ? 'block' : 'none';
}

function removeFile(idx) {
  selectedFiles.splice(idx, 1);
  if (!selectedFiles.length) clearFiles();
  else renderFilePreview();
}

function clearFiles() {
  selectedFiles = [];
  document.getElementById('fileInput').value = '';
  document.getElementById('folderInput').value = '';
  document.getElementById('filePreview').style.display = 'none';
}

async function doUpload() {
  if (!selectedFiles.length) return;

  const formData = new FormData();
  formData.append('type', selectedType);
  formData.append('garansi', selectedGaransi);
  selectedFiles.forEach(f => formData.append('files', f));

  document.getElementById('uploadBtn').disabled = true;
  setOverlay('Mengupload ke Server', 'Sedang mengirim data, mohon tunggu...', 0);

  let prog = 0;
  const interval = setInterval(() => {
    prog = Math.min(prog + 5, 90);
    setOverlay('Mengupload ke Server', 'Proses upload sedang berjalan...', prog);
  }, 200);

  try {
    const res = await fetch('/api/admin/stock/upload', {
      method: 'POST',
      headers: {
        'x-admin-token': window._adminToken || '',
        'x-tg-init-data': initData || '',
      },
      body: formData,
    });
    const data = await res.json();
    clearInterval(interval);
    setOverlay('Selesai!', 'Menyimpan konfigurasi...', 100);

    if (data.success) {
      setTimeout(() => {
        hideOverlay();
        showToast(`✅ ${data.uploaded} file berhasil diupload!`);
        document.getElementById('uploadBtn').disabled = false;
        clearFiles();
        checkUploadStatus(); // Check sync status immediately after upload
      }, 700);
    } else {
      hideOverlay();
      showToast('❌ Upload gagal: ' + (data.error || ''));
      document.getElementById('uploadBtn').disabled = false;
    }
  } catch {
    clearInterval(interval);
    hideOverlay();
    showToast('❌ Terjadi kesalahan saat upload.');
    document.getElementById('uploadBtn').disabled = false;
  }
}

// ─── CATEGORY & PRICE SETTINGS ───────────────────────────────────────────────
async function loadCategorySettings() {
  const container = document.getElementById('categorySettingsList');
  if (!container) return;
  
  container.innerHTML = `
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
  `;

  try {
    const res = await apiFetch('/api/admin/categories');
    const data = await res.json();
    window._categories = data.categories || [];
    renderCategorySettings();
  } catch (e) {
    console.error('Error loading category settings:', e);
    container.innerHTML = '<p style="color:#ef4444; text-align:center; padding:1rem;">Gagal memuat daftar kategori.</p>';
  }
}

function renderCategorySettings() {
  const container = document.getElementById('categorySettingsList');
  if (!container) return;

  if (!window._categories || !window._categories.length) {
    container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:1.5rem;">Belum ada kategori. Klik "➕ Tambah Kategori" di atas untuk membuat kategori baru.</p>';
    return;
  }

  container.innerHTML = window._categories.map((c) => `
    <div class="form-card" id="card-cat-${c.id}" style="margin-bottom:0.75rem; border:1px solid var(--border); border-radius:16px; padding:1.25rem; background:rgba(255,255,255,0.02); display:flex; flex-direction:column; gap:0.9rem;">
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:0.75rem;">
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span style="font-size:1.35rem;" id="badge-emoji-${c.id}">${c.emoji || '📦'}</span>
          <div style="text-align:left;">
            <div style="font-weight:700; color:#fff; font-size:0.95rem;" id="badge-name-${c.id}">${c.name}</div>
            <div style="font-size:0.7rem; color:var(--text-muted); font-family:monospace;">ID: ${c.id}</div>
          </div>
        </div>
        <button class="btn-danger" style="padding:0.35rem 0.75rem; font-size:0.75rem; border-radius:8px; cursor:pointer;" onclick="deleteCategory('${c.id}', '${c.name}')">🗑️ Hapus</button>
      </div>

      <!-- Nama & Emoji -->
      <div style="display:grid; grid-template-columns: 65px 1fr; gap:0.5rem;">
        <div>
          <label style="font-size:0.7rem; color:var(--text-muted); font-weight:700; display:block; margin-bottom:0.25rem;">Emoji</label>
          <input type="text" id="cat-emoji-${c.id}" value="${c.emoji || '📦'}" maxlength="4" oninput="document.getElementById('badge-emoji-${c.id}').textContent = this.value || '📦'" style="width:100%; text-align:center; background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:10px; color:#fff; padding:0.65rem 0; font-size:1.15rem; outline:none; box-sizing:border-box;" />
        </div>
        <div>
          <label style="font-size:0.7rem; color:var(--text-muted); font-weight:700; display:block; margin-bottom:0.25rem;">Nama Kategori</label>
          <input type="text" id="cat-name-${c.id}" value="${c.name}" oninput="document.getElementById('badge-name-${c.id}').textContent = this.value || 'Akun TikTok'" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:10px; color:#fff; padding:0.65rem 0.75rem; font-size:0.9rem; outline:none; box-sizing:border-box;" />
        </div>
      </div>

      <!-- Harga -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem;">
        <div>
          <label style="font-size:0.7rem; color:var(--text-muted); font-weight:700; display:block; margin-bottom:0.25rem;">✅ Garansi (Rp)</label>
          <div style="display:flex; align-items:center; background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:10px; padding:0 0.5rem;">
            <span style="font-size:0.75rem; color:var(--primary-light); font-weight:700; margin-right:0.2rem;">Rp</span>
            <input type="number" id="cat-price-g-${c.id}" value="${c.priceGaransi || 0}" style="background:none; border:none; color:#fff; padding:0.65rem 0.2rem; font-size:0.85rem; outline:none; width:100%;" />
          </div>
        </div>
        <div>
          <label style="font-size:0.7rem; color:var(--text-muted); font-weight:700; display:block; margin-bottom:0.25rem;">❌ No Garansi (Rp)</label>
          <div style="display:flex; align-items:center; background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:10px; padding:0 0.5rem;">
            <span style="font-size:0.75rem; color:var(--primary-light); font-weight:700; margin-right:0.2rem;">Rp</span>
            <input type="number" id="cat-price-ng-${c.id}" value="${c.priceNoGaransi || 0}" style="background:none; border:none; color:#fff; padding:0.65rem 0.2rem; font-size:0.85rem; outline:none; width:100%;" />
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

async function saveAllCategories() {
  if (!window._categories || !window._categories.length) {
    showToast('❌ Tidak ada kategori untuk disimpan.');
    return;
  }

  const updatedCategories = window._categories.map(c => {
    const nameEl = document.getElementById(`cat-name-${c.id}`);
    const emojiEl = document.getElementById(`cat-emoji-${c.id}`);
    const priceGEl = document.getElementById(`cat-price-g-${c.id}`);
    const priceNGEl = document.getElementById(`cat-price-ng-${c.id}`);

    return {
      id: c.id,
      name: nameEl ? nameEl.value.trim() : c.name,
      emoji: emojiEl ? emojiEl.value.trim() : c.emoji,
      priceGaransi: priceGEl ? parseInt(priceGEl.value) || 0 : c.priceGaransi,
      priceNoGaransi: priceNGEl ? parseInt(priceNGEl.value) || 0 : c.priceNoGaransi,
    };
  });

  showToast('⏳ Menyimpan semua perubahan...');

  try {
    const res = await apiFetch('/api/admin/categories', {
      method: 'POST',
      body: JSON.stringify({ categories: updatedCategories }),
    });
    const data = await res.json();
    if (data.success) {
      window._categories = data.categories;
      renderCategorySettings();
      renderUploadCategorySelector();
      tg.showAlert('✅ Seluruh pengaturan kategori dan harga berhasil disimpan!');
    } else {
      showToast('❌ Gagal menyimpan: ' + (data.error || ''));
    }
  } catch (err) {
    console.error('Save categories error:', err);
    showToast('❌ Terjadi kesalahan saat menyimpan.');
  }
}

// ─── ADD CATEGORY MODAL ───────────────────────────────────────────────────────
function openAddCategoryModal() {
  document.getElementById('newCatName').value = '';
  document.getElementById('newCatEmoji').value = '📦';
  document.getElementById('newCatPriceGaransi').value = '';
  document.getElementById('newCatPriceNoGaransi').value = '';
  document.getElementById('addCategoryModal').style.display = 'flex';
}

function closeAddCategoryModal(e) {
  if (e && e.target !== document.getElementById('addCategoryModal')) return;
  document.getElementById('addCategoryModal').style.display = 'none';
}

async function submitAddCategory() {
  const name = document.getElementById('newCatName').value.trim();
  const emoji = document.getElementById('newCatEmoji').value.trim() || '📦';
  const priceG = parseInt(document.getElementById('newCatPriceGaransi').value) || 0;
  const priceNG = parseInt(document.getElementById('newCatPriceNoGaransi').value) || 0;

  if (!name) {
    showToast('❌ Harap isi nama kategori!');
    return;
  }

  // Generate ID slug
  let slug = name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (!slug || window._categories.some(c => c.id === slug)) {
    slug = `${slug ? slug + '_' : 'cat_'}${Date.now().toString(36)}`;
  }

  const newCategory = {
    id: slug,
    name,
    emoji,
    priceGaransi: priceG,
    priceNoGaransi: priceNG,
  };

  const updatedList = [...(window._categories || []), newCategory];

  showToast('⏳ Menambahkan kategori...');

  try {
    const res = await apiFetch('/api/admin/categories', {
      method: 'POST',
      body: JSON.stringify({ categories: updatedList }),
    });
    const data = await res.json();
    if (data.success) {
      window._categories = data.categories;
      closeAddCategoryModal();
      renderCategorySettings();
      renderUploadCategorySelector();
      showToast(`✅ Kategori "${name}" berhasil ditambahkan!`);
    } else {
      showToast('❌ Gagal menambah kategori: ' + (data.error || ''));
    }
  } catch (err) {
    showToast('❌ Terjadi kesalahan saat menambah kategori.');
  }
}

async function deleteCategory(id, name) {
  if (window._categories.length <= 1) {
    showToast('⚠️ Minimal harus ada 1 kategori aktif!');
    return;
  }

  if (!confirm(`Yakin ingin MENGHAPUS kategori "${name}"?\n\nKategori ini tidak akan muncul lagi di pilihan bot Telegram dan panel upload.`)) {
    return;
  }

  showToast(`⏳ Menghapus kategori ${name}...`);

  try {
    const res = await apiFetch(`/api/admin/categories/${id}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (data.success) {
      window._categories = data.categories;
      renderCategorySettings();
      renderUploadCategorySelector();
      showToast('✅ Kategori berhasil dihapus!');
    } else {
      showToast('❌ Gagal menghapus: ' + (data.error || ''));
    }
  } catch (err) {
    showToast('❌ Terjadi kesalahan saat menghapus kategori.');
  }
}

// ─── USER MANAGEMENT ──────────────────────────────────────────────────────────
let allUsers = [];
async function loadUsers() {
  const listEl = document.getElementById('usersList');
  listEl.innerHTML = `
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
  `;

  try {
    const res = await apiFetch('/api/admin/users');
    const data = await res.json();
    allUsers = data.users || [];
    renderUsers(allUsers);
  } catch (err) {
    showToast('❌ Gagal memuat data user');
    listEl.innerHTML = `<div class="empty-state">Gagal memuat data user.</div>`;
  }
}

function renderUsers(usersList) {
  const listEl = document.getElementById('usersList');
  if (usersList.length === 0) {
    listEl.innerHTML = `<div class="empty-state">Tidak ada user ditemukan.</div>`;
    return;
  }

  listEl.innerHTML = usersList.map(u => {
    const usernameDisplay = u.username ? `@${u.username}` : `User_${u.telegramId.slice(-4)}`;
    const nameDisplay = u.firstName || 'Tanpa Nama';
    const totalOrders = u.totalOrders || 0;
    
    return `
      <div class="stock-cat-row" style="padding: 1rem; margin-bottom: 0.75rem; display:flex; flex-direction:column; gap:0.5rem; border:1px solid var(--border); border-radius:16px; background:rgba(255,255,255,0.02);">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="text-align:left;">
            <div style="font-weight:700; color:#fff; font-size:0.95rem;">${nameDisplay}</div>
            <div style="font-size:0.8rem; color:var(--text-muted);">${usernameDisplay} • ID: <code>${u.telegramId}</code></div>
          </div>
          <button class="btn-primary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; border-radius: 8px; flex-shrink:0;" onclick="openSaldoModal('${u.telegramId}', '${u.username || ''}', ${u.saldo || 0})">✏️ Edit Saldo</button>
        </div>
        <div style="display:flex; gap:1rem; border-top: 1px solid rgba(255,255,255,0.05); padding-top:0.5rem; font-size:0.8rem; color:#bbb;">
          <div>💰 Saldo: <b style="color:var(--success);">${rupiah(u.saldo || 0)}</b></div>
          <div>🛒 Total Order: <b>${totalOrders}x</b></div>
        </div>
      </div>
    `;
  }).join('');
}

function searchUsers() {
  const query = document.getElementById('userSearchInput').value.toLowerCase().trim();
  if (!query) {
    renderUsers(allUsers);
    return;
  }

  const filtered = allUsers.filter(u => {
    const username = (u.username || '').toLowerCase();
    const telegramId = (u.telegramId || '').toLowerCase();
    const firstName = (u.firstName || '').toLowerCase();
    return username.includes(query) || telegramId.includes(query) || firstName.includes(query);
  });

  renderUsers(filtered);
}

let activeEditUserId = null;
function openSaldoModal(userId, username, saldo) {
  activeEditUserId = userId;
  document.getElementById('modalUserLabel').innerHTML = `User: <b>${username ? '@' + username : 'ID ' + userId}</b>`;
  document.getElementById('modalSaldoInput').value = saldo;
  
  const modal = document.getElementById('saldoModal');
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
}

function closeSaldoModal(e) {
  if (e && e.target !== e.currentTarget && e.target.className !== 'modal-close' && e.target.className !== 'btn-secondary full') {
    return;
  }
  document.getElementById('saldoModal').style.display = 'none';
  activeEditUserId = null;
}

async function saveUserSaldo() {
  if (!activeEditUserId) return;
  const newSaldo = parseInt(document.getElementById('modalSaldoInput').value);
  if (isNaN(newSaldo) || newSaldo < 0) {
    showToast('❌ Saldo tidak valid');
    return;
  }

  setOverlay('Menyimpan...', 'Memperbarui saldo user...', 50);

  try {
    const res = await apiFetch(`/api/admin/users/${activeEditUserId}/balance`, {
      method: 'POST',
      body: JSON.stringify({ balance: newSaldo })
    });
    const data = await res.json();
    hideOverlay();

    if (data.success) {
      showToast('✅ Saldo berhasil diperbarui!');
      closeSaldoModal();
      loadUsers();
    } else {
      showToast('❌ Gagal memperbarui saldo.');
    }
  } catch {
    hideOverlay();
    showToast('❌ Terjadi kesalahan.');
  }
}

// ─── BROADCAST ────────────────────────────────────────────────────────────────
async function sendBroadcast() {
  const msgEl = document.getElementById('broadcastMsg');
  const imgUrlEl = document.getElementById('broadcastImgUrl');
  const btnTextEl = document.getElementById('broadcastBtnText');
  const btnUrlEl = document.getElementById('broadcastBtnUrl');
  const btnEl = document.getElementById('btnSendBroadcast');

  const message = msgEl.value.trim();
  const imageUrl = imgUrlEl.value.trim();
  const buttonText = btnTextEl.value.trim();
  const buttonUrl = btnUrlEl.value.trim();

  if (!message) {
    showToast('⚠️ Silakan isi pesan broadcast terlebih dahulu!');
    return;
  }

  if ((buttonText && !buttonUrl) || (!buttonText && buttonUrl)) {
    showToast('⚠️ Jika ingin menggunakan tombol aksi, isi Teks Tombol DAN Link URL secara bersamaan!');
    return;
  }

  if (!confirm('Apakah Anda yakin ingin mengirim broadcast ke seluruh user?')) {
    return;
  }

  btnEl.disabled = true;
  btnEl.textContent = '⏳ Mengirim...';

  try {
    const res = await apiFetch('/api/admin/broadcast', {
      method: 'POST',
      body: JSON.stringify({ message, imageUrl, buttonText, buttonUrl }),
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`✅ Broadcast terkirim ke ${data.successCount} user!`);
      msgEl.value = '';
      imgUrlEl.value = '';
      btnTextEl.value = '';
      btnUrlEl.value = '';
    } else {
      showToast(`❌ Gagal: ${data.error || 'Terjadi kesalahan'}`);
    }
  } catch (e) {
    showToast(`❌ Gagal mengirim broadcast: ${e.message}`);
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = '🚀 Kirim Broadcast';
  }
}

async function previewBroadcast() {
  const msgEl = document.getElementById('broadcastMsg');
  const imgUrlEl = document.getElementById('broadcastImgUrl');
  const btnTextEl = document.getElementById('broadcastBtnText');
  const btnUrlEl = document.getElementById('broadcastBtnUrl');
  const btnEl = document.getElementById('btnPreviewBroadcast');

  const message = msgEl.value.trim();
  const imageUrl = imgUrlEl.value.trim();
  const buttonText = btnTextEl.value.trim();
  const buttonUrl = btnUrlEl.value.trim();

  if (!message) {
    showToast('⚠️ Silakan isi pesan broadcast terlebih dahulu!');
    return;
  }

  if ((buttonText && !buttonUrl) || (!buttonText && buttonUrl)) {
    showToast('⚠️ Isi Teks Tombol DAN Link URL untuk mencoba tombol aksi!');
    return;
  }

  if (!user || !user.id) {
    showToast('❌ Gagal mendapatkan ID Telegram Anda untuk preview.');
    return;
  }

  btnEl.disabled = true;
  btnEl.textContent = '⏳...';

  try {
    const res = await apiFetch('/api/admin/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        message,
        imageUrl,
        buttonText,
        buttonUrl,
        preview: true,
        adminTelegramId: user.id
      }),
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('✅ Preview terkirim ke Telegram Anda!');
    } else {
      showToast(`❌ Preview gagal: ${data.error || 'Terjadi kesalahan'}`);
    }
  } catch (e) {
    showToast(`❌ Error: ${e.message}`);
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = '👁️ Preview';
  }
}

function resetBroadcastForm() {
  document.getElementById('broadcastMsg').value = '';
  document.getElementById('broadcastImgUrl').value = '';
  document.getElementById('broadcastBtnText').value = '';
  document.getElementById('broadcastBtnUrl').value = '';
  showToast('🧹 Input broadcast di-reset!');
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toastEl');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ─── BACKGROUND SYNC STATUS ──────────────────────────────────────────────────
let syncStatusInterval = null;

async function checkUploadStatus() {
  try {
    const res = await apiFetch('/api/admin/stock/upload-status');
    if (res.ok) {
      const data = await res.json();
      const el = document.getElementById('syncStatus');
      if (!el) return;
      if (data.remaining > 0) {
        el.style.display = 'inline-block';
        el.innerHTML = `⏳ <b>Sisa upload ke Telegram:</b> ${data.remaining} file...`;
        el.style.borderColor = 'rgba(234,179,8,0.3)';
        el.style.color = '#facc15'; // yellow
        el.style.background = 'rgba(234,179,8,0.05)';
      } else {
        el.style.display = 'inline-block';
        el.innerHTML = `✅ Semua stok tersinkron ke Telegram!`;
        el.style.borderColor = 'rgba(34,197,94,0.3)';
        el.style.color = '#4ade80'; // green
        el.style.background = 'rgba(34,197,94,0.05)';
      }
    }
  } catch (err) {
    console.error('Failed to fetch sync status:', err);
  }
}

function startSyncStatusPolling() {
  stopSyncStatusPolling();
  checkUploadStatus();
  syncStatusInterval = setInterval(checkUploadStatus, 5000);
}

function stopSyncStatusPolling() {
  if (syncStatusInterval) {
    clearInterval(syncStatusInterval);
    syncStatusInterval = null;
  }
}

// ─── DRAG & DROP HANDLERS ─────────────────────────────────────────────────────
function handleDragOver(e) {
  e.preventDefault();
  const dz = document.getElementById('dropZone');
  if (dz) dz.classList.add('dragover');
}

function handleDragLeave(e) {
  e.preventDefault();
  const dz = document.getElementById('dropZone');
  if (dz) dz.classList.remove('dragover');
}

function handleDrop(e) {
  e.preventDefault();
  const dz = document.getElementById('dropZone');
  if (dz) dz.classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files && files.length) {
    handleFiles(files);
  }
}

// ─── START ────────────────────────────────────────────────────────────────────
checkAuth();
