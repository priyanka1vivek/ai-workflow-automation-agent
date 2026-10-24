const $ = selector => document.querySelector(selector);
const state = { requests: [], config: null, workspace: null, role: 'owner', view: 'overview', eventFilter: 'all', email: '', authMode: 'login' };
const statusNames = { queued: 'Queued', processing: 'Processing', review: 'Needs review', delivering: 'Delivering', completed: 'Completed', failed: 'Failed', partial: 'Partial delivery' };
const stageNames = { receive: 'Received', classify: 'AI classification', route: 'Routed', approve: 'Approved', slack: 'Slack delivery', sheets: 'Google Sheets', retry: 'Retry' };
const views = {
  overview: ['Overview', 'WORKSPACE SNAPSHOT', 'Incoming requests, ready for review.', 'Track what arrived, what AI routed, and what was delivered.'],
  requests: ['Requests', 'REQUEST INBOX', 'Incoming requests', 'Find a request, inspect its AI analysis, and approve delivery.'],
  activity: ['Activity', 'EXECUTION HISTORY', 'Activity log', 'Trace intake, classification, routing, retries and delivery.'],
  integrations: ['Connections', 'WORKFLOW CONNECTIONS', 'Set up intake, AI and delivery.', 'Invite requesters and connect the services that run this workflow.']
};
function node(tag, className, content) { const n = document.createElement(tag); if (className) n.className = className; if (content !== undefined) n.textContent = content; return n; }
function date(value) { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
function shortTime(value) { return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function notify(message, error = false) { const t = $('#toast'); t.textContent = message; t.className = `toast visible${error ? ' error' : ''}`; clearTimeout(notify.timer); notify.timer = setTimeout(() => t.classList.remove('visible'), 4500); }
function signedOut() { $('#app-shell').classList.add('hidden'); $('#login-screen').classList.remove('hidden'); }
function signedIn(account) { state.email = account.email; state.role = account.role; $('#login-screen').classList.add('hidden'); $('#app-shell').classList.remove('hidden'); $('#profile-name').textContent = account.email; $('#profile-role').textContent = account.role === 'owner' ? 'Owner · reviewer' : 'Requester'; $('#profile-avatar').textContent = account.email[0].toUpperCase(); $('#workspace-label').firstChild.textContent = account.workspace || 'Support workspace'; document.querySelector('[data-view="integrations"]').closest('.nav-group').classList.toggle('hidden', account.role !== 'owner'); document.querySelector('.side-note').classList.toggle('hidden', account.role !== 'owner'); }
function setAuthMode(mode) {
  state.authMode = mode; const register = mode === 'register';
  $('#auth-kicker').textContent = register ? 'GET STARTED' : 'WELCOME BACK';
  $('#auth-heading').textContent = register ? 'Create your account' : 'Sign in to FlowDesk';
  $('#auth-description').textContent = register ? 'Leave the invite code blank to create a workspace as its reviewer. Enter a code to join as a requester.' : 'Your request queue and execution history are waiting.';
  $('#invite-field').classList.toggle('hidden', !register);
  $('#auth-submit').firstChild.textContent = register ? 'Create account ' : 'Sign in ';
  $('#auth-switch').textContent = register ? 'Already have an account? Sign in' : 'New here? Create an account';
  $('#login-form [name="password"]').minLength = register ? 12 : 0;
  $('#login-form [name="password"]').autocomplete = register ? 'new-password' : 'current-password';
  $('#login-error').textContent = '';
}
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  let data; try { data = await response.json(); } catch { throw new Error('The server did not return JSON.'); }
  if (response.status === 401 && !path.startsWith('/api/auth/')) signedOut();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
async function load() {
  const [config, result, workspace] = await Promise.all([api('/api/config'), api('/api/requests'), state.role === 'owner' ? api('/api/workspace') : Promise.resolve(null)]);
  state.config = config; state.requests = result.requests; state.workspace = workspace; render();
}
function setView(view) {
  if (!views[view] || (view === 'integrations' && state.role !== 'owner')) return;
  state.view = view;
  document.querySelectorAll('.nav-link').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('hidden', element.id !== `${view}-view`));
  const [breadcrumb, kicker, title, description] = views[view];
  $('#breadcrumb-view').textContent = breadcrumb; $('#section-kicker').textContent = kicker; $('#page-title').textContent = title; $('#page-subtitle').textContent = description;
  if (state.role !== 'owner' && view === 'overview') { $('#page-title').textContent = 'Your requests, from intake to resolution.'; $('#page-subtitle').textContent = 'Submit a request and follow its AI routing and review status.'; }
  if (view === 'overview') renderOverview();
  if (view === 'requests') renderRequests();
  if (view === 'activity') renderActivity();
  if (view === 'integrations') renderConnections();
}
function pill(text, className = '') { return node('span', `pill ${className}`, text); }
function render() {
  const r = state.requests, config = state.config;
  $('#metric-total').textContent = r.length;
  $('#metric-review').textContent = r.filter(item => item.status === 'review').length;
  $('#metric-high').textContent = r.filter(item => item.analysis?.priority === 'high').length;
  $('#metric-complete').textContent = r.filter(item => item.status === 'completed').length;
  $('#inbox-count').textContent = r.filter(item => ['review', 'queued', 'failed', 'partial'].includes(item.status)).length;
  $('#empty-onboarding').classList.toggle('hidden', r.length !== 0 || state.role !== 'owner');
  $('#ai-badge').textContent = config.integrations.openai ? '● AI key configured' : '○ AI setup needed';
  $('#ai-badge').classList.toggle('unavailable', !config.integrations.openai);
  $('#setup-notice').classList.toggle('hidden', config.integrations.openai || state.role !== 'owner');
  $('#new-request-button').classList.toggle('hidden', state.role === 'owner');
  $('#new-request-button').textContent = '＋  Submit request';
  $('#metric-review').parentElement.firstElementChild.textContent = state.role === 'owner' ? 'NEEDS YOUR REVIEW' : 'AWAITING REVIEW';
  setView(state.view);
}
function allEvents() { return state.requests.flatMap(r => r.events.map(e => ({ ...e, requestId: r.id, requestTitle: r.title }))).sort((a, b) => b.at.localeCompare(a.at)); }
function eventRow(e, compact = false) {
  const row = node('button', `event-row${compact ? ' compact' : ''}`), dot = node('span', `event-dot ${e.status}`), text = node('span', 'event-copy');
  text.append(node('strong', '', `${stageNames[e.stage] || e.stage} · ${e.requestTitle}`), node('small', '', e.detail));
  row.append(dot, text, node('time', '', compact ? shortTime(e.at) : date(e.at)));
  row.addEventListener('click', () => showDetail(e.requestId)); return row;
}
function renderOverview() {
  const root = $('#review-list'); root.replaceChildren();
  const reviews = state.requests.filter(r => r.status === 'review').sort((a, b) => (a.analysis?.priority === 'high' ? -1 : 0) - (b.analysis?.priority === 'high' ? -1 : 0)).slice(0, 4);
  if (!reviews.length) root.append(node('div', 'empty-inline', state.role === 'owner' ? 'No decisions waiting. Invite a requester or connect n8n to receive work.' : 'No requests awaiting review. Submit one to your workspace.'));
  for (const r of reviews) {
    const row = node('button', 'review-row'), main = node('span', 'review-copy');
    main.append(node('strong', '', r.title), node('small', '', `${r.analysis.route} · ${r.analysis.summary}`));
    row.append(pill(r.analysis.priority.toUpperCase(), r.analysis.priority), main, node('span', 'arrow', '↗'));
    row.onclick = () => showDetail(r.id); root.append(row);
  }
  const events = $('#recent-events'); events.replaceChildren();
  const latest = allEvents().slice(0, 3);
  if (!latest.length) events.append(node('div', 'empty-inline', 'Intake, AI analysis, review and delivery will appear here as requests move through the workflow.'));
  else latest.forEach(e => events.append(eventRow(e, true)));
}
function renderRequests() {
  const query = $('#search-input').value.trim().toLowerCase(), filter = $('#status-filter').value;
  const records = state.requests.filter(r => (filter === 'all' || r.status === filter) && `${r.title} ${r.message} ${r.analysis?.route || ''}`.toLowerCase().includes(query));
  const body = $('#request-rows'); body.replaceChildren(); $('#request-count').textContent = `${records.length} of ${state.requests.length}`;
  $('#request-empty').classList.toggle('hidden', !!records.length);
  $('#request-empty h3').textContent = state.requests.length ? 'No requests match.' : state.role === 'owner' ? 'No incoming requests yet.' : 'No requests submitted yet.';
  $('#request-empty p').textContent = state.requests.length ? 'Try a different search or status.' : state.role === 'owner' ? 'Invite a requester or connect n8n; incoming work will appear here.' : 'Submit a request to send it to the workspace reviewer.';
  $('#empty-create-button').classList.toggle('hidden', !!state.requests.length || state.role === 'owner');
  for (const r of records) {
    const tr = node('tr'), title = node('td'), button = node('button', 'table-title', r.title);
    button.onclick = () => showDetail(r.id); title.append(button, node('small', '', `${r.requester || r.source} · ${r.id.slice(0, 8)}`));
    const priority = node('td'); priority.append(r.analysis ? pill(r.analysis.priority, r.analysis.priority) : node('span', 'muted', '—'));
    const status = node('td'); status.append(pill(statusNames[r.status] || r.status, r.status));
    const action = node('td'), open = node('button', 'table-open', '↗'); open.setAttribute('aria-label', `Open ${r.title}`); open.onclick = () => showDetail(r.id); action.append(open);
    tr.append(title, node('td', 'route-cell', r.analysis?.route || 'Awaiting analysis'), priority, status, node('td', 'muted', date(r.createdAt)), action); body.append(tr);
  }
}
function renderActivity() {
  let events = allEvents();
  if (state.eventFilter === 'error') events = events.filter(e => e.status === 'error');
  if (state.eventFilter === 'retry') events = events.filter(e => e.stage === 'retry');
  if (state.eventFilter === 'delivery') events = events.filter(e => ['slack', 'sheets', 'approve'].includes(e.stage));
  $('#event-count').textContent = `${events.length} events`;
  const root = $('#activity-list'); root.replaceChildren();
  if (!events.length) root.append(node('div', 'empty-inline', 'No events in this view yet.'));
  else events.slice(0, 150).forEach(e => root.append(eventRow(e)));
}
function renderConnections() {
  const config = state.config, root = $('#integration-cards'); root.replaceChildren();
  const rows = [
    ['✦', 'OpenAI', 'Classification, priority, summary and draft reply', config.integrations.openai ? 'Configured' : 'API key missing', config.integrations.openai],
    ['⌁', 'n8n + webhook', 'Authenticated incoming request orchestration', state.workspace?.hasWebhookToken ? 'Token created' : 'Generate token', !!state.workspace?.hasWebhookToken],
    ['⌘', 'Slack', 'Reviewed summaries to your team channel', config.integrations.slack && config.liveDelivery ? 'Delivery enabled' : config.integrations.slack ? 'Configured · delivery off' : 'Add webhook URL', config.integrations.slack],
    ['▦', 'Google Sheets', 'One record per approved request', config.integrations.sheets && config.liveDelivery ? 'Delivery enabled' : config.integrations.sheets ? 'Configured · delivery off' : 'Add service account and Sheet ID', config.integrations.sheets]
  ];
  for (const [icon, name, description, status, ready] of rows) {
    const card = node('article', 'panel connection-card');
    card.append(node('span', 'connection-icon', icon), node('h3', '', name), node('p', '', description), node('span', `connection-status${ready ? ' ready' : ''}`, status)); root.append(card);
  }
  $('#invite-code').textContent = state.workspace?.inviteCode || 'Unavailable';
  $('#live-delivery').checked = config.liveDelivery;
}
function detailSection(title, content) { const box = node('section', 'detail-section'); box.append(node('span', 'overline', title), node('p', '', content)); return box; }
function showDetail(id) {
  const r = state.requests.find(item => item.id === id); if (!r) return;
  const root = $('#detail-content'); root.replaceChildren();
  const head = node('div', 'modal-head'), heading = node('div'), close = node('button', 'icon-button', '×'); close.setAttribute('aria-label', 'Close request'); close.onclick = () => $('#detail-dialog').close();
  heading.append(node('span', 'overline', `REQUEST ${r.id.slice(0, 8).toUpperCase()}`), node('h2', '', r.title)); head.append(heading, close); root.append(head);
  const meta = node('div', 'detail-meta'); meta.append(pill(statusNames[r.status] || r.status, r.status), node('span', '', `${r.source} · ${date(r.createdAt)}`)); root.append(meta);
  root.append(detailSection('ORIGINAL REQUEST · IDENTIFIERS REDACTED', r.message));
  if (r.analysis) {
    const a = r.analysis, analysis = node('section', 'analysis-panel');
    analysis.append(node('span', 'overline', 'OPENAI TRIAGE'), node('h3', '', a.summary));
    const facts = node('div', 'analysis-facts');
    for (const [label, value] of [['Category', a.category], ['Priority', a.priority], ['Route', a.route]]) { const fact = node('div'); fact.append(node('small', '', label), node('strong', '', value)); facts.append(fact); }
    analysis.append(facts, node('p', '', a.reason)); root.append(analysis);
    root.append(detailSection('SUGGESTED REPLY · DRAFT ONLY', a.suggestedReply));
    const note = node('p', 'review-note', a.needsHumanReview ? 'Flagged for closer human review. Check the decision before delivery.' : 'Check the decision before approval. The draft reply is never sent to a customer.'); root.append(note);
  }
  if (Object.keys(r.deliveries).length) {
    const section = node('section', 'detail-section'); section.append(node('span', 'overline', 'DELIVERY RESULTS'));
    for (const [target, result] of Object.entries(r.deliveries)) { const line = node('div', 'delivery-line'); line.append(node('strong', '', target === 'sheets' ? 'Google Sheets' : 'Slack'), node('span', '', `${result.status} · ${result.message || 'Pending'}`)); section.append(line); } root.append(section);
  }
  if (r.error) root.append(node('p', 'form-error', r.error));
  const log = node('section', 'detail-section detail-log'); log.append(node('span', 'overline', 'EXECUTION TRACE'));
  r.events.forEach(e => { const entry = node('div'); entry.append(node('time', '', shortTime(e.at)), node('strong', '', stageNames[e.stage] || e.stage), node('span', '', e.detail)); log.append(entry); }); root.append(log);
  if (r.status !== 'completed' && state.role === 'owner') {
    const actions = node('div', 'modal-actions'), uncertain = Object.values(r.deliveries).some(d => d.status === 'uncertain');
    const action = r.analysis ? 'approve' : 'classify';
    const button = node('button', 'primary', uncertain ? 'Verify uncertain delivery manually' : action === 'approve' ? r.status === 'partial' ? 'Retry failed deliveries →' : 'Approve & deliver →' : 'Retry AI classification →');
    button.disabled = uncertain;
    button.onclick = async () => { button.disabled = true; button.textContent = 'Working…'; try { const result = await api(`/api/requests/${id}/${action}`, { method: 'POST' }); await load(); showDetail(id); notify(['partial', 'failed'].includes(result.status) ? 'This run needs attention. Check the trace.' : 'Request updated.', ['partial', 'failed'].includes(result.status)); } catch (e) { notify(e.message, true); button.disabled = false; } };
    actions.append(button); root.append(actions);
  }
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
}
async function start() {
  try { const account = await api('/api/auth/me'); signedIn(account); await load(); }
  catch (e) { signedOut(); if (!e.message.includes('Sign in')) notify(e.message, true); }
}
function setSidebarCollapsed(collapsed) {
  $('#app-shell').classList.toggle('sidebar-collapsed', collapsed);
  const button = $('#sidebar-toggle');
  button.textContent = collapsed ? '›' : '‹';
  button.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  button.setAttribute('title', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  button.setAttribute('aria-expanded', String(!collapsed));
  try { localStorage.setItem('flowdesk-sidebar-collapsed', collapsed ? '1' : '0'); } catch { /* Keep the control usable without storage. */ }
}
let sidebarWasCollapsed = false;
try { sidebarWasCollapsed = localStorage.getItem('flowdesk-sidebar-collapsed') === '1'; } catch { /* Default to expanded. */ }
setSidebarCollapsed(sidebarWasCollapsed);
$('#sidebar-toggle').onclick = () => setSidebarCollapsed(!$('#app-shell').classList.contains('sidebar-collapsed'));
$('#auth-switch').onclick = () => setAuthMode(state.authMode === 'login' ? 'register' : 'login');
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault(); const button = e.target.querySelector('button[type="submit"]'); button.disabled = true; $('#login-error').textContent = '';
  try { const values = new FormData(e.target); const account = await api(`/api/auth/${state.authMode}`, { method: 'POST', body: JSON.stringify({ email: values.get('email'), password: values.get('password'), inviteCode: values.get('inviteCode') }) }); e.target.reset(); signedIn(account); await load(); }
  catch (error) { $('#login-error').textContent = error.message; } finally { button.disabled = false; }
});
async function logout() { try { await api('/api/auth/logout', { method: 'POST' }); } finally { state.requests = []; state.config = null; signedOut(); } }
$('#logout-button').onclick = logout; $('#mobile-logout-button').onclick = logout;
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('#new-request-button').onclick = () => $('#request-dialog').showModal();
$('#empty-create-button').onclick = () => $('#new-request-button').click();
document.querySelectorAll('.close-request').forEach(button => button.onclick = () => $('#request-dialog').close());
$('#refresh-button').onclick = () => load().then(() => notify('Workspace refreshed.')).catch(e => notify(e.message, true));
$('#search-input').oninput = renderRequests; $('#status-filter').onchange = renderRequests;
document.querySelectorAll('[data-event-filter]').forEach(button => button.onclick = () => { state.eventFilter = button.dataset.eventFilter; document.querySelectorAll('.filter-chip').forEach(chip => chip.classList.toggle('active', chip === button)); renderActivity(); });
$('#request-form').addEventListener('submit', async e => {
  e.preventDefault(); const button = $('#submit-button'); button.disabled = true; button.textContent = 'Submitting…';
  try { const form = new FormData(e.target), r = await api('/api/requests', { method: 'POST', body: JSON.stringify({ title: form.get('title'), message: form.get('message') }) }); e.target.reset(); $('#request-dialog').close(); await load(); setView('requests'); showDetail(r.id); notify(r.status === 'queued' ? 'Request received. The owner can connect AI and classify it.' : r.status === 'failed' ? 'AI classification failed. The owner can retry.' : 'Request sent for owner review.', r.status === 'failed'); }
  catch (error) { notify(error.message, true); } finally { button.disabled = false; button.textContent = 'Submit now →'; }
});
document.querySelectorAll('[data-connection]').forEach(form => form.addEventListener('submit', async event => {
  event.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
  const values = Object.fromEntries(new FormData(form));
  try { await api('/api/connections', { method: 'POST', body: JSON.stringify(values) }); form.reset(); await load(); notify('Connection saved. The secret is not shown again.'); }
  catch (error) { notify(error.message, true); } finally { button.disabled = false; }
}));
$('#save-delivery').onclick = async () => {
  try { await api('/api/connections', { method: 'POST', body: JSON.stringify({ liveDelivery: $('#live-delivery').checked }) }); await load(); notify('Delivery setting saved.'); }
  catch (error) { notify(error.message, true); }
};
$('#token-button').onclick = async () => {
  if (state.workspace?.hasWebhookToken && !confirm('Rotate the token? Existing n8n credentials will stop working until updated.')) return;
  try { const result = await api('/api/workspace/token', { method: 'POST' }); $('#webhook-token').textContent = result.token; $('#webhook-token').classList.remove('hidden'); await load(); notify('Copy this token now. It will only be shown once.'); }
  catch (error) { notify(error.message, true); }
};
start();
