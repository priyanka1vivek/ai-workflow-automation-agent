# Validation

Run `npm test` for input validation and redaction, structured output checks, HTTP retry behavior, account registration, signed sessions and account isolation, origin checks, idempotent intake, approval gating, partial delivery recovery and uncertain delivery handling. Run `npm run check` for JavaScript syntax.

The tests stub external services. To validate a configured environment, sign in, submit a request, inspect the OpenAI classification, approve it, and confirm the resulting Slack message and Google Sheets row. For n8n intake, post JSON to its activated authenticated webhook and confirm that the resulting request appears in the dashboard and activity log.
