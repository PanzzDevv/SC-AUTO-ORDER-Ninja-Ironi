const {
  getPrices, getPriceKey, getStockCount,
  createOrder, getAvailableAccounts, markAccountsSold, updateOrderStatus, getOrder,
  getUser, updateUserSaldo,
} = require('../../server/firebase');
const { createZipFromAccounts, cleanupZip } = require('../../server/zipHelper');

const storeName = process.env.STORE_NAME || 'PanzzStore';
const { getSession, clearSession } = require('../sessions');
const { escapeHTML, formatRupiah, editMain } = require('../utils');
const axios = require('axios');

// ─── QUICK QTY BUTTONS ────────────────────────────────────────────────────────
const QTY_KEYBOARD = (backData) => ({
  inline_keyboard: [
    [
      { text: '10',  callback_data: 'qty_10'  },
      { text: '20',  callback_data: 'qty_20'  },
      { text: '30',  callback_data: 'qty_30'  },
      { text: '40',  callback_data: 'qty_40'  },
      { text: '50',  callback_data: 'qty_50'  },
    ],
    [
      { text: '60',  callback_data: 'qty_60'  },
      { text: '70',  callback_data: 'qty_70'  },
      { text: '80',  callback_data: 'qty_80'  },
      { text: '90',  callback_data: 'qty_90'  },
      { text: '100', callback_data: 'qty_100' },
    ],
    [
      { text: '200', callback_data: 'qty_200' },
      { text: '300', callback_data: 'qty_300' },
      { text: '400', callback_data: 'qty_400' },
      { text: '500', callback_data: 'qty_500' },
    ],
    [{ text: '« Kembali', callback_data: backData }],
  ],
});

// ─── STEP 1: Menu beli akun ───────────────────────────────────────────────────
async function handleBeli(bot, chatId, messageId) {
  const [mg, mn, tg, tn] = await Promise.all([
    getStockCount('muda', true),
    getStockCount('muda', false),
    getStockCount('tua',  true),
    getStockCount('tua',  false),
  ]);

  const prices = await getPrices();
  const mudaName = prices.muda_name || 'Fresh Usia 0 Day';
  const tuaName = prices.tua_name || 'Fresh Usia 2-8 Day';

  const text = `🛒 <b>Pilih Kategori Akun TikTok</b>

Silakan pilih kategori akun yang Anda butuhkan:

• 🧒 <b>${escapeHTML(mudaName)}</b>
Stok saat ini: <b>Garansi (${mg})</b> | <b>No Garansi (${mn})</b>

• 👴 <b>${escapeHTML(tuaName)}</b>
Stok saat ini: <b>Garansi (${tg})</b> | <b>No Garansi (${tn})</b>`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: `❯ ${mudaName}`, callback_data: 'type_muda' },
        { text: `❯ ${tuaName}`,  callback_data: 'type_tua'  },
      ],
      [{ text: '« Kembali', callback_data: 'back_menu' }],
    ],
  };

  await editMain(bot, chatId, text, keyboard, messageId);
}

// ─── STEP 2: Pilih garansi ────────────────────────────────────────────────────
async function handleSelectType(bot, chatId, messageId, type) {
  getSession(chatId).type = type;
  const prices = await getPrices();
  const mudaName = prices.muda_name || 'Fresh Usia 0 Day';
  const tuaName = prices.tua_name || 'Fresh Usia 2-8 Day';
  const typeName = type === 'muda' ? mudaName : tuaName;

  const pG  = prices[getPriceKey(type, true)];
  const pNG = prices[getPriceKey(type, false)];

  const stockG  = await getStockCount(type, true);
  const stockNG = await getStockCount(type, false);

  const text = `🛡️ <b>Pilih Tipe Garansi (${typeName})</b>

Silakan pilih opsi garansi untuk keamanan akun Anda:

• ✅ <b>Dengan Garansi</b> — Rp ${formatRupiah(pG)}/akun
Stok tersedia: <b>${stockG} akun</b>
<i>Mendapatkan proteksi klaim ganti baru jika bermasalah.</i>

• ❌ <b>Tanpa Garansi</b> — Rp ${formatRupiah(pNG)}/akun
Stok tersedia: <b>${stockNG} akun</b>
<i>Dijual apa adanya tanpa garansi (harga lebih hemat).</i>`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: `❯ Dengan Garansi (${stockG})`, callback_data: 'garansi_yes' },
        { text: `❯ Tanpa Garansi (${stockNG})`,  callback_data: 'garansi_no'  },
      ],
      [{ text: '« Kembali', callback_data: 'menu_beli' }],
    ],
  };

  await editMain(bot, chatId, text, keyboard, messageId);
}

// ─── STEP 3: Pilih jumlah ─────────────────────────────────────────────────────
async function handleSelectGaransi(bot, chatId, messageId, garansi) {
  const session = getSession(chatId);
  session.garansi = garansi;

  const prices = await getPrices();
  const price  = prices[getPriceKey(session.type, garansi)];
  const stock  = await getStockCount(session.type, garansi);
  session.pricePerUnit = price;

  const mudaName = prices.muda_name || 'Fresh Usia 0 Day';
  const tuaName = prices.tua_name || 'Fresh Usia 2-8 Day';
  const typeName    = session.type === 'muda' ? mudaName : tuaName;
  const garansiName = garansi ? '✅ Garansi' : '❌ No Garansi';

  const text = `📦 <b>${typeName} — ${garansiName}</b>

<blockquote>💰 Harga: Rp ${formatRupiah(price)}/akun
📊 Stok tersedia: ${stock} akun</blockquote>

Pilih atau ketik jumlah akun:`;

  session.waitingForQty = true;

  await editMain(bot, chatId, text, QTY_KEYBOARD(`type_${session.type}`), messageId);
}

// ─── STEP 4: Konfirmasi order ─────────────────────────────────────────────────
async function handleQtySelected(bot, chatId, messageId, qty) {
  const session = getSession(chatId);
  session.qty           = qty;
  session.waitingForQty = false;

  const { type, garansi, pricePerUnit } = session;
  const stock = await getStockCount(type, garansi);

  if (qty > stock) {
    const errText = `❌ <b>Stok tidak cukup!</b>\n\n<blockquote>Tersedia hanya <b>${stock} akun</b>.</blockquote>\nSilakan pilih jumlah yang lebih kecil.`;
    await editMain(bot, chatId, errText, QTY_KEYBOARD(`type_${type}`), messageId);
    return;
  }

  const total       = pricePerUnit * qty;
  session.totalPrice = total;

  const prices = await getPrices();
  const mudaName = prices.muda_name || 'Fresh Usia 0 Day';
  const tuaName = prices.tua_name || 'Fresh Usia 2-8 Day';
  const typeName    = type === 'muda' ? mudaName : tuaName;
  const garansiName = garansi ? '✅ Garansi' : '❌ No Garansi';

  // Ambil saldo user untuk konfirmasi pembayaran
  const user = await getUser(chatId);
  const saldo = user ? (user.saldo || 0) : 0;

  const text = `🧾 <b>Konfirmasi Order</b>

<blockquote>📦 Produk: <b>${typeName}</b>
🛡️ Garansi: <b>${garansiName}</b>
🔢 Jumlah: <b>${qty} akun</b>
💰 Harga: Rp ${formatRupiah(pricePerUnit)} × ${qty}

💵 <b>Total: Rp ${formatRupiah(total)}</b></blockquote>

👤 Saldo Kamu: <b>Rp ${formatRupiah(saldo)}</b>

Lanjutkan ke pembayaran?`;

  const inline_keyboard = [];
  if (saldo >= total) {
    inline_keyboard.push([{ text: '➤ Bayar Pakai Saldo', callback_data: 'pay_with_saldo' }]);
  }
  inline_keyboard.push([{ text: '➤ Bayar via QRIS (PanzzPay)', callback_data: 'confirm_order' }]);
  inline_keyboard.push([{ text: '« Batalkan', callback_data: 'menu_beli' }]);

  const keyboard = { inline_keyboard };

  await editMain(bot, chatId, text, keyboard, messageId);
}

// Map menyimpan interval polling invoice aktif
const activePollers = new Map();

function startInvoiceAutoPolling(bot, orderId, panzzpayInvoiceId) {
  if (!panzzpayInvoiceId) return;
  if (activePollers.has(panzzpayInvoiceId)) {
    clearInterval(activePollers.get(panzzpayInvoiceId));
  }

  const baseUrl = (process.env.PANZZPAY_BASE_URL || 'https://panzzpay.my.id').replace(/\/+$/, '');
  const apiKey = process.env.PANZZPAY_API_KEY;
  let attempts = 0;
  const maxAttempts = 225; // ~15 menit (225 * 4 detik)

  const timer = setInterval(async () => {
    attempts += 1;
    if (attempts > maxAttempts) {
      clearInterval(timer);
      activePollers.delete(panzzpayInvoiceId);
      return;
    }

    try {
      const headers = {};
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }
      const res = await axios.get(`${baseUrl}/api/payments`, { headers, timeout: 5000 });
      if (Array.isArray(res.data)) {
        const item = res.data.find(p => p.id === panzzpayInvoiceId || p.customer_order_id === orderId);
        if (item && String(item.status).toLowerCase() === 'paid') {
          clearInterval(timer);
          activePollers.delete(panzzpayInvoiceId);

          const { getOrder, updateOrderStatus } = require('../../server/firebase');
          const order = await getOrder(orderId);
          if (order && order.status !== 'done' && order.status !== 'processing') {
            console.log(`🎉 [PanzzPay Auto-Poll] Invoice ${panzzpayInvoiceId} LUNAS! Delivering order ${orderId}...`);
            await updateOrderStatus(orderId, 'paid');
            deliverOrder(bot, orderId).catch(console.error);
          }
        }
      }
    } catch (e) {
      // Abaikan error jaringan sementara saat polling
    }
  }, 4000);

  activePollers.set(panzzpayInvoiceId, timer);
}

// ─── STEP 5: Buat payment PanzzPay ─────────────────────────────────────────────
async function handleConfirmOrder(bot, chatId, messageId, from) {
  const session = getSession(chatId);
  const { type, garansi, qty, totalPrice } = session;

  if (!type || !qty || !totalPrice) {
    await editMain(bot, chatId,
      '❌ Sesi order habis. Silakan mulai ulang.', {}, messageId);
    return;
  }

  await editMain(bot, chatId, '⏳ <i>Membuat link pembayaran QRIS PanzzPay...</i>', {}, messageId);

  try {
    const { generateQris } = require('../utils');
    const qrisResult = await generateQris(totalPrice);

    if (!qrisResult || !qrisResult.invoice) {
      throw new Error('Gagal menghasilkan QRIS dari PanzzPay API');
    }

    const { buffer: qrBuffer, invoice } = qrisResult;
    const finalAmount = invoice.total_amount || totalPrice;
    const uniqueCode = invoice.unique_code || 0;
    const panzzpayInvoiceId = invoice.id;
    const baseUrl = (process.env.PANZZPAY_BASE_URL || 'https://panzzpay.my.id').replace(/\/+$/, '');
    const paymentUrl = `${baseUrl}/#qrResultCard`;

    const order = await createOrder(
      chatId, from.username, type, garansi, qty, finalAmount, paymentUrl, panzzpayInvoiceId, {
        baseAmount: totalPrice,
        uniqueCode: uniqueCode
      }
    );
    session.orderId = order.id;

    const prices = await getPrices();
    const mudaName = prices.muda_name || 'Fresh Usia 0 Day';
    const tuaName = prices.tua_name || 'Fresh Usia 2-8 Day';
    const typeName    = type === 'muda' ? mudaName : tuaName;
    const garansiName = garansi ? 'Garansi' : 'No Garansi';

    const text = `💳 <b>Detail Pembayaran QRIS (PanzzPay)</b>

<blockquote>📦 <b>Detail Pesanan:</b>
• Produk: <b>${qty}x TikTok ${typeName} (${garansiName})</b>
• Harga Produk: Rp ${formatRupiah(totalPrice)}
• Kode Unik: <b>+Rp ${uniqueCode}</b>
• <b>TOTAL BAYAR: <code>Rp ${formatRupiah(finalAmount)}</code></b> 👈 <i>(Wajib Pas)</i>
• ID Invoice: <code>${panzzpayInvoiceId}</code></blockquote>

Silakan scan kode QRIS di atas untuk membayar dengan DANA, ShopeePay, GoPay, OVO, m-BCA, atau BRImo.

<i>*Akun otomatis dikirim dalam hitungan detik setelah transfer terverifikasi lunas. QRIS berlaku 15 menit.</i>`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '« Menu Utama', callback_data: 'back_menu' }],
      ],
    };

    if (qrBuffer) {
      // 1. Restore the main banner back to the Main Menu
      const { buildCaption, buildMainKeyboard } = require('./start');
      await editMain(bot, chatId, buildCaption(from.first_name || from.username || 'Kawan'), buildMainKeyboard(chatId), session.mainMessageId || messageId);
      
      // 2. Send the QR code as a SEPARATE message that can be closed
      const qrKeyboard = {
        inline_keyboard: [
          [{ text: '❌ Tutup QRIS', callback_data: 'close_qris' }],
        ],
      };
      const qrMsg = await bot.sendPhoto(chatId, qrBuffer, {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: qrKeyboard,
      });
      
      const { updateOrderStatus } = require('../../server/firebase');
      await updateOrderStatus(order.id, 'pending', { qrisMessageId: qrMsg.message_id });
    } else {
      await editMain(bot, chatId, text, keyboard, messageId);
    }
    
    // Mulai auto-polling invoice status ke PanzzPay
    startInvoiceAutoPolling(bot, order.id, panzzpayInvoiceId);

    clearSession(chatId);

  } catch (err) {
    console.error('PanzzPay order error:', err.response?.data || err.message);
    const adminUsername = process.env.ADMIN_USERNAME || 'panzzstore_admin';
    await editMain(bot, chatId,
      `❌ <b>Gagal membuat link pembayaran.</b>\nCoba beberapa saat lagi atau hubungi admin (@${adminUsername}).`, {
        inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'back_menu' }]],
      }, messageId);
  }
}

// ─── HANDLE TEXT (qty manual) ─────────────────────────────────────────────────
async function handleTextMessage(bot, msg) {
  const chatId = msg.chat.id;
  const session = getSession(chatId);

  if (session.waitingForQty) {
    const qty = parseInt(msg.text);
    if (isNaN(qty) || qty < 1 || qty > 500) {
      await bot.sendMessage(chatId,
        '❌ Masukkan angka yang valid (1-500).', { parse_mode: 'HTML' });
      return;
    }
    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    await handleQtySelected(bot, chatId, session.mainMessageId, qty);
  }
}

// ─── DELIVER ORDER (dipanggil setelah payment confirm) ────────────────────────
async function deliverOrder(bot, orderId) {
  const { updateUserSaldo, updateOrderStatus, getPrices } = require('../../server/firebase');
  const order = await getOrder(orderId);
  if (!order || order.status === 'done') return;

  const prices = await getPrices();
  const mudaName = prices.muda_name || 'Fresh Usia 0 Day';
  const tuaName = prices.tua_name || 'Fresh Usia 2-8 Day';
  const dynamicProductName = order.type === 'muda' ? mudaName : tuaName;

  const chatId = order.userId;

  // Hapus pesan QRIS jika tersimpan
  if (order.qrisMessageId) {
    bot.deleteMessage(chatId, order.qrisMessageId).catch(() => {});
  }

  if (order.type === 'topup') {
    try {
      await updateOrderStatus(orderId, 'processing');
      await updateUserSaldo(order.userId, order.totalPrice);
      await updateOrderStatus(orderId, 'done', { deliveredAt: new Date().toISOString() });

      await bot.sendMessage(chatId, `✅ <b>Top Up Saldo Berhasil!</b>\n\n<blockquote>💵 Saldo berhasil ditambahkan: <b>Rp ${formatRupiah(order.totalPrice)}</b></blockquote>\n<i>Terima kasih telah melakukan top up di ${storeName}! 🙏</i>`, {
        parse_mode: 'HTML',
      });

      // Notify Admin of Top-up
      const adminTelegramId = process.env.ADMIN_TELEGRAM_ID;
      if (adminTelegramId) {
        const adminMessage = `🔔 <b>NOTIFIKASI TRANSAKSI BARU (TOP-UP)</b>\n\n` +
          `🆔 <b>Invoice ID (PanzzPay):</b> <code>${order.panzzpayInvoiceId || order.pakasirOrderId || orderId}</code>\n` +
          `🆔 <b>Order ID (System):</b> <code>${orderId}</code>\n` +
          `👤 <b>Pembeli:</b> @${order.username || 'User'} (ID: <code>${order.userId}</code>)\n` +
          `💵 <b>Nominal Top-Up:</b> Rp ${formatRupiah(order.totalPrice)}\n` +
          `💳 <b>Metode Pembayaran:</b> PanzzPay QRIS\n` +
          `⏱️ <b>Tanggal:</b> ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n\n` +
          `✅ Status: <b>Saldo berhasil ditambahkan otomatis</b>`;

        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: '👤 Kelola User', callback_data: `admin_view_user_${order.userId}` },
              { text: '💬 Kirim Chat', callback_data: `admin_chat_user_${order.userId}` }
            ]
          ]
        };

        bot.sendMessage(adminTelegramId, adminMessage, { parse_mode: 'HTML', reply_markup: inlineKeyboard }).catch(err => {
          console.error('Failed to notify admin on topup:', err.message);
        });
      }
    } catch (err) {
      console.error('Topup delivery error:', err.message);
      await bot.sendMessage(chatId, '❌ <b>Gagal menambahkan saldo secara otomatis.</b>\nHubungi admin untuk konfirmasi manual.', {
        parse_mode: 'HTML'
      });
      await updateOrderStatus(orderId, 'error');
    }
    return;
  }

  const waitMsg = await bot.sendMessage(chatId,
    '⏳ <b>Pembayaran dikonfirmasi! Sedang menyiapkan akun kamu...</b>',
    { parse_mode: 'HTML' });

  try {
    await updateOrderStatus(orderId, 'processing');
    const accounts = await getAvailableAccounts(order.type, order.garansi, order.qty);

    if (accounts.length < order.qty) {
      bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
      await bot.sendMessage(chatId,
        '⚠️ <b>Stok sedang kosong!</b> Admin akan segera menghubungi kamu.',
        { parse_mode: 'HTML' });
      await updateOrderStatus(orderId, 'out_of_stock');
      return;
    }

    const fs = require('fs');
    const path = require('path');
    
    // Buat ZIP tunggal berisi seluruh akun
    const tempZipPath = await createZipFromAccounts(accounts, orderId);
    
    // Tentukan path folder downloads publik
    const destDir = path.join(__dirname, '../../storage/downloads/');
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    const categoryName = order.type || 'akun';
    const garansiStatus = order.garansi ? 'garansi' : 'nogaransi';
    const qtyCount = `${order.qty}x`;
    const finalZipName = `${categoryName}_${garansiStatus}_${qtyCount}_${orderId}.zip`;
    const finalZipPath = path.join(destDir, finalZipName);
    
    // Pindahkan file zip ke folder publik
    fs.copyFileSync(tempZipPath, finalZipPath);
    cleanupZip(tempZipPath);
    
    // Buat link download
    let baseUrl = process.env.BASE_URL || '';
    if (baseUrl && !baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      baseUrl = `https://${baseUrl}`;
    }
    const downloadUrl = `${baseUrl}/downloads/${finalZipName}`;
    const adminUsername = process.env.ADMIN_USERNAME || 'panzzstore_admin';
    
    const deliveryText = `✅ <b>Order Berhasil!</b>
    
<blockquote>📦 <b>${order.qty}x Akun TikTok ${dynamicProductName} (${order.garansi ? 'Garansi' : 'No Garansi'})</b>
🆔 Invoice ID: <code>${order.panzzpayInvoiceId || order.pakasirOrderId || orderId}</code></blockquote>

Silakan klik tombol di bawah ini untuk mendownload file akun Anda secara langsung:
<i>⚠️ Link aktif selama 24 jam.</i>

<i>Terima kasih sudah belanja di ${storeName}! 🙏</i>`;

    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: '📥 Download File Akun (.zip)', url: downloadUrl }],
        [{ text: '📞 Hubungi Admin', url: `https://t.me/${adminUsername}` }],
      ]
    };

    await bot.sendMessage(chatId, deliveryText, {
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard
    });

    bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});

    await markAccountsSold(accounts.map(a => a.id));
    await updateOrderStatus(orderId, 'done', { deliveredAt: new Date().toISOString() });

    // Notify Admin of Purchase & Stock Alert Check
    const adminTelegramId = process.env.ADMIN_TELEGRAM_ID;
    if (adminTelegramId) {
      const paymentMethod = order.paymentUrl === 'Paid with Balance' ? 'Potong Saldo' : 'PanzzPay QRIS';
      const adminMessage = `🔔 <b>NOTIFIKASI TRANSAKSI BARU (PEMBELIAN)</b>\n\n` +
        `🆔 <b>Invoice ID (PanzzPay):</b> <code>${order.panzzpayInvoiceId || order.pakasirOrderId || orderId}</code>\n` +
        `🆔 <b>Order ID (System):</b> <code>${orderId}</code>\n` +
        `👤 <b>Pembeli:</b> @${order.username || 'User'} (ID: <code>${order.userId}</code>)\n` +
        `📦 <b>Produk:</b> ${order.qty}x Akun TikTok ${dynamicProductName} (${order.garansi ? 'Garansi' : 'No Garansi'})\n` +
        `💵 <b>Total Pembayaran:</b> Rp ${formatRupiah(order.totalPrice)}\n` +
        `💳 <b>Metode Pembayaran:</b> ${paymentMethod}\n` +
        `⏱️ <b>Tanggal:</b> ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n\n` +
        `✅ Status: <b>Sukses dikirim ke pembeli</b>`;

      const inlineKeyboard = {
        inline_keyboard: [
          [
            { text: '👤 Kelola User', callback_data: `admin_view_user_${order.userId}` },
            { text: '💬 Kirim Chat', callback_data: `admin_chat_user_${order.userId}` }
          ],
          [
            { text: '📦 Detail Order', callback_data: `admin_view_order_${orderId}` }
          ]
        ]
      };

      bot.sendMessage(adminTelegramId, adminMessage, { parse_mode: 'HTML', reply_markup: inlineKeyboard }).catch(err => {
        console.error('Failed to notify admin on purchase:', err.message);
      });

      // Stock Alert Check
      try {
        const remainingStock = await getStockCount(order.type, order.garansi);
        if (remainingStock < 5) {
          const stockAlertMessage = `⚠️ <b>PERINGATAN STOK MENIPIS!</b>\n\n` +
            `📦 <b>Kategori:</b> Akun TikTok ${dynamicProductName} (${order.garansi ? 'Garansi' : 'No Garansi'})\n` +
            `🚨 <b>Sisa Stok:</b> <b>${remainingStock} akun</b>\n\n` +
            `<i>Silakan segera lakukan pengisian ulang stok akun melalui panel admin!</i>`;
          bot.sendMessage(adminTelegramId, stockAlertMessage, { parse_mode: 'HTML' }).catch(err => {
            console.error('Failed to send stock alert:', err.message);
          });
        }
      } catch (stockAlertErr) {
        console.error('Error checking low stock for alert:', stockAlertErr.message);
      }
    }

    // Update main banner message to final success state!
    try {
      const { buildMainKeyboard } = require('./start');
      const user = await getUser(chatId);
      const sisaSaldo = user ? (user.saldo || 0) : 0;
      const finalCaption = `✅ <b>Order Selesai!</b>\n\n<blockquote>📦 ${order.qty}x Akun TikTok ${dynamicProductName} (${order.garansi ? 'Garansi' : 'No Garansi'})\n💰 Total: Rp ${formatRupiah(order.totalPrice)}\n👤 Sisa Saldo: Rp ${formatRupiah(sisaSaldo)}</blockquote>\n🎉 <i>Link download file akun telah terkirim di bawah ini! Silakan klik untuk mengunduh.</i>`;
      await editMain(bot, chatId, finalCaption, buildMainKeyboard(chatId));
    } catch (editMainErr) {
      console.error('Failed to update main banner to final success state:', editMainErr.message);
    }

  } catch (err) {
    console.error('Order Delivery Error:', err);
    bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    console.error('Delivery error:', err.message);
    await bot.sendMessage(chatId,
      '❌ <b>Terjadi kesalahan saat mengirim akun.</b>\nAdmin akan segera membantu kamu.',
      { parse_mode: 'HTML' });
    await updateOrderStatus(orderId, 'error');
  }
}

// ─── PAY WITH BALANCE (SALDO) ────────────────────────────────────────────────
async function handlePayWithSaldo(bot, chatId, messageId, from) {
  const session = getSession(chatId);
  const { type, garansi, qty, totalPrice } = session;

  if (!type || !qty || !totalPrice) {
    await editMain(bot, chatId,
      '❌ Sesi order habis. Silakan mulai ulang.', {}, messageId);
    return;
  }

  await editMain(bot, chatId, '⏳ <i>Memproses pembayaran saldo...</i>', {}, messageId);

  try {
    // Check balance again
    const user = await getUser(chatId);
    const saldo = user ? (user.saldo || 0) : 0;
    if (saldo < totalPrice) {
      await editMain(bot, chatId,
        `❌ <b>Saldo tidak cukup!</b>\n\n<blockquote>Harga: Rp ${formatRupiah(totalPrice)}\nSaldo kamu: Rp ${formatRupiah(saldo)}</blockquote>`,
        { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'back_menu' }]] },
        messageId
      );
      return;
    }

    // Check stock again
    const stock = await getStockCount(type, garansi);
    if (qty > stock) {
      await editMain(bot, chatId,
        `❌ <b>Stok tidak cukup!</b>\n\n<blockquote>Tersedia hanya <b>${stock} akun</b>.</blockquote>`,
        { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'back_menu' }]] },
        messageId
      );
      return;
    }

    // Deduct balance
    await updateUserSaldo(chatId, -totalPrice);

    // Create paid order
    const shortId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const orderId = `BAL-${shortId}`;
    
    // Simpan order di Firestore dengan status 'paid'
    const order = await createOrder(
      chatId, from.username, type, garansi, qty, totalPrice, 'Paid with Balance', orderId
    );

    // Update order status to paid
    await updateOrderStatus(order.id, 'paid');

    // Hapus sesi agar tidak double click
    clearSession(chatId);

    // Kirim pesan sukses pemotongan saldo ke menu utama
    const { buildCaption, buildMainKeyboard } = require('./start');
    await editMain(
      bot,
      chatId,
      `✅ <b>Pembayaran Berhasil!</b>\n\n<blockquote>💰 Saldo dipotong: <b>Rp ${formatRupiah(totalPrice)}</b>\n👤 Sisa Saldo: <b>Rp ${formatRupiah(saldo - totalPrice)}</b></blockquote>\n⏳ <i>Mengirim file akun kamu, mohon tunggu sebentar...</i>`,
      buildMainKeyboard(chatId),
      session.mainMessageId || messageId
    );

    // Jalankan pengiriman order
    deliverOrder(bot, order.id).catch(console.error);

  } catch (err) {
    console.error('Pay with saldo error:', err.message);
    const adminUsername = process.env.ADMIN_USERNAME || 'panzzstore_admin';
    await editMain(bot, chatId,
      `❌ <b>Gagal memproses pembayaran.</b>\nHubungi admin jika saldo kamu terpotong (@${adminUsername}).`, {
        inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'back_menu' }]],
      }, messageId);
  }
}

module.exports = {
  handleBeli, handleSelectType, handleSelectGaransi,
  handleQtySelected, handleConfirmOrder, handleTextMessage,
  deliverOrder, handlePayWithSaldo, startInvoiceAutoPolling,
};
