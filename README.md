# PanzzStore — Bot Auto Order Akun TikTok

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Telegram-2CA5E0?style=flat-square&logo=telegram&logoColor=white)
![Storage](https://img.shields.io/badge/Storage-Telegram%20Channel%20+%20Local%20Cache-2CA5E0?style=flat-square&logo=telegram&logoColor=white)
![Database](https://img.shields.io/badge/Database-Firebase-FFCA28?style=flat-square&logo=firebase&logoColor=black)
![Payment](https://img.shields.io/badge/Payment-Pakasir%20QRIS-00C853?style=flat-square)

Bot Telegram untuk jualan akun TikTok **otomatis, 24/7, tanpa campur tangan manual**. Dari order → bayar QRIS / Saldo → akun terkirim, semua terjadi dalam hitungan detik. Fitur admin 100% terintegrasi di **Telegram Mini App** — tidak perlu web dashboard tambahan.

---

## 🚀 Fitur Unggulan

| Fitur | Keterangan |
|---|---|
| 🤖 **Telegram Bot** | Pembeli order, top up saldo, bayar pakai saldo, dan pantau riwayat langsung dari Telegram |
| 👨‍💻 **Mini App Admin** | Kelola stok, harga, order, dan **Kelola User (Saldo & Transaksi)** dari *webview* khusus Admin di dalam Telegram |
| ⚡ **Direct Download Link** | File akun dikirim menggunakan link download langsung dari server VPS/Railway (0 detik upload, download lebih cepat, bypass limit 50MB Telegram) |
| 🧹 **Auto-Cleanup Downloads** | File ZIP unduhan pembeli otomatis dibersihkan oleh server setiap 24 jam agar tidak memakan ruang disk |
| 🗜️ **Smart Master ZIP** | Upload 1 "Master ZIP" berisi banyak folder akun → sistem pecah dan ekstrak jadi banyak akun stok otomatis |
| ☁️ **Telegram Storage (Hybrid)** | File akun asli di-backup di Telegram Private Channel — **aman meski VPS suspend**, tidak ada data hilang |
| 💾 **Local Cache System** | Salinan file stok disimpan di lokal VPS agar proses pembungkusan akun saat checkout berlangsung instan (2-3 detik) |
| 💳 **Payment Pakasir QRIS** | Pembayaran QRIS / e-Wallet otomatis dengan konfirmasi via Webhook |
| 🔥 **Firebase Firestore** | Database real-time untuk order, stok, saldo, dan pengaturan harga |

---

## 🔄 Alur Kerja Bot

```
Pembeli mulai chat bot
        │
        ▼
  Pilih tipe akun
  (Muda/Tua + Garansi)
        │
        ▼
    Pilih jumlah akun
        │
        ▼
  Pilih pembayaran
  (QRIS Pakasir / Saldo)
        │
        ▼
  Pembayaran Berhasil!
        │
        ▼
  Server bungkus akun
  jadi 1 Master ZIP lokal
        │
        ▼
  Bot kirim link unduh
  berkecepatan tinggi ✅
```

---

## 🛠️ Prasyarat

Pastikan sudah terinstall sebelum mulai:

- **Node.js** v18 atau lebih baru → [nodejs.org](https://nodejs.org)
- **npm** (sudah termasuk bersama Node.js)
- **ngrok** (untuk testing lokal) → [ngrok.com](https://ngrok.com)
- Akun **Firebase** (Firestore Database) → [firebase.google.com](https://firebase.google.com)
- Akun **Pakasir** (payment gateway) → [pakasir.com](https://pakasir.com)

---

## 📦 Setup & Instalasi (Lokal / VPS)

### 1. Install Dependensi

```bash
cd "SC AUTO ORDER NEW"
npm install
```

### 2. Setup Firebase

1. Buka [Firebase Console](https://console.firebase.google.com).
2. Buat project baru → aktifkan **Firestore Database** (mode production).
3. Buka **Project Settings → Service Accounts**.
4. Klik **Generate new private key** → file JSON terdownload.
5. Rename file menjadi **`serviceAccountKey.json`** → letakkan di **folder utama** project.

### 3. Setup Telegram Storage Channel ☁️

File akun TikTok dibackup di Telegram Private Channel agar aman jika VPS suspend/mati.

1. Buat **Channel Private** baru di Telegram.
2. Tambahkan bot Telegram Anda sebagai **Admin** di channel tersebut (berikan izin mengirim pesan/dokumen).
3. Ambil **Channel ID** (biasanya berformat `-100xxxxxxxxx`). Anda bisa mengetahuinya dengan memforward pesan dari channel ke bot seperti `@userinfobot`.
4. Masukkan ke `.env` sebagai `STORAGE_CHANNEL_ID`.

### 4. Konfigurasi `.env`

Salin file contoh konfigurasi:
```bash
copy .env.example .env   # Windows
cp .env.example .env     # Linux / Mac
```

Isi file `.env` dengan data kamu:

| Variable | Wajib | Keterangan |
|---|:---:|---|
| `STORE_NAME` | ✅ | Nama toko (mengganti semua teks "PanzzStore" secara dinamis) |
| `BOT_TOKEN` | ✅ | Token bot dari [@BotFather](https://t.me/BotFather) |
| `ADMIN_TELEGRAM_ID` | ✅ | Telegram ID admin (cek via [@userinfobot](https://t.me/userinfobot)). Bisa diisi multipel dipisah koma. |
| `ADMIN_USERNAME` | ✅ | Username Telegram admin untuk tombol Bantuan (tanpa @) |
| `PAKASIR_API_KEY` | ✅ | API Key dari dashboard Pakasir |
| `PAKASIR_SLUG` | ✅ | Slug/username akun Pakasir kamu |
| `BASE_URL` | ✅ | URL server kamu (HTTPS) — ngrok / domain VPS (tanpa garis miring di akhir) |
| `BANNER_URL` | ❌ | URL gambar banner/logo utama (opsional, kosongkan jika ingin bot hanya bertipe teks tanpa foto) |
| `ADMIN_SECRET_KEY` | ✅ | Password rahasia untuk otentikasi Admin Mini App |
| `STORAGE_CHANNEL_ID` | ✅ | ID Channel Telegram Private untuk backup penyimpanan file akun |

---

## ☁️ Panduan Deploy di Railway (Untuk Anda / Buyer)

Ada dua metode deploy yang bisa digunakan di [Railway](https://railway.app):

### 🟢 Metode A: One-Click Deploy (Rekomendasi untuk Buyer)
Jika Anda menjual script ini, Buyer cukup mengklik tombol berikut untuk menduplikasi template ke akun Railway mereka secara otomatis:

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/PanzzDevv/SC-AUTOORDER-TIKTOK)

> ⚠️ *Jangan lupa ganti `USERNAME_GITHUB_ANDA` dan `NAMA_REPO_ANDA` pada link di atas dengan repositori GitHub Anda sebelum membagikannya ke buyer!*

---

### 🔵 Metode B: Deploy Manual via GitHub Repo

#### 1. Push ke GitHub (Private)
* Hubungkan folder project ke repositori **GitHub Private**.
* File `.env` dan `serviceAccountKey.json` otomatis diabaikan (`.gitignore`) agar rahasia database Anda tetap aman.

#### 2. Hubungkan ke Railway
1. Login ke [Railway](https://railway.app) menggunakan akun GitHub.
2. Klik **New Project** -> pilih **Deploy from GitHub repo** -> pilih repositori bot Anda.
3. Klik **Deploy Now**.

#### 3. Konfigurasi Variables di Railway
Buka menu **Variables** pada service Anda di Railway, lalu tambahkan semua konfigurasi dari `.env` lokal Anda satu per satu.

Khusus untuk **Firebase (karena `serviceAccountKey.json` di-ignore)**, Anda cukup menambahkan satu variabel ini di panel Railway:
* **Key:** `FIREBASE_SERVICE_ACCOUNT`
* **Value:** Copy & paste **seluruh isi** teks dari file `serviceAccountKey.json` lokal Anda (dalam format JSON utuh) ke kolom nilai variabel ini.

#### 4. Hubungkan Domain & Set `BASE_URL`
1. Masuk ke tab **Settings** di Railway, cari bagian **Networking**, lalu klik **Generate Domain** (contoh: `https://xxx.up.railway.app`).
2. Masuk kembali ke tab **Variables**, edit/tambahkan variabel **`BASE_URL`** dan isi dengan URL domain tersebut.

#### 5. Setup Persistent Volume (Penting untuk Cache File Unduhan)
1. Di dashboard project Railway Anda, klik **+ New** -> pilih **Volume**.
2. Set **Mount Path** ke: `/app/storage`.
3. Klik **Create**. File zip pesanan aktif Anda sekarang aman & tersimpan secara persisten bahkan setelah server restart.

---

## 📁 Struktur Folder

```
SC AUTO ORDER NEW/
├── bot/
│   ├── handlers/          # Handler command & callback bot
│   │   ├── order.js       # Alur order & pengiriman link download
│   │   ├── saldo.js       # Top up, saldo, & integrasi QRIS
│   │   ├── start.js       # Menu utama, navigasi & UI self-healing
│   │   └── bantuan.js     # Halaman bantuan FAQ
│   ├── index.js           # Inisialisasi bot Telegram
│   ├── sessions.js        # Manajemen sesi & UI state user
│   └── utils.js           # Helper & generator QRIS
├── server/
│   ├── routes/
│   │   ├── admin.js       # API endpoint Admin & Background Upload
│   │   └── webhook.js     # Endpoint webhook Pakasir
│   ├── firebase.js        # Koneksi Firestore & skema saldo
│   ├── telegramStorage.js # Integrasi Telegram Storage & Local Cache
│   ├── zipHelper.js       # Pembuatan & ekstraksi ZIP
│   └── index.js           # Server Express & auto-cleanup task
├── dashboard/             # Source code Telegram Mini App Admin
├── storage/
│   ├── accounts/          # Folder cache file akun lokal (Volume)
│   ├── downloads/         # Folder link download ZIP publik (Volume)
│   └── temp-uploads/      # File temp saat proses upload (Volume)
├── serviceAccountKey.json      # 🔑 Firebase Service Account (jangan di-commit!)
├── .env                        # 🔑 Environment variables (jangan di-commit!)
└── package.json
```

---

## 👨‍💻 Fitur Panel Admin (Mini App)

Buka dari Telegram → tombol **"⚙️ Admin Panel"** di menu utama bot.

| Fitur | Keterangan |
|---|---|
| 📊 **Dashboard** | Ringkasan pendapatan hari ini, total order, dan stok tersisa |
| 📦 **Kelola Stok** | Upload akun baru (instan non-blocking), hapus stok per kategori |
| 📋 **Riwayat Order** | Lihat semua order masuk beserta status dan detail pembeli |
| 👥 **Kelola User** | Cari user, lihat detail saldo/order, serta tambah/edit saldo user langsung |
| ✅ **Konfirmasi Manual** | Konfirmasi pembayaran manual jika webhook gagal |
| 💰 **Update Harga** | Ubah harga per kategori akun secara real-time |

---

## 📁 Panduan Upload Akun

Ada dua cara upload stok akun di Panel Admin:

**1. Upload ZIP Satuan** — Pilih satu atau beberapa file `.zip` (tiap file berisi 1 folder akun).

**2. Upload Folder (Hanya PC)** — Pilih langsung folder-folder akun Anda, sistem akan otomatis membungkus tiap folder menjadi file ZIP terpisah secara instan.

**3. Upload Master ZIP**
- Kumpulkan semua folder akun (misal 100 folder) dalam satu folder.
- Zip folder tersebut menjadi 1 file Master ZIP besar.
- Upload file Master ZIP tersebut, sistem akan membongkar dan menyimpannya menjadi 100 stok terpisah secara otomatis.

> **💡 Mengapa Upload Sekarang Sangat Cepat?** Upload di panel admin sekarang menggunakan sistem **Background Upload**. Begitu Anda klik upload, file langsung tersimpan di VPS Anda dan browser langsung menampilkan "Sukses" (kurang dari 1 detik). Proses backup ke Telegram akan diselesaikan secara aman di latar belakang.

---

## 🔧 Troubleshooting

<details>
<summary><b>❌ Bot tidak merespons sama sekali</b></summary>

- Cek apakah `BOT_TOKEN` di `.env` sudah benar.
- Pastikan tidak ada bot lain yang sedang jalan dengan token yang sama (konflik polling).
- Cek log: `pm2 logs panzzstore` atau log container Railway.

</details>

<details>
<summary><b>❌ Webhook Pakasir tidak masuk / order tidak terkonfirmasi otomatis</b></summary>

- Pastikan `BASE_URL` di `.env` menggunakan HTTPS (bukan HTTP).
- Pastikan URL Webhook di dashboard Pakasir sudah benar: `https://domain.com/webhook/pakasir`.
- Coba tes kirim data webhook simulasi dari dashboard Pakasir.

</details>

<details>
<summary><b>❌ Telegram Storage upload gagal / lambat</b></summary>

- Pastikan `STORAGE_CHANNEL_ID` sudah diisi di `.env` dan berformat negatif (misal: `-100xxxxxxxxxx`).
- Pastikan bot Anda sudah ditambahkan sebagai **Admin** di channel tersebut dengan izin penuh.
- Jika background upload tertunda, server akan otomatis menyelesaikannya secara bertahap untuk menghindari rate-limit Telegram.

</details>

---

## 📞 Support & Bantuan

Untuk bantuan dan perbaikan *source code*, silakan hubungi pengembang sistem.
