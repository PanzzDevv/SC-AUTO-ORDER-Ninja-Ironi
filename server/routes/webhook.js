const express = require('express');
const router = express.Router();
const { getOrderByPanzzpayInvoiceId, getOrderByPakasirId, updateOrderStatus } = require('../firebase');
const { deliverOrder } = require('../../bot/handlers/order');

let botInstance = null;
function setBotInstance(bot) { botInstance = bot; }

// PanzzPay sends a POST webhook when payment is confirmed
async function handlePanzzpayWebhook(req, res) {
  try {
    const webhookToken = process.env.PANZZPAY_WEBHOOK_TOKEN;
    const authHeader = req.headers.authorization || '';
    const receivedToken = authHeader.replace(/^Bearer\s+/i, '') || req.headers['x-webhook-token'] || req.query.token;

    // Verify token if configured
    if (webhookToken && receivedToken && receivedToken !== webhookToken) {
      return res.status(403).json({ ok: false, error: 'Unauthorized webhook token' });
    }

    const invoiceId = req.body?.matched_invoice_id || req.body?.invoice_id || req.body?.order_id || req.body?.id;
    const status = String(req.body?.status || '').toUpperCase();

    if (!invoiceId) {
      return res.status(400).json({ ok: false, error: 'invoice_id parameter missing' });
    }

    if (status && status !== 'PAID' && status !== 'MATCHED' && status !== 'COMPLETED' && status !== 'SUCCESS') {
      return res.json({ ok: true, message: 'Status ignored' });
    }

    const order = await getOrderByPanzzpayInvoiceId(invoiceId);
    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found for invoice' });
    }

    if (order.status === 'done' || order.status === 'processing') {
      return res.json({ ok: true, message: 'Order already processed' });
    }

    await updateOrderStatus(order.id, 'paid');

    if (botInstance) {
      deliverOrder(botInstance, order.id).catch(console.error);
    }

    res.json({ ok: true, success: true, orderId: order.id });
  } catch (err) {
    console.error('PanzzPay Webhook error:', err.message);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
}

router.post('/panzzpay', handlePanzzpayWebhook);
router.post('/callback', handlePanzzpayWebhook);

// Legacy Pakasir webhook for backward compatibility
router.post('/pakasir', async (req, res) => {
  try {
    const { order_id, status, project } = req.body;
    if (process.env.PAKASIR_SLUG && project !== process.env.PAKASIR_SLUG) {
      return res.status(403).json({ error: 'Invalid project slug' });
    }
    if (status !== 'completed' && status !== 'paid' && status !== 'success') {
      return res.json({ message: 'Status ignored' });
    }
    const order = await getOrderByPakasirId(order_id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'done' || order.status === 'processing') {
      return res.json({ message: 'Already processed' });
    }
    await updateOrderStatus(order.id, 'paid');
    if (botInstance) {
      deliverOrder(botInstance, order.id).catch(console.error);
    }
    res.json({ success: true, orderId: order.id });
  } catch (err) {
    console.error('Pakasir Webhook error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { router, setBotInstance };
