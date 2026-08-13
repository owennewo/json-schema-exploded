# Feature: visibility controls

Part of: campaign-v1-schema-canvas.md

Fine-grained control over what the canvas shows, at three scopes. The organizing idea: a relationship is just a property whose resolved type is an entity, so every property has two possible renderings — **row** or **edge** — and most "hide" operations are representation *switches* (demote edge → row), not deletions. A demoted relationship reappears as a row with the target def as its chip (`part-measure[]`), regaining the property ordering, the count, and the required `*` marker that edge rendering loses. Nothing becomes invisible-and-forgotten: anything hidden leaves a residue chip on its card ("2 links hidden"), like the existing "N hidden".

Scopes:

- **Global** (header actions): *hide all props* — every card renders header-only, a table-names-only ER view; *relationships as rows* — zero edges, every card a complete flat property list (the reading view); *extends lines on/off* as its own toggle, since `allOf` composition is a relationship that is not a property.
- **Per-entity**: *hide props* and *hide relationships* as separate toggles (today's collapse chevron conflates hide-own-rows with hide-containment-subtree — split them); plus per-entity demote-all-edges.
- **Per-relationship**: demote a single edge to a row, from the edge-click detail panel; promote back from the row.

Nuances the implementation must respect: a `$ref` to a scalar def is already a row and is not a relationship; a union property (anyOf) is one property fanning into several edges — demote collapses all branches into one row; containment edges demote to a row naming the inline shape.

State: `demoted: [propPath]`, `propsHidden: [entityId]`, and global mode flags join `positions`/`collapsed` in the layout file.

Done when: MNX can be viewed as (a) header-only cards, (b) a zero-edge flat-card view, and (c) the default view with `global-attrs`-heavy defs individually decluttered — and a demoted `part.measures` row shows `part-measure[]` with its `*` required marker, which the edge rendering cannot show today.
