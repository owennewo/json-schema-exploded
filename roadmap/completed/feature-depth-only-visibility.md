# Feature: depth is the only visibility gate

Part of: campaign-v1-schema-canvas.md
Supersedes: feature-collapse.md

Per-card collapse is removed. It fought the depth controls and won — a card had
to be expanded before any depth setting could reveal what was inside it, so
`objects: all` did nothing to a collapsed card. Two gates on one question, with
the older one taking precedence, is a control that lies about what it does.

- **The card header loses its `▸`/`▾` toggle.** `collapsed` is gone from the
  store, from the layout file, and from the `layoutPositions` / `edgeViews`
  signatures.
- **The residue chip absorbs the collapse readout.** A collapsed section card
  used to say `12 ent · 77 props`; a card now says the same thing whenever the
  current depth leaves part of its subtree undrawn, combined with its own gated
  rows: `N ent · M props · K links`. Computed live in App from
  `effectiveHidden` rather than from a static subtree count, so it always
  describes *this* depth. `subtreeStats` is gone with it.
- **`DEFAULT_DEPTH.edges` is 1, not `all`.** With collapse gone, the old default
  would have drawn all ~90 entities on first paint. `edges: 1` draws the anchor
  and its direct children — for the fact-find schema, the root plus its 24
  sections, which is the view the collapsed-by-default sections used to give.
- **Old layout files migrate once.** A file carrying a non-empty `collapsed`
  array meant "this depth, but with those cards folded", so its edge setting was
  never the whole story; on load, `edges` is clamped to 1. The `collapsed` key
  is dropped on the next save, so the migration cannot fire twice.

The navigation loop is now one idea: select a card to move the anchor, and the
three depth axes decide how much is drawn downstream of it.
