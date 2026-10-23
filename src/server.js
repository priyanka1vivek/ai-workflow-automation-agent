import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { classify, deliver, validateInput, integrationConfigured } from './agent.js';
import { openStore } from './store.js';
import { hashPassword, verifyPassword, createSession, readSession, sessionCookie, clearSessionCookie } from './auth.js';

export function envConfig(env = process.env) {
  return { port: Number(env.PORT || 3000), host: env.HOST || '127.0.0.1', dataDir: resolve(env.DATA_DIR || 'data'),
    openaiKey: env.OPENAI_API_KEY || '', model: env.OPENAI_MODEL || 'gpt-4o-mini',
    token: env.APP_TOKEN || '', webhookOwnerEmail: env.WEBHOOK_OWNER_EMAIL || '', liveDelivery: env.LIVE_DELIVERY === 'true', slackUrl: env.SLACK_WEBHOOK_URL || '',
    googleEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '', googlePrivateKey: env.GOOGLE_PRIVATE_KEY || '',
    sheetId: env.GOOGLE_SHEET_ID || '', sheetTab: env.GOOGLE_SHEET_TAB || 'Requests' };
}
const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
function equal(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function fail(status, message) { return Object.assign(new Error(message), { status }); }
async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'Use Content-Type: application/json.');
  let content = ''; for await (const chunk of req) { content += chunk; if (Buffer.byteLength(content) > 20000) throw fail(413, 'Request body is too large.'); }
  try { return JSON.parse(content); } catch { throw fail(400, 'Invalid JSON.'); }
}
function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
export function createApp(config, overrides = {}) {
  const store = openStore(config.dataDir), locks = new Set(), buckets = new Map(), loginAttempts = new Map(), registrationAttempts = new Map();
  const classifyFn = overrides.classify || classify, deliverFn = overrides.deliver || deliver;
  function event(r, stage, detail, status = 'ok') { r.events.push({ at: new Date().toISOString(), stage, detail, status }); r.updatedAt = new Date().toISOString(); store.save(r); }
  function get(id, userId) { const r = store.get(id, userId); if (!r) throw fail(404, 'Request not found.'); return r; }
  async function locked(id, fn) { if (locks.has(id)) throw fail(409, 'This request is already processing.'); locks.add(id); try { return await fn(); } finally { locks.delete(id); } }
  async function analyze(id, userId) {
    return locked(id, async () => {
      const r = get(id, userId); if (r.analysis) return r;
      r.status = 'processing'; event(r, 'classify', 'Classifying request and validating structured output.', 'running');
      try {
        const started = Date.now(); r.analysis = await classifyFn({ title: r.title, message: r.message }, config, (attempt, wait) => event(r, 'retry', `AI retry ${attempt}; waiting ${wait}ms.`, 'retry'));
        r.durationMs = Date.now() - started; r.status = 'review'; r.error = null;
        event(r, 'route', `${r.analysis.route}; ${r.analysis.priority} priority. Human approval required before delivery.`);
      } catch (error) { r.status = 'failed'; r.error = error.message; event(r, 'classify', error.message, 'error'); }
      return r;
    });
  }
  async function dispatch(id, userId) {
    return locked(id, async () => {
      const r = get(id, userId); if (!r.analysis) throw fail(409, 'Classify the request before approval.');
      if (r.status === 'completed') return r;
      r.approvedAt ||= new Date().toISOString(); r.status = 'delivering'; event(r, 'approve', 'Human approved routing and integration delivery.');
      for (const target of ['slack', 'sheets']) {
        if (['sent', 'simulated', 'uncertain'].includes(r.deliveries[target]?.status)) continue;
        r.deliveries[target] = { status: 'sending' }; store.save(r);
        try { r.deliveries[target] = await deliverFn(r, target, config, (attempt, wait) => event(r, 'retry', `${target} retry ${attempt}; waiting ${wait}ms.`, 'retry')); }
        catch (error) { r.deliveries[target] = { status: error.uncertain ? 'uncertain' : 'failed', message: error.uncertain ? 'Delivery outcome is uncertain. Verify the destination before retrying.' : error.message, at: new Date().toISOString() }; }
        event(r, target, r.deliveries[target].message, ['failed', 'uncertain'].includes(r.deliveries[target].status) ? 'error' : 'ok');
      }
      r.status = Object.values(r.deliveries).some(d => ['failed', 'uncertain'].includes(d.status)) ? 'partial' : 'completed'; store.save(r); return r;
    });
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, 'http://localhost'), path = url.pathname;
      if (path === '/healthz') return send(res, 200, { status: 'ok' });
      if (path.startsWith('/api/')) {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw fail(403, 'Cross-origin requests are not allowed.');
        const ip = req.socket.remoteAddress || 'unknown', now = Date.now();
        if (buckets.size > 5000) buckets.clear();
        let bucket = buckets.get(ip); if (!bucket || now - bucket.at > 60000) { bucket = { at: now, count: 0 }; buckets.set(ip, bucket); }
        if (++bucket.count > 180) throw fail(429, 'Too many requests. Try again in a minute.');
        const secure = !!req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
        if (path === '/api/auth/register' && req.method === 'POST') {
          let attempts = registrationAttempts.get(ip); if (!attempts || now - attempts.at > 60 * 60000) attempts = { at: now, count: 0 };
          if (++attempts.count > 10) throw fail(429, 'Too many account creations. Try again later.');
          registrationAttempts.set(ip, attempts);
          const credentials = await readBody(req);
          const email = typeof credentials.email === 'string' ? credentials.email.trim().toLowerCase() : '';
          if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Enter a valid email address.');
          if (typeof credentials.password !== 'string' || credentials.password.length < 12 || credentials.password.length > 1024) throw fail(400, 'Use a password of 12–1,024 characters.');
          if (store.userByEmail(email)) throw fail(409, 'An account with this email already exists. Sign in instead.');
          const user = store.createUser(email, hashPassword(credentials.password));
          res.setHeader('Set-Cookie', sessionCookie(createSession(user, store.secret), secure));
          return send(res, 201, { email: user.email });
        }
        if (path === '/api/auth/login' && req.method === 'POST') {
          let attempts = loginAttempts.get(ip); if (!attempts || now - attempts.at > 15 * 60000) attempts = { at: now, count: 0 };
          if (attempts.count >= 8) throw fail(429, 'Too many sign-in attempts. Try again in 15 minutes.');
          const credentials = await readBody(req);
          const email = typeof credentials.email === 'string' ? credentials.email.trim().toLowerCase() : '';
          const user = store.userByEmail(email);
          if (!user || !verifyPassword(credentials.password, user.password_hash)) {
            attempts.count++; loginAttempts.set(ip, attempts); throw fail(401, 'Incorrect email or password.');
          }
          loginAttempts.delete(ip); res.setHeader('Set-Cookie', sessionCookie(createSession(user, store.secret), secure));
          return send(res, 200, { email: user.email });
        }
        if (path === '/api/auth/logout' && req.method === 'POST') {
          res.setHeader('Set-Cookie', clearSessionCookie(secure)); return send(res, 200, { ok: true });
        }
        const machine = !!config.token && equal(req.headers.authorization || '', `Bearer ${config.token}`);
        const user = machine ? store.userByEmail(config.webhookOwnerEmail.toLowerCase()) : store.userById(readSession(req, store.secret));
        if (!user) throw fail(machine ? 503 : 401, machine ? 'Register WEBHOOK_OWNER_EMAIL before using the machine token.' : 'Sign in to your workspace.');
        if (req.method === 'GET' && path === '/api/auth/me') return send(res, 200, { email: user.email });
        if (req.method === 'GET' && path === '/api/config') return send(res, 200, { model: config.model, liveDelivery: config.liveDelivery,
          integrations: { openai: !!config.openaiKey, slack: integrationConfigured(config, 'slack'), sheets: integrationConfigured(config, 'sheets') } });
        if (req.method === 'GET' && path === '/api/requests') return send(res, 200, { requests: store.list(user.id) });
        if (req.method === 'POST' && ['/api/requests', '/api/webhook'].includes(path)) {
          const body = await readBody(req); let input; try { input = validateInput(body); } catch (e) { throw fail(400, e.message); }
          const key = req.headers['idempotency-key']; if (key && (typeof key !== 'string' || key.length > 150)) throw fail(400, 'Invalid idempotency key.');
          if (key) { const prior = store.byKey(key, user.id); if (prior) {
            if (prior.title !== input.title || prior.message !== input.message) throw fail(409, 'Idempotency key was already used with a different request.');
            return send(res, 200, prior);
          } }
          const r = { id: randomUUID(), ...input, source: path === '/api/webhook' ? 'webhook' : input.source, status: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), analysis: null, deliveries: {}, events: [], error: null };
          store.insert(r, key, user.id); event(r, 'receive', 'Request received, validated and basic identifiers redacted.');
          return send(res, 201, body.autoProcess === false ? r : await analyze(r.id, user.id));
        }
        const match = path.match(/^\/api\/requests\/([a-f0-9-]+)(?:\/(classify|approve))?$/);
        if (match && req.method === 'GET' && !match[2]) return send(res, 200, get(match[1], user.id));
        if (match && req.method === 'POST' && match[2] === 'classify') return send(res, 200, await analyze(match[1], user.id));
        if (match && req.method === 'POST' && match[2] === 'approve') return send(res, 200, await dispatch(match[1], user.id));
        throw fail(404, 'API endpoint not found.');
      }
      if (req.method !== 'GET') throw fail(405, 'Method not allowed.');
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
      if (!files[path]) throw fail(404, 'Page not found.');
      const [file, type] = files[path]; res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(await readFile(join(publicDir, file)));
    } catch (error) { send(res, error.status || 500, { error: error.status ? error.message : 'Unexpected server error. Check server configuration.' }); }
  });
  server.requestTimeout = 60000; server.headersTimeout = 10000;
  return { server, store };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = envConfig(), app = createApp(config);
  app.server.listen(config.port, config.host, () => console.log(`FlowDesk · http://${config.host}:${config.port}`));
  const stop = () => app.server.close(() => { app.store.close(); process.exit(0); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
