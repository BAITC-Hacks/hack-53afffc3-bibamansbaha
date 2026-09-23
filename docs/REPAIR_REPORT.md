# EKT remediation — work in progress

Started 2026-09-23 10:10 UTC / 15:10 UTC+5 from current main `420a171751607cd4b9a35890f6af9962d9891c7a`. The original `docs/FINAL_AUDIT.md` remains unchanged. The user authorized targeted fixes through `CODEX_EKT_REMEDIATION_PROMPT.md`.

Order: payment privacy (EKT-002), agreed cart effects and safe arithmetic (001/014), unit retention (003/004), file parsing (005–007), selection/cart/conflict/offline UI (008–010/016), widget/mobile UI (011–013), CSRF (015), bounded catalog measurements (017), external contracts/production verification (018–020).

Tests will use isolated sessions/databases and deterministic providers, preserving existing tests. No paid model calls are planned: previous usage is unknown, so any new live model verification is `blocked_budget`. Native orders and guessed integration APIs are excluded. Existing user data will not be cleaned without the required separate review/authorization.

Initial status: EKT-001–016 `not_fixed`; EKT-017 `not_fixed` (risk, not a proven root cause); EKT-018/019/020 `blocked_external` pending verification. Each result will gain a regression, evidence, commit and final status as work proceeds.

## Checkpoint 1 — privacy and financial planning

EKT-002: new payment text is rejected at persistence, extraction and provider boundaries; old messages/context and old proposal text are masked on read. Independent review found whitespace/CVV and legacy-proposal gaps; regressions reproduced them before correction. Five privacy tests pass with a network spy (zero paid calls). Counts-only dry-run on existing `.data/ekt.sqlite`: 3 messages, 0 matches, no writes. Targeted cleanup demonstrated on a separate synthetic DB; physical WAL/backup erasure and raw image screening are not claimed.

EKT-001/014: server proposal now carries the initial cart revision and full before/after/delta/repricing plan. Confirm uses the same planner and an atomic revision check; legacy proposals cannot use the old contract. Checked arithmetic rejects unsafe totals before Number conversion. The original financial example, decreasing/unchanged prices and overflow regressions pass; browser verification remains pending.

Current checks: typecheck/lint passed; existing and new unit/integration tests 45 passed, 0 failed. No dependencies changed. Remaining units/file/UI fixes and final production/E2E verification are in progress; no final closure is claimed yet.

## Checkpoint 2 — units, files and interface

Server-held requested lines retain original quantities/units, explicit exclusions and quantity-specific unit reviews. Text extraction has deterministic protection when the model drops an explicit packaging unit. Direct proposals cannot bypass unresolved saved rows. File regressions preserve numeric SKU, XLSX zero formats, Word paragraph/run boundaries and unknown units (28 attachment checks passed).

Browser red/green checks cover exact fractional cart editing, stale proposal rejection, Russian offline recovery, server-backed widget counters, modal keyboard/iframe handling and non-overlapping mobile composer. Six main browser scenarios passed after an asynchronous checkbox integration correction; seven widget/layout regressions passed separately. Targeted HTTP/source/model/file suite: 16 passed; typecheck passed. Lint has no errors and one hook cleanup warning pending final review. Catalog latency work and the expanded final regression remain in progress.
