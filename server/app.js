const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { setDetectedBaseUrl } = require('./urlHelper');

const app = express();

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
const { router: webhookRouter } = require('./routes/webhook');

app.use('/api/admin', adminRoutes);
app.use('/webhook', webhookRouter);

// ─── SERVE DASHBOARD ──────────────────────────────────────────────────────────
function serveHtmlWithStoreName(filePath, extraReplace = null) {
  return (req, res) => {
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Not Found');
    }
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

// Auto-cleanup files older than 24 hours in downloads folder (only on persistent servers)
if (!process.env.VERCEL && process.env.DISABLE_BOT_POLLING !== 'true') {
  setInterval(() => {
    try {
      if (!fs.existsSync(downloadsDir)) return;
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
}

// Serve Mini App (inject ADMIN_IDS so frontend can do local check)
const serveMiniAppHandler = serveHtmlWithStoreName(path.join(__dirname, '../dashboard/miniapp.html'), (html) => {
  return html.replace(
    'window.__ADMIN_IDS__ || \'\'',
    `'${process.env.ADMIN_TELEGRAM_ID || ''}'`
  );
});

// Explicit miniapp route
app.get('/miniapp', serveMiniAppHandler);

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

module.exports = { app, serveMiniAppHandler };
