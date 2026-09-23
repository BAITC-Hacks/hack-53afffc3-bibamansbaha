# EKT Assistant — development progress

## Initial checkpoint

- Target repository: BAITC-Hacks/hack-53afffc3-bibamansbaha.
- Remote default branch verified: main. Existing README and history preserved.
- Local skills are installed; application implementation has not started.
- Private source documents, credentials, uploads and generated files are excluded from Git.

## Next milestones

1. Read the supplied case, inspect catalog responses and model access, document cart integration limits.
2. Implement a catalog lookup, validated proposal, explicit confirmation and persistent session cart.
3. Add specifications/photos, justified alternatives and evidence-backed purchasing information.
4. Verify critical invariants, browser scenarios, responsive UI and production build.

Git checkpoints target 15 minutes between successful pushes, with preparation at 12 minutes and a 20-minute upper target during active work. No real orders will be placed.

## Integration and cart checkpoint

- Downloaded and parsed both supplied Google documents privately; confirmed official required scenarios.
- Verified two catalog pages and detail endpoint with HTTP 200; documented observed fields and a conflicting current rating.
- Local push reminder tested on shortened thresholds, then launched at 12/15/18 minutes without Git operations.
- Next.js/React dependencies installed. Initial catalog adapter and SQLite cart module implemented.
- Cart behavior test verified empty-before-confirmation and duplicate-confirmation protection; broader stock/session tests added.
- UI, parsers and model smoke tests are in progress. Whole-app build has not yet been verified.

## Working application checkpoint

- Real OpenAI text, JPEG and scanned-PDF extraction verified; structured output validated before matching.
- XLSX/DOCX/PDF/JPEG and additional text/CSV inputs flow through real parsing, editable matching and proposals.
- Eight Playwright scenarios passed: file-to-cart, security/isolation/idempotency, injected text, four viewport widths and embedded chat.
- Live browser showed source SKU 200300285_, quantity 2 and total 129840 KZT; explicit confirmation saved the prototype cart.
- Independent review reproduced and fixed concurrent-confirmation and changed-price/identity races; regression tests added.
- Catalog transport issue investigated: default fetch stalled, explicit HTTPS connection-close request succeeded. Adapter now uses bounded native HTTPS without following redirects.
- Minimal dependency security updates applied; npm audit now reports zero vulnerabilities.
- Production build and final browser follow-up are running. Native ekt.kz checkout remains unconnected.
