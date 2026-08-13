# Feature: panel enhancements

Part of: campaign-v1-schema-canvas.md

Upgrade the side panels around the canvas: a new folding JSON panel on the left, and a reworked permanent detail panel on the right.

**Left panel — JSON view**

- Collapsible panel displaying the loaded schema as folding JSON (expand/collapse nodes).
- Cross-panel highlighting: the entity/property selected in the canvas or right panel is highlighted (and scrolled into view) in the JSON tree; selection stays in sync across all panels.

**Right panel — detail view**

- Permanent (always present) but collapsible. With nothing selected, shows the schema/root entity instead of being empty.
- When an entity is selected, its properties are listed below the entity description.
- Properties in the list are clickable, drilling into that property's full detail — particularly its description, which can be long in this schema.

Done when: the left panel folds/unfolds JSON and highlights the current selection made elsewhere; the right panel is collapsible, shows the root entity by default, lists a selected entity's properties under its description, and clicking a property reveals its full detail.

Addendum: the JSON panel gained a Tree/Raw mode toggle — Raw shows the schema pretty-printed (2-space, `JSON.stringify`-identical), keeps the cross-panel selection highlight scrolled into view, and has copy-to-clipboard.

Addendum: the detail panel stops at the entity level — selecting a property no longer navigates away; the owning entity's view stays put (the property highlighted in its list) and a dismissable **Field** section appears below with the property's full detail.

Addendum: entity/field details render the schema node's own keys literally (`title: "…"`, `description: "…"`, `x-propertyOrder: [...]`, custom `x-*` included), values colored by type, resolved from the raw document; large subtrees summarize as `{n keys}`/`[n items]`. Scalar-def rows also list the referenced def's keywords. Replaces the derived prose/badge rendering.
