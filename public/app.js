const $ = selector => document.querySelector(selector);
const state = { requests: [], config: null, view: 'overview', eventFilter: 'all', email: '' };
const statusNames = { queued: 'Queued', processing: 'Processing', review: 'Needs review', delivering: 'Delivering', completed: 'Completed', failed: 'Failed', partial: 'Partial delivery' };
const stageNames = { receive: 'Received', classify: 'AI classification', route: 'Routed', approve: 'Approved', slack: 'Slack delivery', sheets: 'Google Sheets', retry: 'Retry' };
const views = {
  overview: ['Overview', 'WORKSPACE SNAPSHOT', 'Good work starts with a clear queue.', 'A quick view of what has arrived, what needs review, and what moved forward.'],
  requests: ['Requests', 'REQUEST INBOX', 'Every request has a next step.', 'Find a request, inspect its AI analysis, and approve delivery.'],
  activity: ['Activity', 'EXECUTION HISTORY', 'See what happened, in order.', 'Trace intake, classification, routing, retries and delivery.'],
  integrations: ['Connections', 'WORKFLOW CONNECTIONS', 'A connected workflow, end to end.', 'Check your AI, webhook and delivery setup in one place.']
};
function node(tag, className, content) { const n = document.createElement(tag); if (className) n.className = className; if (content !== undefined) n.textContent = content; return n; }
function date(value) { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
function shortTime(value) { return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function notify(message, error = false) { const t = $('#toast'); t.textContent = message; t.className = `toast visible${error ? ' error' : ''}`; clearTimeout(notify.timer); notify.timer = setTimeout(() => t.classList.remove('visible'), 4500); }
function signedOut() { $('#app-shell').classList.add('hidden'); $('#login-screen').classList.remove('hidden'); }
function signedIn(email) { state.email = email; $('#login-screen').classList.add('hidden'); $('#app-shell').classList.remove('hidden'); $('#profile-name').textContent = email; $('#profile-avatar').textContent = email[0].toUpperCase(); }
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  let data; try { data = await response.json(); } catch { throw new Error('The server did not return JSON.'); }
  if (response.status === 401 && !path.startsWith('/api/auth/')) signedOut();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
async function load() {
  const [config, result] = await Promise.all([api('/api/config'), api('/api/requests')]);
  state.config = config; state.requests = result.requests; render();
}
function setView(view) {
  if (!views[view]) return;
  state.view = view;
  document.querySelectorAll('.nav-link').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('hidden', element.id !== `${view}-view`));
  const [breadcrumb, kicker, title, description] = views[view];
  $('#breadcrumb-view').textContent = breadcrumb; $('#section-kicker').textContent = kicker; $('#page-title').textContent = title; $('#page-subtitle').textContent = description;
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
  $('#ai-badge').textContent = config.integrations.openai ? '● AI key configured' : '○ AI setup needed';
  $('#ai-badge').classList.toggle('unavailable', !config.integrations.openai);
  $('#setup-notice').classList.toggle('hidden', config.integrations.openai);
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
  if (!reviews.length) root.append(node('div', 'empty-inline', 'Nothing needs approval right now. New AI analyses will appear here.'));
  for (const r of reviews) {
    const row = node('button', 'review-row'), main = node('span', 'review-copy');
    main.append(node('strong', '', r.title), node('small', '', `${r.analysis.route} · ${r.analysis.summary}`));
    row.append(pill(r.analysis.priority.toUpperCase(), r.analysis.priority), main, node('span', 'arrow', '↗'));
    row.onclick = () => showDetail(r.id); root.append(row);
  }
  const events = $('#recent-events'); events.replaceChildren();
  const latest = allEvents().slice(0, 3);
  if (!latest.length) events.append(node('div', 'empty-inline', 'Your first request will start the execution log.'));
  else latest.forEach(e => events.append(eventRow(e, true)));
}
function renderRequests() {
  const query = $('#search-input').value.trim().toLowerCase(), filter = $('#status-filter').value;
  const records = state.requests.filter(r => (filter === 'all' || r.status === filter) && `${r.title} ${r.message} ${r.analysis?.route || ''}`.toLowerCase().includes(query));
  const body = $('#request-rows'); body.replaceChildren(); $('#request-count').textContent = `${records.length} of ${state.requests.length}`;
  $('#request-empty').classList.toggle('hidden', !!records.length);
  $('#request-empty h3').textContent = state.requests.length ? 'No requests match.' : 'Your inbox is clear.';
  $('#request-empty p').textContent = state.requests.length ? 'Try a different search or status.' : 'Create a request to begin the AI triage workflow.';
  $('#empty-create-button').classList.toggle('hidden', !!state.requests.length);
  for (const r of records) {
    const tr = node('tr'), title = node('td'), button = node('button', 'table-title', r.title);
    button.onclick = () => showDetail(r.id); title.append(button, node('small', '', `${r.source} · ${r.id.slice(0, 8)}`));
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
    ['⌁', 'n8n + webhook', 'Authenticated incoming request orchestration', 'Import workflow to connect', false],
    ['⌘', 'Slack', 'Reviewed summaries to your team channel', config.integrations.slack && config.liveDelivery ? 'Delivery enabled' : config.integrations.slack ? 'Configured · delivery off' : 'Preview only', config.integrations.slack && config.liveDelivery],
    ['▦', 'Google Sheets', 'One record per approved request', config.integrations.sheets && config.liveDelivery ? 'Delivery enabled' : config.integrations.sheets ? 'Configured · delivery off' : 'Preview only', config.integrations.sheets && config.liveDelivery]
  ];
  for (const [icon, name, description, status, ready] of rows) {
    const card = node('article', 'panel connection-card');
    card.append(node('span', 'connection-icon', icon), node('h3', '', name), node('p', '', description), node('span', `connection-status${ready ? ' ready' : ''}`, status)); root.append(card);
  }
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
  if (r.status !== 'completed') {
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
  try { const account = await api('/api/auth/me'); signedIn(account.email); await load(); }
  catch (e) { signedOut(); if (!e.message.includes('Sign in')) notify(e.message, true); }
}
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault(); const button = e.target.querySelector('button[type="submit"]'); button.disabled = true; $('#login-error').textContent = '';
  try { const values = new FormData(e.target); const account = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: values.get('email'), password: values.get('password') }) }); e.target.reset(); signedIn(account.email); await load(); }
  catch (error) { $('#login-error').textContent = error.message; } finally { button.disabled = false; }
});
$('#logout-button').onclick = async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { state.requests = []; state.config = null; signedOut(); } };
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('#new-request-button').onclick = () => state.config?.integrations.openai ? $('#request-dialog').showModal() : (setView('integrations'), notify('Add OPENAI_API_KEY in .env and restart the server to analyze requests.', true));
$('#empty-create-button').onclick = () => $('#new-request-button').click();
document.querySelectorAll('.close-request').forEach(button => button.onclick = () => $('#request-dialog').close());
$('#refresh-button').onclick = () => load().then(() => notify('Workspace refreshed.')).catch(e => notify(e.message, true));
$('#search-input').oninput = renderRequests; $('#status-filter').onchange = renderRequests;
document.querySelectorAll('[data-event-filter]').forEach(button => button.onclick = () => { state.eventFilter = button.dataset.eventFilter; document.querySelectorAll('.filter-chip').forEach(chip => chip.classList.toggle('active', chip === button)); renderActivity(); });
$('#request-form').addEventListener('submit', async e => {
  e.preventDefault(); const button = $('#submit-button'); button.disabled = true; button.textContent = 'Analyzing…';
  try { const form = new FormData(e.target), r = await api('/api/requests', { method: 'POST', body: JSON.stringify({ title: form.get('title'), message: form.get('message') }) }); e.target.reset(); $('#request-dialog').close(); await load(); setView('requests'); showDetail(r.id); notify(r.status === 'failed' ? 'AI classification failed. See the execution trace.' : 'Analysis ready for review.', r.status === 'failed'); }
  catch (error) { notify(error.message, true); } finally { button.disabled = false; button.textContent = 'Analyze request →'; }
});
start();
