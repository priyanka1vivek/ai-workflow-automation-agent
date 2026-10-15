# API reference

All `/api/*` endpoints require `Authorization: Bearer <APP_TOKEN>` when a token is configured. External hosting requires a token. Request JSON bodies are limited to 20 KB; messages to 5,000 characters. All calls are same-origin in the dashboard. There is a coarse in-memory limit of 180 API calls per minute per socket IP.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/healthz` | Public health check, no user data |
| GET | `/api/config` | AI mode and boolean integration status; no credentials |
| GET | `/api/requests` | List persisted requests, newest first |
| GET | `/api/requests/:id` | Get a request with analysis, deliveries and events |
| POST | `/api/requests` | Create and classify a request |
| POST | `/api/webhook` | Create and classify an externally received request |
| POST | `/api/requests/:id/classify` | Classify a queued or failed request; keep existing analysis |
| POST | `/api/requests/:id/approve` | Approve and deliver a classified request |

## Create

```json
{
  "title": "Dashboard error",
  "message": "The dashboard shows an error when the support team signs in.",
  "source": "dashboard",
  "autoProcess": true
}
```

`source` is `dashboard`, `webhook` or `n8n`. `autoProcess:false` leaves the request queued for a separate classify call. `/api/webhook` sets the source to `webhook`. Supply `Idempotency-Key` to reuse the same request for a repeated event. Reusing a key with different title/message content returns 409. A new request returns 201; an existing idempotent request returns 200.

## Approval

Only invoke approval after a person reviewed the request. Authentication grants approval capability; there is no separate role system. Approval sends a summary to configured Slack/Sheets destinations when `LIVE_DELIVERY=true`. Unconfigured destinations produce labelled simulations. It does **not** send the draft reply to a customer.

Delivery statuses are `sending`, `sent`, `simulated`, `failed` or `uncertain`. Repeated approval does not replay completed destinations. A failed destination may be retried; an uncertain destination is held for manual verification.

## Request states

`queued → processing → review → delivering → completed`

Classification failure produces `failed`. An unsuccessful or uncertain destination produces `partial`. Each state change and retry is recorded in the `events` array. Classification failure is returned as a persisted request with `status:"failed"`, not a successful AI analysis.

## Errors

400 invalid JSON/input; 401 missing/wrong token; 403 cross-origin access; 404 unknown request/endpoint; 409 concurrent run or state/idempotency conflict; 413 oversized body; 415 unsupported content type; 429 local rate limit.
