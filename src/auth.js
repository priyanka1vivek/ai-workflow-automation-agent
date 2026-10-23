import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const lifetime = 12 * 60 * 60;

export function checkCredentials(email, password, config) {
  if (typeof email !== 'string' || typeof password !== 'string') return false;
  const expected = scryptSync(config.ownerPassword, config.sessionSecret, 64);
  const supplied = scryptSync(password.slice(0, 1024), config.sessionSecret, 64);
  return timingSafeEqual(expected, supplied) && email.trim().toLowerCase() === config.ownerEmail.toLowerCase();
}

function signature(value, secret) { return createHmac('sha256', secret).update(value).digest('base64url'); }

export function createSession(config) {
  const payload = Buffer.from(JSON.stringify({ email: config.ownerEmail, expires: Date.now() + lifetime * 1000, nonce: randomBytes(12).toString('hex') })).toString('base64url');
  return `${payload}.${signature(payload, config.sessionSecret)}`;
}

export function readSession(req, config) {
  const token = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('fd_session='))?.slice('fd_session='.length);
  if (!token || token.length > 1000) return false;
  const [payload, mac, extra] = token.split('.');
  if (!payload || !mac || extra) return false;
  const expected = Buffer.from(signature(payload, config.sessionSecret)), supplied = Buffer.from(mac);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false;
  try { const session = JSON.parse(Buffer.from(payload, 'base64url').toString()); return session.email === config.ownerEmail && session.expires > Date.now(); }
  catch { return false; }
}

export function sessionCookie(token, secure = false) {
  return `fd_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${lifetime}${secure ? '; Secure' : ''}`;
}
export function clearSessionCookie(secure = false) {
  return `fd_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}
