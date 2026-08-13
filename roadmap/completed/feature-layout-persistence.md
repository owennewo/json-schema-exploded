# Feature: layout persistence

Part of: campaign-v1-schema-canvas.md

Node positions persisted to `<schema>.layout.json` next to the schema file: `{ positions: { [schemaPath]: {x, y} }, collapsed: [...] }`. Saved debounced on `onNodeDragStop`; loaded on open, with stored positions taking precedence over auto-layout. Keys are schema paths so the file survives schema edits; entries whose path no longer exists in the schema are dropped silently on save.

Carries the campaign's open decision on the write mechanism (Vite middleware endpoint vs VS Code extension vs File System Access API) — resolve it here.

Done when: move a node, reload the app, the node is where you left it.
