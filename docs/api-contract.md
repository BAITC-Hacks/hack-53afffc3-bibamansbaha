# Observed integration contract

Verified 2026-09-23 with partner credentials from the privately downloaded Google document. No credentials or raw private responses are stored in Git.

- `GET https://ekt.kz/api/products` and `?page=2`: HTTP 200. Envelope `page`, `per_page`, `count`, `items`; each sampled page contains 20 items. `count` is the page count, not a proven catalog total.
- List items have `id`, `name`, `article`, `price`, `image`, `url`, `url_api_detail`, `offers`.
- `GET /api/products/detail?id=515291`: HTTP 200. Adds `description`, `quantity`, `stores`, `properties`. `id` is not the article. The article is `200300285_`; supplier article is `027228`.
- Stores are `{id,name,quantity}`. The adapter uses the API aggregate quantity without summing stores or promising city fulfillment.
- Units and currency are absent in the observed JSON. Public EKT prices are in tenge. UI discloses unknown measurement unit; only integral quantities in catalog units are accepted when unit is unknown. Fixture cable explicitly supports decimal meters.
- `KRATNOST_MIN` is retained as a raw source attribute. Its meaning (minimum vs order step) is not documented, so neither is inferred. Values above 1 block adding until clarified.
- Observed inconsistency: product 515291 name says 160 A but `NOMINALNYY_TOK` says 250 A. The warning is visible; automatic alternatives are blocked for this conflict.
- No certificate field/link was observed in the representative response. Absence is reported honestly.
- API credentials stay server-side. Requests allow only HTTPS ekt.kz, reject redirects, timeout after 8 seconds and retry at most once. Search loads at most configured 1–5 pages (default 2), with explicit partial coverage.

## Cart boundary

No cart API is provided. A persistent SQLite prototype cart is isolated by HttpOnly cookie sessions, CSRF token and origin checks. Proposals are versioned and expire; confirmation re-fetches product data. Changes require a new preview. No production orders or payments are performed. `/cart` is the current prototype session cart, not ekt.kz checkout.

### Application-owned API

These routes belong to this prototype, not the partner API. Every POST requires an existing session cookie, exact configured `Origin` and `x-csrf-token` obtained from GET state. Prices and stock are never accepted from the client.

| Route | Purpose |
| --- | --- |
| `GET /api/state` | Session-scoped conversation, cart, current proposal, catalog/model availability and CSRF token |
| `POST /api/chat` | Text interpretation and read-only catalog consultation; may prepare, never confirm |
| `POST /api/parse` | Multipart `file`, real extraction and candidate matching |
| `POST /api/match` | Rematch edited specification lines |
| `POST /api/proposal` | Product IDs/quantities, source units and unit-review acknowledgment; return server-priced preview |
| `POST /api/confirm` | Proposal ID/version/hash and explicit `confirmed:true`; atomic idempotent cart update |
| `POST /api/cancel` | Invalidate an unconfirmed proposal |
| `POST /api/cart` | Explicit quantity edit/removal in own prototype cart; changed source facts require new proposal |

Source-unit review is retained when a price-only refresh creates a replacement preview. Changing the catalog unit invalidates the prior unit acknowledgment. There is no inferred pack conversion.

### Required native integration contract

The partner must provide documented basket read/write operations, user/session ownership and authentication, SKU/offer identity, currency and measurement units, package rules, price/stock revalidation behavior, and idempotency or transactional semantics. Agree separately whether stock is merely displayed or reserved. No guessed endpoint is implemented. Connect through the `CartAdapter` boundary only after sandbox verification; real checkout is outside this prototype.

The supplied iframe is same-origin and shares its session cookie. Production cross-origin embedding needs an explicit allowed origin and authentication/cookie design (including third-party-cookie restrictions), plus actual CMS integration testing. There is no wildcard postMessage bridge.

## Runtime model

OpenAI Responses provider `gpt-4.1-mini` verified with actual requests: text interpretation 3.886 s, structured JPEG label extraction through the attachment parser 2.178 s. These are individual observations, not a latency percentile. Model authentication is separate from Codex and 21st. Unconfigured/unavailable AI is explicitly labeled; deterministic search is not represented as AI.

## Modes

`live` = current catalog requests, `fixture` = clearly labeled synthetic examples. `snapshot` is reserved and rejected until a provenance-preserving snapshot is configured; no automatic fallback to synthetic data.
