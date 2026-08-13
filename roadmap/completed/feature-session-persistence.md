# Feature: session persistence

Part of: campaign-v1-schema-canvas.md

A reload is a refresh, not a fresh start. Browser-local view state in `localStorage` under `jse.session.v1` (`src/session.ts`), read once at startup and patched by whoever owns each piece:

- global: last schema that loaded, left/right/footer panel open state, focus mode, snap-to-grid, JSON panel tree/raw mode, validation scope
- per schema: last selection, canvas viewport, and a mirror of the depth settings

The layout file next to a schema stays the record of that schema's graph (positions + depth) and still wins on load; the session copy of depth is the fallback for when that file cannot be written or predates the depth key. Selection and viewport are session-only — they are one browser's place in the document, not a property of the schema.

Restoring the selection matters more than it looks: it is the anchor depth is graded from, so the same depth settings draw a different graph without it. A stored id that no longer resolves in the walk (the schema was edited between sessions) is dropped rather than restored, and a stored schema name that no longer exists falls back to the default.

Done when: hide a panel, switch schema, change depth, select a card, pan — then reload, and the page comes back looking the same.
