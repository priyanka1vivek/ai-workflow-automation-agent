# FlowDesk — AI Workflow Automation Agent

FlowDesk receives support requests through an n8n webhook or a signed-in requester, uses the OpenAI API to classify and summarize them, routes them to a support team, and records each step. A workspace owner reviews the AI result before approved summaries are delivered to Slack and Google Sheets.

## Workflow

1. An authenticated n8n webhook accepts JSON and calls the FlowDesk REST API; requesters can also submit from the browser.
2. FlowDesk validates and redacts common identifiers, persists the request, and asks OpenAI for a structured category, priority, summary, route, and reply draft.
3. The owner sees the routed request in the inbox, checks the analysis, and approves delivery. The reply draft is not sent to the requester.
4. Slack receives an approved summary and Google Sheets gains a row when those connections and real delivery are enabled. Each attempt, retry, error, and destination outcome appears in Activity.

This automates classification and routing; human approval is the checkpoint before external delivery. A request remains queued if OpenAI is not connected. Unconnected destinations are explicitly marked as previews.

## Interface

- **Requester:** Joins a workspace using its invite code, submits requests, and follows their own status.
- **Owner:** Creates a workspace, invites requesters, reviews its requests, manages connections, and approves delivery. Separate workspaces cannot see each other's data.
- **Overview:** Counts and a review queue. Empty states explain how to get the first request.
- **Requests:** Search, status filtering, analysis, delivery results, and a request-level trace.
- **Activity:** Timestamped intake, AI, routing, approval, retry, and delivery events.
- **Connections:** Configure OpenAI, Slack, Google Sheets, and an n8n machine token from the owner account. Credential values are not returned to the browser after saving.

## Stack

| Part | Implementation |
| --- | --- |
| UI | Responsive HTML, CSS, browser JavaScript |
| API and authentication | Node.js HTTP, signed HttpOnly cookies, scoped webhook token |
| Persistence | SQLite for users, workspaces, requests, events, and connection settings |
| AI | OpenAI structured JSON response and schema validation |
| Automation | Importable n8n webhook/HTTP Request workflow |
| Outputs | Slack incoming webhook and Google Sheets API |

Requires Node.js 24+. Run `npm run dev`, open `http://127.0.0.1:3000`, and create an account. The owner enters credentials under Connections; no preset account or `.env` is required for the dashboard. See [Setup](docs/SETUP.md) for exact service configuration and a full end-to-end test. Docker Compose can run the app and n8n together.

[Code walkthrough](docs/CODE_WALKTHROUGH.md) · [API reference](docs/API.md) · [Validation](docs/VALIDATION.md)

Run `npm test` and `npm run check` to verify the code. Live OpenAI, Slack, Sheets, and n8n calls require credentials from your own accounts.
