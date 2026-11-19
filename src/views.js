// Fungsi bantu untuk membuat halaman HTML. Semua teks dari pengguna HARUS lewat esc() agar aman dari XSS.
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Tautan unduh langsung (zip) dari GitHub: browser langsung mengunduh file, halaman GitHub tidak dibuka. */
export const EXAMPLE_ZIP_URL = 'https://github.com/irhagram/tengahin-merchant-example/archive/refs/heads/main.zip';

export const SDK_ZIP_URL = 'https://github.com/irhagram/tengahin-merchant-sdk/archive/refs/heads/main.zip';

export const rupiah = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');

export const sizeText = (bytes) =>
  bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';

const CSS = `
*{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 16px;color:#1d1d1f;background:#fafafa}
h1{margin:0 0 4px}h2{margin-top:28px}a{color:#0b57d0}nav{display:flex;gap:16px;margin:0 0 24px;padding-bottom:12px;border-bottom:1px solid #e3e3e3;align-items:center}
nav .grow{flex:1;font-weight:700}.card{background:#fff;border:1px solid #e3e3e3;border-radius:12px;padding:16px;margin:12px 0}
.muted{color:#666;font-size:14px}.ok{color:#0a7a2f}.bad{color:#b00020}.warn{background:#fff7e0;border:1px solid #f0d58a;border-radius:10px;padding:12px;margin:12px 0}
button,.btn{background:#111;color:#fff;border:0;border-radius:8px;padding:10px 16px;font:inherit;cursor:pointer;text-decoration:none;display:inline-block}
button.ghost{background:#fff;color:#111;border:1px solid #ccc}button.danger{background:#b00020}
label{display:block;margin:12px 0 4px;font-weight:600}input,textarea{width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;font:inherit;background:#fff}
code,pre{background:#f0f0f0;border-radius:6px;padding:2px 6px;word-break:break-all}pre{padding:12px;overflow:auto}
.btn.dl{padding:6px 12px;font-size:14px;white-space:nowrap}
@media(max-width:520px){nav{flex-wrap:wrap}}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.row form{margin:0}.tag{font-size:12px;border-radius:99px;padding:2px 8px;background:#eee}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:6px 4px;border-bottom:1px solid #eee}`;

export const page = (title, body, { admin = false } = {}) => `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>
<nav><span class="grow"><a href="/" style="text-decoration:none;color:inherit">Toko Contoh</a></span>
<a class="btn dl" href="${EXAMPLE_ZIP_URL}" rel="noopener" download="tengahin-merchant-example.zip">&#11015; Download Example .zip</a>
<a class="btn dl" href="${SDK_ZIP_URL}" rel="noopener" download="tengahin-merchant-sdk.zip">&#11015; Download SDK .zip</a>${
  admin ? '<a href="/admin">Admin</a><form method="post" action="/admin/logout" style="margin:0"><button class="ghost">Keluar</button></form>' : '<a href="/admin">Admin</a>'
}</nav>${body}</body></html>`;
