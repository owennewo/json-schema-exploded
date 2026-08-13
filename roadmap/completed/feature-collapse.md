# Feature: collapse subentities

Part of: campaign-v1-schema-canvas.md

A collapse toggle on any entity with children: collapsing hides all descendant nodes and edges (React Flow `hidden: true` over the full node set — nothing is removed from the graph). The collapsed entity shows a count of hidden descendants. Collapse state is stored in the same layout file as positions.

Done when: collapse/expand works at any depth, survives reload, and expanding restores descendants to their saved positions.

**Superseded by feature-depth-only-visibility.md** — collapse and depth were two gates on one question, and collapse won: a card had to be expanded before depth could show anything inside it. Depth is now the only gate; the count of hidden descendants survives as the residue chip.
