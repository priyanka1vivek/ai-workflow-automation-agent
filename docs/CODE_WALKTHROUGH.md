# Code walkthrough and design decisions

FlowDesk is deliberately a small Node application. Each module has one responsibility. The service is a compact support triage application with workspace-scoped request data and owner/requester roles.

## Request lifecycle

```text
Requester dashboard or n8n webhook
  → HTTP authentication and JSON validation
  → redacted request saved in SQLite
  → OpenAI structured classification
  → category maps to a support team
  → workspace owner inspects analysis and approves
  → configured Slack / Sheets delivery
  → status and each event saved in SQLite
```

The frontend never calls OpenAI, Slack or Google directly. It calls same-origin REST endpoints. Credentials are entered in the owner Connections screen, encrypted in SQLite, and optionally supplied from local environment variables for advanced deployments. The encryption key is stored in the same database, so access to its file/backups must be protected. The n8n workflow is an integration client: it receives external events and calls FlowDesk's intake and classify endpoints with a scoped workspace machine token. SQLite is the source of truth for requests and execution history.

## Files and responsibilities

| File | What to explain |
| --- | --- |
| `public/index.html` | Owner/requester registration and login form, application shell, separate screens, request/detail dialogs. It contains no secrets or business decisions. |
| `public/styles.css` | Responsive design, layout, status colors, form and focus states. Mobile navigation changes layout below 760 px. |
| `public/app.js` | Browser state and DOM rendering, registration, sign-in, API calls, filtering, detail inspection, owner approval, and connection forms. Text is inserted with `textContent` to avoid interpreting request data as HTML. |
| `src/server.js` | HTTP routing, auth boundaries, input limits, lifecycle orchestration, persistence calls and static asset delivery. |
| `src/auth.js` | Salted password hashing and comparison, signed 12-hour cookies, logout expiry. |
| `src/agent.js` | Input redaction and validation, AI schema and prompt, OpenAI request, bounded retry, Slack and Sheets adapters. |
| `src/store.js` | SQLite users, workspaces, scoped requests, encrypted connection values, token hashes, idempotency, and interrupted-run recovery. |
| `n8n/triage-workflow.json` | Authenticated webhook → persist queued request → classify through REST API → respond. The workflow does not auto-approve. |
| `external-intake/` | Standalone local support form and Node sender. The server forwards JSON to the published n8n webhook with its caller secret, which is never exposed to browser JavaScript. |
| `test/agent.test.js` | Behavioral tests for auth, validation, retry, approval, idempotency and failures using external-service stubs. |
| `.env.example` | Server configuration template; the actual `.env` is ignored by Git. |
| `Dockerfile`, `docker-compose.yml` | Optional repeatable runtime for the app and n8n with durable volumes and stable internal networking. |

## Key functions in order

### `src/server.js`

- `envConfig` reads configuration once. Local hosting uses loopback by default; optional n8n machine access is configured separately.
- `createApp` opens the SQLite store, which holds accounts and a persistent session signing secret. It constructs a SQLite store, in-memory per-request locks, rate-limit buckets and an HTTP server.
- `event` appends a timestamped stage result and saves the request. This is why Activity can show a trace instead of inferring state from a single status field.
- `analyze` locks a request, invokes the AI classifier and moves it into `review`. A provider error produces a persisted `failed` request with the error and an event, so a reviewer can retry.
- `editAnalysis` validates an owner's corrections while a request is awaiting review, then recomputes the route from the corrected category. `rejectRequest` stores the owner's reason and blocks later classification or approval.
- `dispatch` requires a stored analysis, records human approval, then delivers to Slack and Sheets one by one. Rejected requests are blocked. Already `sent` or previewed destinations are skipped on another attempt. An uncertain send is held to avoid accidental duplicates.
- The HTTP callback serves health and static assets, checks origin and rate limits API requests, handles registration/login/logout, and accepts a signed browser cookie or a scoped n8n token. Only owners can change connections and approve delivery; webhook tokens can intake/classify but cannot approve. The request endpoints call the workflow functions above.

### `src/auth.js`

- `hashPassword` creates a salted scrypt hash at registration. `verifyPassword` compares a login password with the stored hash using a timing-safe comparison.
- `createSession` encodes account ID, expiry and a nonce and signs the payload with HMAC-SHA256. `readSession` checks signature and expiry on each protected request.
- `sessionCookie` uses `HttpOnly` so browser JavaScript cannot read it, and `SameSite=Strict` to limit cross-site use. Login attempts are rate limited by IP in `server.js`. The server maps each session to a user and workspace. Owners see workspace requests; requesters only see their own.

### `src/agent.js`

- `validateInput` accepts only a bounded title/message and a known source. `redact` replaces common emails, phone-like numbers and token patterns before storage and AI analysis. It is intentionally basic, so the app should use synthetic or non-sensitive requests.
- `schema` and `validateAnalysis` constrain the LLM response to known categories/priorities and short text fields. The `routes` mapping turns category into a team name; the model cannot choose an arbitrary destination.
- `classify` calls OpenAI's structured JSON response API. A missing key or failed call raises an error. There is no rule-based result masquerading as a model output.
- `requestWithRetry` retries transient HTTP 429/5xx and, where safe, network errors with short bounded delays. Slack and Sheets writes do not blindly retry after an ambiguous network failure.
- `deliver` first checks whether live delivery and target credentials are enabled. Otherwise it returns an explicit `simulated` result. When enabled it posts a Slack message or appends a Sheets row. The reply draft is excluded from both.

### `src/store.js`

- `openStore` creates `agent.sqlite` under `DATA_DIR` with users, workspaces, settings and workspace-scoped requests. It migrates older single-account data to a dedicated owner workspace. It stores a persistent session signing secret and a unique idempotency key per workspace. Each complete request, including events, is stored as JSON. SQLite handles persistence without another process.
- On startup, interrupted `processing` runs become failed and interrupted `sending` results become uncertain, so the UI does not incorrectly claim success or duplicate a side effect.
- `list`, `get`, `byKey` and `insert` require the authenticated account and workspace, so one workspace cannot read another workspace’s requests; requesters only see their own submissions. `save` writes a request after the server has loaded it within that scope. For a larger service, these could become normalized tables and a durable job queue.

### `public/app.js`

- `api` is the single fetch wrapper. It sends browser cookies and turns JSON errors into messages. A 401 returns the user to sign-in.
- `load` fetches config and requests, then `render` updates counts and the current screen.
- `setView` shows exactly one screen and updates the heading. Overview shows review work, Requests shows the searchable inbox, Activity shows events, and owner-only Connections saves credentials and creates a webhook token.
- `showDetail` creates a request view from DOM nodes: redacted original request, analysis, draft, delivery results, execution trace and the approve/retry action.
- Form listeners create accounts, sign in, sign out, submit new requests and refresh the workspace. Approval is deliberately a separate click from classification.

## Why these choices?

- **Built-in Node HTTP and SQLite:** They keep this small service easy to run and keep routing and state transitions explicit. The modules remain separated so routing or storage can be changed independently.
- **n8n as the orchestrator, server as the source of truth:** n8n handles an external webhook; the Node API validates, stores, classifies and tracks the request. This avoids storing the main business state inside n8n execution history.
- **Human approval:** AI classification can be wrong. A reviewer checks the result before external side effects.
- **Separate cookie and machine token:** Users sign in on the dashboard; n8n uses a token scoped to one workspace with no approval permission. Neither credential is committed.
- **Idempotency and cautious retries:** Repeated webhook events should not create duplicate requests. Remote writes with uncertain outcomes are held for verification rather than sent twice.
- **Preview labels:** If a destination is not configured, the UI records a preview result instead of a sent result.

