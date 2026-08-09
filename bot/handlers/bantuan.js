const { escapeHTML, editMain } = require('../utils');
const storeName = process.env.STORE_NAME || 'PanzzStore';

async function handleBantuan(bot, chatId, messageId) {
  const adminUsername = process.env.ADMIN_USERNAME || 'panzzstore_admin';

  const text = `🆘 <b>Pusat Bantuan & FAQ</b>

Sebelum menghubungi admin, berikut info cepat yang sering ditanyakan:
• <b>Kapan dikirim?</b> Akun dikirim otomatis 1-3 detik setelah bayar.
• <b>Apakah ada garansi?</b> Ya, tersedia opsi Garansi untuk klaim jika bermasalah.

Jika butuh bantuan langsung lewat bot, silakan klik tombol <b>💬 Kirim Pesan ke Admin</b> di bawah ini. Anda bisa menulis pesan dan admin akan membalas langsung ke chat ini.`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '💬 Kirim Pesan ke Admin', callback_data: 'kirim_pesan_admin' }],
      [{ text: '📞 Hubungi Telegram Admin', url: `https://t.me/${adminUsername}` }],
      [{ text: '« Menu Utama',   callback_data: 'back_menu' }],
    ],
  };

  await editMain(bot, chatId, text, keyboard, messageId);
}

module.exports = { handleBantuan };
