# AI Workflow Automation Agent

**FlowDesk** turns incoming support requests into structured summaries, priorities and routing decisions, then delivers reviewed results to Slack and Google Sheets. It includes a responsive dashboard, an authenticated webhook API, durable execution history and an importable n8n workflow.

## What works

- Create and search requests in a responsive dashboard; inspect the original redacted text, classification, suggested reply and execution trace.
- Classify technical, billing and general requests with OpenAI structured outputs in live mode.
- Start without any credentials using a clearly labelled deterministic demo mode. Demo rules are **not an LLM**.
- Route to a team and require human approval before external delivery. Suggested replies remain drafts and are never sent.
- Send approved summaries to Slack incoming webhooks and append reviewed records to Google Sheets using a service account.
- Persist requests and events in SQLite, including after a restart.
- Handle transient API failures with bounded backoff; reject malformed model output; report integration failures independently.
- Deduplicate incoming events using `Idempotency-Key` and prevent concurrent runs of the same request.
- Import the n8n workflow for authenticated webhook ingestion, persistence, classification and a JSON response.

## Run in 2 minutes

Install **Node.js 24 or newer** from [nodejs.org](https://nodejs.org/). This project has no npm dependencies.

```bash
git clone <your-repository-url>
cd ai-workflow-automation-agent
cp .env.example .env
npm start
```

On Windows PowerShell, replace the copy command with:

```powershell
Copy-Item .env.example .env
```

Open **http://127.0.0.1:3000**. Click **Try sample requests**, open a request and choose **Approve & deliver**. In the default configuration, the delivery trace says **simulated** and no external messages or Sheet rows are sent. Repeated sample loading does not create duplicates.

The default host is loopback. For remote deployment, set a long `APP_TOKEN`, use HTTPS and persistent disk; the server refuses non-loopback hosting without a token of at least 24 characters. The browser asks for the token and holds it in tab-scoped session storage.

## Enable live AI

Edit `.env` and restart:

```dotenv
AI_MODE=live
OPENAI_API_KEY=<your-key>
OPENAI_MODEL=gpt-4o-mini
```

API billing is separate from ChatGPT subscriptions. The model must support Chat Completions structured JSON-schema output. Provider errors appear as failed runs; there is no hidden fallback to demo rules. The system prompt is in `src/agent.js`.

## Slack

1. Create a Slack app, enable Incoming Webhooks and select the intended channel.
2. Set `SLACK_WEBHOOK_URL` in `.env`.
3. Set `LIVE_DELIVERY=true` and restart.
4. Submit a synthetic request, review it, then approve delivery in the dashboard.

The configured Slack webhook determines the actual channel. Category routing is included in the message; this version does not select different Slack channels per category.

## Google Sheets

1. Enable the Google Sheets API in a Google Cloud project.
2. Create a service account and JSON key **outside this repository**.
3. Create a Sheet with a tab named `Requests`; share it with the service account email as an editor.
4. Set the following environment variables:

```dotenv
GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account-email>
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=<id-from-sheet-url>
GOOGLE_SHEET_TAB=Requests
LIVE_DELIVERY=true
```

5. Add this header row to A1:I1:

```text
request_id | created_at | title | category | priority | summary | route | provider | approval
```

The backend exchanges a signed service-account JWT for a token, then calls the Sheets append API with `valueInputOption=RAW`. Credentials never enter frontend configuration responses.

## n8n orchestration

Optional: the dashboard works independently. For the n8n-based resume demonstration, complete this setup and verify a real run.

1. Set a random `APP_TOKEN` of at least 24 characters in `.env`.
2. Run `docker compose up --build -d`. The app is on port 3000; n8n is on port 5678. Data persists in named volumes.
3. Complete local n8n account setup, then import `n8n/triage-workflow.json`.
4. Configure the Webhook node's Header Auth credential with header name `X-Webhook-Token` and a separate random secret.
5. Configure **both HTTP Request nodes** with a Header Auth credential: header name `Authorization`, value `Bearer <APP_TOKEN>`.
6. The export uses `http://flowdesk:3000` inside Docker. If n8n runs elsewhere, edit both HTTP node URLs to your reachable app address. Do not use `localhost` to reach the host from a container.
7. Publish/activate the workflow and use the production URL displayed by n8n. During manual tests use the test URL and listen for the test event.
8. Send synthetic input:

```bash
curl -X POST http://127.0.0.1:5678/webhook/flowdesk-triage \
  -H 'Content-Type: application/json' \
  -H 'X-Webhook-Token: <your-webhook-secret>' \
  -H 'Idempotency-Key: sample-event-001' \
  -d '{"title":"Dashboard error","message":"The dashboard shows an error for the support team."}'
```

The request appears in FlowDesk ready for review. **Approve & deliver** in the dashboard invokes the adapters and records results. n8n orchestrates intake and classification; the Node backend owns validation, persistence, routing, approval and delivery. The workflow intentionally does not approve requests automatically. A failed classification returns a failed result with HTTP 422; validation/auth failures stop the HTTP node and appear in n8n's execution history.

The Docker configuration is for localhost development, including HTTP cookies. Use TLS, secure cookies and pinned image digests when deploying n8n publicly.

## Architecture

```mermaid
flowchart TD
    UI[Dashboard] --> API[Node API]
    Hook[Authenticated n8n webhook] --> Intake[Store and classify nodes]
    Intake --> API
    API --> DB[(SQLite requests and events)]
    API --> AI[OpenAI structured analysis]
    API --> Review[Human review]
    Review --> Delivery[Delivery adapters]
    Delivery --> Slack[Slack]
    Delivery --> Sheets[Google Sheets]
```

See [API reference](docs/API.md) and [demo and interview guide](docs/DEMO.md).

## Verification

```bash
npm run check
npm test
```

Backend tests cover input validation, identifier redaction, schema validation, transient retries, authorization, approval gating, idempotency conflicts, concurrent runs, partial failure and uncertain delivery handling. GitHub Actions runs these checks on pushes and pull requests.

The live OpenAI/Slack/Sheets adapters require user-owned credentials and must be verified in your environment. The workflow JSON is provided for import; a real n8n execution must be verified after credentials are configured. No accuracy, time-savings or delivery metrics are fabricated.

## Limitations and responsible use

- This is a support automation portfolio project, not a clinical decision system. Use synthetic data, not patient records.
- Basic email/number/token redaction is not comprehensive de-identification. Names, addresses and other identifiers can remain.
- One workspace token controls the whole app. There are no individual accounts, roles or tenant isolation.
- SQLite is designed here for a single app process with persistent disk. It is unsuitable for ephemeral serverless Vercel functions without redesign. Deploy on a VM or container host with durable storage.
- Bounded retries apply to explicit 429/5xx responses. Network failures during non-idempotent delivery are marked **uncertain** and not automatically resent. Provider failures can still produce duplicate side effects; exactly-once delivery is not guaranteed.
- The suggested reply is a draft. Human approval controls summaries sent to configured destinations; classification flags do not replace review.
- Request listing is not paginated. This version is for a small demonstration workspace.
- Do not commit `.env`, private keys, runtime databases or service-account JSON.

## Publish to GitHub

Create an empty repository named `ai-workflow-automation-agent`, then run from this directory:

```bash
git init
git add .
git commit -m "Build FlowDesk AI workflow automation agent"
git branch -M main
git remote add origin https://github.com/priyanka1vivek/ai-workflow-automation-agent.git
git push -u origin main
```

Alternatively, with GitHub CLI installed and authenticated:

```bash
gh repo create ai-workflow-automation-agent --private --source=. --remote=origin --push
```

The CLI command assumes the local commit already exists. Choose public visibility only if you want the source accessible publicly.

## Official API references

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)
- [Slack incoming webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks)
- [Google Sheets append API](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append)
- [n8n Webhook node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)
- [n8n HTTP Request node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/)
