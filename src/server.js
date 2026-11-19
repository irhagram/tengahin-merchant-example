// Toko contoh dengan pembayaran QRIS Tengahin. Dibuat agar mudah dipelajari pemula:
//   1. Jalankan `npm start`, buka http://localhost:4000 → kamu diminta memasukkan API key (halaman /setup).
//   2. API key tersimpan ke file .env otomatis. Setelah itu buka /admin untuk menambah produk + file yang dijual.
//   3. Pembeli memilih produk → bayar QRIS → setelah lunas, tombol unduh file muncul.
//
// Aturan emas pembayaran (jangan dilanggar):
//   - API key hanya di server (.env), tidak pernah dikirim ke browser.
//   - Harga diambil dari data produk di SERVER, bukan dari form pembeli.
//   - "Sudah bayar" hanya dari getTransaction()/webhook terverifikasi di server, bukan dari tombol/redirect di browser.
//   - Pemenuhan pesanan idempoten: aman walau status dicek berkali-kali atau bersamaan (lihat db.transition()).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import multer from 'multer';
import { Tengahin, TengahinError, verifyWebhook, WebhookSignatureError } from '@tengahin/sdk';
import { checkPassword, clearSessionCookie, hashPassword, isAdmin, recordAttempt, setSessionCookie, tooManyAttempts } from './auth.js';
import * as db from './db.js';
import { loadEnv, saveEnv } from './env.js';
import { esc, page, rupiah, sizeText } from './views.js';

loadEnv();

const PORT = Number(process.env.PORT || 4000);
const MAX_UPLOAD_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 50));
const DEFAULT_BASE_URL = 'https://tengah.in';

// ── Konfigurasi (dibaca ulang tiap dipakai, supaya setup lewat web langsung berlaku tanpa restart) ──
const configured = () => /^tgk_[A-Za-z0-9]{20,}$/.test(process.env.TENGAHIN_API_KEY || '');
let cached = { key: '', client: null };
function tengahin() {
  const apiKey = process.env.TENGAHIN_API_KEY || '';
  const baseUrl = process.env.TENGAHIN_BASE_URL || DEFAULT_BASE_URL;
  const key = `${apiKey}|${baseUrl}`;
  if (cached.key !== key) cached = { key, client: new Tengahin({ apiKey, baseUrl }) };
  return cached.client;
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);

// ── Webhook dari Tengahin (HARUS sebelum body parser lain: tanda tangan dihitung atas body mentah) ──
app.post('/webhooks/tengahin', express.raw({ type: 'application/json', limit: '64kb' }), async (req, res) => {
  const secret = process.env.TENGAHIN_WEBHOOK_SECRET || '';
  if (!secret) return res.status(503).send('webhook belum dikonfigurasi (isi TENGAHIN_WEBHOOK_SECRET)');
  let event;
  try {
    event = await verifyWebhook(req.body, req.get('x-tengahin-signature'), secret);
  } catch (e) {
    if (e instanceof WebhookSignatureError) return res.status(400).send('invalid signature');
    throw e;
  }
  if (event.type === 'webhook.test') return res.sendStatus(200);
  const order = db.getOrder(event.data.reference ?? '');
  if (!order) return res.sendStatus(200); // bukan order kita: terima saja agar tidak dikirim ulang
  try {
    // Webhook hanya pemicu: status dikonfirmasi ulang ke API (sumber kebenaran). Idempoten.
    await refreshOrder(order);
    res.sendStatus(200);
  } catch (e) {
    console.error('webhook gagal diproses:', e);
    res.sendStatus(500); // non-2xx → Tengahin mengirim ulang nanti
  }
});

app.use(express.urlencoded({ extended: false, limit: '20kb' }));

// Header keamanan dasar + perlindungan CSRF sederhana (form hanya boleh dikirim dari situs ini sendiri)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.method === 'POST') {
    const origin = req.get('origin');
    if (origin && new URL(origin).host !== req.get('host')) return res.status(403).send('Origin tidak diizinkan.');
  }
  next();
});

// Sebelum API key diisi, semua halaman diarahkan ke /setup.
app.use((req, res, next) => {
  if (configured() || req.path === '/setup') return next();
  res.redirect('/setup');
});

// ───────────────────────────── SETUP PERTAMA KALI ─────────────────────────────
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOCAL_ADDR = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** Setup hanya boleh dari komputer ini sendiri, supaya orang lain tidak bisa mengisi API key di server yang belum disetel. */
const isLocalRequest = (req) => LOCAL_ADDR.has(req.socket.remoteAddress) && !req.get('x-forwarded-for') && LOCAL_HOSTS.test(req.get('host') || '');

const setupForm = (error = '', v = {}) => page('Setup', `
  <h1>Selamat datang 👋</h1>
  <p class="muted">Satu langkah lagi: hubungkan toko ini ke akun merchant Tengahin kamu.</p>
  ${error ? `<div class="warn bad">${esc(error)}</div>` : ''}
  <form method="post" action="/setup" class="card" autocomplete="off">
    <label for="k">API key Tengahin Merchant</label>
    <input id="k" name="apiKey" placeholder="tgk_..." required value="${esc(v.apiKey)}" spellcheck="false">
    <p class="muted">Dapatkan di Tengahin → Merchant → tab <b>API</b> → "Buat kunci". Kunci ini rahasia dan hanya disimpan di file <code>.env</code> di komputermu.</p>
    <label for="b">Alamat server Tengahin</label>
    <input id="b" name="baseUrl" value="${esc(v.baseUrl || DEFAULT_BASE_URL)}" required>
    <label for="p">Kata sandi admin (opsional)</label>
    <input id="p" name="adminPassword" type="password" minlength="8" placeholder="Kosongkan agar dibuatkan otomatis">
    <p class="muted">Dipakai untuk masuk ke halaman <code>/admin</code> (tambah produk &amp; lihat pesanan).</p>
    <label for="w">Secret webhook (opsional)</label>
    <input id="w" name="webhookSecret" placeholder="whsec_..." value="${esc(v.webhookSecret)}" spellcheck="false">
    <p class="muted">Boleh dikosongkan dulu. Tanpa webhook, status pembayaran tetap dicek otomatis saat pembeli membuka halaman pesanan.</p>
    <p><button>Simpan &amp; mulai</button></p>
  </form>`);

app.get('/setup', (req, res) => {
  if (configured()) return res.redirect('/');
  if (!isLocalRequest(req)) {
    return res.status(403).send(page('Setup', `<h1>Setup hanya dari komputer lokal</h1>
      <p>Untuk keamanan, halaman ini hanya bisa dibuka lewat <code>http://localhost:${PORT}/setup</code> di mesin tempat server berjalan.
      Di server produksi, buat file <code>.env</code> secara manual (lihat <code>.env.example</code>).</p>`));
  }
  res.send(setupForm());
});

app.post('/setup', async (req, res) => {
  if (configured()) return res.redirect('/');
  if (!isLocalRequest(req)) return res.status(403).send('Setup hanya dari komputer lokal.');
  const apiKey = String(req.body.apiKey || '').trim();
  const baseUrl = String(req.body.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const webhookSecret = String(req.body.webhookSecret || '').trim();
  const typed = String(req.body.adminPassword || '');
  const keep = { apiKey, baseUrl, webhookSecret };

  if (!/^tgk_[A-Za-z0-9]{20,}$/.test(apiKey)) return res.status(400).send(setupForm('API key tidak valid. Harus diawali "tgk_" (salin utuh dari halaman Merchant → API).', keep));
  if (!/^https?:\/\/[^\s/]+$/.test(baseUrl)) return res.status(400).send(setupForm('Alamat server tidak valid, contoh: https://tengah.in', keep));
  if (webhookSecret && !/^whsec_[A-Za-z0-9_-]{16,}$/.test(webhookSecret)) return res.status(400).send(setupForm('Secret webhook tidak valid (harus diawali "whsec_").', keep));
  if (typed && typed.length < 8) return res.status(400).send(setupForm('Kata sandi admin minimal 8 karakter.', keep));

  // Uji API key ke server Tengahin: referensi yang tidak ada → 404 (kunci sah), kunci salah → 401.
  try {
    await new Tengahin({ apiKey, baseUrl, maxRetries: 0, timeoutMs: 10_000 }).getTransactionByReference('setup-check');
  } catch (e) {
    if (!(e instanceof TengahinError) || e.status !== 404) {
      const msg = e instanceof TengahinError && e.status === 401 ? 'API key ditolak oleh Tengahin. Periksa lagi atau buat kunci baru.'
        : e instanceof TengahinError && e.status === 0 ? `Tidak bisa menghubungi ${baseUrl}. Periksa alamat server dan koneksi internet.`
        : `Tengahin membalas error tak terduga (${e instanceof TengahinError ? e.status : 'jaringan'}).`;
      return res.status(400).send(setupForm(msg, keep));
    }
  }

  const password = typed || randomBytes(9).toString('base64url');
  const values = {
    TENGAHIN_API_KEY: apiKey,
    TENGAHIN_BASE_URL: baseUrl,
    ADMIN_PASSWORD_HASH: hashPassword(password),
    SESSION_SECRET: randomBytes(32).toString('hex'),
  };
  if (webhookSecret) values.TENGAHIN_WEBHOOK_SECRET = webhookSecret;
  saveEnv(values);

  res.send(page('Setup selesai', `<h1 class="ok">Berhasil terhubung ✓</h1>
    <p>API key valid dan sudah disimpan ke file <code>.env</code>.</p>
    ${typed ? '' : `<div class="warn"><b>Kata sandi admin kamu (catat sekarang, tidak ditampilkan lagi):</b><br><code>${esc(password)}</code></div>`}
    <p><a class="btn" href="/admin">Buka admin &amp; tambah produk</a></p>`));
});

// ───────────────────────────── ADMIN ─────────────────────────────
const secret = () => process.env.SESSION_SECRET || '';
const requireAdmin = (req, res, next) => (isAdmin(req, secret()) ? next() : res.redirect('/admin/login'));

app.get('/admin/login', (req, res) => {
  if (isAdmin(req, secret())) return res.redirect('/admin');
  res.send(page('Masuk admin', `<h1>Masuk admin</h1>${req.query.error ? '<div class="warn bad">Kata sandi salah.</div>' : ''}
    <form method="post" action="/admin/login" class="card"><label for="pw">Kata sandi</label>
    <input id="pw" name="password" type="password" required autofocus><p><button>Masuk</button></p></form>`));
});

app.post('/admin/login', (req, res) => {
  const ip = req.socket.remoteAddress || 'x';
  if (tooManyAttempts(ip)) return res.status(429).send(page('Terlalu banyak percobaan', '<p>Terlalu banyak percobaan. Coba lagi 10 menit lagi.</p>'));
  if (!checkPassword(req.body.password, process.env.ADMIN_PASSWORD_HASH)) {
    recordAttempt(ip);
    return res.redirect('/admin/login?error=1');
  }
  setSessionCookie(res, secret());
  res.redirect('/admin');
});

app.post('/admin/logout', (_req, res) => {
  clearSessionCookie(res);
  res.redirect('/');
});

const upload = multer({
  storage: multer.diskStorage({
    destination: db.FILES_DIR,
    filename: (_req, _file, cb) => cb(null, randomBytes(16).toString('hex')), // nama acak di disk; nama asli disimpan di data produk
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 6 },
});

const cleanName = (s) => String(s || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file';
const removeFile = (stored) => { try { unlinkSync(resolve(db.FILES_DIR, stored)); } catch { /* sudah tidak ada */ } };

app.get('/admin', requireAdmin, (req, res) => {
  const products = db.listProducts();
  const orders = db.listOrders().slice(0, 30);
  const msg = { ok: req.query.ok, err: req.query.err };
  const rows = products.map((p) => `<div class="card"><div class="row"><b>${esc(p.name)}</b> <span class="tag">${rupiah(p.price)}</span>
    <span class="tag">${p.active ? 'dijual' : 'disembunyikan'}</span></div>
    <p class="muted">${esc(p.description)}</p><p class="muted">File: ${esc(p.file.original)} · ${sizeText(p.file.size)}</p>
    <div class="row"><form method="post" action="/admin/products/${esc(p.id)}/toggle"><button class="ghost">${p.active ? 'Sembunyikan' : 'Tampilkan'}</button></form>
    <form method="post" action="/admin/products/${esc(p.id)}/delete" onsubmit="return confirm('Hapus produk ini?')"><button class="danger">Hapus</button></form></div></div>`).join('');
  const orderRows = orders.map((o) => `<tr><td>${esc(o.id)}</td><td>${esc(o.productName)}</td><td>${rupiah(o.price)}</td><td>${esc(o.status)}</td></tr>`).join('');

  res.send(page('Admin', `<h1>Admin</h1>
    ${msg.ok ? `<div class="warn ok">${esc(msg.ok)}</div>` : ''}${msg.err ? `<div class="warn bad">${esc(msg.err)}</div>` : ''}
    <h2>Tambah produk</h2>
    <form method="post" action="/admin/products" enctype="multipart/form-data" class="card">
      <label for="n">Nama produk</label><input id="n" name="name" maxlength="80" required>
      <label for="d">Deskripsi</label><textarea id="d" name="description" rows="3" maxlength="500"></textarea>
      <label for="pr">Harga (rupiah, minimal 10.000)</label><input id="pr" name="price" type="number" min="10000" step="1" required>
      <label for="f">File yang dikirim ke pembeli (gambar, zip, apa saja · maks ${MAX_UPLOAD_MB} MB)</label>
      <input id="f" name="file" type="file" required>
      <p><button>Simpan produk</button></p></form>
    <h2>Produk (${products.length})</h2>${rows || '<p class="muted">Belum ada produk.</p>'}
    <h2>Pesanan terbaru</h2>${orderRows ? `<table><tr><th>ID</th><th>Produk</th><th>Harga</th><th>Status</th></tr>${orderRows}</table>` : '<p class="muted">Belum ada pesanan.</p>'}`, { admin: true }));
});

app.post('/admin/products', requireAdmin, (req, res) => {
  upload.single('file')(req, res, (err) => {
    const back = (k, m) => res.redirect(`/admin?${k}=${encodeURIComponent(m)}`);
    const file = req.file;
    if (err) return back('err', err.code === 'LIMIT_FILE_SIZE' ? `File terlalu besar (maks ${MAX_UPLOAD_MB} MB).` : 'Upload gagal.');
    if (!file) return back('err', 'Pilih file yang akan dikirim ke pembeli.');
    const name = String(req.body.name || '').trim().slice(0, 80);
    const price = Number(req.body.price);
    if (!name || !Number.isInteger(price) || price < 10_000 || price > 10_000_000) {
      removeFile(file.filename);
      return back('err', 'Nama wajib diisi dan harga harus bilangan bulat antara Rp 10.000 dan Rp 10.000.000.');
    }
    db.addProduct({
      name,
      description: String(req.body.description || '').trim().slice(0, 500),
      price,
      file: { stored: file.filename, original: cleanName(file.originalname), size: file.size },
    });
    back('ok', 'Produk tersimpan.');
  });
});

app.post('/admin/products/:id/toggle', requireAdmin, (req, res) => {
  const p = db.getProduct(req.params.id);
  if (p) db.updateProduct(p.id, { active: !p.active });
  res.redirect('/admin');
});

app.post('/admin/products/:id/delete', requireAdmin, (req, res) => {
  const p = db.getProduct(req.params.id);
  if (!p) return res.redirect('/admin');
  // Produk yang sudah pernah dipesan tidak dihapus agar pembeli yang sudah bayar tetap bisa mengunduh.
  if (db.listOrders().some((o) => o.productId === p.id)) {
    return res.redirect('/admin?err=' + encodeURIComponent('Produk ini sudah punya pesanan, jadi tidak bisa dihapus. Gunakan "Sembunyikan".'));
  }
  db.removeProduct(p.id);
  removeFile(p.file.stored);
  res.redirect('/admin?ok=' + encodeURIComponent('Produk dihapus.'));
});

// ───────────────────────────── TOKO ─────────────────────────────
/**
 * Memeriksa status order ke Tengahin. Aman dipanggil berulang (halaman status & webhook).
 * Pemenuhan = menandai order 'paid'; tombol unduh muncul karena status itu. Hanya satu pemanggil yang menang.
 */
async function refreshOrder(order) {
  if (order.status !== 'awaiting_payment') return order;
  const tx = await tengahin().getTransaction(order.transactionId);

  // Validasi silang: transaksi ini benar-benar milik order ini dan nominalnya sama dengan harga di server.
  if (tx.reference !== order.id || tx.amount !== order.price) {
    throw new Error(`Transaksi ${tx.id} tidak cocok dengan order ${order.id}`);
  }
  if (tx.status === 'paid') db.transition(order.id, 'paid', { paidAt: tx.paidAt });
  else if (tx.status === 'expired' || tx.status === 'cancelled') db.transition(order.id, 'failed');
  return db.getOrder(order.id);
}

app.get('/', (_req, res) => {
  const items = db.listProducts({ onlyActive: true }).map((p) => `<div class="card"><b>${esc(p.name)}</b> · ${rupiah(p.price)}
    <p class="muted">${esc(p.description)}</p>
    <form method="post" action="/checkout" class="row"><input type="hidden" name="productId" value="${esc(p.id)}">
    <input name="name" placeholder="Nama kamu (opsional)" maxlength="60" style="max-width:260px"><button>Beli</button></form></div>`).join('');
  res.send(page('Toko Contoh', `<h1>Toko Contoh</h1><p class="muted">Bayar via QRIS, file langsung bisa diunduh setelah lunas.</p>
    ${items || '<div class="card">Belum ada produk. Buka <a href="/admin">Admin</a> untuk menambahkan produk pertama.</div>'}`));
});

app.post('/checkout', async (req, res) => {
  const product = db.getProduct(String(req.body.productId || ''));
  if (!product || !product.active) return res.status(400).send(page('Error', '<p class="bad">Produk tidak ditemukan.</p><p><a href="/">Kembali</a></p>'));

  const order = {
    id: db.newId('ord'),
    productId: product.id,
    productName: product.name,
    price: product.price, // harga dari server, disalin (snapshot) supaya perubahan produk nanti tidak memengaruhi order ini
    file: product.file,
    downloadToken: randomBytes(24).toString('hex'),
    status: 'awaiting_payment',
    createdAt: Date.now(),
  };
  try {
    // reference = ID order → pemanggilan idempoten dan otomatis dicoba ulang SDK bila gagal sementara
    const tx = await tengahin().createTransaction({
      amount: order.price,
      reference: order.id,
      customerName: String(req.body.name || '').slice(0, 60),
      message: product.name.slice(0, 100),
    });
    Object.assign(order, { transactionId: tx.id, paymentUrl: tx.paymentUrl, totalPaid: tx.totalPaid, expiresAt: tx.expiresAt });
    db.addOrder(order);
    res.redirect(`/orders/${order.id}`);
  } catch (e) {
    console.error('createTransaction gagal:', e);
    const msg = e instanceof TengahinError ? e.message : 'Terjadi kesalahan.';
    res.status(502).send(page('Error', `<p class="bad">Gagal membuat pembayaran: ${esc(msg)}</p><p><a href="/">Kembali</a></p>`));
  }
});

app.get('/orders/:id', async (req, res) => {
  let order = db.getOrder(req.params.id);
  if (!order) return res.status(404).send(page('404', '<p>Order tidak ditemukan.</p>'));
  try { order = await refreshOrder(order); } catch (e) { console.error('refreshOrder gagal:', e.message); }

  let body;
  if (order.status === 'awaiting_payment') {
    body = `<div class="card"><p>Total bayar: <b>${rupiah(order.totalPaid)}</b></p>
      <p><a class="btn" href="${esc(order.paymentUrl)}" target="_blank" rel="noopener">Bayar sekarang (QRIS)</a></p>
      <p class="muted">Halaman ini otomatis berubah setelah pembayaran diterima.</p></div>
      <script>
        // Hanya menampilkan: keputusan "lunas" tetap diambil server di /orders/:id/status.
        const t = setInterval(async () => {
          try { const j = await (await fetch('/orders/${esc(order.id)}/status')).json();
            if (j.status !== 'awaiting_payment') { clearInterval(t); location.reload(); } } catch {}
        }, 3000);
      </script>`;
  } else if (order.status === 'paid') {
    body = `<div class="card"><h2 class="ok">Pembayaran diterima ✓</h2>
      <p>File kamu: <b>${esc(order.file.original)}</b> (${sizeText(order.file.size)})</p>
      <p><a class="btn" href="/download/${esc(order.id)}/${esc(order.downloadToken)}">Unduh file</a></p>
      <p class="muted">Simpan alamat halaman ini. Kamu bisa mengunduh lagi kapan saja.</p></div>`;
  } else {
    body = '<div class="card"><h2 class="bad">Pembayaran tidak selesai</h2><p>Waktu habis atau dibatalkan. <a href="/">Coba lagi</a></p></div>';
  }
  res.send(page(`Order ${order.id}`, `<h1>Pesanan</h1><p>${esc(order.productName)} · ${rupiah(order.price)}</p>${body}`));
});

app.get('/orders/:id/status', async (req, res) => {
  const order = db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    res.json({ status: (await refreshOrder(order)).status });
  } catch (e) {
    console.error('refreshOrder gagal:', e.message);
    res.status(502).json({ error: 'gagal memeriksa pembayaran' });
  }
});

// Unduhan: hanya untuk order yang sudah LUNAS dan dengan token rahasia milik order itu.
app.get('/download/:id/:token', (req, res) => {
  const order = db.getOrder(req.params.id);
  const a = Buffer.from(String(req.params.token));
  const b = Buffer.from(order?.downloadToken || '');
  if (!order || order.status !== 'paid' || a.length !== b.length || !timingSafeEqual(a, b)) return res.status(404).send(page('404', '<p>Tautan tidak valid.</p>'));
  const path = resolve(db.FILES_DIR, order.file.stored);
  if (!existsSync(path)) return res.status(410).send(page('Hilang', '<p>File sudah tidak tersedia. Hubungi penjual.</p>'));
  res.setHeader('Cache-Control', 'private, no-store');
  res.download(path, order.file.original); // selalu sebagai lampiran (attachment), tidak pernah dibuka di browser
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).send(page('Error', '<p class="bad">Terjadi kesalahan di server.</p>'));
});

app.listen(PORT, () => {
  console.log(`Toko contoh berjalan di http://localhost:${PORT}`);
  if (!configured()) console.log(`API key belum diatur. Buka http://localhost:${PORT} dan ikuti langkah setup (atau isi file .env).`);
});
