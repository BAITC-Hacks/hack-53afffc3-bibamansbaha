# Interface decisions

The EKT assistant is a Russian B2B purchasing workspace: a conversation in the center, a compact navigation rail, and a persistent proposal review column. At mobile widths the review column follows the conversation. It is intentionally a working product rather than a marketing landing page.

## Verified references

- Inspected the actual ekt.kz browser screenshot on 2026-09-23. Its navigation and catalog accent are blue. The prototype uses a related blue for the EKT wordmark and links, with a restrained red action accent; the red is a prototype choice, not a claim about the official primary brand color.
- Actual 21st MCP search and retrieval supplied [Attachment Composer Tray](https://21st.dev/@sean0205/components/attachment-composer-tray). The implementation adapts its conditional attachment tray, removable attachment chip, explicit button types, accessible labeling, and capped composer textarea. It does not import the reference's unrelated dependency tree.
- `21st init --design-context` was run successfully in this project.
- `21st review src/app/globals.css src/components` completed: six files checked, two informational hardcoded-color notices in the CSS token definition and stylesheet. No automatic fixes were applied; these declared project colors are intentional.

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
