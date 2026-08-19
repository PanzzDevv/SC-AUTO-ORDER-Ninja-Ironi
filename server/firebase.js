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

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// ─── USERS ────────────────────────────────────────────────────────────────────
async function getUser(telegramId) {
  const doc = await db.collection('users').doc(String(telegramId)).get();
  if (!doc.exists) return null;
  const data = doc.data();
  
  // Hitung jumlah order sukses (done) secara dinamis
  const ordersSnapshot = await db.collection('orders')
    .where('userId', '==', String(telegramId))
    .where('status', '==', 'done')
    .get();

  return {
    ...data,
    saldo: data.saldo !== undefined ? data.saldo : (data.balance !== undefined ? data.balance : 0),
    totalOrders: ordersSnapshot.size
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
  const snapshot = await db.collection('accounts')
    .where('type', '==', type)
    .where('garansi', '==', garansi)
    .where('status', '==', 'available')
    .get();
  return snapshot.size;
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
  try {
    const doc = await db.collection('settings').doc('categories').get();
    if (doc.exists && Array.isArray(doc.data().list) && doc.data().list.length > 0) {
      return doc.data().list;
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

      return [
        { id: 'muda', name: mudaName, emoji: '🧒', priceGaransi: Number(mudaGaransi), priceNoGaransi: Number(mudaNoGaransi) },
        { id: 'tua',  name: tuaName,  emoji: '👴', priceGaransi: Number(tuaGaransi),  priceNoGaransi: Number(tuaNoGaransi) },
      ];
    }
  } catch (err) {
    console.error('Error reading fallback prices for categories:', err.message);
  }

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

    // Hapus dari Telegram Channel jika ada telegramFileId (opsional, bisa dibiarkan saja)
    // if (data.telegramFileId) { ... }

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
  return await db.collection('accounts').add({
    type,
    garansi,
    status: 'available',
    telegramFileId,
    fileName,
    fileHash,
    ...(storagePath ? { storagePath } : {}),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
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
}

async function getAllOrders(limitN = 50) {
  const snapshot = await db.collection('orders')
    .orderBy('createdAt', 'desc')
    .limit(limitN)
    .get();
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getOrderStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todaySnapshot = await db.collection('orders')
    .where('status', '==', 'done')
    .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(today))
    .get();
  const totalSnapshot = await db.collection('orders')
    .where('status', '==', 'done')
    .get();
  let todayRevenue = 0;
  todaySnapshot.docs.forEach(d => { todayRevenue += d.data().totalPrice || 0; });
  let totalRevenue = 0;
  totalSnapshot.docs.forEach(d => { totalRevenue += d.data().totalPrice || 0; });
  return {
    todayOrders: todaySnapshot.size,
    todayRevenue,
    totalOrders: totalSnapshot.size,
    totalRevenue,
  };
}

// ─── PRICES ───────────────────────────────────────────────────────────────────
async function getPrices() {
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
      return { ...doc.data(), ...prices };
    }
  } catch (err) {
    console.error('Error fetching settings/prices:', err.message);
  }

  return prices;
}

async function updatePrices(prices) {
  await db.collection('settings').doc('prices').set(prices, { merge: true });
}

function getPriceKey(type, garansi) {
  return `${type}_${garansi ? 'garansi' : 'no_garansi'}`;
}

async function getAllUsers() {
  const usersSnapshot = await db.collection('users').get();
  
  // Ambil semua order sukses (done) untuk menghitung totalOrders per user secara akurat
  const ordersSnapshot = await db.collection('orders')
    .where('status', '==', 'done')
    .get();
    
  const orderCounts = {};
  ordersSnapshot.docs.forEach(d => {
    const o = d.data();
    const uId = String(o.userId);
    orderCounts[uId] = (orderCounts[uId] || 0) + 1;
  });

  return usersSnapshot.docs.map(d => {
    const data = d.data();
    const uId = String(data.telegramId || d.id);
    return {
      id: d.id,
      telegramId: uId,
      ...data,
      saldo: data.saldo !== undefined ? data.saldo : (data.balance !== undefined ? data.balance : 0),
      totalOrders: orderCounts[uId] || 0,
      createdAt: data.createdAt ? (typeof data.createdAt.toDate === 'function' ? data.createdAt.toDate().toISOString() : data.createdAt) : null
    };
  });
}

async function setUserSaldo(telegramId, newSaldo) {
  // Update both 'saldo' and 'balance' for backward compatibility with older database schemas
  await db.collection('users').doc(String(telegramId)).update({
    saldo: Number(newSaldo),
    balance: Number(newSaldo)
  });
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
};

