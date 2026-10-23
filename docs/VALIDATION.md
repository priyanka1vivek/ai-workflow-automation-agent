# Validation boundary

`npm test` exercises input validation and identifier redaction, structured output rejection, transient retry handling, owner session authentication, same-origin checks, request idempotency, persistence, approval gating, partial delivery retry behavior and uncertain outcomes. `npm run check` checks server, AI and browser JavaScript syntax.

External services are intentionally not contacted by the automated test suite. To verify the resume’s complete integration claims, run a real OpenAI request, post to an activated n8n webhook, approve in the dashboard, and observe Slack and Google Sheets delivery. Record the results before describing the workflow as deployed or measured. Classification failure stays visible and does not fall back to a fake AI result.
