require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
process.env.NTBA_FIX_350 = '1';

// Disable Telegram bot polling on Vercel to prevent 409 Conflict
process.env.DISABLE_BOT_POLLING = 'true';

const { app } = require('../server/app');
const { bot } = require('../bot/index');
const { setBotInstance } = require('../server/routes/webhook');

// Wire bot instance so webhook and manual fulfillment can send messages from Vercel
setBotInstance(bot);

module.exports = app;
