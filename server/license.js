const axios = require('axios');

/**
 * Memvalidasi lisensi bot menggunakan Firestore REST API terpusat.
 * Keuntungan: Tidak membutuhkan Firebase Service Account milik developer di sisi klien,
 * sehingga database lisensi terpusat aman dari pencurian kunci akses.
 * 
 * Keamanan Tambahan:
 * - Project ID Firebase Pusat di-hardcode agar buyer tidak bisa mengarahkan verifikasi
 *   ke database Firebase milik mereka sendiri.
 * - Tidak ada bypass via environment variable (.env) demi keamanan 100%.
 */
async function verifyLicense() {
  // PENTING: ID Project Firebase Pusat Anda (Developer) di-hardcode di sini.
  // Jangan ditaruh di .env agar buyer tidak bisa mengubahnya ke project Firebase milik mereka sendiri!
  const centralProjectId = 'panzzdev-license'; 
  
  const licenseKey = process.env.LICENSE_KEY;
  const botToken = process.env.BOT_TOKEN;

  console.log('🔑 Memulai verifikasi lisensi...');

  if (!licenseKey) {
    console.error('\n==================================================');
    console.error('❌ ERROR: LICENSE_KEY tidak ditemukan di .env!');
    console.error('Harap masukkan LICENSE_KEY untuk menjalankan bot ini.');
    console.error('==================================================\n');
    process.exit(1);
  }

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${centralProjectId}/databases/(default)/documents/licenses/${licenseKey}`;
    const response = await axios.get(url);

    const data = response.data;
    if (!data || !data.fields) {
      console.error('\n==================================================');
      console.error('❌ ERROR: Struktur data lisensi dari server tidak valid!');
      console.error('==================================================\n');
      process.exit(1);
    }

    const status = data.fields.status?.stringValue;
    const expiredAtStr = data.fields.expiredAt?.timestampValue;
    const allowedBotToken = data.fields.botToken?.stringValue;

    // 1. Cek Status Lisensi
    if (status !== 'active') {
      console.error('\n==================================================');
      console.error(`❌ ERROR: Lisensi tidak aktif! Status saat ini: ${status || 'tidak diketahui'}`);
      console.error('==================================================\n');
      process.exit(1);
    }

    // 2. Cek Masa Aktif (Expired Date)
    if (expiredAtStr) {
      const expiredAt = new Date(expiredAtStr);
      if (new Date() > expiredAt) {
        console.error('\n==================================================');
        console.error(`❌ ERROR: Masa aktif lisensi Anda telah berakhir pada ${expiredAt.toLocaleString('id-ID')}!`);
        console.error('==================================================\n');
        process.exit(1);
      }
    }

    // 3. Cek Lock Bot Token (Opsional)
    if (allowedBotToken && botToken && allowedBotToken !== botToken) {
      console.error('\n==================================================');
      console.error('❌ ERROR: Lisensi ini dikunci untuk token bot lain!');
      console.error('Harap gunakan BOT_TOKEN yang sesuai.');
      console.error('==================================================\n');
      process.exit(1);
    }

    console.log(`✅ Lisensi valid (Status: ${status}).`);
  } catch (error) {
    console.error('\n==================================================');
    if (error.response && error.response.status === 404) {
      console.error('❌ ERROR: LICENSE_KEY tidak terdaftar / tidak valid!');
    } else {
      console.error('❌ ERROR: Gagal terhubung ke server lisensi untuk verifikasi.');
      console.error(`Detail: ${error.message}`);
    }
    console.error('==================================================\n');
    process.exit(1);
  }
}

module.exports = { verifyLicense };
