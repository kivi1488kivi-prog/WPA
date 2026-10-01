# SETUP

Multi-tenant PWA for barbershop booking. One static build (Cloudflare Pages), one
Supabase project (Postgres + Auth + Storage + Edge Functions). Every tenant lives
under `/s/<slug>/` (client) and `/s/<slug>/owner/` (staff cabinet).

```
tenants/<slug>/business.json + images  ──tenant:publish──▶  Supabase (runtime source of truth)
                                         ──build:shells──▶  dist/s/<slug>/ (html, manifest, icons, sw)
```

## 1. Requirements

| Tool | Version | Why |
|---|---|---|
| Node.js | ≥ 22 | build, scripts (`process.loadEnvFile`) |
| PostgreSQL | 16 or 17, with `btree_gist`, `pgcrypto` (contrib) | local DB without Docker (or use `supabase start`) |
| Supabase CLI | ≥ 2.x | migrations, functions, secrets for the real project |
| Chromium | any recent | Playwright E2E (`npx playwright install chromium` if missing) |

```bash
npm ci
```

## 2. Local run (no Supabase account needed)

The repo ships a local emulator of the Supabase HTTP APIs (PostgREST RPC, Auth,
Storage, Functions) on top of a real Postgres, so the full app runs offline.
All setup scripts are Node/TypeScript — they work the same in Windows cmd,
PowerShell, macOS and Linux (no bash, no `psql` needed).

**Once per machine**

1. Node.js **22+** (`node -v`).
2. PostgreSQL **16** (Windows: the EDB installer from postgresql.org — keep the
   defaults, port 5432, remember the password you set for user `postgres`; contrib
   extensions are included). The service starts automatically.
3. Tell the scripts the password (default is `postgres`):
   - cmd: `set PGPASSWORD=your-password`
   - PowerShell: `$env:PGPASSWORD="your-password"`
   - bash: `export PGPASSWORD=your-password`

   (Variables last for the current terminal window only.)

**Run** (project root; three terminals for the last three steps, or use `local:start`)

```bash
npm ci
npm run local:up        # creates DB barbershop_dev (migrations + seed from tenants/*), writes .env.local
npm run local:stack     # API emulator on http://localhost:54321 — keep this terminal open
npm run local:staff     # demo staff accounts (once, after local:up; the stack must be running)
npm run dev             # http://localhost:5173/s/demo-studio/
```

`npm run local:start` / `npm run local:stop` run the emulator in the background
instead of `local:stack` (log: `.local-stack/server.log`). `local:up` recreates the
dev database from scratch — run `local:staff` again afterwards.

Production-like (per-tenant shells, `_redirects`, service worker):

```bash
npm run build && npm run serve:dist   # http://localhost:4173/s/demo-studio/
```

Demo accounts (local only, password `demo-password-123`): `owner@demo-studio.test`
(owner), `admin@demo-studio.test` (admin), `alexey@demo-studio.test` (barber, sees
only own bookings), `owner@demo-harbor.test` (owner of the second tenant).

Alternative: `supabase start` (Docker) uses `supabase/config.toml`, the same
migrations and `supabase/seed.sql`.

**Troubleshooting**

| Symptom | Fix |
|---|---|
| `EPERM … unlink …esbuild.exe` during `npm ci` | a process holds the file (running `npm run dev`, VS Code terminal, antivirus). Close them, rename `node_modules` to `node_modules_old`, run `npm ci` again |
| `Cannot connect to PostgreSQL … ECONNREFUSED` | start the service (`services.msc` → postgresql-x64-16) |
| `Cannot connect … 28P01` | wrong password → set `PGPASSWORD` (see above) |
| `'export' is not recognized` | you are in cmd — use `set VAR=value` |
| port 54321 / 5173 busy | `set LOCAL_STACK_PORT=54400` before `local:up`; Vite port is in `vite.config.ts` |

## 3. Tests

```bash
npm run typecheck                     # app + scripts (strict)
npx tsc -p tsconfig.functions.json --noEmit   # Edge Functions
npm run lint:tenants                  # no tenant names/values hard-coded in src/
npm test                              # unit: time, web push crypto, AI router, pipeline
npm run db:test                       # SQL suite + concurrency suite (needs bash and psql in PATH: Linux/macOS/WSL/Git Bash)
npm run test:integration              # Edge Functions + pipeline against the local stack
npx playwright install chromium      # once (not needed if PW_CHROMIUM_PATH is set)
npm run e2e                           # Playwright (recreates DB, starts emulator, builds, serves dist itself; stop `local:stack` first — same port)
```

## 4. Real Supabase project

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db push                      # applies supabase/migrations/* (no seed in production)
```

Then in the dashboard:

1. **Auth → Providers → Email**: sign-ups **off** (staff are created by script only).
   Auth → URL configuration: Site URL = your Pages domain.
2. **Storage**: bucket `tenant-media` (public read, 5 MiB, jpeg/png/webp) is created by the migration; writes only via policies (owner/admin into `<tenant_id>/owner/…`) or the service role.
3. **API keys**: copy URL, anon key, service role key.

### Edge Functions

```bash
npm run vapid:generate                # prints VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
cp .env.example supabase/.env.production   # fill in LLM_*, VAPID_*, CRON_SECRET (do not commit)
supabase secrets set --env-file supabase/.env.production
supabase functions deploy ai-chat notify-worker
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically. Without `LLM_*` the assistant answers 503 and the UI hides it.
Without `VAPID_*` push is disabled and jobs are marked `skipped`.

LLM: any OpenAI-compatible endpoint (`LLM_BASE_URL` ending in `/v1`). If the
model has no function calling, set `LLM_TOOL_MODE=json`. Budget: per-tenant
limits live in `tenants` (`ai_daily_request_limit`, `ai_daily_token_limit`), global caps
in `AI_GLOBAL_DAILY_*`; both are enforced by DB counters before the LLM call.

### Cron (notifications + maintenance)

Open `supabase/sql/cron-setup.sql`, replace `<PROJECT_REF>` and `<CRON_SECRET>`,
run it in the SQL editor. It schedules:

- `notify-worker` every minute (outbox `notification_jobs` → Web Push, lease + dedupe),
- `maintenance-daily` (rate counters, stale idempotency records, GDPR retention).

## 5. Tenants

```bash
npm run tenant:new -- my-shop                 # copies tenants/_template
# edit tenants/my-shop/business.json, replace images (see tenants/_schema/business.schema.json)
npm run tenant:validate -- my-shop
npm run tenant:publish -- my-shop --dry-run
npm run tenant:publish -- my-shop             # upserts DB rows + uploads content-addressed media
npm run tenant:member -- my-shop owner@shop.de owner
npm run tenant:member -- my-shop anna@shop.de barber --barber=anna
npm run tenant:verify -- my-shop --strict     # DB vs file, RLS smoke, media, shell
```

Scripts read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env` (or the
environment). Run them only on a trusted machine/CI.

Owner edits in the cabinet win: fields changed by the owner are recorded in
`owner_overrides` and are not overwritten by a later publish unless `--force`.

New tenants start in **preview** (banner, demo bookings allowed, no
notifications sent). Go-live happens in the cabinet (Einstellungen → Live
schalten); it is blocked until Impressum (name, street, city, e-mail), phone, address,
active services and at least one bookable barber with hours exist, and every
service has a barber; it purges demo bookings.

## 6. Deploy frontend (Cloudflare Pages)

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Output directory | `dist` |
| Env vars | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`, `NODE_VERSION=22` |

`npm run build` emits `dist/_redirects` (deep links → right shell) and
`dist/_headers` (CSP, no-cache for `sw.js` and manifests). A new tenant needs a
rebuild (its shell, icons and manifest are generated from `tenants/<slug>/`);
its data comes from the DB at runtime.

## 7. Germany / legal

- `business.json → legal.impressum` (§ 5 DDG) and `legal.privacy` feed
  `/s/<slug>/impressum` and `/s/<slug>/datenschutz`. Go-live is blocked without them.
- Customer data: name, phone, optional e-mail; export (Art. 15/20) and
  anonymization (Art. 17) in the client card; automatic retention via
  `tenants.retention_months` (cron).
- AI notice per Art. 50 AI Act is shown in the assistant.
- Processors to list in the privacy text: Supabase (choose EU region), Cloudflare,
  the LLM provider, push services (Google/Apple/Mozilla). Sign their DPAs (AVV).
- The generated texts are templates, **not legal advice** — have them reviewed.
