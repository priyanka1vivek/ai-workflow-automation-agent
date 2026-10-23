# Local and integration setup

## 1. Create an account and connect OpenAI

Install Node.js 24+, clone the repository, and run `npm run dev`. Open `http://127.0.0.1:3000`, choose **Create an account**, and register with your email and a password of at least 12 characters. Accounts and their requests are stored locally in `data/agent.sqlite`; each account sees its own requests. No account credentials or session secret go in `.env`.

To analyze requests, create `.env` from the example (`Copy-Item .env.example .env` in PowerShell), set `OPENAI_API_KEY`, and restart the server. The signed-in workspace opens without an API key and shows that AI setup is needed. `data/` and `.env` are excluded from Git. Use non-sensitive requests; basic redaction is not a comprehensive data protection system.

## 2. n8n webhook

Generate a random `APP_TOKEN` (24+ characters), set `WEBHOOK_OWNER_EMAIL` to an account that you have registered in the browser, and restart FlowDesk. Import `n8n/triage-workflow.json` in n8n. Configure its Webhook node with a header authentication credential for incoming callers. Configure both HTTP Request nodes with the HTTP Header Auth credential `Authorization: Bearer <APP_TOKEN>`. The JSON body should contain `title` and `message`. Publish the workflow and POST to the n8n webhook test or production URL. The n8n workflow stores a queued request through the REST API, asks FlowDesk to classify it, and returns the result. You still approve delivery in the dashboard.

When using Docker Compose, the preconfigured internal URL `http://flowdesk:3000` works. If you run n8n separately, change the two HTTP Request URLs to the address n8n can reach. `127.0.0.1` inside one container does not refer to another container.

## 3. Slack and Google Sheets

Set `SLACK_WEBHOOK_URL` to an incoming webhook for your chosen channel. Create a Google service account, share a Google Sheet with its email, and set `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (PEM, with literal `\n` accepted), `GOOGLE_SHEET_ID`, and optionally `GOOGLE_SHEET_TAB`. Give the sheet a tab named `Requests` if you keep the default.

Set `LIVE_DELIVERY=true` and restart. Classify a synthetic request, review it, approve, and verify the Slack post and Sheet row. If a destination is unconfigured or delivery is off, the result says **preview only**. A successful classification alone does not send anything.

## 4. Optional Docker Compose

Install Docker Desktop, set `APP_TOKEN` in `.env`, then run `docker compose up --build`. Compose starts FlowDesk on `127.0.0.1:3000` and n8n on `127.0.0.1:5678`. It persists FlowDesk SQLite and n8n data in named volumes. Docker is for repeatable two-service setup; `npm run dev` is sufficient if you are using only the app.

## Verify

Run `npm test` and `npm run check`. For the full live path, sign in, classify a request with OpenAI, review the summary, approve delivery, and confirm the external destinations. The automated tests use stubs for external services, so passing tests do not prove your API credentials or n8n instance are configured.
