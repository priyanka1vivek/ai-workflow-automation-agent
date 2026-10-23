import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const lifetime = 12 * 60 * 60;
export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || !stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex'), supplied = scryptSync(password.slice(0, 1024), salt, 64);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
function signature(value, secret) { return createHmac('sha256', secret).update(value).digest('base64url'); }
export function createSession(user, secret) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, expires: Date.now() + lifetime * 1000, nonce: randomBytes(12).toString('hex') })).toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
}
export function readSession(req, secret) {
  const token = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('fd_session='))?.slice('fd_session='.length);
  if (!token || token.length > 1000) return null;
  const [payload, mac, extra] = token.split('.');
  if (!payload || !mac || extra) return null;
  const expected = Buffer.from(signature(payload, secret)), supplied = Buffer.from(mac);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try { const session = JSON.parse(Buffer.from(payload, 'base64url').toString()); return session.expires > Date.now() && typeof session.id === 'string' ? session.id : null; }
  catch { return null; }
}
export function sessionCookie(token, secure = false) { return `fd_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${lifetime}${secure ? '; Secure' : ''}`; }
export function clearSessionCookie(secure = false) { return `fd_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`; }
