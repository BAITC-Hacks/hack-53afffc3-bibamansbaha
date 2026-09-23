# EKT Assistant state

Mode: BUILD → verification. Deadline, judging rubric and deployment target were not supplied; no deadline is invented.

Known: official case read in RU/KZ/EN from the supplied document; five required capabilities and input formats verified. Catalog uses the partner's BasicAuth read-only endpoints. Native shop cart API is not provided.

Working: TypeScript/Next.js app, bounded catalog adapter, persistent prototype cart, explicit proposal confirmation, session/CSRF checks, document parsers, real OpenAI text/JPEG/scanned-PDF requests and responsive same-origin widget.

Evidence: unit/integration tests and eight browser tests pass at the current checkpoint; production build and final rechecks are in progress. See docs/acceptance.md for final status as recorded.

Remaining integration constraints: only a representative catalog sample is loaded; API does not confirm units, package-step semantics or certificates in the observed data. Delivery pages conflict; native cart integration and deployment require separate contracts/access. No real orders are placed.

Git: authorized main branch at BAITC-Hacks/hack-53afffc3-bibamansbaha. Actual latest verified push timestamp/SHA are stored in `.git/hackathon-push-state.json`; do not infer push time from commit time. Timer only reminds, never writes Git.
