# Tengahin Merchant — Contoh Toko (untuk pemula)

Toko online kecil yang menjual **file digital** (gambar, ZIP, e-book, apa saja) dengan pembayaran **QRIS** lewat [Tengahin Merchant](https://tengah.in).
Dibuat supaya mudah dipelajari: tanpa database, tanpa framework frontend, dan **tanpa perlu membuat file `.env` sendiri**.

Yang bisa kamu lakukan dengan contoh ini:

1. Hubungkan toko ke akun merchant Tengahin kamu lewat halaman web (API key disimpan otomatis ke `.env`).
2. Masuk ke halaman admin, **tambah produk** dan **upload file** yang akan dikirim ke pembeli.
3. Pembeli memilih produk → membayar QRIS → setelah lunas, tombol **Unduh file** muncul.

## Yang kamu butuhkan

- **Node.js 18 atau lebih baru** (cek dengan `node --version`). Unduh di <https://nodejs.org>.
- Akun **merchant Tengahin** dan sebuah **API key** (dibuat di Tengahin → Merchant → tab **API** → "Buat kunci", diawali `tgk_`).

## Menjalankan (5 langkah)

```bash
# 1. Unduh proyek ini
git clone https://github.com/OWNER/tengahin-merchant-example.git
cd tengahin-merchant-example

# 2. Pasang dependensi
npm install

# 3. Jalankan
npm start
```

4. Buka **<http://localhost:4000>** di browser. Karena API key belum ada, kamu otomatis diarahkan ke halaman **Setup**.
5. Tempel API key, klik **Simpan & mulai**. File `.env` dibuat otomatis. Catat **kata sandi admin** yang ditampilkan (hanya sekali).

Selesai. Sekarang buka **/admin** untuk menambah produk pertama.

> **Tidak mau lewat halaman setup?** Salin `.env.example` menjadi `.env`, isi `TENGAHIN_API_KEY`, lalu jalankan `npm start`.

## Menambah produk

1. Buka <http://localhost:4000/admin> dan masuk dengan kata sandi admin.
2. Isi **nama**, **deskripsi**, **harga** (minimal Rp 10.000), dan pilih **file** yang akan dikirim ke pembeli (gambar, ZIP, PDF, apa saja, maksimal 50 MB).
3. Klik **Simpan produk**. Produk langsung tampil di halaman toko (<http://localhost:4000>).

Di halaman admin kamu juga bisa **menyembunyikan** produk, **menghapusnya** (jika belum pernah dipesan), dan melihat **pesanan terbaru**.

## Alur pembelian

```
Pembeli pilih produk ──► server membuat order + transaksi Tengahin (harga dari SERVER)
                    ──► pembeli dibawa ke halaman bayar QRIS Tengahin
Pembeli scan & bayar ──► halaman order otomatis cek status ke server toko
                         └─ server bertanya ke Tengahin → "paid" → order ditandai lunas (sekali saja)
Pembeli melihat tombol "Unduh file" ──► /download/<order>/<token> (hanya untuk order yang lunas)
```

## Peta file (semua pendek dan berkomentar bahasa Indonesia)

| File | Isinya |
|---|---|
| `src/server.js` | Semua rute: setup, admin, toko, pembayaran, unduhan, webhook |
| `src/env.js` | Membaca dan menulis file `.env` |
| `src/db.js` | Penyimpanan sederhana di `data/db.json` (produk & order) |
| `src/auth.js` | Login admin (kata sandi ter-hash + cookie bertanda tangan) |
| `src/views.js` | Pembuat halaman HTML (semua teks di-escape, aman dari XSS) |
| `.env.example` | Daftar pengaturan yang tersedia |
| `data/` | Dibuat otomatis: `db.json` dan folder `files/` berisi file produk (tidak ikut git) |

## Pengaturan (`.env`)

| Variabel | Keterangan |
|---|---|
| `TENGAHIN_API_KEY` | API key merchant (`tgk_…`). **Rahasia.** |
| `TENGAHIN_BASE_URL` | Alamat server Tengahin, mis. `https://tengah.in` |
| `TENGAHIN_WEBHOOK_SECRET` | Opsional. Secret webhook (`whsec_…`) agar toko diberi tahu langsung saat ada pembayaran |
| `ADMIN_PASSWORD_HASH`, `SESSION_SECRET` | Dibuat otomatis oleh halaman setup |
| `PORT` | Port server (bawaan `4000`) |
| `MAX_UPLOAD_MB` | Batas ukuran file produk (bawaan `50`) |

## Webhook (opsional, disarankan)

Tanpa webhook, status pembayaran dicek saat pembeli membuka halaman order. Dengan webhook, Tengahin memberi tahu toko begitu pembayaran masuk, bahkan jika pembeli menutup halaman.

1. Server toko harus bisa dijangkau dari internet lewat **https** (saat uji lokal bisa pakai tunnel seperti `cloudflared` atau `ngrok`).
2. Di Tengahin → Merchant → tab **Webhook**, isi URL `https://DOMAIN-KAMU/webhooks/tengahin`, lalu salin **secret** (`whsec_…`).
3. Tempel secret ke `.env` sebagai `TENGAHIN_WEBHOOK_SECRET=...` lalu restart (`npm start`).
4. Klik **Kirim event uji** di Tengahin untuk memastikan berfungsi.

## Masalah umum

| Gejala | Penyebab & solusi |
|---|---|
| Halaman setup menolak API key ("ditolak oleh Tengahin") | Key salah/dicabut. Buat key baru di Merchant → API, salin utuh (diawali `tgk_`). |
| "Tidak bisa menghubungi …" | Alamat server salah atau tidak ada internet. Cek `TENGAHIN_BASE_URL`. |
| "Setup hanya dari komputer lokal" | Setup hanya bisa dibuka dari `http://localhost:4000` di mesin server. Di server produksi buat `.env` manual. |
| Lupa kata sandi admin | Hapus baris `ADMIN_PASSWORD_HASH` dan `TENGAHIN_API_KEY` dari `.env`, jalankan ulang, lalu setup lagi (produk di `data/` tetap aman). |
| File produk gagal di-upload | Ukurannya melebihi `MAX_UPLOAD_MB`. Naikkan nilainya di `.env`. |
| Pembeli sudah bayar tapi tombol unduh belum muncul | Tunggu beberapa detik; halaman mengecek tiap 3 detik. Cek juga log server (`npm start`) untuk pesan error. |

## Keamanan (sudah diterapkan di contoh ini)

- API key hanya di server (`.env`, izin file dibatasi), **tidak pernah** dikirim ke browser.
- Harga diambil dari produk di server; ubah harga di form tidak berpengaruh.
- "Lunas" hanya diputuskan server setelah bertanya ke Tengahin; pemenuhan **idempoten** (aman dicek berkali-kali/bersamaan).
- File produk disimpan dengan **nama acak** di luar folder publik; unduhan butuh token rahasia milik order **dan** order harus lunas; selalu dikirim sebagai lampiran.
- Admin dilindungi kata sandi (scrypt), sesi bertanda tangan, pembatasan percobaan login, dan pemeriksaan asal (CSRF).
- Halaman setup hanya bisa dibuka dari komputer lokal dan menutup diri setelah selesai.

## Sebelum dipakai sungguhan (produksi)

Contoh ini sengaja sederhana. Untuk toko sungguhan:

- Ganti `data/db.json` dengan database (SQLite/MySQL/Postgres). Ubah status order dengan update bersyarat (`UPDATE ... WHERE status='awaiting_payment'`) dan kirim barang hanya jika ada baris yang berubah.
- Jalankan di belakang **https** (reverse proxy seperti Nginx/Caddy), dan `PORT` tidak dibuka langsung ke internet.
- Simpan file produk di penyimpanan yang dicadangkan (atau object storage) dan pindai file yang di-upload bila perlu.
- Tidak ada sandbox: pembayaran memakai QRIS sungguhan. Uji dengan harga minimum **Rp 10.000**.

Dokumentasi API lengkap: <https://tengah.in/docs>
