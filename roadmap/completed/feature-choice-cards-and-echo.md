# Feature: choice cards + selection echo

Part of: campaign-refactor-dialect.md · refines: feature-tagged-unions.md, feature-def-navigation.md

Two changes from one observation: a def with no node of its own has no presence
on the canvas. Selecting `$defs/PersonParty` highlights nothing, and the tag
values of a union exist only as edge labels.

## 1. The junction becomes a card

Today a union renders as a compact `⑂ 1 of 3` pill and each variant leaves it
as a labelled edge. The pill is the one node in the app that breaks the grammar
everything else follows — *a thing with parts, each part anchoring its own
edge* — and it puts the variant tags in 9px edge labels that collide when the
fan is wide and vanish at zoom-out.

Render it as a card instead:

- **Header**: the property name (`party`), the `⑂` glyph, and a `1 of 3` chip.
  Not titled `anyOf` — the keyword is the *kind*, and a schema with several
  unions would otherwise show several identically-titled boxes in the canvas,
  the minimap and the breadcrumb. The keyword names the kind chip in the panel,
  where it already does.
- **One row per branch**, in document order. The row's name is the variant's
  tag value (`Person`), or the target def name when the union is untagged. Its
  chip is the def the branch is written as — **the elided wrapper when there is
  one** (`PersonParty`, dashed like every other ref chip), with the edge running
  on to the body def (`PersonValue`). That renders the `via` relationship that
  is currently reachable only through an edge tooltip, and gives a wrapper def
  its first visible home.
- **Scalar branches get rows too** (a mixed union's `string` arm), without an
  edge. The card then shows every branch, which is the point of it.
- **Variant edges leave from their row and lose their label** — the row names
  the variant, the same rule containment edges already follow.
- Rows are never depth-gated. A choice card with its rows hidden is a box that
  says nothing, and its edges would have no anchors to leave from.

### The risk this carries

A card with rows means "an object with these properties, all present at once".
A choice card means "exactly one of these applies". If it reads as the former
it actively misinforms, which is worse than the pill — a pill cannot be
misread. The header glyph, the `1 of N` chip, a distinct header tint and tag
chips (not type chips) on the rows all exist to carry that difference.

### What stays true

A row is a use site, not the def. Two unions that both allow `PersonParty` draw
two rows and route both edges to the one `PersonValue` card — the same way
`client` and `partner` are two rows into one `person_details`. Shapes are drawn
once; references are drawn wherever they are made.

## 2. Selection echo

The card fixes wrapper defs, and only those. `Country` (6 uses),
`product_provider`, and mnx's 78 cardless defs are type chips on other cards'
rows; no box will ever give them a node.

So: **when a definition is selected, its use sites light up on the canvas.**
Select `Country` and the six rows that use it mark across every card that has
one. Select `PersonParty` and its variant edge strokes. The mechanism already
exists — the containment chain to the anchor strokes exactly this way — and
`indexUseSites` already knows which rows, edges and cards to light.

- rows (property use sites): a marked row, distinct from the selected row
- edges (variant use sites): stroked like the selection chain
- cards (allOf extenders, the entry `$ref`): an outlined card
- applies to any `$defs/*` selection, card or not: "2 uses" on a def card
  becomes something you can see rather than a number you have to trust.

The panel's **Referenced by** list and the canvas then say the same thing at the
same time, which is the point — one is a list you read, the other is a shape you
recognise.

## Decided while building

- **The kind glyph is `( | )`, not `⑂`.** The fork character isn't in the
  header's monospace stack and rendered as tofu. The kind slot already speaks in
  bracket pairs — `{ }`, `[ ]` — so the choice got one of its own.
- **A wrapper echoes as a row, not an edge.** Once the variant row is typed by
  `PersonParty`, selecting that def lights the row, and the edge stroke is
  redundant. Edge echo stays for the untagged case, where a branch has no
  wrapper to name.
- **The variant row reaches its wrapper.** The drawer's `open $defs/…` now
  offers any def, not only ones that own a card — every def is a subject since
  feature-def-navigation, and the wrapper is exactly the def with no card.

## Verified

Browser session on all four schemas, plus `check:walker` / `check:validation`.

- **Choice card**: `party`, `1 of 3`, rows `Person` / `Corporate` / `Trust`
  chipped `PersonParty` / `CorporateParty` / `TrustParty` (dashed), each row
  anchoring its own edge to the body def. Variant edges carry no labels — the
  rows do. Panel titles it `party` with kind chip `anyOf`.
- **Variant row selected**: drawer reads `Person`, chip `PersonParty`, badge
  `def: PersonParty`, button `open $defs/PersonParty`, path
  `$defs/Client.party/Person`.
- **Echo**: `PersonParty` → 1 row (its variant row); `Country` → 6 rows across
  `TrustValue` and `TerritorialProfileValue`; `NamedStatus` → its own card
  selected *and* its 2 use rows lit. The panel's Referenced by list and the
  canvas agree, item for item.
- mnx and the deduped fact-find render unchanged (no junctions in either);
  dark mode checked; no console errors.
