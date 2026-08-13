# Feature: design refresh — header, entity panel, chrome

Part of: campaign-v1-schema-canvas.md

A design pass over the whole chrome, from a review of the shipped UI. No region
moves and no colour is invented: everything comes from the existing token set,
plus two darker surface steps for panel stratification and chip tints derived
from the `--syn-*` JSON syntax colours the app already ships.

- **Header (33px → 44px), three zones** — document (brand, schema picker),
  anchor (breadcrumb), view/status (depth, focus, validation, theme) — separated
  by hairlines that fade at both ends. Seven controls at one visual weight
  became three groups.
- **Depth is one control, not three selects.** A readout (`detail  a 3 · { } 0 ·
  → ∞`) opens a popover where each axis gets a name, a one-line caption and a
  5-step segmented track (`0 1 2 3 ∞`), with a live footer reporting the
  consequence (`21 cards drawn, 14 folded to a residue chip`). Reclaims ~150px
  and moves the tool's primary mental model out of tooltips.
- **The anchor is named.** `ANCHOR` + a monospace crumb with `/` separators (it
  is a schema path, not a wizard), terminating in a `⌖` pill carrying the
  selection's type chip. `⌖` is the anchor glyph everywhere: crumb, focus,
  depth popover.
- **Native `<select>`s are gone.** Schema picker, depth and validation scope are
  popovers (`Popover.tsx`) — they close on outside click and on Escape, marking
  the event so closing one does not also clear the selection.
- **Drift/parse status has a fixed slot** in the status zone. It used to render
  between the picker and the crumbs, so a warning appearing shoved the whole
  breadcrumb sideways.
- **Validation verdict is visible without opening anything**: a `✕ n · ⚠ n` pill
  in the header (click opens the footer), and the collapsed 32px footer strip
  carries the per-profile verdict inline (`basic ✓ pass · openai strict 172 6 ·
  …`). One run backs both — `useValidation` — with the scope choice in the store.
- **Entity panel is three fixed regions, not one scroll** (340 → 380px): a
  pinned subject header on a raised surface (kind glyph, name, path field +
  copy, `↑ parent`, `null ok`, `⌖ focus`), a scrolling body, and the selected
  field pinned in its own drawer at the bottom. Inspecting a field no longer
  scrolls the entity context off the top, so `scrollIntoView` is gone.
- **Property table**: three aligned columns — name, flag, type chip — in a
  bordered block with row rules. Flags are words (`req` / `null`), not a 4px
  `*` and a `?` inside a chip. The selected row keeps the accent inset bar and
  stays where the schema put it — a row that moves when you click it is worse
  than one you have to scroll to. A selection arriving from elsewhere (canvas,
  JSON panel, validation finding) scrolls itself into view instead.
- **The raw keyword dump is available, not first**: `x-propertyOrder` rendered
  literally is four lines listing the same names the table shows. It now lives
  behind a `Raw keywords` disclosure; the description is prose above it.
- **Type chips carry the type's colour** (`chipTone.ts`), taken from the syntax
  tokens: string, number, enum/array, const. Panel, cards and JSON view now
  agree on what colour a `string` is. Light `--syn-number` moved from purple to
  teal — chips made the pre-existing collision with `--array` load-bearing.
- **Selection reads as a chain**: the containment path from root to anchor is
  stroked in the accent while every other edge drops to `--edge-dim`, and cards
  get an accent ring + halo instead of a 2px outline (which is ~1px at the zoom
  a 25-card graph is actually viewed at).
- **Chrome consistency**: rules fade at their ends, radii unified at 6px for
  controls / 8px for surfaces, section labels are monospace 9.5px at 0.1em, and
  canvas controls/minimap sit *on* the canvas (panel surface, border, shadow).
- **`F` toggles focus**, since the control now advertises the shortcut.
- React Flow's default lock button is replaced by `⌗` snap-to-grid on the
  canvas background's own 20px pitch.

## Deliberate non-changes

- **Blue stays the accent.** Purple already means *array* here; adopting a
  blurple accent would collide with an existing semantic.
- Five-region layout, card anatomy and depth semantics are unchanged — only the
  depth *control* changed.
- The React Flow attribution badge stays: hiding it is a paid-plan option.

## Not built (from the same review, in value-per-effort order)

1. `⌘K` type-ahead palette over entities, properties and `$defs`.
2. Keyboard navigation of the selection (`↑/↓` rows, `←/→` the chain, `Enter` to
   traverse, `1/2/3/0` depth) — only `Esc` and `F` are bound.
3. Persist `leftOpen` / `rightOpen` / `bottomOpen` / `mode` to the layout file.
4. Diff mode between two schema versions.
5. Make the residue chip a control that raises depth for its card alone.
6. Per-card validation badges on the canvas.
7. `x-propertyOrder` drift as a validation rule rather than a keyword dump.
8. Twin cards: merge behind a `×2` badge or draw the twin relation explicitly.
9. A JSON parse failure should take over the canvas region with its location,
   rather than rendering as a red string in the header.
