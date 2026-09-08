/**
 * Script Migrasi: Backfill totalOrders untuk semua user
 * 
 * Jalankan 1x saja setelah update firebase.js:
 *   node migrate-totalOrders.js
 * 
 * Script ini akan:
 * 1. Membaca semua orders dengan status 'done'
 * 2. Menghitung jumlah order per user
 * 3. Update field totalOrders di setiap user document
 */

require('dotenv').config();
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ─── Firebase Init (sama seperti di firebase.js) ─────────────────────────────
let serviceAccount;
const jsonKeyPath = path.join(__dirname, 'serviceAccountKey.json');
if (fs.existsSync(jsonKeyPath)) {
  serviceAccount = require(jsonKeyPath);
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
} else {
  serviceAccount = {
    type: 'service_account',
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
  };
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

async function migrate() {
  console.log('🔄 Memulai migrasi totalOrders...\n');

  // 1. Hitung semua orders done per user
  console.log('📊 Membaca semua orders dengan status "done"...');
  const ordersSnapshot = await db.collection('orders')
    .where('status', '==', 'done')
    .get();

  const orderCounts = {};
  ordersSnapshot.docs.forEach(doc => {
    const data = doc.data();
    const userId = String(data.userId);
    orderCounts[userId] = (orderCounts[userId] || 0) + 1;
  });

  console.log(`   ✅ Ditemukan ${ordersSnapshot.size} orders done dari ${Object.keys(orderCounts).length} user\n`);

  // 2. Ambil semua users
  console.log('👥 Membaca semua user documents...');
  const usersSnapshot = await db.collection('users').get();
  console.log(`   ✅ Ditemukan ${usersSnapshot.size} user\n`);

  // 3. Update totalOrders di setiap user (batch write, max 500 per batch)
  console.log('📝 Memulai update totalOrders...\n');

  let batchCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let batch = db.batch();

  for (const userDoc of usersSnapshot.docs) {
    const userData = userDoc.data();
    const userId = String(userData.telegramId || userDoc.id);
    const correctCount = orderCounts[userId] || 0;
    const currentCount = userData.totalOrders || 0;

    if (currentCount !== correctCount) {
      batch.update(userDoc.ref, { totalOrders: correctCount });
      updatedCount++;
      console.log(`   🔧 ${userId} (@${userData.username || '—'}): ${currentCount} → ${correctCount}`);
    } else {
      skippedCount++;
    }

    batchCount++;

    // Firestore batch limit = 500 operations
    if (batchCount >= 499) {
      await batch.commit();
      console.log(`   💾 Batch committed (${batchCount} operations)`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  // Commit remaining
  if (batchCount > 0) {
    await batch.commit();
  }

  console.log('\n' + '═'.repeat(50));
  console.log(`✅ MIGRASI SELESAI!`);
  console.log(`   • Updated: ${updatedCount} user`);
  console.log(`   • Skipped (sudah benar): ${skippedCount} user`);
  console.log(`   • Total orders done: ${ordersSnapshot.size}`);
  console.log('═'.repeat(50));

  process.exit(0);
}

migrate().catch(err => {
  console.error('❌ Migrasi gagal:', err);
  process.exit(1);
});
