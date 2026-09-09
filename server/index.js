require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
process.env.NTBA_FIX_350 = '1';

const { verifyLicense } = require('./license');

(async () => {
  // 1. Verifikasi lisensi terpusat sebelum inisialisasi aplikasi apapun
  await verifyLicense();

  const { app } = require('./app');
  const { getBaseUrl } = require('./urlHelper');
  const { setBotInstance } = require('./routes/webhook');

  // ─── START BOT ────────────────────────────────────────────────────────────────
  const { bot } = require('../bot/index');
  setBotInstance(bot);

  // Reset Telegram Chat Menu Button to default (remove 'Open App' button)
  bot.setChatMenuButton({
    menu_button: JSON.stringify({ type: 'default' })
  }).catch(() => {});

  // ─── START SERVER ─────────────────────────────────────────────────────────────
  const isBotOnly = process.env.BOT_ONLY === 'true';
  const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;

  if (!isBotOnly) {
    app.listen(PORT, () => {
      const currentBaseUrl = getBaseUrl();
      console.log(`🚀 ${process.env.STORE_NAME || 'PanzzStore'} Server running on ${currentBaseUrl} (Port: ${PORT})`);
      console.log(`📊 Dashboard: ${currentBaseUrl}/dashboard`);
      console.log(`🔗 Webhook URL: ${currentBaseUrl}/webhook/panzzpay`);
    });
  } else {
    console.log(`🤖 Bot running in BOT_ONLY mode (HTTP server disabled)`);
  }
})();
