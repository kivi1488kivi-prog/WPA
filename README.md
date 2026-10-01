# Barbershop Booking (multi-tenant PWA)

Online booking for barbershops: one static build, one Supabase project, any number
of shops under `/s/<slug>/`. German-first (DE/EN/RU), DSGVO features, Impressum.

- **Clients**: book without an account (service → barber or "any" → time → name + phone),
  manage the booking via a private link (cancel/reschedule, ICS, push reminders), AI assistant.
- **Staff** (`/s/<slug>/owner/`): calendar day/week/per barber, manual bookings,
  reschedule/cancel, blocks and vacations, schedules with breaks and special dates,
  services and prices, barbers, photos, client cards with history and GDPR export/erasure,
  payments, statistics, settings, go-live.
- **Guarantees in the database**: no double booking (`EXCLUDE` on one occupancy table),
  atomic create/reschedule/cancel, idempotent retries, immutable price snapshots,
  RLS + composite tenant FKs, function-level GRANT whitelist.

| Doc | |
|---|---|
| [SETUP.md](SETUP.md) | local run, tests, Supabase, functions, cron, Cloudflare Pages |
| [CLONE-IN-6-MINUTES.md](CLONE-IN-6-MINUTES.md) | add a new barbershop |
| [ACCEPTANCE.md](ACCEPTANCE.md) | what was tested and what still needs real infrastructure |
| [PROGRESS.md](PROGRESS.md) | development log |
| [AGENTS.md](AGENTS.md) | conventions for coding agents |

Quick start (local Postgres, no Supabase account):

```bash
npm ci
export PGPASSWORD=postgres
npm run local:up && npm run local:stack &   # DB + API emulator
npm run local:staff && npm run dev           # → http://localhost:5173/s/demo-studio/
```

Stack: React 19, TypeScript (strict), Vite, React Router, TanStack Query, Zod,
Astryx + shadcn/ui, vite-plugin-pwa (injectManifest), Supabase (Postgres, Auth,
Storage, Edge Functions), Web Push (VAPID), Playwright, Vitest.
