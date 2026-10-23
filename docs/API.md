# FlowDesk API

The dashboard signs in at `POST /api/auth/login` using the owner email and password and receives a signed, HttpOnly, SameSite cookie valid for 12 hours. `GET /api/auth/me` confirms the session; `POST /api/auth/logout` clears it. All request and config endpoints accept that cookie. n8n and external webhook clients use `Authorization: Bearer <APP_TOKEN>` instead. The machine token grants full workspace API access, so keep it private.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/healthz` | Public readiness response; no workspace data |
| POST | `/api/auth/login` | Create an owner session |
| GET | `/api/auth/me` | Return signed-in owner email |
| POST | `/api/auth/logout` | Clear the browser session |
| GET | `/api/config` | AI model and boolean integration status; no credentials |
| GET | `/api/requests` | List persisted requests, newest first |
| GET | `/api/requests/:id` | Get one request, its analysis, deliveries and events |
| POST | `/api/requests` | Create and classify a request |
| POST | `/api/webhook` | Create and classify an externally received request |
| POST | `/api/requests/:id/classify` | Retry classification of a queued or failed request |
| POST | `/api/requests/:id/approve` | Approve and deliver a classified request |

A request body:

```json
{ "title": "Dashboard access blocked", "message": "Our support team cannot sign in to the dashboard.", "source": "dashboard", "autoProcess": true }
```

`source` is `dashboard`, `webhook` or `n8n`. `autoProcess:false` stores a queued request for the n8n classify step. `/api/webhook` marks the source as `webhook`. Supply an `Idempotency-Key` header for repeated events: matching content returns the original request, conflicting content returns 409. Request JSON is capped at 20 KB and message text at 5,000 characters.

The states are `queued → processing → review → delivering → completed`; classification failure becomes `failed`, and destination failure or uncertainty becomes `partial`. Approval requires a stored analysis and is never automatic. Repeated approval skips already sent or previewed destinations; uncertain delivery is held for manual verification. A reviewer’s approval sends the summary only, never the suggested reply.

Errors: 400 invalid input; 401 missing or expired session/token; 403 cross-origin request; 404 missing resource; 409 concurrency or idempotency conflict; 413 oversized body; 415 non-JSON input; 429 rate limit. Responses use JSON with `{ "error": "..." }` on failure.
