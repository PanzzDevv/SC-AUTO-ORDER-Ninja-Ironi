const { getSession } = require('./sessions');
const path = require('path');
const fs = require('fs');
const Jimp = require('jimp');

let cachedBannerFileId = null;

/** Escape special HTML characters */
function escapeHTML(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Format number to Rupiah string for HTML */
function formatRupiah(num) {
  return Number(num).toLocaleString('id-ID');
}

/**
 * Edit the main persistent message (photo caption or text) using HTML parse mode.
 */
async function editMain(bot, chatId, text, keyboard, msgId = null) {
  const session = getSession(chatId);

  // Jika dipaksa untuk mengirim pesan baru (misal via Reply Keyboard)
  if (msgId === 'new') {
    let m;
    let isPhoto = false;
    const bannerUrl = process.env.BANNER_URL || '';

    try {
      if (bannerUrl) {
        const photoSource = cachedBannerFileId ? cachedBannerFileId : bannerUrl;
        m = await bot.sendPhoto(chatId, photoSource, {
          caption: text,
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
        isPhoto = true;
        if (!cachedBannerFileId && m.photo && m.photo.length > 0) {
          cachedBannerFileId = m.photo[m.photo.length - 1].file_id;
        }
      } else {
        m = await bot.sendMessage(chatId, text, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      }
    } catch (e) {
      console.error('Error sending new main message with photo:', e.message);
      m = await bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      isPhoto = false;
    }

    session.mainMessageId = m.message_id;
    session.mainIsPhoto = isPhoto;

    // Simpan ke Firestore untuk pemulihan nanti jika bot restart
    try {
      const { db } = require('../server/firebase');
      await db.collection('users').doc(String(chatId)).update({
        mainMessageId: m.message_id,
        mainIsPhoto: isPhoto
      }).catch(() => {});
    } catch {}
    return;
  }

  let targetId = msgId || session.mainMessageId;
  let isPhoto  = session.mainIsPhoto;

  // Recovery: jika targetId tidak ada di session, coba ambil dari Firestore
  // OPTIMIZED: Hanya coba recovery 1x per session, bukan setiap editMain call
  if (!targetId && !session._recoveryAttempted) {
    session._recoveryAttempted = true;
    try {
      const { getUser } = require('../server/firebase');
      const user = await getUser(chatId);
      if (user && user.mainMessageId) {
        targetId = user.mainMessageId;
        isPhoto = user.mainIsPhoto !== false;
        // Simpan kembali ke memory session agar request berikutnya cepat
        session.mainMessageId = targetId;
        session.mainIsPhoto = isPhoto;
        console.log(`🔄 [Self-Healing] Recovered mainMessageId (${targetId}) from Firestore for user ${chatId}`);
      }
    } catch (dbErr) {
      console.error('Failed to recover mainMessageId from Firestore:', dbErr.message);
    }
  }

  if (!targetId) {
    const m = await bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
    session.mainMessageId = m.message_id;
    session.mainIsPhoto = false;

    // Simpan ke Firestore untuk pemulihan nanti jika bot restart
    try {
      const { db } = require('../server/firebase');
      await db.collection('users').doc(String(chatId)).update({
        mainMessageId: m.message_id,
        mainIsPhoto: false
      }).catch(() => {});
    } catch {}
    return;
  }

  // Jika isPhoto belum terdefinisi (misal setelah recover tetapi field di DB tidak ada), asumsikan true
  const finalIsPhoto = isPhoto !== false;

  try {
    if (finalIsPhoto) {
      await bot.editMessageCaption(text, {
        chat_id: chatId,
        message_id: targetId,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } else {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: targetId,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    }
  } catch (e) {
    console.error('editMain HTML error:', e.message);
    try {
      const m = await bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      session.mainMessageId = m.message_id;
      session.mainIsPhoto = false;

      // Simpan ke Firestore
      const { db } = require('../server/firebase');
      await db.collection('users').doc(String(chatId)).update({
        mainMessageId: m.message_id,
        mainIsPhoto: false
      }).catch(() => {});
    } catch {}
  }
}

const axios = require('axios');
const qrcode = require('qrcode');

/**
 * Generate a QRIS image buffer and invoice details using PanzzPay API
 */
async function generateQris(amount, orderId = null) {
  try {
    const baseUrl = (process.env.PANZZPAY_BASE_URL || 'https://panzzpay.my.id').replace(/\/+$/, '');
    const apiKey = process.env.PANZZPAY_API_KEY;

    if (!apiKey) {
      throw new Error('PANZZPAY_API_KEY is not configured in environment variables');
    }

    const { getBaseUrl } = require('../server/urlHelper');
    const customerOrderId = orderId || `INV-${Date.now()}`;
    const serverBaseUrl = getBaseUrl();
    const webhookUrl = `${serverBaseUrl}/webhook/panzzpay`;

    const requestBody = {
      amount: Number(amount),
      customer_order_id: customerOrderId,
      bot_name: process.env.STORE_NAME || 'PanzzStore',
      expiry_minutes: 15
    };
    if (webhookUrl) {
      requestBody.webhook_url = webhookUrl;
    }

    const res = await axios.post(`${baseUrl}/api/payment`, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      timeout: 15000
    });

    const paymentData = res.data?.data || res.data?.invoice || res.data;

    if (!paymentData || (!paymentData.id && !paymentData.transaction_id)) {
      console.error('PanzzPay API error response:', res.data);
      throw new Error(res.data?.message || res.data?.error || 'Gagal memperoleh QRIS dari PanzzPay API');
    }

    const id = paymentData.id || paymentData.transaction_id;
    const qrString = paymentData.qris_payload || paymentData.qr_string || paymentData.payload;
    const totalAmount = paymentData.unique_amount || paymentData.total || paymentData.amount || amount;
    const uniqueCode = paymentData.unique_code !== undefined ? paymentData.unique_code : (totalAmount - amount);

    let rawQrBuffer;
    if (qrString) {
      rawQrBuffer = await qrcode.toBuffer(qrString, { 
        margin: 2,
        width: 400,
        color: { dark: '#000000', light: '#ffffff' }
      });
    } else if (paymentData.qr_png_data_url || paymentData.qr_data_url) {
      const dataUrl = paymentData.qr_png_data_url || paymentData.qr_data_url;
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      rawQrBuffer = Buffer.from(base64Data, 'base64');
    } else {
      console.error('No QR payload String or data URL in PanzzPay response:', paymentData);
      throw new Error('QR payload string not found in PanzzPay response');
    }

    const invoice = {
      id: id,
      payload: qrString || '',
      total_amount: totalAmount,
      unique_code: uniqueCode > 0 ? uniqueCode : 0,
      status: paymentData.status || 'pending',
      raw: paymentData
    };

    // --- BUILD PREMIUM FRAME ---
    const width = 600;
    const height = 850;
    const image = new Jimp(width, height);

    // 1. Premium Gradient Background
    for (let y = 0; y < height; y++) {
      const ratio = y / height;
      const r = Math.round(15 * (1 - ratio) + 10 * ratio);
      const g = Math.round(30 * (1 - ratio) + 15 * ratio);
      const b = Math.round(70 * (1 - ratio) + 30 * ratio);
      const color = Jimp.rgbaToInt(r, g, b, 255);
      for (let x = 0; x < width; x++) {
        image.setPixelColor(color, x, y);
      }
    }

    // Soft glow around center
    const cx = width / 2;
    const cy = height / 2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dist = Math.sqrt(Math.pow(x - cx, 2) + Math.pow(y - cy, 2));
        if (dist < 400) {
          const existing = Jimp.intToRGBA(image.getPixelColor(x, y));
          const alpha = Math.max(0, 15 - dist * (15/400));
          const r = Math.min(255, existing.r + alpha);
          const g = Math.min(255, existing.g + alpha * 2);
          const b = Math.min(255, existing.b + alpha * 3);
          image.setPixelColor(Jimp.rgbaToInt(r, g, b, 255), x, y);
        }
      }
    }

    const boxSize = 460;
    const boxX = (width - boxSize) / 2;
    const boxY = (height - boxSize) / 2 + 30;
    const radius = 25;

    const drawRoundRect = (img, cX, cY, cSize, cRadius, color, startY = 0) => {
      for (let y = startY; y < cSize; y++) {
        for (let x = 0; x < cSize; x++) {
          let isInside = true;
          if (x < cRadius && y < cRadius) {
            isInside = Math.pow(x - cRadius, 2) + Math.pow(y - cRadius, 2) <= cRadius * cRadius;
          } else if (x > cSize - cRadius && y < cRadius) {
            isInside = Math.pow(x - (cSize - cRadius), 2) + Math.pow(y - cRadius, 2) <= cRadius * cRadius;
          } else if (x < cRadius && y > cSize - cRadius) {
            isInside = Math.pow(x - cRadius, 2) + Math.pow(y - (cSize - cRadius), 2) <= cRadius * cRadius;
          } else if (x > cSize - cRadius && y > cSize - cRadius) {
            isInside = Math.pow(x - (cSize - cRadius), 2) + Math.pow(y - (cSize - cRadius), 2) <= cRadius * cRadius;
          }
          if (isInside) {
            const rgba = Jimp.intToRGBA(color);
            if (rgba.a < 255) {
              const bg = Jimp.intToRGBA(img.getPixelColor(cX + x, cY + y));
              const mixedR = Math.round((rgba.r * rgba.a + bg.r * (255 - rgba.a)) / 255);
              const mixedG = Math.round((rgba.g * rgba.a + bg.g * (255 - rgba.a)) / 255);
              const mixedB = Math.round((rgba.b * rgba.a + bg.b * (255 - rgba.a)) / 255);
              img.setPixelColor(Jimp.rgbaToInt(mixedR, mixedG, mixedB, 255), cX + x, cY + y);
            } else {
              img.setPixelColor(color, cX + x, cY + y);
            }
          }
        }
      }
    };

    // Shadow
    drawRoundRect(image, boxX + 15, boxY + 25, boxSize, radius, Jimp.rgbaToInt(0, 0, 0, 60));
    drawRoundRect(image, boxX + 5, boxY + 10, boxSize, radius, Jimp.rgbaToInt(0, 0, 0, 100));

    // White Box
    drawRoundRect(image, boxX, boxY, boxSize, radius, Jimp.rgbaToInt(255, 255, 255, 255));

    // Logo
    const logoW = 160;
    const logoX = (width - logoW) / 2;
    const logoY = boxY - 30;
    drawRoundRect(image, logoX + 5, logoY + 5, logoW, 10, Jimp.rgbaToInt(0, 0, 0, 80), 0);

    const realLogoPath = path.join(__dirname, '../assets/qris_logo.png');
    if (fs.existsSync(realLogoPath)) {
      const qrisLogo = await Jimp.read(realLogoPath);
      qrisLogo.resize(logoW, Jimp.AUTO);
      image.composite(qrisLogo, logoX, logoY);
    }

    const fontBig = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
    const fontMed = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    const fontSmall = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);

    // Composite QR Code
    const qrImage = await Jimp.read(rawQrBuffer);
    image.composite(qrImage, boxX + (boxSize - qrImage.getWidth()) / 2, boxY + (boxSize - qrImage.getHeight()) / 2 + 15);

    // Texts
    const storeName = process.env.STORE_NAME || "PanzzStore";
    image.print(fontBig, 0, 65, { text: storeName, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER }, width);
    image.print(fontMed, 0, boxY + boxSize + 30, { text: "SCAN UNTUK MEMBAYAR", alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER }, width);
    image.print(fontSmall, 0, height - 40, { text: "Verifikasi Pembayaran Otomatis (PanzzPay)", alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER }, width);

    const finalBuffer = await image.getBufferAsync(Jimp.MIME_PNG);
    return { buffer: finalBuffer, invoice };
  } catch (err) {
    console.error('Failed to generate QRIS via PanzzPay:', err.response?.data || err.message);
    return null;
  }
}

module.exports = { escapeHTML, formatRupiah, editMain, generateQris };
