import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { classify, deliver, validateInput, integrationConfigured } from './agent.js';
import { openStore } from './store.js';

export function envConfig(env = process.env) {
  return { port: Number(env.PORT || 3000), host: env.HOST || '127.0.0.1', dataDir: resolve(env.DATA_DIR || 'data'),
    aiMode: env.AI_MODE || 'demo', openaiKey: env.OPENAI_API_KEY || '', model: env.OPENAI_MODEL || 'gpt-4o-mini',
    token: env.APP_TOKEN || '', liveDelivery: env.LIVE_DELIVERY === 'true', slackUrl: env.SLACK_WEBHOOK_URL || '',
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
  if (!['demo', 'live'].includes(config.aiMode)) throw new Error('AI_MODE must be demo or live.');
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.host) && config.token.length < 24) throw new Error('Network hosting requires APP_TOKEN with at least 24 characters.');
  const store = openStore(config.dataDir), locks = new Set(), buckets = new Map();
  const classifyFn = overrides.classify || classify, deliverFn = overrides.deliver || deliver;
  function event(r, stage, detail, status = 'ok') { r.events.push({ at: new Date().toISOString(), stage, detail, status }); r.updatedAt = new Date().toISOString(); store.save(r); }
  function get(id) { const r = store.get(id); if (!r) throw fail(404, 'Request not found.'); return r; }
  async function locked(id, fn) { if (locks.has(id)) throw fail(409, 'This request is already processing.'); locks.add(id); try { return await fn(); } finally { locks.delete(id); } }
  async function analyze(id) {
    return locked(id, async () => {
      const r = get(id); if (r.analysis) return r;
      r.status = 'processing'; event(r, 'classify', 'Classifying request and validating structured output.', 'running');
      try {
        const started = Date.now(); r.analysis = await classifyFn({ title: r.title, message: r.message }, config, (attempt, wait) => event(r, 'retry', `AI retry ${attempt}; waiting ${wait}ms.`, 'retry'));
        r.durationMs = Date.now() - started; r.status = 'review'; r.error = null;
        event(r, 'route', `${r.analysis.route}; ${r.analysis.priority} priority. Human approval required before delivery.`);
      } catch (error) { r.status = 'failed'; r.error = error.message; event(r, 'classify', error.message, 'error'); }
      return r;
    });
  }
  async function dispatch(id) {
    return locked(id, async () => {
      const r = get(id); if (!r.analysis) throw fail(409, 'Classify the request before approval.');
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
        if (config.token && !equal(req.headers.authorization || '', `Bearer ${config.token}`)) throw fail(401, 'Enter the APP_TOKEN to access this dashboard.');
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw fail(403, 'Cross-origin requests are not allowed.');
        const ip = req.socket.remoteAddress || 'unknown', now = Date.now();
        if (buckets.size > 5000) buckets.clear();
        let bucket = buckets.get(ip); if (!bucket || now - bucket.at > 60000) { bucket = { at: now, count: 0 }; buckets.set(ip, bucket); }
        if (++bucket.count > 180) throw fail(429, 'Too many requests. Try again in a minute.');
        if (req.method === 'GET' && path === '/api/config') return send(res, 200, { aiMode: config.aiMode, model: config.aiMode === 'live' ? config.model : 'Deterministic rules', liveDelivery: config.liveDelivery,
          integrations: { openai: !!config.openaiKey, slack: integrationConfigured(config, 'slack'), sheets: integrationConfigured(config, 'sheets') } });
        if (req.method === 'GET' && path === '/api/requests') return send(res, 200, { requests: store.list() });
        if (req.method === 'POST' && ['/api/requests', '/api/webhook'].includes(path)) {
          const body = await readBody(req); let input; try { input = validateInput(body); } catch (e) { throw fail(400, e.message); }
          const key = req.headers['idempotency-key']; if (key && (typeof key !== 'string' || key.length > 150)) throw fail(400, 'Invalid idempotency key.');
          if (key) { const prior = store.byKey(key); if (prior) {
            if (prior.title !== input.title || prior.message !== input.message) throw fail(409, 'Idempotency key was already used with a different request.');
            return send(res, 200, prior);
          } }
          const r = { id: randomUUID(), ...input, source: path === '/api/webhook' ? 'webhook' : input.source, status: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), analysis: null, deliveries: {}, events: [], error: null };
          store.insert(r, key); event(r, 'receive', 'Request received, validated and basic identifiers redacted.');
          return send(res, 201, body.autoProcess === false ? r : await analyze(r.id));
        }
        const match = path.match(/^\/api\/requests\/([a-f0-9-]+)(?:\/(classify|approve))?$/);
        if (match && req.method === 'GET' && !match[2]) return send(res, 200, get(match[1]));
        if (match && req.method === 'POST' && match[2] === 'classify') return send(res, 200, await analyze(match[1]));
        if (match && req.method === 'POST' && match[2] === 'approve') return send(res, 200, await dispatch(match[1]));
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
  app.server.listen(config.port, config.host, () => console.log(`FlowDesk · http://${config.host}:${config.port} · ${config.aiMode} mode`));
  const stop = () => app.server.close(() => { app.store.close(); process.exit(0); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
