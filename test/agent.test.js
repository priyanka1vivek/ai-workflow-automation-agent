import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, envConfig } from '../src/server.js';
import { hashPassword } from '../src/auth.js';
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
  const dataDir = mkdtempSync(join(tmpdir(), 'flowdesk-test-')), config = { ...envConfig({ APP_TOKEN: 'a-test-token-for-isolation', WEBHOOK_OWNER_EMAIL: 'owner@example.test' }), dataDir, host: '127.0.0.1' };
  const app = createApp(config, { classify: async () => ({ category: 'technical', priority: 'high', summary: 'A dashboard login error is blocking the team.', reason: 'Access is blocked.', suggestedReply: 'The team will investigate.', needsHumanReview: true, route: 'Technical support', provider: 'test-stub', model: null }), ...overrides });
  const user = app.store.createUser('owner@example.test', hashPassword('a-secure-test-password'));
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password: 'a-secure-test-password' }) });
  const cookie = login.headers.get('set-cookie');
  t.after(async () => { await new Promise(r => app.server.close(r)); app.store.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return { app, config, base, cookie, async api(path, body, extra = {}) { const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, data: await response.json() }; } };
}
test('authentication protects stored requests and config never leaks secrets', async t => {
  const f = await fixture(t); assert.equal((await fetch(f.base + '/api/requests')).status, 401);
  const result = await f.api('/api/config'); assert.equal(result.status, 200); assert.ok(!JSON.stringify(result.data).includes(f.config.token));
  assert.equal((await f.api('/api/requests', undefined, { Origin: 'https://evil.test' })).status, 403);
});
test('registered user signs in with an HttpOnly session, sees requests, and signs out', async t => {
  const f = await fixture(t);
  const wrong = await fetch(f.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.test', password: 'wrong-password' }) });
  assert.equal(wrong.status, 401);
  const login = await fetch(f.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.test', password: 'a-secure-test-password' }) });
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
test('owner can correct analysis or reject before delivery; requester and token cannot', async t => {
  const sent = [];
  const f = await fixture(t, { deliver: async (r, target) => { sent.push({ target, summary: r.analysis.summary, route: r.analysis.route }); return { status: 'sent', message: 'Delivered' }; } });
  const first = (await f.api('/api/requests', { title: 'Wrong classification', message: 'The billing charge needs review by operations.' })).data;
  const corrected = await f.api(`/api/requests/${first.id}/edit`, { category: 'billing', priority: 'medium', summary: 'A billing charge needs review.', reason: 'The request concerns a charge.', suggestedReply: 'We will review the charge.', needsHumanReview: true });
  assert.equal(corrected.status, 200);
  assert.equal(corrected.data.analysis.route, 'Billing operations');
  assert.equal(corrected.data.analysis.editedByOwner, true);
  assert.ok(corrected.data.events.some(e => e.stage === 'edit'));
  assert.equal((await f.api(`/api/requests/${first.id}/edit`, { category: 'wrong' })).status, 400);
  await f.api(`/api/requests/${first.id}/approve`, {});
  assert.deepEqual(sent.map(item => item.route), ['Billing operations', 'Billing operations']);
  assert.equal((await f.api(`/api/requests/${first.id}/edit`, corrected.data.analysis)).status, 409);
  assert.equal((await f.api(`/api/requests/${first.id}/reject`, { reason: 'Too late now' })).status, 409);

  const second = (await f.api('/api/requests', { title: 'Out of scope', message: 'This is an unrelated request for the team.' })).data;
  assert.equal((await f.api(`/api/requests/${second.id}/reject`, null)).status, 400);
  const rejected = await f.api(`/api/requests/${second.id}/reject`, { reason: 'This belongs elsewhere. Contact test@example.com.' });
  assert.equal(rejected.data.status, 'rejected');
  assert.match(rejected.data.rejectionReason, /\[email redacted\]/);
  assert.ok(rejected.data.events.some(e => e.stage === 'reject'));
  assert.equal((await f.api(`/api/requests/${second.id}/approve`, {})).status, 409);
  assert.equal((await f.api(`/api/requests/${second.id}/classify`, {})).status, 409);
  assert.equal(sent.length, 2);

  const inviteCode = (await f.api('/api/workspace')).data.inviteCode;
  const registration = await fetch(f.base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'review-requester@example.test', password: 'another-secure-password', inviteCode }) });
  const cookie = registration.headers.get('set-cookie');
  for (const action of ['edit', 'reject']) {
    const denied = await fetch(f.base + `/api/requests/${second.id}/${action}`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Please reject' }) });
    assert.equal(denied.status, 403);
  }
  const token = (await f.api('/api/workspace/token', {})).data.token;
  const denied = await fetch(f.base + `/api/requests/${second.id}/reject`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Please reject' }) });
  assert.equal(denied.status, 403);
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
test('new accounts have isolated request lists and cannot inspect another account', async t => {
  const f = await fixture(t);
  const first = (await f.api('/api/requests', { title: 'First account', message: 'A request owned by the first user.' })).data;
  const registration = await fetch(f.base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'second@example.test', password: 'another-secure-password' }) });
  assert.equal(registration.status, 201);
  const cookie = registration.headers.get('set-cookie');
  const list = await fetch(f.base + '/api/requests', { headers: { Cookie: cookie } });
  assert.deepEqual((await list.json()).requests, []);
  assert.equal((await fetch(f.base + `/api/requests/${first.id}`, { headers: { Cookie: cookie } })).status, 404);
  const second = await fetch(f.base + '/api/requests', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Second account', message: 'A request owned by the second user.' }) });
  assert.equal(second.status, 201);
  assert.equal((await f.api('/api/requests')).data.requests.length, 1);
  assert.equal((await f.api(`/api/requests/${(await second.json()).id}`)).status, 404);
});
test('requester joins owner workspace, submits, sees only own work, and cannot approve', async t => {
  const f = await fixture(t);
  const workspace = (await f.api('/api/workspace')).data;
  const registration = await fetch(f.base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'requester@example.test', password: 'another-secure-password', inviteCode: workspace.inviteCode }) });
  assert.equal(registration.status, 201);
  const cookie = registration.headers.get('set-cookie');
  const post = await fetch(f.base + '/api/requests', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Login issue', message: 'Our dashboard login is broken for the team.' }) });
  assert.equal(post.status, 201); const r = await post.json(); assert.equal(r.status, 'review');
  assert.equal((await f.api('/api/requests')).data.requests[0].id, r.id);
  const denied = await fetch(f.base + `/api/requests/${r.id}/approve`, { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(denied.status, 403);
  const corrected = await f.api(`/api/requests/${r.id}/edit`, { category: 'billing', priority: 'medium', summary: 'Reviewer corrected the summary.', reason: 'Billing access is affected.', suggestedReply: 'We will investigate.', needsHumanReview: true });
  assert.equal(corrected.status, 200);
  const requesterRead = async id => (await (await fetch(f.base + `/api/requests/${id}`, { headers: { Cookie: cookie } })).json());
  const visibleCorrection = await requesterRead(r.id);
  assert.equal(visibleCorrection.analysis.summary, 'Reviewer corrected the summary.');
  assert.equal(visibleCorrection.analysis.editedByOwner, true);
  assert.ok(visibleCorrection.events.some(event => event.stage === 'edit'));
  assert.equal((await f.api(`/api/requests/${r.id}/approve`, {})).data.status, 'completed');
  const visibleApproval = await requesterRead(r.id);
  assert.equal(visibleApproval.status, 'completed');
  assert.ok(visibleApproval.events.some(event => event.stage === 'approve'));
  const second = await fetch(f.base + '/api/requests', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Request to decline', message: 'Please check this unrelated request for our team.' }) });
  const secondId = (await second.json()).id;
  await f.api(`/api/requests/${secondId}/reject`, { reason: 'Please contact the correct team.' });
  const visibleRejection = await requesterRead(secondId);
  assert.equal(visibleRejection.status, 'rejected');
  assert.equal(visibleRejection.rejectionReason, 'Please contact the correct team.');
  assert.equal((await fetch(f.base + '/api/workspace', { headers: { Cookie: cookie } })).status, 403);
});
test('connection secrets stay server-side and generated webhook token can intake but not approve', async t => {
  const f = await fixture(t);
  const saved = await f.api('/api/connections', { openaiKey: 'sk-test-private-value', slackUrl: 'https://hooks.slack.com/services/test' });
  assert.equal(saved.status, 200);
  assert.equal((await f.api('/api/config')).data.integrations.openai, true);
  assert.ok(!JSON.stringify((await f.api('/api/config')).data).includes('sk-test-private-value'));
  const token = (await f.api('/api/workspace/token', {})).data.token;
  const post = await fetch(f.base + '/api/requests', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Webhook intake', message: 'Please route this inbound workflow request.' }) });
  assert.equal(post.status, 201); const r = await post.json(); assert.equal(r.source, 'webhook');
  const denied = await fetch(f.base + `/api/requests/${r.id}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  assert.equal(denied.status, 403);
});
test('without an AI key intake persists queued work and does not invent analysis', async t => {
  const f = await fixture(t, { classify: undefined });
  const created = await f.api('/api/requests', { title: 'Unclassified intake', message: 'Please route this request when AI is connected.' });
  assert.equal(created.status, 201);
  assert.equal(created.data.status, 'queued');
  assert.equal(created.data.analysis, null);
  assert.equal((await f.api(`/api/requests/${created.data.id}/classify`, {})).status, 409);
  assert.equal((await f.api('/api/requests')).data.requests.length, 1);
});
