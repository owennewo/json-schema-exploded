# Feature: card annotations

Part of: campaign-refactor-dialect.md

Card-level dialect facts that today live only in raw JSON: closed objects and
curation comments.

- **`additionalProperties: false`** — a closed-lock glyph in the card header.
  In the refactor dialect every object is closed (§4 rule 2), so the glyph's
  real job is the *absence* case: an open object in a schema claiming the
  dialect is a defect, and the missing lock should be conspicuous (header tint
  or warning badge, matching the validation panel's finding).
- **`$comment`** — a curation dot on the card header (def-level comments) or on
  the row (property-level). The panel shows the comment as a callout block —
  these notes record deliberate deviations from the swagger (`curation:` notes
  from the lift, provenance notes in the refactor) and are the audit trail the
  change-log workflow depends on. Never render the dot for absent comments; no
  truncation in the panel.
- Both annotations join the copy-section output (`copySection.ts`) so a copied
  entity keeps its provenance.

Done when: every card of the refactor schema shows the closed lock; deleting an
`additionalProperties: false` in a scratch copy makes that card visibly warn;
the lift schema's `Client` card shows the curation dot and the panel quotes its
oneOf-curation comment verbatim.
