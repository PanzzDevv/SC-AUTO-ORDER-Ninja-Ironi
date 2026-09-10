const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { getCategories, getCategoryById, addAccount, db } = require('../../server/firebase');
const { uploadFileToTelegram } = require('../../server/telegramStorage');

// In-memory store untuk sesi upload dokumen admin
// Map: promptMessageId -> { fileId, fileName, fileSize, type, garansi, chatId }
const pendingUploads = new Map();

function setPendingUpload(msgId, data) {
  pendingUploads.set(msgId, { ...data, timestamp: Date.now() });
  // Hapus otomatis setelah 30 menit jika tidak diselesaikan
  setTimeout(() => pendingUploads.delete(msgId), 30 * 60 * 1000);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Handle document (file) yang dikirim oleh Admin di chat bot.
 */
async function handleAdminDocument(bot, msg) {
  const chatId = msg.chat.id;
  const adminIds = (process.env.ADMIN_TELEGRAM_ID || '').split(',').map(s => s.trim());

  // Hanya admin yang diizinkan upload stok
  if (!adminIds.includes(String(chatId))) {
    return false;
  }

  const doc = msg.document;
  if (!doc) return false;

  const fileName = doc.file_name || 'stock.zip';

  // Validasi ekstensi .zip
  if (!fileName.toLowerCase().endsWith('.zip')) {
    await bot.sendMessage(
      chatId,
      '⚠️ <b>Format File Tidak Didukung!</b>\n\n' +
      'Untuk upload stok otomatis, silakan kirimkan file dengan format <b>.zip</b>.\n\n' +
      '<i>Bisa berupa 1 file .zip akun, atau 1 Master ZIP yang berisi banyak file .zip akun di dalamnya.</i>',
      { parse_mode: 'HTML' }
    );
    return true;
  }

  try {
    const categories = await getCategories();
    if (!categories || categories.length === 0) {
      await bot.sendMessage(chatId, '❌ Belum ada kategori produk yang terdaftar di database.');
      return true;
    }

    const keyboard = [];
    for (let i = 0; i < categories.length; i += 2) {
      const row = [];
      const c1 = categories[i];
      row.push({
        text: `${c1.emoji || '📦'} ${c1.name}`,
        callback_data: `up_cat_${c1.id}`
      });
      if (categories[i + 1]) {
        const c2 = categories[i + 1];
        row.push({
          text: `${c2.emoji || '📦'} ${c2.name}`,
          callback_data: `up_cat_${c2.id}`
        });
      }
      keyboard.push(row);
    }
    keyboard.push([{ text: '❌ Batal', callback_data: 'up_cancel' }]);

    const promptMsg = await bot.sendMessage(
      chatId,
      `📦 <b>UPLOAD STOK AKUN (.ZIP)</b>\n\n` +
      `📄 <b>File:</b> <code>${fileName}</code>\n` +
      `📊 <b>Ukuran:</b> <code>${formatBytes(doc.file_size)}</code>\n\n` +
      `<i>Silakan pilih <b>Kategori Produk</b> untuk stok ini:</i>`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      }
    );

    setPendingUpload(promptMsg.message_id, {
      fileId: doc.file_id,
      fileName,
      fileSize: doc.file_size,
      chatId
    });

    return true;
  } catch (err) {
    console.error('handleAdminDocument error:', err.message);
    await bot.sendMessage(chatId, `❌ Gagal memproses dokumen: ${err.message}`);
    return true;
  }
}

/**
 * Handle callback query interaktif tombol upload (up_*)
 */
async function handleUploadCallback(bot, query) {
  const chatId = query.message.chat.id;
  const promptMsgId = query.message.message_id;
  const adminIds = (process.env.ADMIN_TELEGRAM_ID || '').split(',').map(s => s.trim());

  if (!adminIds.includes(String(chatId))) {
    await bot.answerCallbackQuery(query.id, { text: 'Akses Ditolak.', show_alert: true });
    return;
  }

  const uploadData = pendingUploads.get(promptMsgId);
  if (!uploadData) {
    await bot.answerCallbackQuery(query.id, {
      text: 'Sesi upload kedaluwarsa. Silakan kirim ulang file ZIP.',
      show_alert: true
    });
    return;
  }

  // ─── BATAL ──────────────────────────────────────────────────────────────────
  if (query.data === 'up_cancel') {
    pendingUploads.delete(promptMsgId);
    await bot.deleteMessage(chatId, promptMsgId).catch(() => {});
    await bot.answerCallbackQuery(query.id, { text: 'Upload stok dibatalkan' });
    return;
  }

  // ─── KEMBALI PILIH KATEGORI ─────────────────────────────────────────────────
  if (query.data === 'up_back_cat') {
    const categories = await getCategories();
    const keyboard = [];
    for (let i = 0; i < categories.length; i += 2) {
      const row = [];
      const c1 = categories[i];
      row.push({ text: `${c1.emoji || '📦'} ${c1.name}`, callback_data: `up_cat_${c1.id}` });
      if (categories[i + 1]) {
        const c2 = categories[i + 1];
        row.push({ text: `${c2.emoji || '📦'} ${c2.name}`, callback_data: `up_cat_${c2.id}` });
      }
      keyboard.push(row);
    }
    keyboard.push([{ text: '❌ Batal', callback_data: 'up_cancel' }]);

    await bot.editMessageText(
      `📦 <b>UPLOAD STOK AKUN (.ZIP)</b>\n\n` +
      `📄 <b>File:</b> <code>${uploadData.fileName}</code>\n` +
      `📊 <b>Ukuran:</b> <code>${formatBytes(uploadData.fileSize)}</code>\n\n` +
      `<i>Silakan pilih <b>Kategori Produk</b> untuk stok ini:</i>`,
      {
        chat_id: chatId,
        message_id: promptMsgId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      }
    );
    await bot.answerCallbackQuery(query.id);
    return;
  }

  // ─── PILIH KATEGORI (up_cat_<id>) ───────────────────────────────────────────
  if (query.data.startsWith('up_cat_')) {
    const catId = query.data.replace('up_cat_', '');
    uploadData.type = catId;
    const cat = await getCategoryById(catId);

    const text = `📦 <b>UPLOAD STOK AKUN (.ZIP)</b>\n\n` +
      `📄 <b>File:</b> <code>${uploadData.fileName}</code>\n` +
      `🏷️ <b>Kategori:</b> <b>${cat.emoji || '📦'} ${cat.name}</b>\n\n` +
      `<i>Apakah stok akun ini memiliki <b>Garansi</b>?</i>`;

    const keyboard = [
      [
        { text: '✅ Dengan Garansi', callback_data: 'up_gar_yes' },
        { text: '❌ Tanpa Garansi', callback_data: 'up_gar_no' }
      ],
      [
        { text: '« Ganti Kategori', callback_data: 'up_back_cat' },
        { text: '❌ Batal', callback_data: 'up_cancel' }
      ]
    ];

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: promptMsgId,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  // ─── PILIH GARANSI (up_gar_yes / up_gar_no) ──────────────────────────────────
  if (query.data === 'up_gar_yes' || query.data === 'up_gar_no') {
    const garansiBool = (query.data === 'up_gar_yes');
    uploadData.garansi = garansiBool;

    await bot.answerCallbackQuery(query.id, { text: 'Memulai proses upload...' });
    await processUploadJob(bot, chatId, promptMsgId, uploadData);
    return;
  }
}

/**
 * Download file, ekstrak, hitung hash, upload ke Telegram Storage, dan catat ke Firestore.
 */
async function processUploadJob(bot, chatId, messageId, uploadData) {
  const jobFolder = path.join(os.tmpdir(), `upjob_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
  
  try {
    if (!fs.existsSync(jobFolder)) fs.mkdirSync(jobFolder, { recursive: true });

    // 1. Tampilkan status download
    await bot.editMessageText(
      `⏳ <b>MENGUNDUH FILE DARI TELEGRAM...</b>\n\n` +
      `📄 <b>File:</b> <code>${uploadData.fileName}</code>\n` +
      `Mohon tunggu sebentar, file sedang diunduh ke server...`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML'
      }
    );

    // 2. Download file dari Telegram
    let downloadedFilePath = '';
    try {
      downloadedFilePath = await bot.downloadFile(uploadData.fileId, jobFolder);
    } catch (dlErr) {
      console.warn('bot.downloadFile fallback ke stream Axios:', dlErr.message);
      const axios = require('axios');
      const fileLink = await bot.getFileLink(uploadData.fileId);
      downloadedFilePath = path.join(jobFolder, uploadData.fileName || 'uploaded.zip');
      const writer = fs.createWriteStream(downloadedFilePath);
      const response = await axios({ method: 'GET', url: fileLink, responseType: 'stream' });
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
    }

    // 3. Baca ZIP dengan AdmZip
    let zip;
    try {
      zip = new AdmZip(downloadedFilePath);
    } catch (zipErr) {
      throw new Error('File ZIP rusak atau terproteksi password. Pastikan file ZIP valid.');
    }

    const entries = zip.getEntries();
    const innerZipEntries = entries.filter(e =>
      !e.isDirectory &&
      e.name.toLowerCase().endsWith('.zip') &&
      !e.entryName.includes('__MACOSX') &&
      !e.name.startsWith('._')
    );

    let itemsToProcess = [];

    if (innerZipEntries.length > 0) {
      // ─── MASTER ZIP (Berisi banyak file .zip) ───────────────────────────────
      itemsToProcess = innerZipEntries.map(e => ({
        name: e.name,
        getBuffer: () => e.getData()
      }));
    } else {
      // Periksa apakah berisi folder-folder akun (misal Akun1/, Akun2/)
      const rootDirs = new Set();
      entries.forEach(e => {
        if (e.entryName.includes('__MACOSX') || e.name.startsWith('._')) return;
        const parts = e.entryName.split(/[\/\\]/).filter(Boolean);
        if (parts.length > 1) {
          rootDirs.add(parts[0]);
        }
      });

      if (rootDirs.size > 1) {
        // ─── MASTER ZIP (Berisi banyak folder akun) ───────────────────────────
        for (const dirName of rootDirs) {
          const subZip = new AdmZip();
          entries.forEach(e => {
            if (e.entryName.startsWith(dirName + '/') || e.entryName.startsWith(dirName + '\\')) {
              const relPath = e.entryName.slice(dirName.length + 1);
              if (!e.isDirectory && relPath) {
                subZip.addFile(relPath, e.getData());
              }
            }
          });
          itemsToProcess.push({
            name: `${dirName}.zip`,
            getBuffer: () => subZip.toBuffer()
          });
        }
      } else {
        // ─── SINGLE ZIP (1 file ZIP merupakan 1 akun) ─────────────────────────
        itemsToProcess = [{
          name: uploadData.fileName,
          getBuffer: () => fs.readFileSync(downloadedFilePath)
        }];
      }
    }

    const total = itemsToProcess.length;
    let successCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    const cat = await getCategoryById(uploadData.type);

    await bot.editMessageText(
      `⏳ <b>MEMPROSES STOK...</b>\n\n` +
      `📦 <b>Kategori:</b> ${cat.emoji || '📦'} ${cat.name} (${uploadData.garansi ? 'Garansi' : 'No Garansi'})\n` +
      `📊 <b>Total Ditemukan:</b> ${total} akun\n\n` +
      `<i>Sedang upload ke Telegram Storage Channel & database Firestore...</i>`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML'
      }
    );

    for (let i = 0; i < total; i++) {
      const item = itemsToProcess[i];
      const buffer = item.getBuffer();
      const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

      // Cek duplikasi hash di Firestore
      const existingSnapshot = await db.collection('accounts')
        .where('fileHash', '==', fileHash)
        .limit(1)
        .get();

      if (!existingSnapshot.empty) {
        duplicateCount++;
        continue;
      }

      // Tulis buffer ke file temporary untuk di-upload
      const itemTempPath = path.join(jobFolder, `acc_up_${i}_${item.name}`);
      fs.writeFileSync(itemTempPath, buffer);

      try {
        const telegramFileId = await uploadFileToTelegram(itemTempPath, item.name);
        await addAccount(uploadData.type, uploadData.garansi, telegramFileId, item.name, '', fileHash);
        successCount++;
      } catch (accErr) {
        console.error(`Gagal upload akun ${item.name}:`, accErr.message);
        errorCount++;
      } finally {
        try { fs.unlinkSync(itemTempPath); } catch (_) {}
      }

      // Update progres tiap 5 akun jika jumlah akun banyak
      if ((i + 1) % 5 === 0 && (i + 1) < total) {
        try {
          await bot.editMessageText(
            `⏳ <b>MEMPROSES STOK...</b>\n\n` +
            `📦 <b>Kategori:</b> ${cat.emoji || '📦'} ${cat.name} (${uploadData.garansi ? 'Garansi' : 'No Garansi'})\n` +
            `📈 <b>Progres:</b> <code>${i + 1}/${total} akun</code>\n` +
            `✅ <b>Berhasil:</b> ${successCount} | ⚠️ <b>Duplikat/Gagal:</b> ${duplicateCount + errorCount}`,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'HTML'
            }
          );
        } catch (_) {}
      }

      // Jeda halus antar akun untuk menghindari limit rate Telegram
      if (total > 1) {
        await new Promise(resolve => setTimeout(resolve, 350));
      }
    }

    // Bersihkan sesi
    pendingUploads.delete(messageId);

    // Tampilkan hasil akhir
    const summaryText = `🎉 <b>UPLOAD STOK SELESAI!</b>\n\n` +
      `📦 <b>Kategori:</b> ${cat.emoji || '📦'} ${cat.name}\n` +
      `🛡️ <b>Garansi:</b> ${uploadData.garansi ? '✅ Garansi' : '❌ No Garansi'}\n` +
      `📁 <b>File Asal:</b> <code>${uploadData.fileName}</code>\n\n` +
      `📊 <b>Hasil Pemrosesan:</b>\n` +
      `• Total Terdeteksi: <b>${total} akun</b>\n` +
      `• ✅ Berhasil Ditambahkan: <b>${successCount} akun</b>\n` +
      (duplicateCount > 0 ? `• ⚠️ Duplikat Dilewati: <b>${duplicateCount} akun</b>\n` : '') +
      (errorCount > 0 ? `• ❌ Gagal Diproses: <b>${errorCount} akun</b>\n` : '') +
      `\n🚀 <i>Stok sudah tersimpan ke Telegram Storage Channel & database Firestore. Siap dibeli oleh pelanggan!</i>`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '📊 Cek Statistik & Stok', callback_data: 'admin_view_stats' }],
        [{ text: '👑 Kembali ke Menu Admin', callback_data: 'admin_cancel_input' }]
      ]
    };

    await bot.editMessageText(summaryText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: keyboard
    });

  } catch (err) {
    console.error('Upload processing error:', err);
    pendingUploads.delete(messageId);
    await bot.editMessageText(
      `❌ <b>Gagal Memproses File ZIP</b>\n\n` +
      `Penyebab: <code>${err.message || 'Terjadi kesalahan sistem'}</code>\n\n` +
      `<i>Pastikan file ZIP tidak rusak dan coba kirim kembali.</i>`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '« Kembali ke Menu Admin', callback_data: 'admin_cancel_input' }]]
        }
      }
    );
  } finally {
    // Bersihkan folder kerja temporary
    try {
      fs.rmSync(jobFolder, { recursive: true, force: true });
    } catch (_) {}
  }
}

module.exports = {
  handleAdminDocument,
  handleUploadCallback
};
