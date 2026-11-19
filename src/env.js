// Membaca dan menulis file .env tanpa library tambahan.
// Dipakai oleh halaman setup: saat pertama kali jalan, API key diminta lewat web lalu disimpan ke .env.
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';

export const ENV_PATH = resolve(process.cwd(), '.env');

/** Membaca .env (jika ada) ke process.env. Nilai yang sudah ada di environment sistem tidak ditimpa. */
export function loadEnv() {
  if (!existsSync(ENV_PATH)) return;
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

/** Menyimpan/memperbarui beberapa variabel di .env (membuat file jika belum ada) dan langsung berlaku. */
export function saveEnv(values) {
  let text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n]/.test(String(value))) throw new Error(`Nilai ${key} tidak boleh mengandung baris baru.`);
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, () => line) : text.replace(/\s*$/, text ? '\n' : '') + line + '\n';
    process.env[key] = String(value);
  }
  writeFileSync(ENV_PATH, text, { mode: 0o600 });
  try { chmodSync(ENV_PATH, 0o600); } catch { /* Windows: abaikan */ }
}
