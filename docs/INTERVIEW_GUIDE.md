# Explaining FlowDesk in an interview

## 45-second explanation

“FlowDesk is a support request triage workflow. A request arrives from the dashboard or an authenticated n8n webhook. The Node API validates and stores it in SQLite, then sends the redacted text to OpenAI for a structured category, priority, summary, reason and reply draft. The category maps to a support team. A workspace owner reviews the result before approving it. Approval sends the summary to configured Slack and Google Sheets destinations, while an execution log records each step, failure and retry. The dashboard separates the work queue, event log and integration status.”

## Questions you are likely to get

**Who is the user?** A support operations owner. Other teams can submit requests through the n8n webhook; the owner signs in to review and route them. The draft response helps the reviewer but is not automatically emailed to a customer.

**Why Slack and Google Sheets?** Slack alerts the right team to a reviewed request. Sheets adds a structured record for later tracking or reporting. They are optional destinations and send only after approval.

**Where does n8n fit?** It receives an external webhook and calls the Node REST API to persist and classify. The app owns validation, AI logic and saved state, so the same logic also works when a request is submitted in the dashboard.

**Where exactly is the AI?** `src/agent.js` calls OpenAI using a strict JSON schema. The returned category, priority and summary are validated before the request moves to review. Without an API key or on a provider error, classification fails visibly rather than showing a fabricated result.

**How is a team chosen?** The schema allows `technical`, `billing` or `general`; the fixed `routes` map converts that category to Technical support, Billing operations or Customer support. The model cannot invent a new destination.

**What happens after classification?** The owner opens the request, reads its summary, reason and draft reply, then chooses whether to approve. Approval triggers destination delivery; classification alone does not.

**What does “retry and logging” mean?** Transient 429 and server failures get a bounded retry. Each workflow stage and retry is timestamped in the stored request. If Slack succeeded but Sheets failed, another approval skips Slack and retries Sheets. If a network write outcome is uncertain, FlowDesk asks for manual verification before resending.

**How do duplicate webhooks behave?** The caller supplies `Idempotency-Key`. SQLite keeps it unique; repeating the same event returns the existing request, while reusing the key with different content returns a conflict.

**How does login work?** The owner email and password are kept in the local server environment. The login endpoint compares credentials and returns a signed, time-limited HttpOnly cookie. Browser requests use that cookie; n8n uses a separate `APP_TOKEN` in an Authorization header. The client never receives OpenAI, Slack or Google credentials.

**Why no Express or external database?** The project has a small, explicit set of routes and one workspace. Node’s built-in HTTP API and SQLite keep the service easy to run and let me show validation, auth and transitions directly. The modules still separate server routing, authentication, AI/integrations, persistence and frontend code.

**Why Docker?** It is optional for the web app, but Docker Compose starts the app and n8n with stable internal networking and persisted data. For local UI work I can run `npm run dev` directly.

## Resume claim checklist

| Claim | Code that implements it |
| --- | --- |
| Webhook trigger | `n8n/triage-workflow.json`, `POST /api/webhook` and `/api/requests` |
| LLM classification and summary | `classify`, strict `schema` and `validateAnalysis` in `src/agent.js` |
| Slack and Google Sheets routing | `dispatch` in `src/server.js`, `deliver` in `src/agent.js` |
| REST APIs and JSON | HTTP route handling and `readBody` in `src/server.js` |
| Retry and logging | `requestWithRetry`, `event`, `src/store.js` and Activity screen |
| GitHub documentation | `README.md` and `docs/` |

The code and automated tests demonstrate the implementation. Before saying external delivery was exercised, run the configured OpenAI, n8n, Slack and Sheets path once and verify the resulting message and row.
