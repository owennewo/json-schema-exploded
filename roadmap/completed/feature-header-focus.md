# Feature: header panel, breadcrumb & focus mode

Part of: campaign-v1-schema-canvas.md

A full-width header bar replacing the floating toolbar, hosting the app title, schema picker, drift warnings, a selection breadcrumb, and global actions — the home for future global toggles (feature-visibility-controls.md).

- **Breadcrumb**: the selection's containment path (`schema › Tax Status › client › tax_residencies`), row selections appending their row, edge selections appending their label. Every ancestor crumb is clickable and moves the selection there — def cards chain from the card itself.
- **Focus mode**: a global on/off toggle. When on, the canvas shows only the selected entity's neighborhood — the anchor plus every direct neighbor over any edge kind: containment parent, children, ref targets, and *incoming* refs (who references this def). Focus overrides collapse state, relayouts the visible subgraph, and refits the viewport on each refocus. Row/edge selections resolve to their owning/source entity as the anchor.
- Breadcrumb + focus compose into the navigation loop: focused three layers deep, clicking an ancestor crumb refocuses one or two levels up; Escape clears the selection and drops focus back to the full graph. Focus is a session view mode, not persisted to the layout file.
- **Position isolation**: focus positions are an overlay, never written into the base graph. The focus layout is computed fresh from the neighborhood alone (saved positions are ignored — they describe the full graph) and translated so the anchor stays exactly where it already sits on screen. Base positions are untouched while focused, so leaving focus restores the full graph verbatim and needs no refit; drags made inside focus are ephemeral and never persisted.
- Deliberate limit: "extends" is not an edge, so `global-attrs` does not appear in every MNX def's focus neighborhood — by design, same hairball-avoidance as ref-support's extends rendering.
