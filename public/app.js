const $ = selector => document.querySelector(selector);
const state = { requests: [], config: null, view: 'overview', selected: null, token: sessionStorage.getItem('flowdesk-token') || '' };
const labels = { review: 'Ready for review', queued: 'Queued', processing: 'Processing', delivering: 'Delivering', completed: 'Completed', failed: 'Failed', partial: 'Partial delivery' };
const samples = [
  { title: 'Dashboard access is blocked', message: 'Our production support team cannot access the dashboard. Login returns an error for all users. This is urgent and work is blocked.' },
  { title: 'Duplicate charge on the monthly invoice', message: 'The monthly invoice shows a duplicate charge for our subscription. Please review the billing entry and explain the next steps.' },
  { title: 'Question about support hours', message: 'How do I find information about weekend support hours and the best way to contact the team?' }
];
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function badge(text, style) { return el('span', `badge ${style}`, text); }
function time(value) { return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function toast(message, error = false) { $('#toast').textContent = message; $('#toast').className = `toast show${error ? ' error' : ''}`; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('show'), 4500); }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...options.headers } });
  const data = await response.json();
  if (response.status === 401) { if (!$('#auth-dialog').open) $('#auth-dialog').showModal(); throw new Error('Workspace token required.'); }
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
async function refresh() { const [config, data] = await Promise.all([api('/api/config'), api('/api/requests')]); state.config = config; state.requests = data.requests; render(); }
function setView(view) {
  state.view = view;
  document.querySelectorAll('nav .nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#overview-view').classList.toggle('hidden', !['overview', 'requests'].includes(view));
  $('#integrations-view').classList.toggle('hidden', view !== 'integrations'); $('#activity-view').classList.toggle('hidden', view !== 'activity');
  const titles = { overview: ['Overview', 'A clearer queue. A calmer day.', 'Classify, summarize and route every request from one place.'], requests: ['Request inbox', 'Every request, in the right place.', 'Review decisions, approve delivery and follow each run.'], integrations: ['Integrations', 'Connect the tools you work with.', 'One workflow, connected to your team’s everyday tools.'], activity: ['Execution log', 'A trace of every next step.', 'Inspect classification, routing, retries and integration delivery.'] };
  const [crumb, title, description] = titles[view]; $('#breadcrumb-view').textContent = crumb; $('#page-heading').textContent = title; $('#page-description').textContent = description;
}
function render() {
  const r = state.requests, config = state.config;
  $('#stat-total').textContent = r.length; $('#stat-review').textContent = r.filter(x => x.status === 'review').length;
  $('#stat-complete').textContent = r.filter(x => x.status === 'completed').length; $('#stat-high').textContent = r.filter(x => x.analysis?.priority === 'high').length;
  $('#inbox-count').textContent = r.filter(x => !['completed'].includes(x.status)).length; $('#queue-count').textContent = r.length;
  $('#mode-badge').textContent = config.aiMode === 'demo' ? '● Demo mode' : '● Live AI';
  const banner = $('#mode-banner'); banner.querySelector('strong').textContent = config.aiMode === 'demo' ? 'Demo workspace' : 'Live AI workspace';
  banner.querySelector('div > span').textContent = config.aiMode === 'demo' ? `Local rules power classification. ${config.liveDelivery ? 'Configured integrations can deliver after approval.' : 'External deliveries are previews.'}` : `OpenAI powers classification. ${config.liveDelivery ? 'Configured integrations can deliver after approval.' : 'External delivery is disabled; approval creates previews.'}`;
  renderRows(); renderDistribution(); renderIntegrations(); renderActivity();
}
function renderRows() {
  const query = $('#search-input').value.toLowerCase(), filter = $('#status-filter').value;
  const rows = state.requests.filter(r => (filter === 'all' || r.status === filter) && `${r.title} ${r.message} ${r.analysis?.category || ''}`.toLowerCase().includes(query));
  const body = $('#request-rows'); body.replaceChildren(); $('#empty-state').classList.toggle('hidden', !!rows.length);
  $('#empty-state h3').textContent = state.requests.length ? 'No matching requests.' : 'Your queue starts here.';
  $('#empty-state p').textContent = state.requests.length ? 'Try another search or choose a different status.' : 'Add a request or try three synthetic samples to see the workflow in action.';
  $('#empty-demo-button').classList.toggle('hidden', !!state.requests.length);
  for (const r of rows) {
    const tr = el('tr'), subjectCell = el('td'), subject = el('div', 'request-subject');
    subject.append(el('span', 'request-symbol', r.analysis?.category === 'billing' ? '▧' : r.analysis?.category === 'technical' ? '⌘' : '▤'));
    const info = el('div'), button = el('button', 'request-title', r.title); button.addEventListener('click', () => showDetail(r.id));
    info.append(button, el('small', '', `${r.analysis?.route || 'Awaiting classification'} · ${time(r.createdAt)}`)); subject.append(info); subjectCell.append(subject);
    const priority = el('td'); priority.append(r.analysis ? badge(r.analysis.priority[0].toUpperCase() + r.analysis.priority.slice(1), r.analysis.priority) : el('span', 'subtle', '—'));
    const status = el('td'); status.append(badge(labels[r.status] || r.status, r.status));
    const last = el('td'), open = el('button', 'row-open', '›'); open.setAttribute('aria-label', `Open ${r.title}`); open.addEventListener('click', () => showDetail(r.id)); last.append(open); tr.append(subjectCell, priority, status, last); body.append(tr);
  }
  $('#shown-count').textContent = `${rows.length} of ${state.requests.length} requests`;
}
function renderDistribution() {
  const root = $('#distribution'); root.replaceChildren(); const total = state.requests.filter(r => r.analysis).length;
  for (const [key, label] of [['technical', 'Technical support'], ['billing', 'Billing operations'], ['general', 'Customer support']]) {
    const count = state.requests.filter(r => r.analysis?.category === key).length, row = el('div', 'distribution-row'), line = el('div');
    line.append(el('span', '', label), el('strong', '', String(count))); const bar = el('div', 'bar'), fill = el('i');
    // Width classes keep the content security policy free of inline styles.
    fill.className = `bar-${total ? Math.round(count / total * 100) : 0}`; bar.append(fill); row.append(line, bar); root.append(row);
  }
}
function renderIntegrations() {
  const root = $('#integration-cards'), c = state.config; root.replaceChildren();
  for (const [key, symbol, name, description] of [['openai', '✦', 'OpenAI', 'Classify requests and generate structured summaries.'], ['slack', '⌘', 'Slack', 'Send reviewed requests to your team’s channel.'], ['sheets', '▦', 'Google Sheets', 'Append an auditable row for each approved request.']]) {
    const card = el('article', 'card integration-card'); const enabled = c.integrations[key];
    const status = key === 'openai' ? (c.aiMode === 'demo' ? 'Demo rules active' : enabled ? 'Configured · live AI' : 'API key missing') : enabled && c.liveDelivery ? 'Configured · delivery enabled' : enabled ? 'Configured · preview only' : 'Not configured · preview only';
    card.append(el('span', 'integration-icon', symbol), el('h2', '', name), el('p', '', description), el('span', `integration-status${enabled ? ' ready' : ''}`, status)); root.append(card);
  }
}
function renderActivity() {
  const root = $('#activity-list'); root.replaceChildren();
  const events = state.requests.flatMap(r => r.events.map(e => ({ ...e, title: r.title, id: r.id }))).sort((a, b) => b.at.localeCompare(a.at));
  $('#event-count').textContent = events.length;
  if (!events.length) root.append(el('div', 'empty-state subtle', 'Execution events will appear after your first request.'));
  for (const e of events.slice(0, 150)) { const item = el('div', 'activity-item'), info = el('div'); info.append(el('strong', '', `${e.stage[0].toUpperCase()}${e.stage.slice(1)} · ${e.title}`), el('p', '', e.detail), el('small', '', e.id.slice(0, 8))); item.append(el('span', `event-dot ${e.status}`), info, el('time', '', time(e.at))); root.append(item); }
}
function section(title, text) { const s = el('section', 'detail-section'); s.append(el('h3', '', title), el('p', '', text)); return s; }
function showDetail(id) {
  state.selected = id; const r = state.requests.find(x => x.id === id); if (!r) return;
  const root = $('#detail-content'); root.replaceChildren();
  const head = el('div', 'dialog-heading'), headText = el('div'), close = el('button', 'icon-btn', '×'); close.setAttribute('aria-label', 'Close request'); close.onclick = () => $('#detail-dialog').close();
  headText.append(el('span', 'eyebrow', `REQUEST ${r.id.slice(0, 8).toUpperCase()}`), el('h2', '', r.title)); head.append(headText, close); root.append(head);
  const meta = el('div', 'detail-meta'); meta.append(badge(labels[r.status], r.status)); if (r.analysis) meta.append(badge(r.analysis.priority, r.analysis.priority)); root.append(meta, section('Original request · redacted', r.message));
  if (r.analysis) {
    const a = r.analysis, box = el('div', 'analysis-box'); box.append(el('h3', '', `✦ ${a.provider === 'openai' ? 'AI analysis' : 'Demo analysis'} → ${a.route}`), el('p', '', a.summary), el('small', '', a.reason)); root.append(box, section('Suggested reply · draft only', a.suggestedReply));
    root.append(el('div', 'review-note', a.needsHumanReview ? 'Flagged for closer review. Check the classification and draft before approving.' : 'Review the decision before approval. Approval delivers only the summary; the suggested reply is not sent.'));
    if (Object.keys(r.deliveries).length) {
      const delivery = el('section', 'detail-section'); delivery.append(el('h3', '', 'Integration delivery'));
      for (const [target, d] of Object.entries(r.deliveries)) { const line = el('div', 'delivery-row'); line.append(el('span', '', target === 'slack' ? 'Slack' : 'Google Sheets'), el('span', '', `${d.status} · ${d.message || 'In progress'}`)); delivery.append(line); } root.append(delivery);
    }
    root.append(el('p', 'subtle', `Provider: ${a.provider}${a.model ? ` · ${a.model}` : ''} · Classification: ${r.durationMs}ms · ${r.source}`));
  }
  if (r.error) root.append(el('p', 'error-text', r.error));
  const log = el('section', 'detail-section'); log.append(el('h3', '', 'Execution trace'));
  for (const e of r.events) { const row = el('div', 'mini-event'); row.append(el('b', '', `${time(e.at)} · ${e.stage} `), document.createTextNode(e.detail)); log.append(row); } root.append(log);
  if (r.status !== 'completed') {
    const actions = el('div', 'detail-actions'), button = el('button', 'primary', r.analysis ? (r.status === 'partial' ? 'Retry failed deliveries →' : 'Approve & deliver →') : 'Run classification →');
    const uncertain = Object.values(r.deliveries).some(d => d.status === 'uncertain');
    if (uncertain) { button.disabled = true; button.textContent = 'Verify uncertain deliveries manually'; }
    else button.onclick = async () => { button.disabled = true; button.textContent = 'Processing…'; try { const result = await api(`/api/requests/${id}/${r.analysis ? 'approve' : 'classify'}`, { method: 'POST' }); await refresh(); showDetail(id); toast(result.status === 'partial' || result.status === 'failed' ? 'Run needs attention. Check the execution trace.' : 'Request updated.', ['partial', 'failed'].includes(result.status)); } catch (e) { toast(e.message, true); button.disabled = false; } };
    actions.append(button); root.append(actions);
  }
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
}
async function loadSamples() {
  if (state.config?.aiMode !== 'demo') return toast('Sample loading is available in demo mode. Use New request for live AI.', true);
  const buttons = [$('#demo-button'), $('#empty-demo-button')]; buttons.forEach(b => b.disabled = true);
  try { for (let i = 0; i < samples.length; i++) await api('/api/requests', { method: 'POST', headers: { 'Idempotency-Key': `flowdesk-sample-${i}` }, body: JSON.stringify(samples[i]) }); await refresh(); setView('overview'); toast('Three synthetic requests analyzed. Select one to review.'); }
  catch (e) { toast(e.message, true); } finally { buttons.forEach(b => b.disabled = false); }
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
$('#new-request-button').onclick = () => $('#request-dialog').showModal();
document.querySelectorAll('.close-dialog').forEach(b => b.onclick = () => $('#request-dialog').close());
$('#search-input').addEventListener('input', renderRows); $('#status-filter').addEventListener('change', renderRows);
$('#demo-button').onclick = loadSamples; $('#empty-demo-button').onclick = loadSamples;
$('#refresh-button').onclick = () => refresh().then(() => toast('Dashboard refreshed.')).catch(e => toast(e.message, true));
$('#request-form').onsubmit = async e => {
  e.preventDefault(); const button = $('#submit-button'); button.disabled = true; button.textContent = 'Analyzing…';
  try { const form = new FormData(e.target); const r = await api('/api/requests', { method: 'POST', body: JSON.stringify({ title: form.get('title'), message: form.get('message') }) }); e.target.reset(); $('#request-dialog').close(); await refresh(); showDetail(r.id); toast(r.status === 'failed' ? 'Classification failed. Check the request trace.' : 'Request analyzed and ready for review.', r.status === 'failed'); }
  catch (error) { toast(error.message, true); } finally { button.disabled = false; button.textContent = 'Analyze request →'; }
};
$('#auth-form').onsubmit = async e => { e.preventDefault(); state.token = new FormData(e.target).get('token'); try { await refresh(); sessionStorage.setItem('flowdesk-token', state.token); e.target.reset(); $('#auth-dialog').close(); $('#auth-error').textContent = ''; } catch { $('#auth-error').textContent = 'Unable to connect. Check the token and server.'; } };
refresh().catch(e => toast(e.message, true));
