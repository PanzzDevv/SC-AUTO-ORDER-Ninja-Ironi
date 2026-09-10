const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const {
  getAllOrders, getOrderStats, getAllStock, deleteStockCategory,
  updateOrderStatus, addAccount, getPrices, updatePrices, db,
  getAllUsers, setUserSaldo,
  getCategories, saveCategories, getCategoryById,
  cacheGet, cacheSet, cacheInvalidate
} = require('../firebase');
const { uploadFileToTelegram } = require('../telegramStorage');

// Ensure temp upload directory exists (use OS tempdir in serverless/Vercel)
const tempUploadDir = process.env.VERCEL
  ? path.join(require('os').tmpdir(), 'temp-uploads')
  : path.join(__dirname, '../../storage/temp-uploads/');

try {
  if (!fs.existsSync(tempUploadDir)) {
    fs.mkdirSync(tempUploadDir, { recursive: true });
  }
} catch (err) {
  console.warn('⚠️ [Upload] Could not create temp upload directory:', err.message);
}

// Multer for file uploads (temp storage)
const upload = multer({
  dest: tempUploadDir,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── VALIDATE TELEGRAM initData ───────────────────────────────────────────────
function validateTelegramInitData(initData) {
  try {
    const botToken = (process.env.BOT_TOKEN || '').trim();
    if (!botToken) return false;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;
    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData')
      .update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey)
      .update(dataCheckString).digest('hex');
    return computedHash === hash;
  } catch (err) {
    console.error('[validateTelegramInitData error]:', err.message);
    return false;
  }
}

// ─── LOGIN (web dashboard) ───────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    res.json({ success: true, token: process.env.ADMIN_SECRET_KEY || 'panzzstore2026' });
  } else {
    res.status(401).json({ error: 'Password salah' });
  }
});

// ─── MINIAPP AUTH (validate Telegram initData) ────────────────────────────────
router.post('/miniapp-auth', (req, res) => {
  const { initData } = req.body;
  if (!initData) return res.status(400).json({ error: 'NO_INIT_DATA', message: 'Data Telegram (initData) kosong.' });

  const botToken = (process.env.BOT_TOKEN || '').trim();
  if (!botToken) {
    console.error('❌ [MiniApp Auth] BOT_TOKEN is missing in Vercel Environment Variables!');
    return res.status(403).json({
      error: 'BOT_TOKEN_MISSING',
      message: 'BOT_TOKEN belum diset di Environment Variables Vercel.'
    });
  }

  const valid = validateTelegramInitData(initData);
  if (!valid) {
    console.warn('⚠️ [MiniApp Auth] Invalid Telegram hash verification failed.');
    return res.status(403).json({
      error: 'INVALID_INIT_DATA',
      message: 'Validasi token Telegram gagal. Pastikan BOT_TOKEN di Vercel sama persis dengan bot Telegram ini.'
    });
  }

  // Check if user is admin
  const params = new URLSearchParams(initData);
  const userJson = params.get('user');
  if (!userJson) return res.status(403).json({ error: 'NO_USER_DATA', message: 'Data user Telegram tidak ditemukan di initData.' });

  let user;
  try {
    user = JSON.parse(userJson);
  } catch {
    return res.status(400).json({ error: 'MALFORMED_USER', message: 'Format data user Telegram rusak.' });
  }

  const adminIds = (process.env.ADMIN_TELEGRAM_ID || '').split(',').map(s => s.trim()).filter(Boolean);
  if (adminIds.length === 0) {
    console.error('❌ [MiniApp Auth] ADMIN_TELEGRAM_ID is missing in Vercel Environment Variables!');
    return res.status(403).json({
      error: 'ADMIN_ID_MISSING',
      userId: user.id,
      message: 'ADMIN_TELEGRAM_ID belum diset di Environment Variables Vercel.'
    });
  }

  if (!adminIds.includes(String(user.id))) {
    console.warn(`⚠️ [MiniApp Auth] User ${user.id} (${user.username || user.first_name}) is not in adminIds:`, adminIds);
    return res.status(403).json({
      error: 'NOT_ADMIN',
      userId: user.id,
      message: `ID Telegram Anda (${user.id}) belum terdaftar di ADMIN_TELEGRAM_ID.`
    });
  }

  const secretToken = process.env.ADMIN_SECRET_KEY || 'panzzstore2026';
  res.json({ success: true, token: secretToken });
});

// ─── STATS ────────────────────────────────────────────────────────────────────
// OPTIMIZED: Stats endpoint sudah menggunakan cache dari firebase.js
// getOrderStats() cache 2 menit, getAllStock() cache 1 menit
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const [stats, stock] = await Promise.all([getOrderStats(), getAllStock()]);
    // Response-level cache header agar browser juga tidak spam request
    res.set('Cache-Control', 'private, max-age=30');
    res.json({ stats, stock });
  } catch (e) {
    console.error('Stats error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── ORDERS ───────────────────────────────────────────────────────────────────
router.get('/orders', adminAuth, async (req, res) => {
  try {
    const orders = await getAllOrders(100);
    res.json({ orders });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/orders/:id/confirm', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await updateOrderStatus(id, 'paid');

    // Manual delivery trigger
    const { deliverOrder } = require('../../bot/handlers/order');
    const botModule = require('../../bot/index');
    deliverOrder(botModule.bot, id).catch(console.error);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── STOCK / ACCOUNTS ─────────────────────────────────────────────────────────
router.get('/stock', adminAuth, async (req, res) => {
  try {
    const stock = await getAllStock();
    res.json({ stock });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete all stock for a specific category
router.delete('/stock', adminAuth, async (req, res) => {
  try {
    const { type, garansi } = req.body;
    if (!type || garansi === undefined) {
      return res.status(400).json({ error: 'type and garansi required' });
    }
    const garansiBool = garansi === 'true' || garansi === true;
    await deleteStockCategory(type, garansiBool);
    res.json({ success: true });
  } catch (e) {
    console.error('Delete stock error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Helper to calculate SHA-256 hash of a file using streams
function getFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', err => reject(err));
  });
}

// Upload account files ke Telegram Storage langsung
router.post('/stock/upload', adminAuth, upload.array('files', 500), async (req, res) => {
  try {
    const { type, garansi } = req.body;
    if (!type || garansi === undefined) {
      return res.status(400).json({ error: 'type and garansi required' });
    }
    const garansiBool = garansi === 'true' || garansi === true;
    const results = [];
    const errors = [];

    const { uploadFileToTelegram } = require('../telegramStorage');

    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'Tidak ada file akun yang terkirim ke server' });
    }

    for (const file of files) {
      try {
        // Hitung SHA-256 hash file temp
        const fileHash = await getFileHash(file.path);

        // Cek duplikasi hash di Firestore
        const existingSnapshot = await db.collection('accounts')
          .where('fileHash', '==', fileHash)
          .limit(1)
          .get();

        if (!existingSnapshot.empty) {
          throw new Error('Akun duplikat (file sudah pernah diupload sebelumnya)');
        }

        // Upload langsung ke Telegram Storage
        const telegramFileId = await uploadFileToTelegram(file.path, file.originalname);

        // Simpan ke Firestore dengan status available, telegramFileId terisi, storagePath kosong
        await addAccount(type, garansiBool, telegramFileId, file.originalname, '', fileHash);

        results.push({ fileName: file.originalname });
      } catch (err) {
        console.error(`Failed to process ${file.originalname}:`, err.message);
        errors.push({ fileName: file.originalname, error: err.message });
      } finally {
        // Hapus file temp selalu
        try { fs.unlinkSync(file.path); } catch (_) {}
      }
    }

    const hasErrors = errors.length > 0;
    res.json({
      success: !hasErrors,
      uploaded: results.length,
      failed: errors.length,
      results,
      ...(hasErrors ? { errors, error: errors.map(e => `${e.fileName}: ${e.error}`).join(' | ') } : {}),
    });
  } catch (e) {
    console.error('[Stock Upload Error]:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get remaining background uploads status
router.get('/stock/upload-status', adminAuth, async (req, res) => {
  res.json({ remaining: 0 });
});

// ─── BACKGROUND UPLOAD WORKER ────────────────────────────────────────────────
let isUploadingBackground = false;
async function triggerBackgroundUpload() {
  if (isUploadingBackground) return;
  isUploadingBackground = true;

  try {
    const { uploadFileToTelegram } = require('../telegramStorage');
    
    while (true) {
      // Ambil 1 akun yang belum di-upload ke Telegram
      const snapshot = await db.collection('accounts')
        .where('status', '==', 'available')
        .where('telegramFileId', '==', '')
        .limit(1)
        .get();

      if (snapshot.empty) break;

      const doc = snapshot.docs[0];
      const data = doc.data();
      const accountId = doc.id;
      
      if (!data.storagePath) {
        // Data tidak valid, lewati
        await db.collection('accounts').doc(accountId).update({
          telegramFileId: 'ERROR_NO_STORAGE_PATH'
        });
        continue;
      }

      const uuid = data.storagePath.split('/').pop();
      const localPath = path.join(__dirname, '../../storage/accounts/', uuid);

      if (!fs.existsSync(localPath)) {
        console.error(`Background upload error: Local file not found for account ${accountId}`);
        await db.collection('accounts').doc(accountId).update({
          telegramFileId: 'ERROR_LOCAL_FILE_MISSING'
        });
        continue;
      }

      try {
        console.log(`📤 [Background] Uploading ${data.fileName} to Telegram Channel...`);
        const telegramFileId = await uploadFileToTelegram(localPath, data.fileName);

        // Rename file lokal menggunakan telegramFileId agar sinkron dengan sistem cache
        const newLocalPath = path.join(__dirname, '../../storage/accounts/', telegramFileId);
        fs.renameSync(localPath, newLocalPath);

        // Update dokumen di Firestore
        await db.collection('accounts').doc(accountId).update({
          telegramFileId: telegramFileId,
          storagePath: ''
        });
        console.log(`✅ [Background] Upload success for ${data.fileName} -> ID: ${telegramFileId}`);
      } catch (uploadErr) {
        console.error(`[Background] Upload failed for ${data.fileName}:`, uploadErr.message);
        // Tunggu 5 detik sebelum mencoba lagi (jika karena limit/koneksi)
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  } catch (err) {
    console.error('[Background] Upload loop error:', err.message);
  } finally {
    isUploadingBackground = false;
  }
}

// Auto-run trigger on startup to resume any pending uploads (only in persistent server mode)
if (!process.env.VERCEL && process.env.DISABLE_BOT_POLLING !== 'true') {
  triggerBackgroundUpload().catch(console.error);
}

// ─── CATEGORIES ───────────────────────────────────────────────────────────────
router.get('/categories', adminAuth, async (req, res) => {
  try {
    const categories = await getCategories();
    res.json({ success: true, categories });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/categories', adminAuth, async (req, res) => {
  try {
    const { categories } = req.body;
    if (!categories || !Array.isArray(categories)) {
      return res.status(400).json({ error: 'Array categories dibutuhkan' });
    }
    const saved = await saveCategories(categories);
    res.json({ success: true, categories: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/categories/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const categories = await getCategories();
    if (categories.length <= 1) {
      return res.status(400).json({ error: 'Minimal harus ada 1 kategori yang tersisa' });
    }
    const filtered = categories.filter(c => c.id !== id);
    if (filtered.length === categories.length) {
      return res.status(404).json({ error: 'Kategori tidak ditemukan' });
    }
    const saved = await saveCategories(filtered);
    res.json({ success: true, categories: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PRICES ───────────────────────────────────────────────────────────────────
router.get('/prices', adminAuth, async (req, res) => {
  try {
    const prices = await getPrices();
    res.json({ prices });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/prices', adminAuth, async (req, res) => {
  try {
    const { prices } = req.body;
    await updatePrices(prices);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── REALTIME ORDERS (long-poll / snapshot for dashboard) ─────────────────────
// OPTIMIZED: Debounce SSE updates agar tidak kirim terlalu sering (min 5 detik antar update)
router.get('/orders/stream', adminAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let debounceTimer = null;
  const DEBOUNCE_MS = 5000; // Minimal 5 detik antar update SSE

  const unsubscribe = db.collection('orders')
    .orderBy('createdAt', 'desc')
    .limit(30) // Dikurangi dari 50 → 30 untuk hemat reads
    .onSnapshot(snapshot => {
      // Debounce: jika ada update berturut-turut, hanya kirim yang terakhir
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try {
          const orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          res.write(`data: ${JSON.stringify(orders)}\n\n`);
        } catch (err) {
          // Connection mungkin sudah ditutup
        }
      }, DEBOUNCE_MS);
    });

  req.on('close', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    unsubscribe();
  });
});

// ─── USER MANAGEMENT ──────────────────────────────────────────────────────────
router.get('/users', adminAuth, async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json({ users });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/users/:id/balance', adminAuth, async (req, res) => {
  try {
    const { balance } = req.body;
    const telegramId = req.params.id;
    if (balance === undefined || isNaN(balance)) {
      return res.status(400).json({ error: 'Valid balance is required' });
    }
    await setUserSaldo(telegramId, balance);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── BROADCAST MESSAGE ────────────────────────────────────────────────────────
router.post('/broadcast', adminAuth, async (req, res) => {
  try {
    const { message, imageUrl, buttonText, buttonUrl, preview, adminTelegramId } = req.body;
    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Pesan broadcast tidak boleh kosong' });
    }

    const botModule = require('../../bot/index');
    
    // Construct inline keyboard options if provided
    let reply_markup = null;
    if (buttonText && buttonUrl && buttonText.trim() !== '' && buttonUrl.trim() !== '') {
      reply_markup = {
        inline_keyboard: [[{ text: buttonText, url: buttonUrl }]]
      };
    }

    // Helper to send message to a single user
    const sendMessageToUser = async (uId) => {
      if (imageUrl && imageUrl.trim() !== '') {
        const opts = {
          caption: message,
          parse_mode: 'HTML',
          ...(reply_markup ? { reply_markup } : {})
        };
        await botModule.bot.sendPhoto(uId, imageUrl, opts);
      } else {
        const opts = {
          parse_mode: 'HTML',
          ...(reply_markup ? { reply_markup } : {})
        };
        await botModule.bot.sendMessage(uId, message, opts);
      }
    };

    // If it's a preview request
    if (preview) {
      if (!adminTelegramId) {
        return res.status(400).json({ error: 'ID Telegram Admin diperlukan untuk preview' });
      }
      try {
        await sendMessageToUser(String(adminTelegramId));
        return res.json({ success: true, message: 'Preview terkirim!' });
      } catch (err) {
        console.error('Preview broadcast failed:', err.message);
        return res.status(400).json({ error: `Gagal mengirim preview: ${err.message}` });
      }
    }

    // Otherwise, send broadcast to all users
    const users = await getAllUsers();
    let successCount = 0;
    let failCount = 0;

    const sendPromises = users.map(async (u) => {
      try {
        const uId = String(u.telegramId || u.id);
        await sendMessageToUser(uId);
        successCount++;
      } catch (err) {
        console.error(`Broadcast failed for user ${u.telegramId || u.id}:`, err.message);
        failCount++;
      }
    });

    await Promise.all(sendPromises);

    res.json({ success: true, total: users.length, successCount, failCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
