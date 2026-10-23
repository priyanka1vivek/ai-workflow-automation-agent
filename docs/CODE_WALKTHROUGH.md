# Code walkthrough and design decisions

FlowDesk is deliberately a small Node application. Each module has one responsibility. The service is suitable for a single owner and low-volume support triage; it is not a multi-tenant ticketing platform.

## Request lifecycle

```text
Dashboard or n8n webhook
  → HTTP authentication and JSON validation
  → redacted request saved in SQLite
  → OpenAI structured classification
  → category maps to a support team
  → owner inspects analysis and approves
  → configured Slack / Sheets delivery
  → status and each event saved in SQLite
```

The frontend never calls OpenAI, Slack or Google directly. It calls same-origin REST endpoints. Credentials are stored only in the server environment. The n8n workflow is an integration client: it receives external events and calls FlowDesk's intake and classify endpoints with a separate machine token. SQLite is the source of truth for requests and execution history.

## Files and responsibilities

| File | What to explain |
| --- | --- |
| `public/index.html` | Semantic login form, application shell, separate screens, request/detail dialogs. It contains no secrets or business decisions. |
| `public/styles.css` | Responsive design, layout, status colors, form and focus states. Mobile navigation changes layout below 760 px. |
| `public/app.js` | Browser state and DOM rendering, sign-in, API calls, filtering, detail inspection, approval. Text is inserted with `textContent` to avoid interpreting request data as HTML. |
| `src/server.js` | HTTP routing, auth boundaries, input limits, lifecycle orchestration, persistence calls and static asset delivery. |
| `src/auth.js` | Owner credential comparison, signed 12-hour cookie creation and validation, logout cookie expiry. |
| `src/agent.js` | Input redaction and validation, AI schema and prompt, OpenAI request, bounded retry, Slack and Sheets adapters. |
| `src/store.js` | SQLite request table, idempotency lookup, load/save, recovery of interrupted processing. |
| `n8n/triage-workflow.json` | Authenticated webhook → persist queued request → classify through REST API → respond. The workflow does not auto-approve. |
| `test/agent.test.js` | Behavioral tests for auth, validation, retry, approval, idempotency and failures using external-service stubs. |
| `.env.example` | Server configuration template; the actual `.env` is ignored by Git. |
| `Dockerfile`, `docker-compose.yml` | Optional repeatable runtime for the app and n8n with durable volumes and stable internal networking. |

## Key functions in order

### `src/server.js`

- `envConfig` reads configuration once. Local hosting uses loopback by default; network hosting also requires a sufficiently long machine token.
- `createApp` validates owner credentials and session secret before listening. It constructs a SQLite store, in-memory per-request locks, rate-limit buckets and an HTTP server.
- `event` appends a timestamped stage result and saves the request. This is why Activity can show a trace instead of inferring state from a single status field.
- `analyze` locks a request, invokes the AI classifier and moves it into `review`. A provider error produces a persisted `failed` request with the error and an event, so a reviewer can retry.
- `dispatch` requires a stored analysis, records human approval, then delivers to Slack and Sheets one by one. Already `sent` or previewed destinations are skipped on another attempt. An uncertain send is held to avoid accidental duplicates.
- The HTTP callback serves health and static assets, checks origin and rate limits API requests, handles login/logout, and accepts either a signed browser cookie or the n8n machine token for protected endpoints. The request endpoints call the workflow functions above.

### `src/auth.js`

- `checkCredentials` derives comparable password bytes with `scryptSync` and uses a timing-safe comparison. The owner email must also match. The configured password is still a server secret and belongs only in `.env`.
- `createSession` encodes email, expiry and a nonce and signs the payload with HMAC-SHA256. `readSession` checks signature and expiry on each protected request.
- `sessionCookie` uses `HttpOnly` so browser JavaScript cannot read it, and `SameSite=Strict` to limit cross-site use. Login attempts are rate limited by IP in `server.js`. This is a single-owner local application, not an account-registration system.

### `src/agent.js`

- `validateInput` accepts only a bounded title/message and a known source. `redact` replaces common emails, phone-like numbers and token patterns before storage and AI analysis. It is intentionally basic, so the app should use synthetic or non-sensitive requests.
- `schema` and `validateAnalysis` constrain the LLM response to known categories/priorities and short text fields. The `routes` mapping turns category into a team name; the model cannot choose an arbitrary destination.
- `classify` calls OpenAI's structured JSON response API. A missing key or failed call raises an error. There is no rule-based result masquerading as a model output.
- `requestWithRetry` retries transient HTTP 429/5xx and, where safe, network errors with short bounded delays. Slack and Sheets writes do not blindly retry after an ambiguous network failure.
- `deliver` first checks whether live delivery and target credentials are enabled. Otherwise it returns an explicit `simulated` result. When enabled it posts a Slack message or appends a Sheets row. The reply draft is excluded from both.

### `src/store.js`

- `openStore` creates `agent.sqlite` under `DATA_DIR` and a requests table with a unique idempotency key. Each complete request, including events, is stored as JSON. SQLite handles persistence without another process.
- On startup, interrupted `processing` runs become failed and interrupted `sending` results become uncertain, so the UI does not incorrectly claim success or duplicate a side effect.
- `list`, `get`, `byKey`, `insert` and `save` are the only storage operations the server needs. For a larger service, these could become normalized tables and a durable job queue.

### `public/app.js`

- `api` is the single fetch wrapper. It sends browser cookies and turns JSON errors into messages. A 401 returns the user to sign-in.
- `load` fetches config and requests, then `render` updates counts and the current screen.
- `setView` shows exactly one screen and updates the heading. Overview shows review work, Requests shows the complete searchable inbox, Activity shows events, Connections shows service status and setup.
- `showDetail` creates a request view from DOM nodes: redacted original request, analysis, draft, delivery results, execution trace and the approve/retry action.
- Form listeners sign in, sign out, submit new requests and refresh the workspace. Approval is deliberately a separate click from classification.

## Why these choices?

- **Built-in Node HTTP and SQLite:** They keep this small service easy to run and keep routing and state transitions explicit. The modules remain separated so routing or storage can be changed independently.
- **n8n as the orchestrator, server as the source of truth:** n8n handles an external webhook; the Node API validates, stores, classifies and tracks the request. This avoids storing the main business state inside n8n execution history.
- **Human approval:** AI classification can be wrong. A reviewer checks the result before external side effects.
- **Separate cookie and machine token:** A person signs in on the dashboard; n8n uses a token suitable for HTTP nodes. Neither credential is committed.
- **Idempotency and cautious retries:** Repeated webhook events should not create duplicate requests. Remote writes with uncertain outcomes are held for verification rather than sent twice.
- **Preview labels:** If a destination is not configured, the UI records a preview result instead of a sent result.

