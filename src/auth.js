// Login admin sederhana: satu kata sandi, sesi lewat cookie bertanda tangan (HMAC). Tanpa library tambahan.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const hashPassword = (password) => {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString('hex')}`;
};

export function checkPassword(password, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const a = Buffer.from(scryptSync(String(password), salt, 32).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

const COOKIE = 'shop_admin';
const MAX_AGE = 60 * 60 * 8; // 8 jam
const sign = (value, secret) => createHmac('sha256', secret).update(value).digest('base64url');

function makeSession(secret) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  return `${exp}.${sign(String(exp), secret)}`;
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

export function isAdmin(req, secret) {
  if (!secret) return false;
  const [exp, mac] = readCookie(req, COOKIE).split('.');
  if (!exp || !mac || Number(exp) < Date.now() / 1000) return false;
  const want = sign(exp, secret);
  return mac.length === want.length && timingSafeEqual(Buffer.from(mac), Buffer.from(want));
}

export const setSessionCookie = (res, secret) =>
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(makeSession(secret))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`);
export const clearSessionCookie = (res) => res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);

/** Pembatas percobaan login: maksimal 8 kali per 10 menit per alamat IP. */
const attempts = new Map();
export function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60_000);
  attempts.set(ip, list);
  return list.length >= 8;
}
export const recordAttempt = (ip) => attempts.set(ip, [...(attempts.get(ip) || []), Date.now()]);
