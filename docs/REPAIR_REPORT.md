# EKT remediation — work in progress

Started 2026-09-23 10:10 UTC / 15:10 UTC+5 from current main `420a171751607cd4b9a35890f6af9962d9891c7a`. The original `docs/FINAL_AUDIT.md` remains unchanged. The user authorized targeted fixes through `CODEX_EKT_REMEDIATION_PROMPT.md`.

Order: payment privacy (EKT-002), agreed cart effects and safe arithmetic (001/014), unit retention (003/004), file parsing (005–007), selection/cart/conflict/offline UI (008–010/016), widget/mobile UI (011–013), CSRF (015), bounded catalog measurements (017), external contracts/production verification (018–020).

Tests will use isolated sessions/databases and deterministic providers, preserving existing tests. No paid model calls are planned: previous usage is unknown, so any new live model verification is `blocked_budget`. Native orders and guessed integration APIs are excluded. Existing user data will not be cleaned without the required separate review/authorization.

Initial status: EKT-001–016 `not_fixed`; EKT-017 `not_fixed` (risk, not a proven root cause); EKT-018/019/020 `blocked_external` pending verification. Each result will gain a regression, evidence, commit and final status as work proceeds.
