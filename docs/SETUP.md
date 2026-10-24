# Set up and run FlowDesk in VS Code

These steps use PowerShell on Windows. Replace example names and addresses with yours. Use synthetic support requests; the basic identifier redaction is not a clinical privacy system.

## 1. Run the application

1. Install Node.js 24 or newer and Git. Open VS Code, choose **File → Open Folder**, and select `ai-workflow-automation-agent`.
2. Open **Terminal → New Terminal** in VS Code. Run `node --version` and `git status` to confirm you are in the repository.
3. Run `git pull origin main` and `npm run dev`. There are no npm package dependencies to install.
4. Open `http://127.0.0.1:3000`. Choose **Create an account**. Enter your email and a password of at least 12 characters; leave the invite code empty. You are the **owner/reviewer**.
5. Open **Connections**. Copy the workspace invite code. Open a private browser window, choose **Create an account**, register a different email, and enter the invite code. This is the **requester**. The requester submits; the owner reviews. To switch between accounts in one browser, sign out first.
6. The server stores accounts and requests in `data/agent.sqlite` and generates its own signing secret. You do not need to create `.env`. The database and optional `.env` are ignored by Git. Keep backups of the database private because it also stores connection credentials and the encryption key.

If port 3000 is occupied, stop the other process or set `PORT=3001` in a local `.env` and restart. To stop the watch server, press Ctrl+C.

## 2. Connect OpenAI

1. Sign in as the workspace owner. Visit `https://platform.openai.com/api-keys` in another tab and sign in to the OpenAI API platform. A ChatGPT subscription alone does not supply API credits; make sure your API project has the required billing/usage access.
2. Select **Create new secret key**, create a key for this project, and copy it immediately. Do not post it in chat or commit it to the repository.
3. In FlowDesk, open **Connections → OpenAI**, paste the key into **API key**, and select **Save OpenAI key**. The field clears and the status changes to **Configured**. Saved keys are not displayed again; you can replace one by saving another.
4. In the requester browser window, select **Submit request**, enter a subject and a 10+ character description, and submit. Refresh the owner window. The new request should show **Needs review** with a category, priority, summary, route, and draft reply. If the AI connection was absent when it arrived, it stays **Queued**; the owner can open it and choose **Retry AI classification** after saving the key.

Classification calls the OpenAI API from the Node server; the browser never sends the key directly. The configured model defaults to `gpt-4o-mini` and can be changed with `OPENAI_MODEL` in local `.env` if needed. A provider error is recorded as **Failed** with a retry path; it does not produce a fake classification.

## 3. Connect Slack

1. In your Slack workspace, open `https://api.slack.com/apps` and select **Create New App → From scratch**. Name the app, pick the workspace, and create it.
2. In the app settings, open **Incoming Webhooks**, switch **Activate Incoming Webhooks** on, then select **Add New Webhook to Workspace**. Choose the channel for routed support summaries and select **Allow**.
3. Copy the generated `https://hooks.slack.com/services/...` URL. Treat this URL like a password.
4. In FlowDesk **Connections → Slack**, paste it in **Webhook URL** and select **Save Slack webhook**. The card changes to **Configured**. If your organization does not allow app creation or webhooks, ask its Slack admin; do not use a random URL.

## 4. Connect Google Sheets

1. Make a Google Sheet to receive approved requests. Rename its first tab **Requests**. Optionally put headers in row 1: `ID, Created, Title, Category, Priority, Summary, Route, Provider, Review`.
2. Copy the **spreadsheet ID** from its browser URL: the text between `/d/` and `/edit`.
3. Open `https://console.cloud.google.com/`, create or select a project, then go to **APIs & Services → Library**. Find **Google Sheets API** and select **Enable**.
4. In **IAM & Admin → Service Accounts**, choose **Create service account**. After creation, open that service account, go to **Keys → Add Key → Create new key → JSON**, and download the JSON file. Keep it private and out of GitHub.
5. Open the JSON file locally and copy its full contents. Its `client_email` is the service account email. Back in your Sheet, select **Share**, add that email as an **Editor**, and send/share. The service account must have permission to append rows.
6. In FlowDesk **Connections → Google Sheets**, paste the entire JSON into **Service account JSON**, paste the spreadsheet ID into **Sheet ID**, leave **Tab name** as `Requests` or enter your actual tab name, and select **Save Sheets connection**. The card changes to **Configured** when all required values are present.

## 5. Enable real delivery

1. As owner, confirm both Slack and Google Sheets cards show **Configured**. In **Connections → Send real deliveries**, check **Enable real delivery after approval** and select **Save delivery setting**.
2. Open a request showing **Needs review**. Read its summary, category, priority, reason, and suggested draft. If needed, select **Edit analysis** to correct those fields before approval, or **Reject request** with a reason to stop it. Otherwise select **Approve & deliver**.
3. In the request detail, inspect **Delivery results**. Confirm the message in your Slack channel and a new row in the Sheet. The draft reply is never sent as a customer message.
4. If real delivery is off or a destination is unconfigured, its result explicitly says **Preview only**. A failed destination can be retried without resending a previously successful destination. An uncertain network outcome is held for manual verification to avoid duplicates.

## 6. Run n8n and connect webhook intake

Docker Desktop is the simplest way to run both services with the included configuration. Stop a standalone `npm run dev` server first so port 3000 is free. In VS Code's terminal, run `docker compose up --build`. Then open FlowDesk at `http://127.0.0.1:3000` and n8n at `http://127.0.0.1:5678`. The Compose volumes persist the FlowDesk database and n8n data separately from a direct Node run. Create/sign in to the FlowDesk owner account in this Docker data volume and configure its connections there; settings from the standalone `data/` folder are not copied into Docker automatically.

1. In FlowDesk **Connections → n8n webhook token**, select **Generate / rotate token**. Copy the 64-character token now; it is displayed only once. Rotating it invalidates the old token. Do not confuse this with the separate password protecting the public n8n webhook.
2. In n8n, create/sign in to its local n8n account. Choose **Add workflow → Import from file** (or the workflow menu's **Import from File**) and select `n8n/triage-workflow.json` from this repository.
3. Open **Receive request** (Webhook node). Set up its **Header Auth** credential: header name `X-Webhook-Token`, value a separate random secret of your choice. This protects the incoming n8n URL; callers must send it. Save the credential.
4. Open **Validate and store** (HTTP Request node). Under **Authentication → Generic Credential Type → Header Auth**, create a credential with name `Authorization` and value `Bearer <FlowDesk token>`, replacing the angle-bracket example with the token copied in step 1. Save. Assign the same credential to **Classify summarize and route**.
5. The supplied HTTP Request URLs use `http://flowdesk:3000`, which works when both services run in this Compose network. If n8n runs outside Compose, change both node URLs to an address it can reach; `127.0.0.1` inside a container is not the host or another container.
6. Open the Webhook node, select **Listen for test event**, and copy its **Test URL**. In a separate PowerShell terminal, replace the URL and secret below and run:

```powershell
$webhookUrl = 'http://127.0.0.1:5678/webhook-test/flowdesk-triage'
$webhookSecret = 'your-separate-incoming-webhook-secret'
$body = @{ title = 'Dashboard login failure'; message = 'Our team cannot sign in to the dashboard this morning.' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $webhookUrl -Headers @{ 'X-Webhook-Token' = $webhookSecret } -ContentType 'application/json' -Body $body
```

7. The webhook response should contain a request with AI analysis and status **review**. Refresh the FlowDesk owner dashboard; the request appears in **Requests** and **Needs your review**. Approve it to verify Slack and Sheets. In n8n, inspect the execution to see the webhook, persist, classify, and response nodes.
8. When the test succeeds, **Publish/activate** the n8n workflow. Use its **Production URL** (`/webhook/flowdesk-triage`) with the same `X-Webhook-Token` header for future requests. A local URL accepts calls only from your computer or network; an external sender needs a properly hosted, reachable n8n instance.

The n8n webhook is the external trigger in the resume claim. It receives JSON, makes authenticated REST calls to FlowDesk, and receives the AI classification. Human review gates Slack/Sheets delivery. The requester UI provides an additional, easy-to-explain intake path.

### Submit from a separate external form

This repository includes a small local form as an example of an upstream source. It is separate from the signed-in FlowDesk requester screen. Its server sends the webhook request; the browser never receives the incoming n8n secret.

1. Keep FlowDesk (`3000`) and your **published** n8n workflow (`5678`) running. The n8n **Receive request** node must still use its `X-Webhook-Token` Header Auth credential.
2. Add these lines to your local `.env` in the repository root. Put **the incoming secret you set on the n8n Webhook node** in `N8N_WEBHOOK_SECRET`, not the FlowDesk bearer token:

```dotenv
N8N_WEBHOOK_URL=http://127.0.0.1:5678/webhook/flowdesk-triage
N8N_WEBHOOK_SECRET=your-incoming-n8n-header-secret
```

3. In another VS Code terminal run `npm run intake`. Open `http://127.0.0.1:3001`, enter a subject and details, and select **Send request**.
4. The form shows the returned request ID and status. Check the new execution in n8n, refresh the FlowDesk owner's Requests page, then approve the request to deliver to Slack and Sheets.

The form listens on your own computer by default. It is a working sample upstream sender, not a claim that a particular company's ticketing system is connected. You can still test the same webhook with another system or with the PowerShell command above.

## 7. Verify and push your own changes

In VS Code's terminal, run `npm run check` and `npm test`. The automated suite stubs external services; it proves app behavior but cannot prove your private keys or external accounts work. The full live test is steps 2–6 above.

After editing code, inspect `git status` and `git diff`, then run `git add .`, `git commit -m "Describe your change"`, and `git push origin main`. The repository ignores `data/` and `.env`; check `git status` before pushing so no downloaded service-account JSON or credentials are tracked.
