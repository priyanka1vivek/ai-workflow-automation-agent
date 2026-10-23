# Live walkthrough

1. Sign in as the owner. Overview shows decisions awaiting review, recent events and the four workflow stages.
2. Create a synthetic support request. OpenAI returns category, priority, summary, route, reason and a reply draft. A missing key or API failure produces a visible failed run.
3. Open the request in the Requests screen and explain that approval is a separate action. The draft reply is not delivered to customers.
4. Approve. If Slack and Sheets are configured and `LIVE_DELIVERY=true`, verify the message and row. Otherwise explain the clearly labelled preview results.
5. Open Activity to show receive, classify, route, approval, delivery and any retries. Connections shows configured status and how n8n enters the system.
6. For webhook intake, post a synthetic JSON request to the activated n8n webhook with its header credential, then refresh Requests and inspect its `n8n` source.

This is an implementation walkthrough. Do not claim measured manual-time savings, deployment, or successful external delivery without collecting that evidence.
