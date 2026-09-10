let detectedBaseUrl = '';

/**
 * Set the auto-detected base URL captured from Express request middleware
 * @param {string} url 
 */
function setDetectedBaseUrl(url) {
  if (url && typeof url === 'string') {
    const cleaned = url.trim().replace(/\/+$/, '');
    if (!cleaned.includes('localhost') && !cleaned.includes('127.0.0.1')) {
      detectedBaseUrl = cleaned;
    }
  }
}

/**
 * Automatically determine the server's public Base URL.
 * Priority:
 * 1. Dynamic Express request host/proto if provided (req)
 * 2. Captured base URL from previous incoming HTTP request (detectedBaseUrl)
 * 3. Environment variables: SERVER_URL, BASE_URL, PUBLIC_URL, APP_URL
 * 4. Platform environment variables (Railway, Render, Vercel, Fly.io, Koyeb, etc.)
 * 5. Fallback for local development (http://localhost:PORT)
 * 
 * @param {Object} [req] - Express request object
 * @returns {string} Fully qualified base URL (e.g. "https://my-app.up.railway.app")
 */
function getBaseUrl(req = null) {
  // 1. Dynamic check from active Express request if provided
  if (req) {
    const host = req.get('x-forwarded-host') || req.get('host');
    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      const url = `${proto}://${host}`.replace(/\/+$/, '');
      detectedBaseUrl = url;
      return url;
    }
  }

  // 2. Previously captured base URL from incoming HTTP request middleware
  if (detectedBaseUrl) {
    return detectedBaseUrl;
  }

  // 3. Environment variables explicitly set by user (MINIAPP_URL, SERVER_URL, BASE_URL, PUBLIC_URL, APP_URL)
  const envUrl = process.env.MINIAPP_URL || process.env.SERVER_URL || process.env.BASE_URL || process.env.PUBLIC_URL || process.env.APP_URL;
  if (envUrl && envUrl.trim() !== '') {
    let url = envUrl.trim().replace(/\/+$/, '');
    // If not localhost, use it
    if (!url.includes('localhost') && !url.includes('127.0.0.1')) {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        const isIpOrPort = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(url) || /:\d+$/.test(url);
        url = isIpOrPort ? `http://${url}` : `https://${url}`;
      }
      return url;
    }
  }

  // 4. Auto-detect from cloud hosting environment variables
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_DOMAIN;
  if (railwayDomain && railwayDomain.trim() !== '') {
    const domain = railwayDomain.trim().replace(/\/+$/, '');
    return domain.startsWith('http') ? domain : `https://${domain}`;
  }

  if (process.env.RENDER_EXTERNAL_URL) {
    const domain = process.env.RENDER_EXTERNAL_URL.trim().replace(/\/+$/, '');
    return domain.startsWith('http') ? domain : `https://${domain}`;
  }
  if (process.env.VERCEL_URL) {
    const domain = process.env.VERCEL_URL.trim().replace(/\/+$/, '');
    return domain.startsWith('http') ? domain : `https://${domain}`;
  }
  if (process.env.FLY_APP_NAME) {
    return `https://${process.env.FLY_APP_NAME}.fly.dev`;
  }
  if (process.env.KOYEB_PUBLIC_DOMAIN) {
    const domain = process.env.KOYEB_PUBLIC_DOMAIN.trim().replace(/\/+$/, '');
    return domain.startsWith('http') ? domain : `https://${domain}`;
  }

  // If envUrl was set to localhost explicitly in .env, fallback to it
  if (envUrl && envUrl.trim() !== '') {
    let url = envUrl.trim().replace(/\/+$/, '');
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      const isIpOrPort = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(url) || /:\d+$/.test(url);
      url = isIpOrPort ? `http://${url}` : `https://${url}`;
    }
    return url;
  }

  // 5. Fallback for local development environment
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}`;
}

module.exports = {
  getBaseUrl,
  setDetectedBaseUrl
};
