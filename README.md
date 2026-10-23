# FlowDesk — AI Workflow Automation Agent

FlowDesk is a support operations workspace. An owner signs in, submits or receives a request, reviews an OpenAI classification and summary, then approves its route to Slack and Google Sheets. Each stage is recorded with its outcome and retries.

![FlowDesk workflow](https://img.shields.io/badge/workflow-webhook%20%E2%86%92%20AI%20%E2%86%92%20review%20%E2%86%92%20delivery-167552)

## What it does

- **Private workspace:** A single owner signs in with credentials configured on the server. The browser receives a time-limited, signed, HttpOnly session cookie. n8n uses a separate machine token.
- **Request intake:** Submit requests from the dashboard or an authenticated n8n webhook. Inputs are validated, basic identifiers are redacted, and an idempotency key prevents duplicate intake.
- **AI triage:** OpenAI returns a validated category, priority, summary, routing reason and draft response. A missing or failed AI service leaves a visible failed request; no rule-based classification is presented as an AI result.
- **Human review:** The owner inspects the analysis before approving. The draft reply is never sent to a customer automatically.
- **Delivery:** Approved summaries can go to Slack and Google Sheets. When credentials or live delivery are off, each destination is explicitly marked as a preview.
- **Execution history:** SQLite stores requests, workflow stages, retry attempts and destination results. A partial run retries only failed destinations; uncertain outcomes require manual verification.

The interface has distinct **Overview**, **Requests**, **Activity**, and **Connections** screens. Overview highlights work awaiting review; Requests is the searchable inbox; Activity is the event log; Connections explains the configured integrations and n8n intake.

## Stack and architecture

| Part | Implementation |
| --- | --- |
| Frontend | Responsive HTML, CSS and browser JavaScript |
| Server and API | Node.js built-in HTTP server and REST endpoints |
| Storage | Node.js built-in SQLite, persisted under `data/` |
| AI | OpenAI Chat Completions structured JSON output |
| Workflow | Importable n8n webhook and HTTP workflow |
| Destinations | Slack incoming webhook and Google Sheets API |

The server has no external npm dependencies. Docker Compose is optional: it starts FlowDesk and n8n together, keeps their data in volumes, and gives the n8n workflow a stable `http://flowdesk:3000` address. Running FlowDesk directly with Node is enough for the dashboard.

## Run locally

Requires Node.js 24 or newer. Create a local `.env` from the example, set `OWNER_EMAIL`, `OWNER_PASSWORD` (12+ characters), `SESSION_SECRET` (32+ random characters), and `OPENAI_API_KEY`, then start:

```powershell
Copy-Item .env.example .env
npm run dev
```

Generate a suitable secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Open [http://127.0.0.1:3000](http://127.0.0.1:3000) and sign in. `.env` and `data/` are ignored by Git. See [the setup guide](docs/SETUP.md) for n8n, Slack, Sheets and Docker instructions.

## Explore the code

- [Architecture and code walkthrough](docs/CODE_WALKTHROUGH.md) explains the request lifecycle and the purpose of each module and main function.
- [API reference](docs/API.md) documents endpoints, authentication and states.
- [Validation guide](docs/VALIDATION.md) describes the tests and what needs live credentials to verify.

Run `npm test` and `npm run check` to verify the local implementation.
