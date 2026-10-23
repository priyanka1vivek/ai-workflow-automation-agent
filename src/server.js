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
  function get(id, user) { const r = store.get(id, user); if (!r) throw fail(404, 'Request not found.'); return r; }
  function effectiveConfig(user) { return { ...config, ...store.integrations(user.workspace_id) }; }
  async function locked(id, fn) { if (locks.has(id)) throw fail(409, 'This request is already processing.'); locks.add(id); try { return await fn(); } finally { locks.delete(id); } }
  async function analyze(id, user) {
    return locked(id, async () => {
      const r = get(id, user); if (r.analysis) return r;
      const connections = effectiveConfig(user);
      if (!connections.openaiKey && !overrides.classify) throw fail(409, 'Connect OpenAI before classifying this request.');
      r.status = 'processing'; event(r, 'classify', 'Classifying request and validating structured output.', 'running');
      try {
        const started = Date.now(); r.analysis = await classifyFn({ title: r.title, message: r.message }, connections, (attempt, wait) => event(r, 'retry', `AI retry ${attempt}; waiting ${wait}ms.`, 'retry'));
        r.durationMs = Date.now() - started; r.status = 'review'; r.error = null;
        event(r, 'route', `${r.analysis.route}; ${r.analysis.priority} priority. Human approval required before delivery.`);
      } catch (error) { r.status = 'failed'; r.error = error.message; event(r, 'classify', error.message, 'error'); }
      return r;
    });
  }
  async function dispatch(id, user) {
    return locked(id, async () => {
      const r = get(id, user); if (!r.analysis) throw fail(409, 'Classify the request before approval.');
      const connections = effectiveConfig(user);
      if (r.status === 'completed') return r;
      r.approvedAt ||= new Date().toISOString(); r.status = 'delivering'; event(r, 'approve', 'Human approved routing and integration delivery.');
      for (const target of ['slack', 'sheets']) {
        if (['sent', 'simulated', 'uncertain'].includes(r.deliveries[target]?.status)) continue;
        r.deliveries[target] = { status: 'sending' }; store.save(r);
        try { r.deliveries[target] = await deliverFn(r, target, connections, (attempt, wait) => event(r, 'retry', `${target} retry ${attempt}; waiting ${wait}ms.`, 'retry')); }
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
          const inviteCode = typeof credentials.inviteCode === 'string' ? credentials.inviteCode.trim() : '';
          const user = store.createUser(email, hashPassword(credentials.password), inviteCode);
          res.setHeader('Set-Cookie', sessionCookie(createSession(user, store.secret), secure));
          return send(res, 201, { email: user.email, role: user.role, workspace: store.workspace(user.workspace_id).name });
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
          return send(res, 200, { email: user.email, role: user.role, workspace: store.workspace(user.workspace_id).name });
        }
        if (path === '/api/auth/logout' && req.method === 'POST') {
          res.setHeader('Set-Cookie', clearSessionCookie(secure)); return send(res, 200, { ok: true });
        }
        const bearer = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
        const legacyMachine = !!config.token && equal(req.headers.authorization || '', `Bearer ${config.token}`);
        const machine = !!bearer || legacyMachine;
        const user = bearer ? store.userByToken(bearer[1]) : legacyMachine ? store.userByEmail(config.webhookOwnerEmail.toLowerCase()) : store.userById(readSession(req, store.secret));
        if (!user) throw fail(401, 'Sign in or provide a valid webhook token.');
        if (machine && !['/api/requests', '/api/webhook'].includes(path) && !path.match(/^\/api\/requests\/[a-f0-9-]+\/classify$/)) throw fail(403, 'Webhook token is limited to intake and classification.');
        if (req.method === 'GET' && path === '/api/auth/me') return send(res, 200, { email: user.email, role: user.role, workspace: store.workspace(user.workspace_id).name });
        if (req.method === 'GET' && path === '/api/config') { const c = effectiveConfig(user); return send(res, 200, { model: c.model, liveDelivery: c.liveDelivery,
          integrations: { openai: !!c.openaiKey, slack: integrationConfigured(c, 'slack'), sheets: integrationConfigured(c, 'sheets') } }); }
        if (req.method === 'GET' && path === '/api/workspace') {
          if (user.role !== 'owner' || machine) throw fail(403, 'Owner access required.');
          const w = store.workspace(user.workspace_id);
          return send(res, 200, { name: w.name, inviteCode: w.invite_code, hasWebhookToken: !!w.api_hash });
        }
        if (req.method === 'POST' && path === '/api/workspace/token') {
          if (user.role !== 'owner' || machine) throw fail(403, 'Owner access required.');
          return send(res, 200, { token: store.rotateToken(user.workspace_id) });
        }
        if (req.method === 'POST' && path === '/api/connections') {
          if (user.role !== 'owner' || machine) throw fail(403, 'Owner access required.');
          const body = await readBody(req), update = {};
          if (typeof body.openaiKey === 'string' && body.openaiKey.trim()) {
            if (!body.openaiKey.trim().startsWith('sk-')) throw fail(400, 'Enter a valid OpenAI API key.');
            update.openaiKey = body.openaiKey.trim();
          }
          if (typeof body.slackUrl === 'string' && body.slackUrl.trim()) {
            let url; try { url = new URL(body.slackUrl.trim()); } catch { throw fail(400, 'Enter a valid Slack webhook URL.'); }
            if (url.protocol !== 'https:' || !['hooks.slack.com', 'hooks.slack-gov.com'].includes(url.hostname)) throw fail(400, 'Use an official Slack HTTPS webhook URL.');
            update.slackUrl = url.toString();
          }
          if (typeof body.googleCredentials === 'string' && body.googleCredentials.trim()) {
            let credentials; try { credentials = JSON.parse(body.googleCredentials); } catch { throw fail(400, 'Service account key must be valid JSON.'); }
            if (credentials.type !== 'service_account' || !credentials.client_email || !credentials.private_key?.includes('BEGIN PRIVATE KEY')) throw fail(400, 'Use a Google service account JSON key.');
            update.googleEmail = credentials.client_email; update.googlePrivateKey = credentials.private_key;
          }
          if (typeof body.sheetId === 'string' && body.sheetId.trim()) {
            if (!/^[\w-]{15,150}$/.test(body.sheetId.trim())) throw fail(400, 'Enter a valid Google Sheet ID.');
            update.sheetId = body.sheetId.trim();
          }
          if (typeof body.sheetTab === 'string' && body.sheetTab.trim()) update.sheetTab = body.sheetTab.trim().slice(0, 80);
          if (typeof body.liveDelivery === 'boolean') update.liveDelivery = body.liveDelivery;
          if (!Object.keys(update).length) throw fail(400, 'Enter a connection value.');
          store.updateIntegrations(user.workspace_id, update);
          return send(res, 200, { ok: true });
        }
        if (req.method === 'GET' && path === '/api/requests') return send(res, 200, { requests: store.list(user) });
        if (req.method === 'POST' && ['/api/requests', '/api/webhook'].includes(path)) {
          const body = await readBody(req); let input; try { input = validateInput(body); } catch (e) { throw fail(400, e.message); }
          const key = req.headers['idempotency-key']; if (key && (typeof key !== 'string' || key.length > 150)) throw fail(400, 'Invalid idempotency key.');
          if (key) { const prior = store.byKey(key, user); if (prior) {
            if (prior.title !== input.title || prior.message !== input.message) throw fail(409, 'Idempotency key was already used with a different request.');
            return send(res, 200, prior);
          } }
          const r = { id: randomUUID(), ...input, requester: machine ? 'n8n webhook' : user.email, source: machine || path === '/api/webhook' ? 'webhook' : input.source, status: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), analysis: null, deliveries: {}, events: [], error: null };
          store.insert(r, key, user); event(r, 'receive', 'Request received, validated and basic identifiers redacted.');
          return send(res, 201, body.autoProcess === false || (!effectiveConfig(user).openaiKey && !overrides.classify) ? r : await analyze(r.id, user));
        }
        const match = path.match(/^\/api\/requests\/([a-f0-9-]+)(?:\/(classify|approve))?$/);
        if (match && req.method === 'GET' && !match[2]) return send(res, 200, get(match[1], user));
        if (match && req.method === 'POST' && match[2] === 'classify') {
          if (user.role !== 'owner') throw fail(403, 'Only the owner can retry classification.');
          return send(res, 200, await analyze(match[1], user));
        }
        if (match && req.method === 'POST' && match[2] === 'approve') {
          if (user.role !== 'owner' || machine) throw fail(403, 'Only the owner can approve delivery.');
          return send(res, 200, await dispatch(match[1], user));
        }
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
