import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'] };

function reply(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

export function createIntakeApp({ webhookUrl, webhookSecret, fetchImpl = fetch }) {
  const attempts = new Map();
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
    const path = new URL(req.url, 'http://localhost').pathname;
    try {
      if (req.method === 'GET' && assets[path]) {
        const [file, type] = assets[path];
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return res.end(await readFile(join(here, file)));
      }
      if (path !== '/api/submit' || req.method !== 'POST') return reply(res, 404, { error: 'Page not found.' });
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return reply(res, 403, { error: 'Cross-origin requests are not allowed.' });
      if (!req.headers['content-type']?.startsWith('application/json')) return reply(res, 415, { error: 'Send JSON.' });
      const ip = req.socket.remoteAddress || 'unknown', now = Date.now();
      if (attempts.size > 5000) attempts.clear();
      let bucket = attempts.get(ip);
      if (!bucket || now - bucket.at > 60000) bucket = { at: now, count: 0 };
      attempts.set(ip, bucket);
      if (++bucket.count > 20) return reply(res, 429, { error: 'Please wait before submitting again.' });
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 10000) return reply(res, 413, { error: 'Request is too large.' });
      }
      let body;
      try { body = JSON.parse(raw); } catch { return reply(res, 400, { error: 'Invalid JSON.' }); }
      const { title, message } = body || {};
      if (typeof title !== 'string' || title.trim().length < 3 || title.length > 120 || typeof message !== 'string' || message.trim().length < 10 || message.length > 5000) {
        return reply(res, 400, { error: 'Enter a subject (3–120 characters) and details (10–5,000 characters).' });
      }
      if (!webhookUrl || !webhookSecret) return reply(res, 503, { error: 'This intake form is not connected yet.' });
      let url;
      try { url = new URL(webhookUrl); } catch { return reply(res, 503, { error: 'The webhook URL is invalid.' }); }
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
        return reply(res, 503, { error: 'Use HTTPS for a hosted webhook or HTTP on localhost.' });
      }
      const response = await fetchImpl(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Token': webhookSecret },
        body: JSON.stringify({ title: title.trim(), message: message.trim() }), signal: AbortSignal.timeout(90000)
      });
      let result;
      try { result = await response.json(); } catch { result = null; }
      if (!response.ok || !result?.id) return reply(res, 502, { error: `The workflow could not accept this request (HTTP ${response.status}). Check the n8n execution.` });
      return reply(res, 200, { id: result.id, status: result.status, summary: result.analysis?.summary || null });
    } catch {
      return reply(res, 502, { error: 'The workflow is unavailable. Check that n8n and FlowDesk are running.' });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.INTAKE_PORT || 3001);
  createIntakeApp({ webhookUrl: process.env.N8N_WEBHOOK_URL, webhookSecret: process.env.N8N_WEBHOOK_SECRET })
    .listen(port, '127.0.0.1', () => console.log(`External intake · http://127.0.0.1:${port}`));
}
