# Interface decisions

The EKT assistant is a Russian B2B purchasing workspace: a conversation in the center, a compact navigation rail, and a persistent proposal review column. At mobile widths the review column follows the conversation. It is intentionally a working product rather than a marketing landing page.

## Verified references

- Inspected the actual ekt.kz browser screenshot on 2026-09-23. Its navigation and catalog accent are blue. The prototype uses a related blue for the EKT wordmark and links, with a restrained red action accent; the red is a prototype choice, not a claim about the official primary brand color.
- Actual 21st MCP search and retrieval supplied [Attachment Composer Tray](https://21st.dev/@sean0205/components/attachment-composer-tray). The implementation adapts its conditional attachment tray, removable attachment chip, explicit button types, accessible labeling, and capped composer textarea. It does not import the reference's unrelated dependency tree.
- `21st init --design-context` was run successfully in this project.
- `21st review src/app/globals.css src/components` completed: six files checked, four informational hardcoded-color notices after the final accessibility pass in the CSS token definition and stylesheet. No automatic fixes were applied; these declared project colors are intentional.

## Skills applied

Read actual instructions for `minimalist-ui`, `21st-ui-build`, `playwright-cli`, `gpt-taste`, and `high-end-visual-design` before implementation. The working design uses minimalist-ui's flat surfaces, restrained color, crisp radii, generous local whitespace, and readable hierarchy, together with 21st-ui-build's grounded references and accessibility requirements. The reference website and product workflow override generic aesthetic rules.

The cinematic AIDA/GSAP/randomization prescriptions in gpt-taste and high-end-visual-design are not appropriate to a purchasing workspace; these skills were evaluated and deferred rather than falsely reported as implemented. No fabricated user testimonials, warehouse counts, product images, or catalog capabilities appear in the UI.

## Behavior

- Catalog mode and runtime-model availability are displayed independently. Fixture data is explicitly labeled. Missing runtime model is labeled “Поиск без AI”.
- A product button prepares a server-checked proposal. Only the explicit confirmation button can save its contents to the prototype cart.
- Prices are backend minor-unit values. The UI never computes authoritative totals or invents missing stock/units. Null units appear as “ед. каталога”, with a source caveat in product details.
- Document rows are editable, matched against real returned candidates, and explicitly selectable. Excluded rows appear in the proposal.
- CSRF tokens come from the current state. Busy, network-error, parsing, attachment-removal, confirmation, and restored-session states are supported.
- The cart route reads server state and supports explicit updates/removal. The embed route demonstrates a same-origin iframe and accurately states that it is not installed on ekt.kz.
- Custom SVG icons avoid misleading stock illustrations. Product images are used only when returned by the catalog.
- Visible keyboard focus, labeled controls, live status text, flexible layouts and reduced-motion support are included. Browser checks are recorded by the project acceptance report.

Typography uses Golos Text when available with a local Segoe UI fallback. Remote font loading is optional; it does not gate application availability.

## Browser verification — 2026-09-23

Used a separate Playwright CLI browser session against the actual running application at `127.0.0.1:3000`.

- Live lookup of `200300285_` returned the observed Legrand item, 64,920 KZT and aggregate stock 23, while displaying the source's current-rating contradiction and absent-unit caveats.
- A two-unit proposal showed 129,840 KZT. Explicit confirmation saved it to the prototype cart; the cart persisted through a full page reload. Explicit quantity reduction from two to one succeeded and updated the total to 64,920 KZT.
- Created another proposal and edited a product quantity. The old proposal immediately became invalid, the server cancel operation completed, and its confirmation button became disabled. Preparing a new proposal restored a fresh confirmation step.
- Desktop 1440 and 1280 and mobile 390 and 360 layouts were inspected. Measured document widths matched viewport widths at 1280, 390 and 360. Mobile composer remains visible at the bottom; a proposal shortcut scrolls to the review/confirmation panel.
- The `/embed` launcher opened the real same-origin iframe on a 360-pixel viewport. The iframe rendered the assistant and its close control worked.
- A fresh browser navigation and the live proposal/cancel flow had zero browser console errors or warnings. Earlier catalog timeout and origin configuration failures were observed, correctly surfaced, and rechecked after correction/retry; they are not claimed as successful first attempts.
- Final UI ESLint and TypeScript checks passed. Screenshots are local-only in `.tmp/ui-final-desktop1440.png`, `.tmp/ui-final-mobile390.png`, `.tmp/ui-final-mobile390-proposal.png`, and `.tmp/ui-widget360.png`.

These checks verify the prototype basket only. No native ekt.kz basket, reservation, checkout, or real order was invoked.
