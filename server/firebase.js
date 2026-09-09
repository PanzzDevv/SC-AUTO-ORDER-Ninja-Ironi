require('dotenv').config();
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ─── FIREBASE INIT ────────────────────────────────────────────────────────────
// Prioritas 1: Gunakan serviceAccountKey.json jika ada di root project
// Prioritas 2: Gunakan environment variable FIREBASE_SERVICE_ACCOUNT (JSON string)
// Prioritas 3: Gunakan environment variables terpisah dari .env
let serviceAccount;

const jsonKeyPath = path.join(__dirname, '../serviceAccountKey.json');
if (fs.existsSync(jsonKeyPath)) {
  serviceAccount = require(jsonKeyPath);
  console.log('✅ Firebase: menggunakan serviceAccountKey.json');
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    console.log('✅ Firebase: menggunakan environment variable FIREBASE_SERVICE_ACCOUNT (JSON)');
  } catch (err) {
    console.error('❌ Gagal memproses FIREBASE_SERVICE_ACCOUNT JSON:', err.message);
  }
}

if (!serviceAccount) {
  serviceAccount = {
    type: 'service_account',
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
  };
  console.log('✅ Firebase: menggunakan environment variables terpisah');
}

let db;
try {
  if (!admin.apps.length) {
    if (serviceAccount && serviceAccount.project_id && (serviceAccount.private_key || serviceAccount.private_key_id)) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('✅ Firebase Admin initialized successfully.');
    } else {
      console.warn('⚠️ Firebase: Credentials not found. Please set FIREBASE_SERVICE_ACCOUNT or (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) in environment variables.');
    }
  }
  if (admin.apps.length) {
    db = admin.firestore();
  }
} catch (err) {
  console.error('❌ Firebase Admin initialization error:', err.message);
}

// Fallback proxy to provide clear error message if db is accessed before credentials are configured
if (!db) {
  db = new Proxy({}, {
    get(target, prop) {
      if (admin.apps.length) {
        db = admin.firestore();
        return db[prop];
      }
      throw new Error('Firebase credentials missing! Silakan set FIREBASE_SERVICE_ACCOUNT atau (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) di Settings > Environment Variables Vercel.');
    }
  });
}

// ─── IN-MEMORY CACHE SYSTEM ──────────────────────────────────────────────────
// Cache sederhana berbasis TTL untuk mengurangi reads Firestore secara drastis.
// Setiap entry punya: { data, expireAt }
const _cache = {};

/**
 * Ambil data dari cache. Return null jika expired atau belum ada.
 */
function cacheGet(key) {
  const entry = _cache[key];
  if (!entry) return null;
  if (Date.now() > entry.expireAt) {
    delete _cache[key];
    return null;
  }
  return entry.data;
}

/**
 * Simpan data ke cache dengan TTL dalam detik.
 */
function cacheSet(key, data, ttlSeconds) {
  _cache[key] = {
    data,
    expireAt: Date.now() + (ttlSeconds * 1000),
  };
}

/**
 * Hapus cache entry tertentu, atau semua yang cocok prefix.
 */
function cacheInvalidate(keyOrPrefix) {
  if (_cache[keyOrPrefix]) {
    delete _cache[keyOrPrefix];
    return;
  }
  // Invalidate by prefix
  for (const k of Object.keys(_cache)) {
    if (k.startsWith(keyOrPrefix)) {
      delete _cache[k];
    }
  }
}

// Cache TTL constants (dalam detik)
const CACHE_TTL = {
  CATEGORIES: 300,    // 5 menit — kategori jarang berubah
  ORDER_STATS: 120,   // 2 menit — stats tidak perlu real-time
  ALL_STOCK: 60,      // 1 menit — stok perlu lebih fresh
  STOCK_COUNT: 60,    // 1 menit
  PRICES: 300,        // 5 menit
  ALL_USERS: 60,      // 1 menit
};

// ─── USERS ────────────────────────────────────────────────────────────────────
async function getUser(telegramId) {
  const doc = await db.collection('users').doc(String(telegramId)).get();
  if (!doc.exists) return null;
  const data = doc.data();

  // OPTIMIZED: Gunakan field totalOrders yang tersimpan di dokumen user
  // BUKAN lagi query seluruh orders collection setiap kali (ini penyebab utama quota habis)
  return {
    ...data,
    saldo: data.saldo !== undefined ? data.saldo : (data.balance !== undefined ? data.balance : 0),
    totalOrders: data.totalOrders || 0
  };
}

async function createUser(telegramId, username, firstName) {
  const userData = {
    telegramId: String(telegramId),
    username: username || '',
    firstName: firstName || '',
    saldo: 0,
    totalOrders: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await db.collection('users').doc(String(telegramId)).set(userData);
  return userData;
}

async function getUserOrCreate(telegramId, username, firstName) {
  let user = await getUser(telegramId);
  if (!user) user = await createUser(telegramId, username, firstName);
  return user;
}

async function getUserByUsername(username) {
  const cleanedUsername = username.replace(/^@/, '').trim();
  if (!cleanedUsername) return null;

  const snapshot = await db.collection('users')
    .where('username', '==', cleanedUsername)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  const telegramId = doc.id;
  return getUser(telegramId);
}

async function updateUserSaldo(telegramId, amount) {
  await db.collection('users').doc(String(telegramId)).update({
    saldo: admin.firestore.FieldValue.increment(amount),
    balance: admin.firestore.FieldValue.increment(amount),
  });
}

// ─── ACCOUNTS (STOCK) ─────────────────────────────────────────────────────────
async function getAvailableAccounts(type, garansi, qty) {
  const snapshot = await db.collection('accounts')
    .where('type', '==', type)
    .where('garansi', '==', garansi)
    .where('status', '==', 'available')
    .limit(qty)
    .get();
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getStockCount(type, garansi) {
  // OPTIMIZED: Cek cache dulu
  const cacheKey = `stock_count_${type}_${garansi}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;

  // Coba gunakan count() aggregation (Firestore SDK v6.1+)
  // Count aggregation tidak dihitung sebagai document read
  try {
    const countResult = await db.collection('accounts')
      .where('type', '==', type)
      .where('garansi', '==', garansi)
      .where('status', '==', 'available')
      .count()
      .get();
    const count = countResult.data().count;
    cacheSet(cacheKey, count, CACHE_TTL.STOCK_COUNT);
    return count;
  } catch (err) {
    // Fallback jika SDK lama belum support count()
    const snapshot = await db.collection('accounts')
      .where('type', '==', type)
      .where('garansi', '==', garansi)
      .where('status', '==', 'available')
      .get();
    const count = snapshot.size;
    cacheSet(cacheKey, count, CACHE_TTL.STOCK_COUNT);
    return count;
  }
}

async function getStockItems(type, garansi) {
  const snapshot = await db.collection('accounts')
    .where('type', '==', type)
    .where('garansi', '==', garansi)
    .where('status', '==', 'available')
    .get();
  
  const items = [];
  snapshot.forEach(doc => {
    items.push({ id: doc.id, ...doc.data() });
  });
  return items;
}

// ─── CATEGORIES & PRICES ──────────────────────────────────────────────────────
const DEFAULT_CATEGORIES = [
  {
    id: 'muda',
    name: 'Fresh Usia 0 Day',
    emoji: '🧒',
    priceGaransi: 50000,
    priceNoGaransi: 30000,
  },
  {
    id: 'tua',
    name: 'Fresh Usia 2-8 Day',
    emoji: '👴',
    priceGaransi: 80000,
    priceNoGaransi: 60000,
  }
];

async function getCategories() {
  // OPTIMIZED: Cache selama 5 menit, karena kategori jarang berubah
  const cached = cacheGet('categories');
  if (cached) return cached;

  try {
    const doc = await db.collection('settings').doc('categories').get();
    if (doc.exists && Array.isArray(doc.data().list) && doc.data().list.length > 0) {
      const result = doc.data().list;
      cacheSet('categories', result, CACHE_TTL.CATEGORIES);
      return result;
    }
  } catch (err) {
    console.error('Error fetching settings/categories:', err.message);
  }

  // Fallback / Initial migration from settings/prices if available
  try {
    const pDoc = await db.collection('settings').doc('prices').get();
    if (pDoc.exists) {
      const pData = pDoc.data();
      const mudaName = pData.muda_name || 'Fresh Usia 0 Day';
      const tuaName = pData.tua_name || 'Fresh Usia 2-8 Day';
      const mudaGaransi = pData.muda_garansi !== undefined ? pData.muda_garansi : 50000;
      const mudaNoGaransi = pData.muda_no_garansi !== undefined ? pData.muda_no_garansi : 30000;
      const tuaGaransi = pData.tua_garansi !== undefined ? pData.tua_garansi : 80000;
      const tuaNoGaransi = pData.tua_no_garansi !== undefined ? pData.tua_no_garansi : 60000;

      const result = [
        { id: 'muda', name: mudaName, emoji: '🧒', priceGaransi: Number(mudaGaransi), priceNoGaransi: Number(mudaNoGaransi) },
        { id: 'tua',  name: tuaName,  emoji: '👴', priceGaransi: Number(tuaGaransi),  priceNoGaransi: Number(tuaNoGaransi) },
      ];
      cacheSet('categories', result, CACHE_TTL.CATEGORIES);
      return result;
    }
  } catch (err) {
    console.error('Error reading fallback prices for categories:', err.message);
  }

  cacheSet('categories', DEFAULT_CATEGORIES, CACHE_TTL.CATEGORIES);
  return DEFAULT_CATEGORIES;
}

async function saveCategories(categories) {
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error('Kategori tidak boleh kosong');
  }

  // Bersihkan dan format tiap kategori
  const cleanList = categories.map(c => {
    let cleanId = String(c.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (!cleanId) {
      cleanId = `cat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
    }
    return {
      id: cleanId,
      name: String(c.name || '').trim() || 'Akun TikTok',
      emoji: String(c.emoji || '📦').trim(),
      priceGaransi: Number(c.priceGaransi) || 0,
      priceNoGaransi: Number(c.priceNoGaransi) || 0,
    };
  });

  // Simpan ke Firestore doc settings/categories
  await db.collection('settings').doc('categories').set({
    list: cleanList,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Perbarui juga settings/prices untuk kompatibilitas script lama
  const priceMap = {};
  cleanList.forEach(c => {
    priceMap[`${c.id}_name`] = c.name;
    priceMap[`${c.id}_emoji`] = c.emoji;
    priceMap[`${c.id}_garansi`] = c.priceGaransi;
    priceMap[`${c.id}_no_garansi`] = c.priceNoGaransi;
  });
  await db.collection('settings').doc('prices').set(priceMap, { merge: true });

  // OPTIMIZED: Invalidate cache setelah write
  cacheInvalidate('categories');
  cacheInvalidate('prices');

  return cleanList;
}

async function getCategoryById(id) {
  const categories = await getCategories();
  const found = categories.find(c => c.id === id);
  if (found) return found;
  return {
    id: id || 'unknown',
    name: id === 'muda' ? 'Fresh Usia 0 Day' : id === 'tua' ? 'Fresh Usia 2-8 Day' : (id || 'Akun TikTok'),
    emoji: id === 'muda' ? '🧒' : id === 'tua' ? '👴' : '📦',
    priceGaransi: 0,
    priceNoGaransi: 0,
  };
}

async function getAllStock() {
  // OPTIMIZED: Cache selama 1 menit
  const cached = cacheGet('all_stock');
  if (cached) return cached;

  const categories = await getCategories();
  const result = [];
  
  for (const cat of categories) {
    const [itemsGaransi, itemsNoGaransi] = await Promise.all([
      getStockItems(cat.id, true),
      getStockItems(cat.id, false),
    ]);

    result.push({
      type: cat.id,
      garansi: true,
      label: `Akun Tiktok ${cat.name} + Garansi`,
      categoryName: cat.name,
      emoji: cat.emoji || '📦',
      count: itemsGaransi.length,
      items: itemsGaransi.map(i => ({
        id: i.id,
        fileName: i.fileName || 'Unknown File',
        createdAt: i.createdAt ? (typeof i.createdAt.toDate === 'function' ? i.createdAt.toDate().toISOString() : i.createdAt) : null,
      })),
    });

    result.push({
      type: cat.id,
      garansi: false,
      label: `Akun Tiktok ${cat.name} + No Garansi`,
      categoryName: cat.name,
      emoji: cat.emoji || '📦',
      count: itemsNoGaransi.length,
      items: itemsNoGaransi.map(i => ({
        id: i.id,
        fileName: i.fileName || 'Unknown File',
        createdAt: i.createdAt ? (typeof i.createdAt.toDate === 'function' ? i.createdAt.toDate().toISOString() : i.createdAt) : null,
      })),
    });
  }

  cacheSet('all_stock', result, CACHE_TTL.ALL_STOCK);
  return result;
}

async function deleteStockCategory(type, garansi) {
  const fs = require('fs');
  const path = require('path');

  const snapshot = await db.collection('accounts')
    .where('type', '==', type)
    .where('garansi', '==', garansi)
    .where('status', '==', 'available')
    .get();

  const batch = db.batch();

  snapshot.docs.forEach(doc => {
    batch.update(doc.ref, {
      status: 'deleted',
      deletedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const data = doc.data();

    // Fallback: hapus dari local jika masih ada storagePath lama
    if (data.storagePath) {
      try {
        const fullPath = path.join(__dirname, '..', data.storagePath);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      } catch (err) {
        console.error('Error deleting local file:', data.storagePath, err.message);
      }
    }
  });

  if (!snapshot.empty) {
    await batch.commit();
  }

  // OPTIMIZED: Invalidate stock cache setelah delete
  cacheInvalidate('all_stock');
  cacheInvalidate('stock_count');
}

async function markAccountsSold(accountIds) {
  const batch = db.batch();
  accountIds.forEach(id => {
    batch.update(db.collection('accounts').doc(id), {
      status: 'sold',
      soldAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();

  // OPTIMIZED: Invalidate stock cache setelah sold
  cacheInvalidate('all_stock');
  cacheInvalidate('stock_count');
}

/**
 * Tambah akun baru ke Firestore.
 * @param {string} type - 'muda' atau 'tua'
 * @param {boolean} garansi
 * @param {string} telegramFileId - Telegram File ID
 * @param {string} fileName - nama file asli
 * @param {string} [storagePath] - (legacy) path lokal lama, opsional
 * @param {string} [fileHash] - hash SHA-256 file
 */
async function addAccount(type, garansi, telegramFileId, fileName, storagePath = null, fileHash = '') {
  const result = await db.collection('accounts').add({
    type,
    garansi,
    status: 'available',
    telegramFileId,
    fileName,
    fileHash,
    ...(storagePath ? { storagePath } : {}),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // OPTIMIZED: Invalidate stock cache setelah add
  cacheInvalidate('all_stock');
  cacheInvalidate('stock_count');

  return result;
}

// ─── ORDERS ───────────────────────────────────────────────────────────────────
async function createOrder(userId, username, type, garansi, qty, totalPrice, paymentUrl, panzzpayInvoiceId, extraData = {}) {
  const orderData = {
    userId: String(userId),
    username: username || '',
    type,
    garansi,
    qty,
    totalPrice,
    paymentUrl: paymentUrl || '',
    panzzpayInvoiceId: panzzpayInvoiceId || '',
    pakasirOrderId: panzzpayInvoiceId || '', // backward compatibility
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...extraData,
  };
  const ref = await db.collection('orders').add(orderData);
  return { id: ref.id, ...orderData };
}

async function getOrder(orderId) {
  const doc = await db.collection('orders').doc(orderId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function getOrderByPanzzpayInvoiceId(invoiceId) {
  const snapshot = await db.collection('orders')
    .where('panzzpayInvoiceId', '==', invoiceId)
    .limit(1)
    .get();
  if (!snapshot.empty) {
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  }
  // Fallback to pakasirOrderId field if existing
  const fallbackSnapshot = await db.collection('orders')
    .where('pakasirOrderId', '==', invoiceId)
    .limit(1)
    .get();
  if (fallbackSnapshot.empty) return null;
  const doc = fallbackSnapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function getOrderByPakasirId(pakasirOrderId) {
  return await getOrderByPanzzpayInvoiceId(pakasirOrderId);
}

async function updateOrderStatus(orderId, status, extra = {}) {
  await db.collection('orders').doc(orderId).update({
    status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...extra,
  });

  // OPTIMIZED: Jika order selesai (done), increment totalOrders di user document
  // Ini menggantikan query dinamis yang lama — hemat ratusan reads per hari
  if (status === 'done') {
    try {
      const orderDoc = await db.collection('orders').doc(orderId).get();
      if (orderDoc.exists) {
        const orderData = orderDoc.data();
        const userId = String(orderData.userId);
        await db.collection('users').doc(userId).update({
          totalOrders: admin.firestore.FieldValue.increment(1),
        });
      }
    } catch (err) {
      console.error('Failed to increment totalOrders for user:', err.message);
    }

    // Invalidate order stats cache
    cacheInvalidate('order_stats');
  }
}

async function getAllOrders(limitN = 50) {
  const snapshot = await db.collection('orders')
    .orderBy('createdAt', 'desc')
    .limit(limitN)
    .get();
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getOrderStats() {
  // OPTIMIZED: Cache selama 2 menit — stats tidak perlu real-time
  const cached = cacheGet('order_stats');
  if (cached) return cached;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Coba gunakan count() aggregation untuk total orders (hemat reads)
  let totalOrders = 0;
  let totalRevenue = 0;
  let todayOrders = 0;
  let todayRevenue = 0;

  // Today stats — ini biasanya sedikit, jadi aman baca dokumen
  const todaySnapshot = await db.collection('orders')
    .where('status', '==', 'done')
    .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(today))
    .get();
  todaySnapshot.docs.forEach(d => { todayRevenue += d.data().totalPrice || 0; });
  todayOrders = todaySnapshot.size;

  // Total stats — OPTIMIZED: coba count() dulu, fallback ke full read
  try {
    const countResult = await db.collection('orders')
      .where('status', '==', 'done')
      .count()
      .get();
    totalOrders = countResult.data().count;

    // Untuk totalRevenue tetap perlu baca dokumen, tapi kita cache hasilnya
    const totalSnapshot = await db.collection('orders')
      .where('status', '==', 'done')
      .get();
    totalSnapshot.docs.forEach(d => { totalRevenue += d.data().totalPrice || 0; });
  } catch (err) {
    // Fallback jika count() tidak tersedia
    const totalSnapshot = await db.collection('orders')
      .where('status', '==', 'done')
      .get();
    totalOrders = totalSnapshot.size;
    totalSnapshot.docs.forEach(d => { totalRevenue += d.data().totalPrice || 0; });
  }

  const result = {
    todayOrders,
    todayRevenue,
    totalOrders,
    totalRevenue,
  };

  cacheSet('order_stats', result, CACHE_TTL.ORDER_STATS);
  return result;
}

// ─── PRICES ───────────────────────────────────────────────────────────────────
async function getPrices() {
  // OPTIMIZED: Cache selama 5 menit
  const cached = cacheGet('prices');
  if (cached) return cached;

  const categories = await getCategories();
  const prices = {};
  categories.forEach(c => {
    prices[`${c.id}_name`] = c.name;
    prices[`${c.id}_emoji`] = c.emoji;
    prices[`${c.id}_garansi`] = c.priceGaransi;
    prices[`${c.id}_no_garansi`] = c.priceNoGaransi;
  });

  // Ambil data mentah dari doc settings/prices jika ada
  try {
    const doc = await db.collection('settings').doc('prices').get();
    if (doc.exists) {
      const result = { ...doc.data(), ...prices };
      cacheSet('prices', result, CACHE_TTL.PRICES);
      return result;
    }
  } catch (err) {
    console.error('Error fetching settings/prices:', err.message);
  }

  cacheSet('prices', prices, CACHE_TTL.PRICES);
  return prices;
}

async function updatePrices(prices) {
  await db.collection('settings').doc('prices').set(prices, { merge: true });
  // OPTIMIZED: Invalidate cache
  cacheInvalidate('prices');
  cacheInvalidate('categories');
}

function getPriceKey(type, garansi) {
  return `${type}_${garansi ? 'garansi' : 'no_garansi'}`;
}

async function getAllUsers() {
  // OPTIMIZED: Cache selama 1 menit
  const cached = cacheGet('all_users');
  if (cached) return cached;

  const usersSnapshot = await db.collection('users').get();

  // OPTIMIZED: TIDAK lagi query semua orders untuk hitung totalOrders
  // totalOrders sudah disimpan sebagai field di dokumen user (di-increment saat order done)
  const result = usersSnapshot.docs.map(d => {
    const data = d.data();
    const uId = String(data.telegramId || d.id);
    return {
      id: d.id,
      telegramId: uId,
      ...data,
      saldo: data.saldo !== undefined ? data.saldo : (data.balance !== undefined ? data.balance : 0),
      totalOrders: data.totalOrders || 0,
      createdAt: data.createdAt ? (typeof data.createdAt.toDate === 'function' ? data.createdAt.toDate().toISOString() : data.createdAt) : null
    };
  });

  cacheSet('all_users', result, CACHE_TTL.ALL_USERS);
  return result;
}

async function setUserSaldo(telegramId, newSaldo) {
  // Update both 'saldo' and 'balance' for backward compatibility with older database schemas
  await db.collection('users').doc(String(telegramId)).update({
    saldo: Number(newSaldo),
    balance: Number(newSaldo)
  });
  // Invalidate users cache
  cacheInvalidate('all_users');
}

async function saveHelpTicket(adminMessageId, userId) {
  await db.collection('help_tickets').doc(String(adminMessageId)).set({
    userId: String(userId),
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

async function getUserIdFromHelpTicket(adminMessageId) {
  const doc = await db.collection('help_tickets').doc(String(adminMessageId)).get();
  return doc.exists ? doc.data().userId : null;
}

module.exports = {
  db, admin,
  getUser, getUserByUsername, createUser, getUserOrCreate, updateUserSaldo, getAllUsers, setUserSaldo,
  getAvailableAccounts, getStockCount, getStockItems, getAllStock, markAccountsSold, addAccount, deleteStockCategory,
  createOrder, getOrder, getOrderByPanzzpayInvoiceId, getOrderByPakasirId, updateOrderStatus, getAllOrders, getOrderStats,
  getCategories, saveCategories, getCategoryById,
  getPrices, updatePrices, getPriceKey,
  saveHelpTicket, getUserIdFromHelpTicket,
  // Export cache utilities untuk admin.js
  cacheGet, cacheSet, cacheInvalidate, CACHE_TTL,
};
