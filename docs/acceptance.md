# Acceptance — 23 September 2026

Statuses: `passed`, `failed`, `blocked`, `not_run`. A fixture success is not live verification. All carts below are the SQLite prototype; no real order, payment or shop-cart write occurred.

## Executed checks

| Check | Result | Evidence |
| --- | --- | --- |
| `npm test` | passed | 31 deterministic tests: parsers, model boundaries, catalog, cart, units, expiry, restart persistence and concurrency. |
| `npm run typecheck` / `npm run lint` | passed | Final unit-review source checks passed at 09:18 UTC. |
| `npm run build` | passed | Optimized Next.js build with `/`, `/cart`, `/embed`, `/api/[action]` at 09:18 UTC. |
| `npm run test:e2e` | passed | Nine browser scenarios passed in 22.7 s at 09:19 UTC, including source-unit review/reset. An initial new-test locator was incorrect and fixed; the test was rerun successfully. |
| `npm audit` / `npm audit --omit=dev` | passed | Zero reported vulnerabilities after minimal Next/PDF dependency fixes. |
| Real model and live catalog | passed | `node --env-file=.env.local --import tsx scripts/smoke-live.ts`, 09:13:56 UTC. Six actual read-only observations below. |

## Requirement matrix

| Requirement | Scenario / evidence | Data / cart mode | Result |
| --- | --- | --- | --- |
| Existing article | Live SKU `200300285_`, product ID `515291`, browser returned price 64920 KZT, stock 23 and source attributes | live / prototype | passed |
| Second-page item | Authenticated `?page=2` returned 200, first SKU `200300285_`; cold search found exact match among 40 loaded products | live / no write | passed |
| Units and minimum | API omissions disclosed; `KRATNOST_MIN` retained without guessing semantics; values >1 block addition pending clarification | live / prototype | passed |
| Missing certificate | Empty source evidence shows explicit absence; no generated certificate link | live + fixture | passed |
| Present certificate | No certificate field or real certificate sample in provided API; production mapping still needs confirmed source contract | live | blocked |
| Zero stock + compatible candidate | C16 OUT offers IN with five matching critical attributes and disclosed brand difference; chosen explicitly | fixture / prototype | passed |
| Live compatible analogues | Required critical fields not all mapped/provided in observed source. Current live matching returns no safe analogues | live | blocked |
| Insufficient comparison data | `DEMO-NO-ALT` returns no analogue; real 160/250 A contradiction disclosed and excludes automatic replacement | fixture + live | passed |
| Purchasing terms | Six sourced policy entries; conflicting delivery thresholds and unknown minimum order disclosed | official public pages | passed |
| Consultation / preview does not mutate cart | Unit + E2E inspect empty cart before confirm | fixture / prototype | passed |
| Negation and injected document instructions | Browser upload and chat leave cart empty | fixture / prototype | passed |
| Explicit current confirmation | Confirm saves exact quantities and server amounts once | fixture + live / prototype | passed |
| Existing quantity and insufficient/unknown stock | Aggregate checks, no overstock, null stock blocks | fixture / prototype | passed |
| Source price / identity changes | New preview and confirmation required; changed-price quantity edit refused | controlled source responses / prototype | passed |
| Concurrent/repeated confirm | Parallel HTTP confirm and delayed conflicting-source regression, one cart increment | fixture / prototype | passed |
| Expired, cancelled and foreign proposal | 10-minute expiry, cancellation and another session rejected | fixture / prototype | passed |
| Cart link, reload, process restart | Live browser reload plus close/reopen real SQLite database test | live + fixture / prototype | passed |
| XLSX and DOCX | Real workbook cells and Word table parsing with quantity/unit assertions | generated files / deterministic | passed |
| Text PDF | Actual PDF text layer extracted and matched by common pipeline | generated file / deterministic | passed |
| JPEG and scanned PDF | Actual OpenAI extraction: JPEG 2.178 s, scan 4.064 s in initial smoke; structured rows with quantity, not canned filename response | live model / no cart write | passed |
| Ambiguous or unreadable input | Empty/unknown matches ask for correction; no model configuration produces controlled error, no fake OCR | deterministic / fixture | passed |
| Edit quantity after upload | Browser edit invalidates existing preview; fresh proposal required | live / prototype | passed |
| Mismatched source units | Server rejects `упак → м` without review; aliases allowed; unknown live unit requires explicit review. Browser regression added | deterministic + live / prototype | passed |
| Oversized, forged, unsafe Office/ZIP | 8 MB, 100 rows, signature, expansion, macro and entity checks | generated malicious samples | passed |
| Model timeout / missing key | Stalled vision cancelled; unavailable model explicit; text search fallback labeled | controlled model / fixture | passed |
| Catalog network failure | Initial real timeout surfaced as unavailable; transport fixed, repeated actual requests pass | live network | passed |
| Session separation | Distinct cookies cannot read/confirm another proposal/cart; state scoped to session | fixture / prototype | passed |
| CSRF, forged price and origin | Hostile origin rejected; strict request schema rejects client price, server reloads catalog facts | fixture / prototype | passed |
| XSS links | `javascript:` and off-origin product links rejected by normalizer; React escapes text. Full security audit not claimed | deterministic | passed |
| Responsive / keyboard | 1440, 1280, 390, 360 px; no document overflow; keyboard Enter submits; visible labeled controls | browser / fixture + live | passed |
| Same-origin widget | Actual iframe chat opens on test page, closes on mobile | browser / prototype | passed |
| Cross-origin widget, native EKT cart, reservation, orders | No documented partner contract/authentication; no attempt to invent or call write endpoints | production | blocked |
| Deployment / load testing | No target supplied or deployment performed; local checks do not prove production operation | production | not_run |

## Latency observations

Windows local network on 23.09.2026 at 09:13 UTC. Serial individual measurements, 40 products / two pages, HTTP catalogue plus actual OpenAI `gpt-4.1-mini`. Cache is 120 seconds. These are not p95 or load-test results; UI dev compilation is excluded from this service-level smoke.

| Operation | First call | Second call |
| --- | --- | --- |
| Exact SKU, catalog cache cold then warm | 3930 ms | <1 ms (rounded 0 ms) |
| Model text interpretation + warm catalog | 1456 ms | 883 ms |
| JPEG recognition + warm catalog | 967 ms | 1320 ms |

First/second model calls mean a new process and repeat in that process; provider-side cache state is unknown. JPEG sample is a generated, readable label, not a claim of equivalent speed or accuracy for every photo. Live requests may fail or take longer; catalog deadline is 8 s per attempt, maximum two attempts. Cold initial Next dev compilation was separately observed to add seconds.

## Local evidence and limits

Browser screenshots: `.tmp/ui-final-desktop1440.png`, `.tmp/ui-final-mobile390.png`, `.tmp/ui-final-mobile390-proposal.png`, `.tmp/ui-widget360.png`; automated screenshots `.tmp/ui-{width}.png`. These contain no source credentials and are not published by default. Fresh final UI console had zero errors/warnings before the last unit-review regression.

Source docs and credentials remain private. Snapshot mode is not implemented. Search is partial. Live unit, packaging and certificate semantics require partner documentation. Purchasing policy conflicts need business confirmation. Photos/specifications require human review of parsed text and chosen goods. This is a verified local prototype, not a production readiness claim.
