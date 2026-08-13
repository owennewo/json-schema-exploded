# Campaign: v1 schema canvas

Visualise a JSON Schema as a draggable node canvas: entities (objects and arrays-of-objects) as boxes with their scalar properties as rows, full detail in a right-hand panel, positions and collapse state persisted to a layout file.

## Stack (decided)

- Vite + React + TypeScript
- `@xyflow/react` (React Flow) — canvas, drag, click, hide
- `elkjs` (layered algorithm, left-to-right) — initial auto-layout
- `zustand` — UI state (selection, collapse)
- Layout state file next to the schema: `<schema>.layout.json` containing `{ positions: { [id]: {x, y} }, collapsed: [id, ...] }`, keyed by schema path (`tax_status.client.tax_residencies[]`) so it survives schema edits.

## Design rules

- Simple types (strings, numbers, booleans, enums) never get their own boxes — they are rows inside the owning entity.
- Entities show property names + compact type chips by default; descriptions, enum values, patterns and badges live in the click-through detail panel.
- Manually moved positions always win; ELK lays out only nodes that have never been moved.
- Nullability (`type: [X, "null"]`, or `null` inside an `enum`) renders as a nullable flag on the row, never as a union type.
- `x-propertyOrder` governs row order; declaration order is the fallback.

## Features

Phase 1 — walking skeleton
1. feature-scaffold.md
2. feature-schema-walker.md
3. feature-entity-nodes.md
4. feature-auto-layout.md

Phase 2 — interaction
5. feature-detail-panel.md
6. feature-layout-persistence.md
7. feature-collapse.md

Phase 3 — extraction workflow
8. feature-section-cards.md
9. feature-twin-detection.md

v2
10. feature-ref-support.md
11. feature-panel-enhancements.md
12. feature-header-focus.md
13. feature-visibility-controls.md
14. feature-validation-panel.md
15. feature-raw-view-polish.md
16. feature-dark-mode.md
17. feature-prop-depth-and-edges.md
18. feature-design-refresh.md
19. feature-depth-only-visibility.md
20. feature-session-persistence.md
21. feature-ref-affordance.md
22. feature-def-navigation.md
23. feature-reset-layout.md
24. feature-remote-schemas.md

## Decisions resolved

- Layout file writes go through a Vite dev-server middleware endpoint (`PUT /schemas/<name>.layout.json` in vite.config.ts) — chosen over a VS Code extension or the File System Access API because the app is a standalone dev tool.
- Remote schemas are fetched by the *page*, not by a proxy endpoint (feature-remote-schemas.md), so the built app is deployable as static files with no backend. The dev middleware stays what it is: local files and layout writes, neither of which a static deploy has.
