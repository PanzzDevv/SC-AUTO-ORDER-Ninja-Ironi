const fs = require('fs');
const axios = require('axios');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

// Instance bot khusus untuk storage (tanpa polling, agar tidak konflik dengan bot utama)
let _storageBot = null;
function getStorageBot() {
  if (!_storageBot) {
    _storageBot = new TelegramBot(process.env.BOT_TOKEN);
  }
  return _storageBot;
}

/**
 * Upload sebuah file dari lokal ke Telegram Private Channel, lalu hapus file lokalnya.
 * @param {string} filePath - Path lokal file
 * @param {string} fileName - Nama file
 * @returns {Promise<string>} telegramFileId
 */
async function uploadFileToTelegram(filePath, fileName, retries = 5) {
  const channelId = process.env.STORAGE_CHANNEL_ID;
  if (!channelId) {
    throw new Error('STORAGE_CHANNEL_ID belum diset di .env');
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const msg = await getStorageBot().sendDocument(channelId, fs.createReadStream(filePath), {
        caption: `📦 File Account: ${fileName}\n📅 Date: ${new Date().toISOString()}`
      }, {
        filename: fileName,
        contentType: 'application/octet-stream'
      });

      if (!msg.document || !msg.document.file_id) {
        throw new Error('Gagal mendapatkan file_id dari Telegram');
      }

      const telegramFileId = msg.document.file_id;
      console.log(`✅ Telegram Storage Upload: ${fileName} → File ID: ${telegramFileId}`);
      return telegramFileId;
    } catch (err) {
      if (err.message && err.message.includes('429')) {
        const match = err.message.match(/retry after (\d+)/i);
        const waitSeconds = match ? parseInt(match[1]) : 10;
        console.log(`⏳ Limit Telegram (429) untuk ${fileName}. Menunggu ${waitSeconds} detik (Percobaan ${attempt}/${retries})...`);
        // Tunggu sesuai instruksi Telegram + 1 detik buffer
        await new Promise(resolve => setTimeout(resolve, (waitSeconds + 1) * 1000));
      } else {
        throw err; // Jika bukan 429, langsung throw error
      }
    }
  }
  throw new Error(`Gagal upload ${fileName} setelah ${retries} percobaan karena kena limit Telegram terus.`);
}

/**
 * Mendownload file dari Telegram berdasarkan file_id, simpan ke lokal.
 * @param {string} fileId - Telegram file_id
 * @param {string} destPath - Path tujuan untuk menyimpan file lokal
 * @returns {Promise<void>}
 */
async function downloadFileFromTelegram(fileId, destPath) {
  // Cek apakah file ada di cache lokal
  const localCachePath = path.join(__dirname, '../storage/accounts/', fileId);
  if (fs.existsSync(localCachePath)) {
    console.log(`⚡ Cache hit: ${fileId} found locally!`);
    fs.copyFileSync(localCachePath, destPath);
    return;
  }

  // Dapatkan URL file dari API Telegram
  const fileLink = await getStorageBot().getFileLink(fileId);
  
  // Download file menggunakan Axios
  const response = await axios({
    method: 'GET',
    url: fileLink,
    responseType: 'stream',
  });

  return new Promise((resolve, reject) => {
    const dest = fs.createWriteStream(destPath);
    response.data.pipe(dest);
    
    dest.on('finish', () => {
      // Simpan salinan ke cache lokal agar ke depannya instan
      try {
        const localAccountsDir = path.dirname(localCachePath);
        if (!fs.existsSync(localAccountsDir)) {
          fs.mkdirSync(localAccountsDir, { recursive: true });
        }
        fs.copyFileSync(destPath, localCachePath);
      } catch (_) {}
      resolve();
    });
    dest.on('error', (err) => reject(err));
    response.data.on('error', (err) => reject(err));
  });
}

module.exports = {
  uploadFileToTelegram,
  downloadFileFromTelegram,
};
