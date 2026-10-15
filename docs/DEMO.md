# Demo and interview guide

## Three-minute demonstration

1. Open the dashboard and point out the explicit demo/live badge.
2. Load the three synthetic samples. Show technical, billing and general routing, plus urgency and the review queue.
3. Open the dashboard access request. Explain the original redacted input, structured analysis, reason and suggested reply.
4. Approve it. In demo mode, point out that both destinations say **simulated** and no real delivery was made. With credentials configured, verify the actual Slack message and Google Sheets row.
5. Show the execution log, filter completed requests and refresh to demonstrate persistence.
6. For the n8n demonstration, send a synthetic webhook request and show the node execution and the new review-ready request in the UI.

## Explain the project

“I built a support-triage automation agent that turns unstructured requests into validated classifications, priorities and summaries. n8n orchestrates webhook intake and classification. A Node backend persists the runs, maps categories to teams and integrates with Slack and Google Sheets. The dashboard lets a person inspect the reasoning and approve delivery. I added idempotency, bounded retries and execution logs because automation needs to handle repeated events and partial failures, not just the happy path.”

## Questions you should be able to answer

| Question | Answer |
|---|---|
| Where is AI used? | In live mode, OpenAI produces category, priority, summary, reason, suggested reply and a review flag using a strict schema. The server validates that output. |
| Is the default demo AI? | No. It uses deterministic keyword rules and labels them honestly. |
| Why n8n? | It makes webhook orchestration and execution history visible while the backend remains responsible for durable state and integration logic. |
| What is routing? | A validated category maps to technical support, billing operations or customer support. One configured Slack channel receives the labelled summary. |
| Why human approval? | Classification can be wrong. Approval gives a person control before external side effects and keeps generated replies as drafts. |
| What happens if Slack works but Sheets fails? | The run is partial; a retry skips the completed Slack destination and retries Sheets. |
| What if the network disconnects during a send? | The outcome is uncertain. The app holds it for destination verification instead of claiming exactly-once delivery. |
| How are duplicate webhook events handled? | Clients provide an Idempotency-Key. SQLite stores its unique association; conflicting reuse is rejected. |
| How are secrets protected? | Credentials live only in server environment variables; frontend configuration exposes booleans, not keys. |
| How do you handle prompt injection? | Request text is marked untrusted data; structured output is validated; the model cannot execute tools or approve delivery. This reduces risk but does not make injection impossible. |
| Can you use patient data? | This demo is not designed for patient records. Basic redaction is incomplete and is not a compliance guarantee. |
| What would you improve? | Individual login/roles, a durable job queue, pagination, provider-specific idempotency, stronger data controls and measured classification evaluation. |

## Resume wording after verification

After live OpenAI, n8n, Slack and Sheets runs have actually been verified:

“Built a support-triage automation agent with an n8n webhook workflow, OpenAI structured classification and a dashboard for human review; integrated Slack and Google Sheets with bounded retries, request deduplication and persistent execution logs.”

Until then, describe live integrations as implemented/configurable, not verified or deployed. Do not claim measured savings or accuracy without collecting evidence.
