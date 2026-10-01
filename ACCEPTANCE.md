# ACCEPTANCE

Status as of 2026-10-01. Everything below was **actually executed** in the
development sandbox (Linux, Node 22, PostgreSQL 16, Chromium) against the local
Postgres + local Supabase-API emulator. Nothing here was run against a real
Supabase project, a real LLM, real push services or Cloudflare (see the last section).

## Executed checks

| Check | Command | Result |
|---|---|---|
| TypeScript strict (app + scripts) | `npm run typecheck` | ✅ 0 errors |
| TypeScript (Edge Functions) | `npx tsc -p tsconfig.functions.json --noEmit` | ✅ 0 errors |
| No tenant values in `src/` | `npm run lint:tenants` | ✅ 15 values × 63 files |
| Unit tests | `npm test` | ✅ 32 / 32 (4 files) |
| SQL suite | `npm run db:test` | ✅ 255 assertions, 6 files, fresh DB |
| Concurrency (real parallel sessions) | part of `db:test` | ✅ 6 scenarios |
| Integration (functions + pipeline) | `npm run test:integration` | ✅ 9 / 9 |
| Tenant files | `npm run tenant:validate -- demo-studio / demo-harbor` | ✅ both valid |
| Publish + verify | `tenant:publish` + `tenant:verify` (both demo tenants) | ✅ 0 errors, 0 warnings |
| Playwright E2E | `npm run e2e` | ✅ 5 / 5 (4 specs; isolation runs mobile + desktop) |
| Visual check | Playwright screenshots of client + cabinet screens (DE, mobile + desktop) | ✅ reviewed manually |

### SQL suite (`supabase/tests/sql`)

| File | Asserts | Covers |
|---|---|---|
| 01_availability_booking | 47 | public payload, multi-interval days, breaks, eligibility, specific/any barber, overlaps, vacation, barber block, shop-wide closure (also for barbers added later), multi-day blocks, special dates, timezones/DST |
| 02_reschedule_cancel_idempotency | 41 | same idempotency key → same booking and same token, token access, reschedule (same/any/other barber), failed reschedule keeps original, self-reschedule limit, cancel, per-service and tenant policies, minimum notice, staff override, validation |
| 03_security_roles | 64 | anon has zero table access, tokens bound to their shop, user without membership, tenant A vs owner B, owner/admin/barber inside a tenant, storage policies, exact function whitelist per role |
| 04_history_payments_stats | 41 | price/name snapshots immutable, barber deactivation keeps history, append-only payments, stats split upcoming/completed/cancelled/payments, local-midnight period boundaries, barber/service filters, client card, preview → live |
| 05_outbox_notifications_ai | 41 | outbox on create/reschedule/cancel, dedupe on retry, superseded reminders, preview never sends, lease + crash recovery, at-most-once delivery, gone subscriptions, LLM budget (tenant + global), AI scopes, public rate limits |
| 06_gdpr_legal | 21 | export, anonymization (blocked with upcoming bookings), retention job, Impressum required for go-live |

Concurrency (`supabase/tests/concurrency.sh`, sessions released together through an advisory-lock gate):
8 sessions same barber/slot → exactly 1 wins; different barbers same time → all win;
"any barber" race with 2 eligible barbers → exactly 2 win, no overlap; same
idempotency key ×5 → one booking; reschedule vs new booking on the same target → one wins,
loser keeps its state; shop-wide block vs booking → never both.

### Unit (`tests/unit`)

`time` (local ↔ UTC, DST), `webpush` (RFC 8291 aes128gcm payload decrypted by a
simulated user agent, VAPID JWT ES256 verified with the public key, push-service status mapping), `ai-router` (intent pre-routing, bounded
tool loop, JSON-intent fallback, invented-time guard, fallback answer from tool
data), `pipeline` (template validity, schema errors incl. missing Impressum, reference/overlap/timezone checks, contrast warning, deterministic conversion to DB units).

### Integration (`tests/integration`, real Postgres + emulator + function handlers)

- ai-chat: availability answered from the booking engine; invented times rejected;
  usage counted in the DB budget and the daily limit enforced; LLM down → 503 while
  the booking API keeps working; owner scope requires a member JWT of *that* tenant;
  a client cannot reach owner tools by asking.
- notify-worker: staff-side reschedule/cancel delivered to the customer exactly once,
  times rendered in the tenant timezone.
- pipeline: publish + verify; re-publish keeps owner edits and bookings; storage RLS
  (no cross-tenant writes, anon cannot write).

### E2E (`e2e/`, built `dist/` served with the same rewrites as Cloudflare Pages)

1. **Booking → cabinet** (mobile client, desktop owner): service → barber → slot →
   details → confirmed; token only in the URL fragment; owner logs in, finds the
   booking in the week calendar, opens it (status "Bestätigt"), finds the client card with history.
2. **Reschedule**: client opens the booking link, picks a slot that another client
   takes before confirming → "Diese Zeit wurde gerade vergeben", original booking unchanged;
   then reschedules successfully (version 2).
3. **Tenant isolation** (mobile + desktop): per-tenant title, `lang`, manifest
   id/scope/start_url, theme color, maskable icon; content only from own rows;
   token of shop A → "Booking not found" in shop B; owner of B gets "kein Zugriff" in A's cabinet; unknown slug → not found.
4. **Mobile scenario**: deep link with preselected service, browser Back/Forward
   through the sheets, date strip, booking; "Meine Termine"; the link opened on a
   second device cancels; first device sees "Storniert".

## Remaining external dependencies (not verifiable here)

| Item | What to do | Risk if skipped |
|---|---|---|
| Real Supabase project | `supabase db push`, set secrets, deploy functions (SETUP.md §4) and re-run `tenant:verify --strict` | the emulator mirrors PostgREST/Auth/Storage only as far as the app uses them |
| Supabase Cron | run `supabase/sql/cron-setup.sql`; watch `cron.job_run_details` | no reminders, no retention job |
| Real LLM | set `LLM_*`; try both `LLM_TOOL_MODE=tools` and `json` with the chosen model | quality of German answers untested with a real model (router logic is tested with a scripted model) |
| Web Push on devices | Android Chrome, desktop Chrome/Firefox, **iOS ≥ 16.4 only as installed PWA** | encryption is verified by round-trip decryption, delivery through FCM/APNs/Mozilla not |
| Cloudflare Pages | deploy, check `_redirects`, `_headers` (CSP), SW scope per tenant on the real domain | — |
| PWA install | Lighthouse/installability on a real phone (Android + iOS splash screens) | — |
| Legal review | Impressum/Datenschutz texts, AVV with Supabase/Cloudflare/LLM provider, EU region choice | texts are templates, not legal advice |
| Load | k6/pgbench against the real project (EXCLUDE + advisory locks are correct under concurrency, throughput not measured) | — |

## Known limitations

- Main JS bundle ≈ 370 KB gzip (Astryx + React + Supabase); cabinet and assistant are lazy-loaded.
- Payments are recorded manually (cash/card at the shop); no online payment provider.
- E-mail/SMS notifications are not implemented; Web Push + ICS download only.
