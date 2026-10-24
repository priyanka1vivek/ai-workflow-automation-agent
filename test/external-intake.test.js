import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntakeApp } from '../external-intake/server.js';

test('external form submits JSON to n8n with server-side authentication', async t => {
  let forwarded;
  const app = createIntakeApp({ webhookUrl: 'http://127.0.0.1:5678/webhook/flowdesk-triage', webhookSecret: 'caller-only-secret',
    fetchImpl: async (url, options) => {
      forwarded = { url: String(url), headers: options.headers, body: JSON.parse(options.body) };
      return Response.json({ id: 'request-123', status: 'review', analysis: { summary: 'The export is failing.' } });
    }
  });
  app.listen(0, '127.0.0.1');
  await new Promise(resolve => app.once('listening', resolve));
  t.after(() => new Promise(resolve => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;
  const page = await (await fetch(base)).text();
  assert.match(page, /Submit a support request/);
  assert.doesNotMatch(page, /caller-only-secret/);
  const response = await fetch(`${base}/api/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Export failure', message: 'Our operations team cannot export its report.' }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: 'request-123', status: 'review', summary: 'The export is failing.' });
  assert.equal(forwarded.headers['X-Webhook-Token'], 'caller-only-secret');
  assert.deepEqual(forwarded.body, { title: 'Export failure', message: 'Our operations team cannot export its report.' });
  const invalid = await fetch(`${base}/api/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'X', message: 'Too short' }) });
  assert.equal(invalid.status, 400);
});
