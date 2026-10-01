# PROGRESS — состояние работы (для продолжения в новой сессии)

Обновлено: 2026-10-01. Ветка `main`, история в git (архив содержит `.git`).

## Готово и проверено
- **SQL-слой** (`supabase/migrations/*`, 13 миграций): схема multi-tenant, составные FK, RLS/GRANT,
  `resource_occupancies` + EXCLUDE, движок расписания (интервалы, перерывы, особые даты, блокировки,
  отпуска, timezone/DST), атомарные create/reschedule/cancel, идемпотентность, токены (только hash),
  outbox уведомлений с lease и at-most-once, счётчики rate-limit и бюджета LLM, статистика в SQL,
  owner API с ролями owner/admin/barber, конвейер publish, GDPR (экспорт/анонимизация/retention),
  Impressum/legal-поля, go-live.
  Проверка: `npm run db:test` → 252 SQL-проверки + конкурентный набор (реальные параллельные сессии) — всё зелёное.
- **Конвейер tenant**: `tenant:new|validate|publish|verify|member`, `seed:build`, JSON Schema.
  Проверено против локального стенда: publish (2 раза, медиа не перезаливаются), verify — 0 ошибок.
- **Два demo-tenant**: `demo-studio` (de, Europe/Berlin, EUR) и `demo-harbor` (en, America/New_York, USD).
  Фото — Pexels (лицензия, credits в business.json).
- **Фронтенд** (React 19, TS strict, Vite 8, Router 7, Query 5, Zod 4, Astryx 0.6.3 + shadcn Drawer Base UI):
  клиент (главная, запись последовательными sheet-ами, моя запись по токену, перенос/отмена, ICS, push,
  мои записи, Impressum/Datenschutz), кабинет (календарь день/неделя/барбер, запись/перенос/отмена/оплаты,
  блокировки, клиенты + GDPR, барберы с фото и расписанием, услуги, особые дни, статистика, фото, настройки,
  go-live, AI-помощник). Локали de/en/ru + каталоги Astryx de-DE/ru-RU. `npm run typecheck` — чисто.
- **PWA**: `src/sw.ts` (injectManifest), `scripts/build-shells.ts` — per-tenant index.html/manifest/иконки/
  maskable/apple-touch/startup, отдельные SW scopes клиента и кабинета, `_redirects`, `_headers` (CSP).
- **Edge Functions**: `ai-chat` (pre-routing, ограниченный tool loop, JSON fallback, guard от выдуманных
  времён, бюджет), `notify-worker` (VAPID + RFC 8291 на WebCrypto). Unit-тесты webpush/time — зелёные.
- **Локальный стенд без Docker**: `tools/local-stack` (эмулятор PostgREST RPC/Auth/Storage/Functions поверх
  реального Postgres) + `tools/serve-dist.ts` (правила как в Cloudflare `_redirects`).

## В работе / осталось
1. Прогнать `tests/unit/ai-router.test.ts` (написан, ещё не запускался) и починить, если нужно.
2. Unit-тесты конвейера (негативные кейсы validate, normalize) и проверка «нет названий tenant в src» (`lint:tenants`).
3. Integration-тесты против локального стенда: ai-chat с поддельным LLM-сервером, notify-worker
   (push-сервис застаблен), republish сохраняет данные владельца, Storage RLS по HTTP.
4. Playwright E2E: запись → появление в кабинете; перенос; изоляция двух tenant; мобильный сценарий
   (deep link → … → открытие по токену → отмена/перенос).
5. Скрипт VAPID-ключей, `supabase/sql/cron-setup.sql`, `.env.example`.
6. Документы: SETUP.md, CLONE-IN-6-MINUTES.md, ACCEPTANCE.md, README.md.
7. Полировка: перевод статуса tenant в настройках, оптимизация размера бандла (~370 KB gzip).

## Как продолжить локально (Linux/macOS/WSL, нужен PostgreSQL 15+ с btree_gist/pgcrypto)
```bash
npm ci
npm run db:test                 # SQL + конкурентные тесты
npm run local:up                # БД barbershop_dev + seed + .env.local
tools/local-stack/start-bg.sh   # эмулятор API на :54321
npm run local:staff             # demo-учётки: owner@demo-studio.test / demo-password-123
npm run build && npx tsx tools/serve-dist.ts 4173   # http://localhost:4173/s/demo-studio/
```

## Состояние на 2026-10-01 (вечер)
- Всё зелёное: typecheck (app+functions), lint:tenants, unit 32, SQL 255 + concurrency 6, integration 9, E2E Playwright 5/5, tenant validate/publish/verify для обоих демо.
- Добавлено: E2E (e2e/*.spec.ts), .env.example, `npm run vapid:generate`, supabase/sql/cron-setup.sql, `npm run serve:dist`,
  SETUP.md, CLONE-IN-6-MINUTES.md, ACCEPTANCE.md, README.md; хэш конфига не зависит от базового URL медиа; перевод статуса тенанта.
- Осталось (внешнее, см. ACCEPTANCE.md): реальный Supabase-проект, реальная LLM, push на устройствах, деплой Cloudflare, юр. проверка текстов.
- Возможные улучшения: размер бандла (~370 KB gzip), свободные интервалы в календаре не обрезаются по «сейчас», e-mail/SMS уведомления.
