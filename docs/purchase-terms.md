# Public purchase guidance

Checked on 2026-09-23. Only public, first-party EKT pages were read. No private catalog, customer session, basket mutation, payment or order was used for this research.

| Topic | Evidence and application behavior |
| --- | --- |
| Payment | Individual and business payment options are documented in [EKT public information](https://ekt.kz/about/information/). The app reports those options with the source; it does not collect payment. |
| Delivery and collection | [Delivery terms](https://ekt.kz/checkout-delivery/) support collection and manager coordination for intercity delivery. An exact delivery quote requires the destination and manager confirmation. |
| Conflicting price thresholds | The dedicated delivery content says over 30,000 KZT, while its repeated footer and [ordering instructions](https://ekt.kz/about/howto/) say over 15,000 KZT. The app explicitly reports the conflict, without calculating a free-delivery entitlement. |
| Conflicting schedules | Delivery terms publish 48 hours and 09:00–17:00; ordering instructions publish next day and 09:00–18:00. Neither becomes a guaranteed date. |
| Minimum order | Not established in the reviewed delivery, ordering and [FAQ](https://ekt.kz/about/faq/) sections. Absence of a discovered rule is not proof of no minimum. |

`src/server/purchase-terms.ts` is the small curated source for UI/API guidance. Each item carries its public URL and check date. These records are a dated research snapshot; they are not a live policy feed. Recheck the official source before changing the guidance. Native EKT cart integration cannot be inferred from these website instructions.
