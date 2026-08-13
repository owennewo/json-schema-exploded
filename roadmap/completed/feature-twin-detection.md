# Feature: twin detection and drift lint

Part of: campaign-v1-schema-canvas.md

Structural hashing over entity subtrees (property names, type chips, nullability, enum values, patterns, formats — ignoring `description`/`title`) to find duplicates:

- **Twin badge** — an entity structurally identical to an earlier one shows "≡ \<name\>" (full path on hover). Only maximal twin subtrees are badged; a twin nested inside a twin is implied. On the flat fact-find schema this finds 13: the nine client/partner pairs, plus four genuine shape-shares the estimate missed (the two LPA documents; the four FG21/1 vulnerability drivers all matching `health`).
- **Drift lint** — any same-parent `client`/`partner` pair that is not structurally identical produces a toolbar warning listing exactly which properties differ, recursing into subentities. Scoped to the client/partner convention deliberately: generic near-identity thresholds false-positive on this schema's *intentional* variants (the six protection product shapes legitimately differ by a couple of fields), so cross-domain product drift is not linted.

Done when: the flat fact-find schema shows the 9 client/partner twin badges and zero drift warnings; removing one property from one twin produces a warning naming that property.

Verified: pristine schema → 13 badges (9 partner + 4 intra-person), 0 warnings; removing `cgt_exposure` from `tax_status.partner` → exactly one warning, "'cgt_exposure' missing from tax_status.partner", and the drifted partner loses its twin badge.
