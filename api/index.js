require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
process.env.NTBA_FIX_350 = '1';

// Disable Telegram bot polling on Vercel to prevent 409 Conflict
process.env.DISABLE_BOT_POLLING = 'true';

const { app } = require('../server/app');
const { setBotInstance } = require('../server/routes/webhook');

// If BOT_TOKEN is configured in Vercel, instantiate bot without polling for webhook delivery
if (process.env.BOT_TOKEN) {
  try {
    const TelegramBot = require('node-telegram-bot-api');
    const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
    setBotInstance(bot);
  } catch (botErr) {
    console.warn('⚠️ Could not initialize bot on Vercel:', botErr.message);
  }
}

module.exports = app;
