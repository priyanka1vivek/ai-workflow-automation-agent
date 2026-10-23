import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, envConfig } from '../src/server.js';
import { redact, validateInput, validateAnalysis, requestWithRetry, deliver } from '../src/agent.js';

test('reject malformed input and redact identifiers before storage', () => {
  assert.throws(() => validateInput({ title: 'x', message: 'short' }));
  assert.throws(() => validateInput({ title: 'Subject', message: 'A valid message', source: 'invalid' }));
  assert.equal(redact('Email test@example.com or call +91 9876543210'), 'Email [email redacted] or call [number redacted]');
});
test('reject invalid AI schema instead of trusting provider output', () => {
  assert.throws(() => validateAnalysis({ category: 'medical', priority: 'urgent' }));
  assert.throws(() => validateAnalysis({ category: 'technical', priority: 'high', needsHumanReview: true, summary: {}, reason: 'x', suggestedReply: 'x' }));
});
test('retry transient failures but fail immediately on authorization errors', async () => {
  let calls = 0, retries = 0;
  const result = await requestWithRetry('https://example.test', {}, { fetchImpl: async () => new Response('', { status: ++calls < 3 ? 503 : 200 }), onRetry: () => retries++, sleep: async () => {} });
  assert.equal(result.status, 200); assert.equal(calls, 3); assert.equal(retries, 2);
  calls = 0;
  await assert.rejects(requestWithRetry('https://example.test', {}, { fetchImpl: async () => { calls++; return new Response('', { status: 401 }); }, sleep: async () => {} }));
  assert.equal(calls, 1);
});
test('delivery previews cannot send when disabled', async () => {
  const result = await deliver({ analysis: {}, title: 'Test' }, 'slack', { liveDelivery: false, slackUrl: 'https://hooks.slack.com/example' });
  assert.equal(result.status, 'simulated'); assert.match(result.message, /No Slack message/);
});
test('non-idempotent network uncertainty is not blindly retried', async () => {
  let calls = 0;
  await assert.rejects(requestWithRetry('https://example.test', {}, { fetchImpl: async () => { calls++; throw new Error('Network lost'); }, retryNetwork: false }), error => error.uncertain === true);
  assert.equal(calls, 1);
});
async function fixture(t, overrides = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'flowdesk-test-')), config = { ...envConfig({ APP_TOKEN: 'a-test-token-for-isolation', OWNER_EMAIL: 'owner@example.test', OWNER_PASSWORD: 'a-secure-test-password', SESSION_SECRET: 'test-secret-at-least-32-characters-long' }), dataDir, host: '127.0.0.1' };
  const app = createApp(config, { classify: async () => ({ category: 'technical', priority: 'high', summary: 'A dashboard login error is blocking the team.', reason: 'Access is blocked.', suggestedReply: 'The team will investigate.', needsHumanReview: true, route: 'Technical support', provider: 'test-stub', model: null }), ...overrides }); await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await new Promise(r => app.server.close(r)); app.store.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return { app, config, base, async api(path, body, extra = {}) { const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, data: await response.json() }; } };
}
test('authentication protects stored requests and config never leaks secrets', async t => {
  const f = await fixture(t); assert.equal((await fetch(f.base + '/api/requests')).status, 401);
  const result = await f.api('/api/config'); assert.equal(result.status, 200); assert.ok(!JSON.stringify(result.data).includes(f.config.token));
  assert.equal((await f.api('/api/requests', undefined, { Origin: 'https://evil.test' })).status, 403);
});
test('owner signs in with an HttpOnly session, sees requests, and signs out', async t => {
  const f = await fixture(t);
  const wrong = await fetch(f.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.config.ownerEmail, password: 'wrong-password' }) });
  assert.equal(wrong.status, 401);
  const login = await fetch(f.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.config.ownerEmail, password: f.config.ownerPassword }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie'); assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.equal((await fetch(f.base + '/api/auth/me', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(f.base + '/api/requests', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(f.base + '/api/requests', { headers: { Cookie: cookie, Origin: 'https://evil.test' } })).status, 403);
  const logout = await fetch(f.base + '/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await fetch(f.base + '/api/requests')).status, 401);
});
test('complete workflow run persists analysis, requires approval and avoids duplicate side effects', async t => {
  let deliveries = 0;
  const f = await fixture(t, { deliver: async () => { deliveries++; return { status: 'simulated', message: 'Preview only' }; } });
  const input = { title: 'Dashboard error', message: 'The dashboard shows an error when I login. Contact me at test@example.com.' };
  const created = await f.api('/api/requests', input, { 'Idempotency-Key': 'event-123' });
  assert.equal(created.status, 201); assert.equal(created.data.status, 'review'); assert.equal(deliveries, 0); assert.ok(!created.data.message.includes('test@example.com'));
  const repeated = await f.api('/api/requests', input, { 'Idempotency-Key': 'event-123' }); assert.equal(repeated.data.id, created.data.id);
  const conflict = await f.api('/api/requests', { ...input, title: 'Another dashboard error' }, { 'Idempotency-Key': 'event-123' }); assert.equal(conflict.status, 409);
  const approved = await f.api(`/api/requests/${created.data.id}/approve`, {}); assert.equal(approved.data.status, 'completed'); assert.equal(deliveries, 2);
  await f.api(`/api/requests/${created.data.id}/approve`, {}); assert.equal(deliveries, 2);
  assert.equal((await f.api('/api/requests')).data.requests.length, 1);
});
test('concurrent approval is rejected and successful destinations are not retried', async t => {
  let release, gate = new Promise(r => release = r), slack = 0, sheets = 0;
  const f = await fixture(t, { deliver: async (r, target) => { if (target === 'slack') { slack++; await gate; return { status: 'sent', message: 'Delivered' }; } sheets++; if (sheets === 1) throw new Error('Service unavailable'); return { status: 'sent', message: 'Delivered' }; } });
  const r = (await f.api('/api/requests', { title: 'Support hours', message: 'How do I find support hours for weekends?' })).data;
  const first = f.api(`/api/requests/${r.id}/approve`, {});
  while (!slack) await new Promise(r => setImmediate(r));
  const second = await f.api(`/api/requests/${r.id}/approve`, {}); assert.equal(second.status, 409); release();
  assert.equal((await first).data.status, 'partial');
  assert.equal((await f.api(`/api/requests/${r.id}/approve`, {})).data.status, 'completed'); assert.equal(slack, 1); assert.equal(sheets, 2);
});
test('AI failure is visible, with no fabricated fallback', async t => {
  const f = await fixture(t, { classify: async () => { throw new Error('Provider unavailable'); } });
  const r = (await f.api('/api/requests', { title: 'Test request', message: 'Please review this test request.' })).data;
  assert.equal(r.status, 'failed'); assert.equal(r.analysis, null); assert.equal(r.error, 'Provider unavailable');
});
test('uncertain delivery is held instead of resent on another approval', async t => {
  let calls = 0;
  const f = await fixture(t, { deliver: async () => { calls++; throw Object.assign(new Error('Timeout'), { uncertain: true }); } });
  const r = (await f.api('/api/requests', { title: 'Test request', message: 'Please review this test request.' })).data;
  const first = await f.api(`/api/requests/${r.id}/approve`, {}); assert.equal(first.data.deliveries.slack.status, 'uncertain');
  await f.api(`/api/requests/${r.id}/approve`, {}); assert.equal(calls, 2);
});
test('network hosting requires a sufficiently long token', () => {
  assert.throws(() => createApp({ ...envConfig({ OWNER_EMAIL: 'owner@example.test', OWNER_PASSWORD: 'a-secure-test-password', SESSION_SECRET: 'test-secret-at-least-32-characters-long' }), host: '0.0.0.0', token: '', dataDir: '/tmp/flowdesk-should-not-exist' }), /APP_TOKEN/);
});
