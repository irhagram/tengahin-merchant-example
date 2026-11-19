// Penyimpanan sederhana berbasis file JSON (data/db.json) supaya contoh ini tanpa database.
// Di produksi, ganti dengan database sungguhan (SQLite/MySQL/Postgres). Antarmuka fungsi di bawah bisa dipertahankan.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

export const DATA_DIR = resolve(process.cwd(), 'data');
export const FILES_DIR = resolve(DATA_DIR, 'files');
const DB_FILE = resolve(DATA_DIR, 'db.json');
mkdirSync(FILES_DIR, { recursive: true });

let state = { products: [], orders: [] };
if (existsSync(DB_FILE)) {
  try {
    state = { products: [], orders: [], ...JSON.parse(readFileSync(DB_FILE, 'utf8')) };
  } catch {
    throw new Error('data/db.json rusak. Perbaiki atau hapus file itu (data produk akan hilang).');
  }
}

/** Tulis atomik: ke file sementara dulu, lalu diganti, supaya data tidak rusak kalau proses mati di tengah. */
function save() {
  const tmp = DB_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, DB_FILE);
}

export const newId = (prefix) => `${prefix}_${randomBytes(6).toString('hex')}`;

// ── Produk ──
export const listProducts = ({ onlyActive = false } = {}) => state.products.filter((p) => !onlyActive || p.active);
export const getProduct = (id) => state.products.find((p) => p.id === id) ?? null;

export function addProduct({ name, description, price, file }) {
  const product = { id: newId('prd'), name, description, price, active: true, createdAt: Date.now(), file };
  state.products.push(product);
  save();
  return product;
}

export function updateProduct(id, patch) {
  const p = getProduct(id);
  if (!p) return null;
  Object.assign(p, patch);
  save();
  return p;
}

export function removeProduct(id) {
  const i = state.products.findIndex((p) => p.id === id);
  if (i < 0) return null;
  const [p] = state.products.splice(i, 1);
  save();
  return p;
}

// ── Order ──
export const getOrder = (id) => state.orders.find((o) => o.id === id) ?? null;
export const listOrders = () => [...state.orders].reverse();

export function addOrder(order) {
  state.orders.push(order);
  save();
  return order;
}

/**
 * Mengubah order dari 'awaiting_payment' ke status baru HANYA jika masih menunggu.
 * Mengembalikan true kalau pemanggil ini yang berhasil mengubahnya (cuma satu pemanggil yang menang),
 * sehingga pemenuhan pesanan tidak pernah terjadi dua kali walau status dicek berulang atau bersamaan.
 */
export function transition(id, status, extra = {}) {
  const o = getOrder(id);
  if (!o || o.status !== 'awaiting_payment') return false;
  Object.assign(o, extra, { status });
  save();
  return true;
}
