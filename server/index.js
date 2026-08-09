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

  // 2. Load dependencies setelah lisensi diverifikasi untuk menghindari crash inisialisasi modul lain
  const express = require('express');
  const cors = require('cors');
  const path = require('path');
  const fs = require('fs');

  const { getBaseUrl, setDetectedBaseUrl } = require('./urlHelper');

  const app = express();
  const PORT = process.env.PORT || 3000;

  // ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Auto-detect base URL from incoming requests middleware
  app.use((req, res, next) => {
    const host = req.get('x-forwarded-host') || req.get('host');
    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      setDetectedBaseUrl(`${proto}://${host}`);
    }
    next();
  });

  // ─── ROUTES ───────────────────────────────────────────────────────────────────
  const adminRoutes = require('./routes/admin');
  const { router: webhookRouter, setBotInstance } = require('./routes/webhook');

  app.use('/api/admin', adminRoutes);
  app.use('/webhook', webhookRouter);

  // ─── SERVE DASHBOARD ──────────────────────────────────────────────────────────
  function serveHtmlWithStoreName(filePath, extraReplace = null) {
    return (req, res) => {
      let html = fs.readFileSync(filePath, 'utf8');
      const storeName = process.env.STORE_NAME || 'PanzzStore';
      html = html.replace(/PanzzStore/g, storeName);
      if (extraReplace) {
        html = extraReplace(html);
      }
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    };
  }

  app.use('/dashboard', express.static(path.join(__dirname, '../dashboard'), { index: false }));

  // Expose public static downloads folder with auto-cleanup task
  const downloadsDir = path.join(__dirname, '../storage/downloads');
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }
  app.use('/downloads', express.static(downloadsDir));

  // Auto-cleanup files older than 24 hours in downloads folder
  setInterval(() => {
    try {
      const files = fs.readdirSync(downloadsDir);
      const now = Date.now();
      const expiryTime = 24 * 60 * 60 * 1000; // 24 hours

      files.forEach(file => {
        const filePath = path.join(downloadsDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > expiryTime) {
          fs.unlinkSync(filePath);
          console.log(`🧹 Auto-cleaned old download file: ${file}`);
        }
      });
    } catch (err) {
      console.error('Auto-cleanup error:', err.message);
    }
  }, 60 * 60 * 1000); // Check every hour

  // Serve Mini App (inject ADMIN_IDS so frontend can do local check)
  const serveMiniAppHandler = serveHtmlWithStoreName(path.join(__dirname, '../dashboard/miniapp.html'), (html) => {
    return html.replace(
      'window.__ADMIN_IDS__ || \'\'',
      `'${process.env.ADMIN_TELEGRAM_ID || ''}'`
    );
  });

  // Catch-all GET route for WebApp / MiniApp / Dashboard (prevents any 404 Not Found errors)
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/webhook') || req.path.startsWith('/downloads')) {
      return next();
    }
    const dashboardFilePath = path.join(__dirname, '../dashboard', req.path);
    if (fs.existsSync(dashboardFilePath) && fs.statSync(dashboardFilePath).isFile()) {
      return res.sendFile(dashboardFilePath);
    }
    return serveMiniAppHandler(req, res);
  });

  // ─── START BOT ────────────────────────────────────────────────────────────────
  const { bot } = require('../bot/index');
  setBotInstance(bot);

  // Reset Telegram Chat Menu Button to default (remove 'Open App' button)
  bot.setChatMenuButton({
    menu_button: JSON.stringify({ type: 'default' })
  }).catch(() => {});

  // ─── START SERVER ─────────────────────────────────────────────────────────────
  app.listen(PORT, () => {
    const currentBaseUrl = getBaseUrl();
    console.log(`🚀 ${process.env.STORE_NAME || 'PanzzStore'} Server running on ${currentBaseUrl}`);
    console.log(`📊 Dashboard: ${currentBaseUrl}/dashboard`);
    console.log(`🔗 Webhook URL: ${currentBaseUrl}/webhook/panzzpay`);
  });
})();
