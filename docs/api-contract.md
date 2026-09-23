# Observed integration contract

Verified 2026-09-23 with partner credentials from the privately downloaded Google document. No credentials or raw private responses are stored in Git.

- `GET https://ekt.kz/api/products` and `?page=2`: HTTP 200. Envelope `page`, `per_page`, `count`, `items`; each sampled page contains 20 items. `count` is the page count, not a proven catalog total.
- List items have `id`, `name`, `article`, `price`, `image`, `url`, `url_api_detail`, `offers`.
- `GET /api/products/detail?id=515291`: HTTP 200. Adds `description`, `quantity`, `stores`, `properties`. `id` is not the article. The article is `200300285_`; supplier article is `027228`.
- Stores are `{id,name,quantity}`. The adapter uses the API aggregate quantity without summing stores or promising city fulfillment.
- Units and currency are absent in the observed JSON. Public EKT prices are in tenge. UI discloses unknown measurement unit; only integral quantities in catalog units are accepted when unit is unknown. Fixture cable explicitly supports decimal meters.
- `KRATNOST_MIN` is retained as the minimum quantity; package size is unknown, not guessed.
- Observed inconsistency: product 515291 name says 160 A but `NOMINALNYY_TOK` says 250 A. The warning is visible; automatic alternatives are blocked for this conflict.
- No certificate field/link was observed in the representative response. Absence is reported honestly.
- API credentials stay server-side. Requests allow only HTTPS ekt.kz, reject redirects, timeout after 8 seconds and retry at most once. Search loads at most configured 1–5 pages (default 2), with explicit partial coverage.

## Cart boundary

No cart API is provided. A persistent SQLite prototype cart is isolated by HttpOnly cookie sessions, CSRF token and origin checks. Proposals are versioned and expire; confirmation re-fetches product data. Changes require a new preview. No production orders or payments are performed. `/cart` is the current prototype session cart, not ekt.kz checkout.

## Runtime model

OpenAI Responses provider configured locally; text and image verification is in progress. Model authentication is separate from Codex and 21st. Unconfigured/unavailable AI must be explicitly labeled; deterministic search is not represented as AI.

## Modes

`live` = current catalog requests, `fixture` = clearly labeled synthetic examples. `snapshot` is reserved and rejected until a provenance-preserving snapshot is configured; no automatic fallback to synthetic data.
