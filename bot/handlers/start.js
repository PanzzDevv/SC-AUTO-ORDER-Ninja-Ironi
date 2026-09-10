require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { getUserOrCreate, db } = require('../../server/firebase');
const { getSession } = require('../sessions');
const { escapeHTML, editMain } = require('../utils');
const path = require('path');

const storeName = process.env.STORE_NAME || 'PanzzStore';

const REPLY_KEYBOARD = {
  keyboard: [
    [{ text: '➤ Cek Saldo' }, { text: '➤ Pusat Bantuan' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

function buildCaption(name) {
  return `✨ <b>Halo, ${escapeHTML(name)}! Selamat datang di ${escapeHTML(storeName)}</b>

🏪 Toko Akun TikTok otomatis terpercaya dengan pengiriman instan 24/7.

🛍️ <b><u>Ketentuan Pembelian:</u></b>
• <b>Minimal Pembelian:</b> 10 akun per transaksi

<blockquote>⚠️ <b>Penting (Update Sistem TikTok):</b>
Klaim voucher saat ini mulai random dari sistem TikTok.
• Jika gagal klaim, harap jeda minimal 24 jam & lakukan restore akun.
• Mohon pengertiannya untuk tidak komplain mengenai klaim voucher random ini.</blockquote>

🛡️ <b>Ketentuan Garansi (24 Jam):</b>
1. Akun terkena banned (sebelum digunakan)
2. Akun sudah pernah digunakan orang lain
3. Tidak ada voucher ongkir pada akun
4. Gagal klaim voucher

📨 <b>Syarat Klaim:</b> Wajib mengirimkan file backup akun.
⚖️ <i>Membeli berarti memahami dan menyetujui ketentuan di atas.</i>

Silakan klik tombol di bawah untuk mulai memesan! 👇`;
}

const { getBaseUrl } = require('../../server/urlHelper');

function buildMainKeyboard(chatId) {
  const adminIds = (process.env.ADMIN_TELEGRAM_ID || '').split(',').map(s => s.trim());
  const isAdmin = adminIds.includes(String(chatId));

  return {
    inline_keyboard: [
      [{ text: '➤ Beli Akun TikTok', callback_data: 'menu_beli' }],
      ...(isAdmin ? [[{ text: '⚙️ Panel Administrator', callback_data: 'admin_open_panel' }]] : []),
    ],
  };
}

let cachedBannerFileId = null;

async function handleStart(bot, msg) {
  const { id: chatId, username, first_name } = msg.from;
  const session = getSession(chatId);

  try { await getUserOrCreate(chatId, username, first_name); } catch { }

  const name = first_name || username || 'Kawan';

  // 1. Kirim pesan loading awal TANPA reply_markup agar pesan bisa di-edit lancar
  let loadingMsg;
  try {
    loadingMsg = await bot.sendMessage(chatId, `⏳ <b>Loading ${storeName}...</b>\n\n<code>[■■□□□□□□□□] 20%</code>`, {
      parse_mode: 'HTML',
    });
  } catch (e) {
    console.error('Error sending loading message:', e.message);
  }

  // Frame 2: 60%
  await new Promise(r => setTimeout(r, 450));
  if (loadingMsg) {
    try {
      await bot.editMessageText(`⏳ <b>Loading ${storeName}...</b>\n\n<code>[■■■■■■□□□□] 60%</code>`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'HTML',
      });
    } catch (e) {
      console.error('Frame 60% error:', e.message);
    }
  }

  // Frame 3: 100%
  await new Promise(r => setTimeout(r, 450));
  if (loadingMsg) {
    try {
      await bot.editMessageText(`⏳ <b>Loading ${storeName}...</b>\n\n<code>[■■■■■■■■■■] 100%</code>`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'HTML',
      });
    } catch (e) {
      console.error('Frame 100% error:', e.message);
    }
  }

  await new Promise(r => setTimeout(r, 200));

  // Hapus pesan loading setelah selesai agar room chat bersih
  if (loadingMsg) {
    try {
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    } catch (e) {
      console.error('Error deleting loading message:', e.message);
    }
  }

  const caption = buildCaption(name);
  const inlineKeyboard = buildMainKeyboard(chatId);
  const bannerUrl = process.env.BANNER_URL || '';

  // 2. Kirim pesan penyambung & banner secara PARALEL agar super cepat, tapi tunggu barengan
  try {
    const p1 = bot.sendMessage(chatId, `<blockquote>✨ <b>Selamat datang di ${storeName}!</b></blockquote>`, {
      parse_mode: 'HTML',
      reply_markup: REPLY_KEYBOARD,
    });

    if (bannerUrl) {
      const photoSource = cachedBannerFileId ? cachedBannerFileId : bannerUrl;
      const p2 = bot.sendPhoto(chatId, photoSource, {
        caption,
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard,
      });

      const [msg1, photoMsg] = await Promise.all([p1, p2]);

      // Cache file_id untuk pengiriman super kilat selanjutnya
      if (!cachedBannerFileId && photoMsg.photo && photoMsg.photo.length > 0) {
        cachedBannerFileId = photoMsg.photo[photoMsg.photo.length - 1].file_id;
      }

      session.mainMessageId = photoMsg.message_id;
      session.mainIsPhoto = true;

      // Simpan ke Firestore untuk pemulihan nanti jika bot restart
      await db.collection('users').doc(String(chatId)).update({
        mainMessageId: photoMsg.message_id,
        mainIsPhoto: true
      }).catch(() => { });
    } else {
      const [msg1, textMsg] = await Promise.all([
        p1,
        bot.sendMessage(chatId, caption, {
          parse_mode: 'HTML',
          reply_markup: inlineKeyboard,
        })
      ]);

      session.mainMessageId = textMsg.message_id;
      session.mainIsPhoto = false;

      await db.collection('users').doc(String(chatId)).update({
        mainMessageId: textMsg.message_id,
        mainIsPhoto: false
      }).catch(() => { });
    }
  } catch (e) {
    console.error('Send message/photo error:', e.message);
    // Fallback if photo fails
    const textMsg = await bot.sendMessage(chatId, caption, {
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard,
    });
    session.mainMessageId = textMsg.message_id;
    session.mainIsPhoto = false;

    await db.collection('users').doc(String(chatId)).update({
      mainMessageId: textMsg.message_id,
      mainIsPhoto: false
    }).catch(() => { });
  }
}

async function handleBackToMenu(bot, chatId, messageId, firstName) {
  const session = getSession(chatId);
  const caption = buildCaption(firstName || 'Kawan');
  const keyboard = buildMainKeyboard(chatId);
  const bannerUrl = process.env.BANNER_URL || '';

  // Jika main menu sebelumnya diturunkan ke teks (isPhoto === false) atau messageId hilang,
  // hapus pesan lama dan kirim ulang menu utama dengan foto banner agar branding tetap konsisten
  if (session.mainIsPhoto === false || !messageId) {
    if (messageId) bot.deleteMessage(chatId, messageId).catch(() => { });

    const photoSource = cachedBannerFileId ? cachedBannerFileId : bannerUrl;
    if (photoSource) {
      try {
        const photoMsg = await bot.sendPhoto(chatId, photoSource, {
          caption,
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });

        if (!cachedBannerFileId && photoMsg.photo && photoMsg.photo.length > 0) {
          cachedBannerFileId = photoMsg.photo[photoMsg.photo.length - 1].file_id;
        }

        session.mainMessageId = photoMsg.message_id;
        session.mainIsPhoto = true;

        await db.collection('users').doc(String(chatId)).update({
          mainMessageId: photoMsg.message_id,
          mainIsPhoto: true
        }).catch(() => { });
        return;
      } catch (e) {
        console.error('Failed to restore main menu photo banner:', e.message);
      }
    }

    // Fallback if photo banner is not available or failed
    try {
      const textMsg = await bot.sendMessage(chatId, caption, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      session.mainMessageId = textMsg.message_id;
      session.mainIsPhoto = false;
      await db.collection('users').doc(String(chatId)).update({
        mainMessageId: textMsg.message_id,
        mainIsPhoto: false
      }).catch(() => { });
      return;
    } catch (e) {
      console.error('Failed to send fallback main menu text:', e.message);
      return;
    }
  }

  await editMain(bot, chatId, caption, keyboard, messageId);
}

module.exports = { handleStart, handleBackToMenu, buildCaption, buildMainKeyboard };
