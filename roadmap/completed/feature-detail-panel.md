# Feature: detail panel

Part of: campaign-v1-schema-canvas.md

Right-hand panel showing the selected node's full detail: schema-path breadcrumb, description, enum value list, and badges for `format`, `pattern`, `uniqueItems`, `x-extraction`, `contentMediaType`. Row-level selection within an entity shows that property's detail. Selection state in zustand (`selectedId`), driven by React Flow's click handlers.

The fact-find schema's descriptions are long prescriptive prose, so this panel — not the canvas — is where they live; nodes stay compact.

Done when: clicking any entity or row shows its complete metadata; Escape or canvas click clears the selection.
