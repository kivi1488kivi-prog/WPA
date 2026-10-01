# New barbershop in 6 minutes

Prerequisites: project already deployed once (see SETUP.md), `.env` with
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on your machine.

| Min | Step | Command / action |
|---|---|---|
| 0:00 | Create folder from template | `npm run tenant:new -- salon-mitte` |
| 0:30 | Fill in data | `tenants/salon-mitte/business.json`: name, address, phone, timezone, hours, services (price in cents, minutes), barbers (+ which services), `legal.impressum`, `legal.privacy` |
| 3:00 | Replace images | `images/`: `cover.jpg`, `logo.png`, `icon.png` + `icon-maskable.png` (square, ≥ 512 px), `barbers/*`, gallery — paths as referenced in the JSON |
| 3:30 | Check | `npm run tenant:validate -- salon-mitte` (schema, contrast, overlaps, missing files) |
| 4:00 | Publish data + media | `npm run tenant:publish -- salon-mitte` |
| 4:30 | Owner account | `npm run tenant:member -- salon-mitte inhaber@salon-mitte.de owner` (prints a temporary password unless `--password=` is given) |
| 5:00 | Shell + deploy | `git add tenants/salon-mitte && git commit -m "tenant: salon-mitte" && git push` → Cloudflare Pages rebuilds |
| 5:30 | Verify | `npm run tenant:verify -- salon-mitte --strict` |

Result:

- Client app: `https://<domain>/s/salon-mitte/` (installable PWA with its own name, icon, colors)
- Cabinet: `https://<domain>/s/salon-mitte/owner/`
- Status **preview**: yellow banner, no notifications. The owner switches to live
  in *Einstellungen → Live schalten* once the go-live check is green.

Optional: `--seed-demo` on publish adds demo bookings from `demo.bookings` (deleted on go-live).

Later changes: edit `business.json` → `tenant:publish` again. Things the owner
changed in the cabinet are kept (reported as `skipped_owner`); `--force`
overwrites them, `--prune` deactivates barbers/services removed from the file.
Only name/colors/icon changes require a rebuild (step 5:00).
