# Legal review

What a lawyer needs for the Terms (`apps/site/src/pages/terms.md`) and the Privacy policy
(`apps/site/src/pages/privacy.md`), as of 2026-11-08. Both pages still carry the "Draft for
lawyer review" note, which comes off once this list is settled.

## The company

GalleoApp, Inc., a Delaware C corporation (incorporated 8 September 2026, Delaware file number
10762410), run from 3704 Lakepoint Drive, Severn, ON L3V 8M9, Canada. That address is on the
IRS SS-4 and is the one used for the D-U-N-S number and Apple enrollment.

## Fixed on 2026-11-08

- The postal address and the Delaware entity, on both pages.
- The service providers: Render for the API, Neon for the database, Resend for email (named, where
  the draft said "an email provider"), and Sentry, marked to keep only once error reporting is on.
- Where data is processed: the United States.
- Cover photos keep their file's metadata, including location, and are shown in link previews.
  That's how the code works today (F6); the sentence goes when covers are cleaned on the device.
- How deletion works in time: rows straight away, files within minutes and once more after
  upload links expire.
- A governing-law clause with the choice left marked, and a line keeping consumer rights.
- Apple's licensed application terms, which Apple expects a custom EULA to acknowledge.

## Open questions for the lawyer

1. **Governing law and venue.** Delaware, where the company is incorporated, or Ontario, where
   it's run from. Courts or arbitration, and whether a class-action waiver is wanted or
   enforceable for consumers in Canada and the EU.
2. **Privacy law that applies.** PIPEDA (Canada) applies to a business run from Ontario. Does
   GDPR apply because EU residents can join events, and if so: the lawful basis for each kind of
   data, an EU representative (Article 27), and the transfer mechanism to the United States.
   Quebec's Law 25 and California's CCPA thresholds.
3. **A privacy officer.** PIPEDA expects someone accountable to be named. Naib, at
   support@lingercam.app, or a separate privacy@ address.
4. **Minimum ages.** The draft says hosts are 18 or have a parent's permission, and the service
   isn't directed at children under 13. Guests have no age gate. Whether that's enough under
   COPPA, GDPR's age of digital consent (13 to 16 by country) and Apple's age rating.
5. **Photos of other people.** Guests photograph people who never agreed to the terms. What the
   terms should ask of guests and hosts, and how a person in a photo asks for it to be removed
   (today: through the host, or by email to support).
6. **Child sexual abuse material.** The terms say it's reported to the authorities. As a US
   company that becomes a provider's duty to report to NCMEC; confirm the process and any
   Canadian reporting duty.
7. **Copyright notices.** Whether to register a DMCA agent with the US Copyright Office for the
   safe harbour, and the notice process to publish.
8. **Refunds.** App Store and Google Play purchases follow the stores' processes. Web purchases
   through Stripe need a stated policy, including the EU right of withdrawal for digital content
   that's used straight away.
9. **Liability cap.** The draft limits it to what was paid for the event in the last 12 months.
   Whether that holds for free events and across jurisdictions.
10. **Retention.** How long purchase records are kept after an account is deleted (D5), for tax
    and chargebacks, and how long database backups keep deleted data (Neon keeps a 7-day restore
    window).
11. **Licence to photos.** The terms take a licence to store, process and show photos to the
    event. Whether it should also cover the link-preview cover and the recap, and what happens to
    a guest's photos that others have already saved.
12. **EU Digital Services Act.** App Store Connect will ask for trader status. Whether the
    company is a trader under the DSA, and the contact details that then appear on the listing.

## Not changed

- The bracketed notes left in the pages (age per region, refund policy, liability per
  jurisdiction, backups and tax retention, the Sentry line) are questions above, so they stay
  until there's an answer.
