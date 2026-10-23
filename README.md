# FlowDesk — AI Workflow Automation Agent

FlowDesk is a support operations workspace. A user creates an account, signs in, submits or receives a request, reviews an OpenAI classification and summary, then approves its route to Slack and Google Sheets. Each stage is recorded with its outcome and retries.

## What it does

- **Private accounts:** Users create accounts in the browser. Password hashes and a persistent session signing secret are stored in SQLite. Each account sees only its own requests; n8n uses a separate machine token tied to a registered account.
- **Request intake:** Submit requests from the dashboard or an authenticated n8n webhook. Inputs are validated, basic identifiers are redacted, and an idempotency key prevents duplicate intake.
- **AI triage:** OpenAI returns a validated category, priority, summary, routing reason and draft response. If classification fails, the request stays visible with an error and can be retried.
- **Human review:** The signed-in user inspects the analysis before approving. The draft reply is never sent to a customer automatically.
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

Requires Node.js 24 or newer. Start the app, open [http://127.0.0.1:3000](http://127.0.0.1:3000), and choose **Create an account**. No preset email or password is needed.

```powershell
npm run dev
```

For OpenAI classification, create a local `.env` from `.env.example`, fill `OPENAI_API_KEY`, and restart the app. `.env` and `data/` are ignored by Git. See [the setup guide](docs/SETUP.md) for n8n, Slack, Sheets and Docker instructions.

## Explore the code

- [Architecture and code walkthrough](docs/CODE_WALKTHROUGH.md) explains the request lifecycle and the purpose of each module and main function.
- [API reference](docs/API.md) documents endpoints, authentication and states.
- [Validation guide](docs/VALIDATION.md) describes the tests and what needs live credentials to verify.

Run `npm test` and `npm run check` to verify the local implementation.
