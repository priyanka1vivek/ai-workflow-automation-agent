# Local and integration setup

## 1. Local owner and OpenAI

Install Node.js 24+. Clone the repository and open it in VS Code. In PowerShell:

```powershell
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste the generated secret as `SESSION_SECRET` in `.env`. Set your `OWNER_EMAIL` and a unique `OWNER_PASSWORD` of at least 12 characters. Set `OPENAI_API_KEY` to use real LLM classification. Keep `HOST=127.0.0.1` for local use. Then run `npm run dev`, open `http://127.0.0.1:3000`, and sign in. No `npm install` is needed. The app starts without an OpenAI key to show connection status, but it cannot analyze requests until the key is added and the server restarted.

The password and API credentials remain in `.env` on the server. `.env` and `data/` are excluded from Git. This is a single-owner workspace, not a multi-user SaaS login. Do not put patient or sensitive real-world data into the project; its basic redaction is not comprehensive.

## 2. n8n webhook

Generate a second random value for `APP_TOKEN` (24+ characters) and restart FlowDesk. Import `n8n/triage-workflow.json` in n8n. Configure its Webhook node with a header authentication credential for incoming callers. Configure both HTTP Request nodes with the HTTP Header Auth credential `Authorization: Bearer <APP_TOKEN>`. The JSON body should contain `title` and `message`. Publish the workflow and POST to the n8n webhook test or production URL. The n8n workflow stores a queued request through the REST API, asks FlowDesk to classify it, and returns the result. You still approve delivery in the dashboard.

When using Docker Compose, the preconfigured internal URL `http://flowdesk:3000` works. If you run n8n separately, change the two HTTP Request URLs to the address n8n can reach. `127.0.0.1` inside one container does not refer to another container.

## 3. Slack and Google Sheets

Set `SLACK_WEBHOOK_URL` to an incoming webhook for your chosen channel. Create a Google service account, share a Google Sheet with its email, and set `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (PEM, with literal `\n` accepted), `GOOGLE_SHEET_ID`, and optionally `GOOGLE_SHEET_TAB`. Give the sheet a tab named `Requests` if you keep the default.

Set `LIVE_DELIVERY=true` and restart. Classify a synthetic request, review it, approve, and verify the Slack post and Sheet row. If a destination is unconfigured or delivery is off, the result says **preview only**. A successful classification alone does not send anything.

## 4. Optional Docker Compose

Install Docker Desktop, set `APP_TOKEN` in `.env`, then run `docker compose up --build`. Compose starts FlowDesk on `127.0.0.1:3000` and n8n on `127.0.0.1:5678`. It persists FlowDesk SQLite and n8n data in named volumes. Docker is for repeatable two-service setup; `npm run dev` is sufficient if you are using only the app.

## Verify

Run `npm test` and `npm run check`. For the full live path, sign in, classify a request with OpenAI, review the summary, approve delivery, and confirm the external destinations. The automated tests use stubs for external services, so passing tests do not prove your API credentials or n8n instance are configured.
