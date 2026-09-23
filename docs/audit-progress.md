# Final audit progress — no product fixes

Started 2026-09-23 09:29 UTC / 14:29 UTC+5. Product baseline: `025e15ee0ea4264b2127008e765263f3e0aed1a9`, main, initially clean working tree. `CODEX_EKT_FINAL_AUDIT.md` is copied from the user-provided document.

The audit is read-only for product source, existing tests, dependencies and design. Diagnostic probes use `.tmp/audit`; a detached local copy at `.tmp/audit-code` uses isolated fixture databases and ports. Native ekt.kz orders are never invoked.

Independent reviewers cover server/cart/security, files/model/spec, and UI/browser. Root cross-checks evidence and runs standard commands. Initial concrete reproductions: existing-cart repricing on adding the same SKU, missing units/leading-zero SKU issues in parsing, and persistence of synthetic payment details. These are findings only, not fixes; final classification, complete evidence and limitations belong in `docs/FINAL_AUDIT.md`.

Fresh `npm ci` in the audit copy passed with lockfile unchanged and zero audit vulnerabilities; blocked optional install scripts did not fail installation. A dependency-junction experiment was rejected by Turbopack, so the copy uses real local dependencies. That audit-setup failure is not attributed to the product.

Typecheck, lint, all 38 existing tests and build passed in the audit copy. All nine existing E2E scenarios passed again in 26.2 seconds. Independent browser probes also completed a new specification with changed quantities, confirmation and cart reload, plus a second independent input; new UI findings are being documented separately. Framework-generated type paths changed the disposable audit copy only; the primary product tree is not changed.

Secret scan checked 91 reachable Git blobs and 30 client/log files, with zero matches for configured secrets or key patterns. Independent reproduction confirmed 3 server, 6 file/model/privacy and 5 UI findings. These are not repaired; final IDs and evidence are being consolidated.

Live catalog audit was degraded: first uncached request failed after 16.035 seconds; a second attempt succeeded in 19.880 seconds with the documented SKU/price/stock. It was another uncached attempt, not a warm-cache measurement. One real model context request, one JPEG and one text-unit request completed in 1.389–2.242 seconds. External latency/root cause is not inferred from only these observations.

The environment's automatic approval review rejected the isolated production `npm start` command with `blocked by policy`, without a more specific reason. It was not retried through another execution path. Production launch is blocked in this audit; successful build/dev/E2E do not replace it.
