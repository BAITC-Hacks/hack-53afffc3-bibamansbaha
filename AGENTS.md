# EKT Assistant

- Preserve existing work and the remote history.
- Production is Vercel + Neon PostgreSQL + GPT-5.5 Responses (reasoning low). Brev/WSL repair and deployment are retired by the owner; do not resume them without an explicit new request.
- Keep acceptance (6 calls/$0.25) and demo (100 calls/$1) budgets separate and persistent in Neon. Do not reset ledgers or raise caps. Store credentials only in server-side secrets.
- Authorized push destination: https://github.com/BAITC-Hacks/hack-53afffc3-bibamansbaha.git, branch `main` (verified remote default).
- At the start, make a small useful safe checkpoint; during active development prepare at 12 minutes, target a verified push every 15 minutes, avoid exceeding 20 minutes when access works.
- Explicitly stage reviewed paths; exclude credentials, private DOCX/extracts, uploads, runtime databases and local snapshots. Never force push or rewrite published history.
- Verify every push against the remote branch, record UTC time/SHA/branch in the Git-local push-state file, and report `PUSH OK`. Stop reminders when work stops.
- Catalog facts come from observed API data; fixture and snapshot modes must be labeled. Native ekt.kz cart integration is unconfirmed.
- Cart confirmation, ownership, price/stock checks and idempotency are server invariants. Never place real orders.
- Read actual applicable skill instructions before use. See docs/skills-usage.md and docs/acceptance.md as they are created.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
