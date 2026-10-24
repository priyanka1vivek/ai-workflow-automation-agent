# FlowDesk API

A user creates an account at `POST /api/auth/register`, then signs in at `POST /api/auth/login`. Passwords are stored as salted scrypt hashes. The browser receives a signed, HttpOnly, SameSite cookie valid for 12 hours. `GET /api/auth/me` confirms the session; `POST /api/auth/logout` clears it. Request and config endpoints accept that cookie and scope data to the signed-in workspace and role. Owners see all workspace requests and can review; requesters see their own requests and cannot approve. An owner generates a scoped webhook bearer token from Connections; n8n uses it for intake and classification only.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/healthz` | Public readiness response; no workspace data |
| POST | `/api/auth/register` | Create a workspace owner or join using `inviteCode`, then start a session |
| POST | `/api/auth/login` | Sign in |
| GET | `/api/auth/me` | Return email, role and workspace |
| GET | `/api/workspace` | Owner: name, invite code and token status |
| POST | `/api/workspace/token` | Owner: rotate and reveal a webhook token once |
| POST | `/api/connections` | Owner: set credentials or live-delivery switch; never return secrets |
| POST | `/api/auth/logout` | Clear the browser session |
| GET | `/api/config` | AI model and boolean integration status; no credentials |
| GET | `/api/requests` | List persisted requests, newest first |
| GET | `/api/requests/:id` | Get one request, its analysis, deliveries and events |
| POST | `/api/requests` | Create and classify a request, or queue it if no AI key is configured |
| POST | `/api/webhook` | Create and classify an externally received request |
| POST | `/api/requests/:id/classify` | Owner or scoped webhook: classify a queued or failed request |
| POST | `/api/requests/:id/edit` | Owner only: correct category, priority, summary, reason, draft reply and review flag before approval; route is recomputed |
| POST | `/api/requests/:id/reject` | Owner only: reject an undelivered request with a reason |
| POST | `/api/requests/:id/approve` | Owner only: approve and deliver a classified request |

A request body:

```json
{ "title": "Dashboard access blocked", "message": "Our support team cannot sign in to the dashboard.", "source": "dashboard", "autoProcess": true }
```

`source` is `dashboard`, `webhook` or `n8n`. `autoProcess:false` stores a queued request for the n8n classify step. `/api/webhook` marks the source as `webhook`. Supply an `Idempotency-Key` header for repeated events: matching content returns the original request, conflicting content returns 409. Request JSON is capped at 20 KB and message text at 5,000 characters.

The states are `queued → processing → review → delivering → completed`; classification failure becomes `failed`, and destination failure or uncertainty becomes `partial`. Before approval, the owner can edit a request in `review` or reject a request in `queued`, `review` or `failed`. A rejected request is terminal and never delivered. Owner corrections are logged and category changes recompute the team route. Approval requires a stored analysis and is never automatic. Repeated approval skips already sent or previewed destinations; uncertain delivery is held for manual verification. An owner’s approval sends the summary only, never the suggested reply.

Errors: 400 invalid input; 401 missing or expired session/token; 403 cross-origin request; 404 missing resource; 409 concurrency or idempotency conflict; 413 oversized body; 415 non-JSON input; 429 rate limit. Responses use JSON with `{ "error": "..." }` on failure.
