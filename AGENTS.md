# EKT Assistant

- Preserve existing work and the remote history.
- Authorized push destination: https://github.com/BAITC-Hacks/hack-53afffc3-bibamansbaha.git, branch `main` (verified remote default).
- At the start, make a small useful safe checkpoint; during active development prepare at 12 minutes, target a verified push every 15 minutes, avoid exceeding 20 minutes when access works.
- Explicitly stage reviewed paths; exclude credentials, private DOCX/extracts, uploads, runtime databases and local snapshots. Never force push or rewrite published history.
- Verify every push against the remote branch, record UTC time/SHA/branch in the Git-local push-state file, and report `PUSH OK`. Stop reminders when work stops.
- Catalog facts come from observed API data; fixture and snapshot modes must be labeled. Native ekt.kz cart integration is unconfirmed.
- Cart confirmation, ownership, price/stock checks and idempotency are server invariants. Never place real orders.
- Read actual applicable skill instructions before use. See docs/skills-usage.md and docs/acceptance.md as they are created.
