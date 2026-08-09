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
  getAllUsers, setUserSaldo
} = require('../firebase');
const { uploadFileToTelegram } = require('../telegramStorage');

// Ensure temp upload directory exists
const tempUploadDir = path.join(__dirname, '../../storage/temp-uploads/');
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
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
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData')
      .update(process.env.BOT_TOKEN).digest();
    const computedHash = crypto.createHmac('sha256', secretKey)
      .update(dataCheckString).digest('hex');
    return computedHash === hash;
  } catch { return false; }
}

// ─── LOGIN (web dashboard) ───────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    res.json({ success: true, token: process.env.ADMIN_SECRET_KEY });
  } else {
    res.status(401).json({ error: 'Password salah' });
  }
});

// ─── MINIAPP AUTH (validate Telegram initData) ────────────────────────────────
router.post('/miniapp-auth', (req, res) => {
  const { initData } = req.body;
  if (!initData) return res.status(400).json({ error: 'No initData' });

  const valid = validateTelegramInitData(initData);
  if (!valid) return res.status(403).json({ error: 'Invalid initData' });

  // Check if user is admin
  const params = new URLSearchParams(initData);
  const userJson = params.get('user');
  if (!userJson) return res.status(403).json({ error: 'No user' });

  const user = JSON.parse(userJson);
  const adminIds = (process.env.ADMIN_TELEGRAM_ID || '').split(',').map(s => s.trim());
  if (!adminIds.includes(String(user.id))) {
    return res.status(403).json({ error: 'Not admin' });
  }

  res.json({ success: true, token: process.env.ADMIN_SECRET_KEY });
});

// ─── STATS ────────────────────────────────────────────────────────────────────
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const [stats, stock] = await Promise.all([getOrderStats(), getAllStock()]);
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

    for (const file of req.files) {
      try {
        // Hitung SHA-256 hash file temp
        const fileHash = await getFileHash(file.path);

        // Cek duplikasi hash di Firestore
        const existingSnapshot = await db.collection('accounts')
          .where('fileHash', '==', fileHash)
          .limit(1)
          .get();

        if (!existingSnapshot.empty) {
          throw new Error('Duplicate account file detected');
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

// Auto-run trigger on startup to resume any pending uploads
triggerBackgroundUpload().catch(console.error);

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
router.get('/orders/stream', adminAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const unsubscribe = db.collection('orders')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .onSnapshot(snapshot => {
      const orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      res.write(`data: ${JSON.stringify(orders)}\n\n`);
    });

  req.on('close', () => unsubscribe());
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
