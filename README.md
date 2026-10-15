# FlowDesk — AI Workflow Automation Agent

FlowDesk is a support request triage application. It receives requests through a web dashboard or webhook, classifies each request, assigns a priority and team, and prepares a concise summary and draft response. A reviewer can inspect the result before sending the summary to Slack and recording it in Google Sheets.

## Features

- **Request dashboard:** Submit requests, search and filter the inbox, review classifications, and follow each execution step.
- **AI-assisted triage:** In live mode, OpenAI returns a structured category, priority, summary, routing reason, draft reply, and human review flag.
- **Human approval:** External delivery begins only after a reviewer approves a classified request. Draft replies are shown for review and are not sent to customers.
- **Workflow automation:** An importable n8n workflow accepts authenticated webhooks, stores requests, runs classification, and returns the result.
- **Integrations:** Approved summaries can be posted to a configured Slack channel and appended to Google Sheets.
- **Execution history:** SQLite stores requests, classifications, delivery outcomes, and retry events. Idempotency keys prevent duplicate webhook submissions.

## How it works

1. A request arrives from the dashboard or the n8n webhook.
2. The server validates the input and stores it in SQLite.
3. OpenAI classifies and summarizes the request in live mode. The category maps to technical support, billing operations, or customer support.
4. A reviewer checks the analysis and approves delivery in the dashboard.
5. The application sends the approved summary to configured destinations and records the outcome of each step.

The default **demo mode** uses deterministic classification rules, so the dashboard can be explored without API credentials. When external delivery is disabled, Slack and Google Sheets results are clearly marked as previews.

## Tech stack

| Layer | Technology |
| --- | --- |
| Dashboard | HTML, CSS, JavaScript |
| API and persistence | Node.js, SQLite |
| AI classification | OpenAI structured outputs |
| Workflow | n8n webhooks and HTTP nodes |
| Destinations | Slack incoming webhooks, Google Sheets API |

## Run locally

Requires **Node.js 24 or newer**. No npm dependencies are required.

```bash
git clone https://github.com/priyanka1vivek/ai-workflow-automation-agent.git
cd ai-workflow-automation-agent
cp .env.example .env
npm start
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`. Open [http://127.0.0.1:3000](http://127.0.0.1:3000), then select **Try sample requests** to explore the dashboard.

To use live AI, set `AI_MODE=live` and `OPENAI_API_KEY` in `.env`. Slack and Google Sheets delivery can be enabled with their respective credentials and `LIVE_DELIVERY=true`. The n8n workflow is available at [`n8n/triage-workflow.json`](n8n/triage-workflow.json).

See [API documentation](docs/API.md) for endpoints and request states.
