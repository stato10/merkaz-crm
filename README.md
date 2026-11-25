# Merkaz — multi-tenant CRM for sales and service

A production-grade, Hebrew-first (RTL) CRM: contacts and companies, a sales pipeline with a weighted forecast, a service inbox with tickets and appointments, team roles, a public REST API with webhooks, and CSV import/export. Built as a multi-tenant SaaS where **Postgres itself enforces tenant isolation**.

> מערכת CRM בעברית למכירות ושירות: אנשי קשר, צנרת עסקאות, פניות ותורים, הרשאות לפי תפקיד, API ו-Webhooks.

![Sales pipeline](docs/screenshots/pipeline.png)

| Overview | Service inbox | API & webhooks |
| --- | --- | --- |
| ![Overview](docs/screenshots/overview.png) | ![Inbox](docs/screenshots/inbox.png) | ![Developers](docs/screenshots/developers.png) |

## Highlights

- **Multi-tenancy with row-level security.** Every API request runs inside a transaction that switches to a restricted Postgres role and pins `app.org_id`; RLS policies on every tenant table hide other organizations' rows *even if a query forgets its filter*. Integration tests prove it by running deliberately unscoped queries.
- **Role-based access control.** Owner, admin, sales and service roles, checked on the server next to every read and write (`requirePermission`), and mirrored onto API keys.
- **Public REST API** (`/api/v1`) — contacts, companies, deals, tickets — with hashed API keys, per-key rate limiting stored in Postgres (works across serverless instances), cursor pagination, consistent JSON errors with request IDs, and an [OpenAPI 3.1 spec](src/lib/api/openapi.ts).
- **Webhooks with a transactional outbox.** Every audited change can become an event; deliveries are HMAC-SHA256 signed (Stripe-style, replay-protected), retried with exponential backoff, claimed with `FOR UPDATE SKIP LOCKED` so concurrent workers never double-send, and guarded against SSRF.
- **Sales pipeline.** Drag-and-drop board with optimistic updates, stage probabilities and a weighted forecast; winning a deal promotes the contact to customer.
- **Service.** Ticket inbox with per-organization numbering, customer/agent/internal-note thread and priorities; appointments with overlap protection per assignee.
- **CSV import/export.** RFC 4180 parser shared by the browser preview and the server, Hebrew/English column auto-mapping, de-duplication by email and normalized phone (`+972` ≡ `0`), per-row error report, and formula-injection–safe export that opens correctly in Excel.
- **Audit log** of every change, which also feeds the webhook outbox.
- **Observability.** Structured JSON logs with request IDs, `onRequestError` instrumentation for all server errors, and a `/api/health` readiness probe.
- **Tested.** 44 unit + integration tests (Vitest, real Postgres) and Playwright end-to-end tests on desktop and mobile, all in CI.

## Architecture

```mermaid
flowchart LR
  subgraph Client
    UI["Next.js App Router<br/>Server Components + Server Actions<br/>Hebrew RTL UI"]
    EXT["External systems<br/>(API key)"]
  end

  subgraph Server["Next.js server (Node)"]
    SA["Server Actions<br/>getCtx() → requirePermission()"]
    API["/api/v1 route handlers<br/>auth · rate limit · RBAC"]
    AUD["writeAudit()<br/>audit log + outbox"]
    WH["Webhook worker<br/>SKIP LOCKED · backoff · HMAC"]
  end

  subgraph PG["PostgreSQL 17"]
    T[("Tenant tables<br/>RLS: org_id = app.org_id")]
    O[("audit_log<br/>webhook_deliveries")]
    RL[("rate_limits")]
  end

  UI --> SA --> T
  EXT --> API -->|"SET LOCAL ROLE crm_tenant<br/>set_config('app.org_id')"| T
  API --> RL
  SA --> AUD
  API --> AUD --> O
  O --> WH -->|"signed POST"| HOOK["Customer endpoint"]
  CRON["Scheduler<br/>/api/cron/webhooks"] --> WH
```

**Request path (API).** `apiRoute()` in [`src/lib/api/handler.ts`](src/lib/api/handler.ts) authenticates the key (SHA-256 lookup), applies the rate limit, checks the key's role, then runs the handler in [`withTenant()`](src/db/tenant.ts). Audit entries are queued and written after the transaction commits, so a webhook never announces a change that rolled back.

**Request path (app).** Pages and server actions call `getCtx()` / `requirePermission()` in [`src/lib/session.ts`](src/lib/session.ts); every query in [`src/lib/queries.ts`](src/lib/queries.ts) is scoped by organization.

### Engineering decisions

| Decision | Why |
| --- | --- |
| RLS via `SET LOCAL ROLE` inside a transaction | The app connection owns the tables (and so bypasses RLS); switching to a non-owner role per transaction makes the policies apply without a second connection pool. `set_config(..., true)` is transaction-local, so pooled connections can't leak a tenant. |
| Postgres for rate limits and the webhook queue | One less moving part than Redis/SQS at this scale, correct across serverless instances, and transactional with the data. The outbox claim uses `FOR UPDATE SKIP LOCKED` leases. |
| Keyset pagination | Stable under concurrent inserts and O(page size), unlike `OFFSET`. |
| Won/lost are deal outcomes, not stages | Keeps the board to open work and makes the forecast (`amount × stage probability`) honest. |
| Hash API keys with SHA-256 (no KDF) | Keys are 192-bit random tokens; a slow hash adds latency without adding security. Only a short prefix is kept for display. |
| Server Actions + `useOptimistic` | Mutations stay type-safe and colocated, with instant UI on drag-and-drop and a server-confirmed result. |

## Tech stack

Next.js 16 (App Router, Cache Components, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 · PostgreSQL 17 · Drizzle ORM · Better Auth (organizations & roles) · Zod · Vitest · Playwright · Docker · GitHub Actions

## Run it

**Docker (everything, with demo data):**

```bash
docker compose --profile app up --build
# http://localhost:3000 → "כניסה לחשבון ההדגמה"
```

**Local development:**

```bash
docker compose up -d db            # Postgres on :5433
cp .env.example .env.local         # set BETTER_AUTH_SECRET
npm install
npm run db:push                    # schema + RLS policies
npm run db:seed                    # optional demo organization
npm run dev                        # http://localhost:3000
```

## Tests

```bash
npm run test:unit          # pure logic: CSV, signatures, SSRF guard, permissions
npm run test:integration   # real Postgres (crm_test): API, RLS isolation, roles, rate limits, webhooks
npm run test:e2e           # Playwright: sign-up → contact → deal → won, board, API keys, CSV import
npm run check              # lint + types + unit + integration
```

Integration tests create their own database, push the schema and apply the RLS setup. Among other things they verify that one tenant can't read, update, delete or reference another tenant's records; that a raw unscoped query inside a tenant transaction only sees that tenant; that the rate limiter is atomic under 20 concurrent requests; and that three concurrent webhook workers deliver an event exactly once.

## API in 30 seconds

Create a key in **Settings → API & Webhooks**, then:

```bash
curl -X POST http://localhost:3000/api/v1/deals \
  -H "Authorization: Bearer crm_live_…" \
  -H "Content-Type: application/json" \
  -d '{"title":"Annual plan","amount":48000}'
```

Full spec: [`/api/v1/openapi.json`](src/lib/api/openapi.ts). Webhook payloads are signed with `X-CRM-Signature: t=<unix>,v1=<hmac>`; see [`verifyWebhook()`](src/lib/tokens.ts) for a reference verifier.

## Project layout

| Path | What's there |
| --- | --- |
| `src/db/schema.ts` | All tables: auth/orgs, CRM, service, sales, platform (keys, webhooks, rate limits) |
| `src/db/tenant.ts` | `withTenant()` — RLS-enforced transaction |
| `scripts/db-setup.ts` | Restricted role + RLS policies (idempotent) |
| `src/lib/permissions.ts` | Roles and permissions per resource |
| `src/lib/api/` | API handler, resources, DTOs, OpenAPI spec |
| `src/lib/webhooks.ts` | Outbox enqueue, signed delivery, retry worker |
| `src/lib/csv.ts` | CSV parser/writer and import column mapping |
| `src/app/(app)` | The product: overview, deals, tickets, appointments, contacts, companies, settings |
| `tests/` | `unit/`, `integration/` (Vitest) and `e2e/` (Playwright) |

## Roadmap

1. ✅ Foundation: auth, organizations, roles, contacts and companies
2. ✅ Service: ticket inbox and appointments
3. ✅ Sales: deals, pipeline board, weighted forecast
4. ✅ Platform: REST API, webhooks, RLS, CSV, tests, CI, Docker
5. AI agent (Claude) with tools over the CRM, human handoff, an MCP server and evals
6. Channels: email, website chat, WhatsApp
7. Dashboards and reports
8. Voice (LiveKit), billing, production hardening

The earlier Python pilot is kept in `pilot/` for reference.
