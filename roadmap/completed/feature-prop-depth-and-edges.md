# Feature: prop depth, object rows & edge anchoring

Part of: campaign-v1-schema-canvas.md

Today a property is either a row (scalar) or an edge (object) — never both — and every entity shows every scalar row at every depth, so the far side of the canvas is as noisy as the part being read. This feature makes rows *and* the graph itself **depth-graded from the focus anchor**, lets an object prop render as a row *and* an edge at the same time, and fixes the three edge-rendering defects that make object-props-as-rows worth having: edges that ignore the row they belong to, edges that all leave a card at the same height, and edges that don't say whether they mean one or many.

## Global depth options

Three header controls, all measured **downstream from the anchor** — level 1 is the anchor itself, its children are level 2, and "child" means any outgoing edge, containment or ref alike:

- **scalar rows** (`0 | 1 | 2 | 3 | all`) — how many levels of cards render their scalar props as rows. Default `1`.
- **object rows** (`0 | 1 | 2 | 3 | all`) — how many levels of cards render their object props as rows. Default `1`.
- **edges** (`0 | 1 | 2 | 3 | all`) — how many hops of child edges to draw. Default `all`.

Scalar `1` + object `2` = the anchor shows both kinds, its children show only their object props, grandchildren show nothing but a header. `0` hides that kind everywhere; `all` disables the gate (today's behaviour for scalars).

The row options count *cards*; the edge option counts *hops*, so edges `N` reveals cards down to level `N+1` — `0` is the anchor alone, `2` is the anchor, its children and its grandchildren. The off-by-one is deliberate: each control is named for what it draws. The row options subtract rows; the edge option subtracts graph — an edge past the depth is not drawn, and **a card is only shown if an edge reached it**, so pruning the edge takes the child card with it.

**This is not focus mode.** Edge depth walks child edges only; focus mode takes the anchor's neighbourhood in *both* directions, including the containment parent and every def that references the anchor. They are separate axes and compose: focus on plus edges `2` = the anchor's inbound neighbourhood, with its downstream cone drawn two hops out. An inbound counterpart ("how many levels of referencing parents") is a plausible fourth control and deliberately not in this feature.

Consequences worth stating:

- A card at the boundary keeps its link rows even though the targets are gone — the row becomes the only evidence of the pruned subgraph, and no dangling line is drawn for it.
- Depth is the shortest downstream path, and refs count as child edges: a def the anchor references directly is level 2 even when its containment parent sits deeper or is pruned. Ref cycles are BFS-visited once, like everywhere else in the walker.
- Cards outside the cone entirely (the anchor's parents, unrelated sections) have no level: under a finite edge depth they are not drawn, and under `all` they draw with header only unless a row option is set to `all`.
- Boundary cards carry the residue chip collapse already uses, so a pruned cone is visibly pruned rather than absent.

- **Anchor** is the one focus mode already computes (`anchorId` in App.tsx — an entity selection; a row resolves to its owner, an edge to its source). With no selection the anchor is the entry entity (`isEntry`), so the canvas is always graded from somewhere stable rather than flipping between "graded" and "ungraded".
- Still orthogonal to collapse: collapse prunes a *subtree from a named card*, edge depth prunes *past a hop count from the anchor*. They compose by union — an entity is hidden if either rule hides it, and neither is expressed in terms of the other.
- Nothing goes silently missing: the header's `N hidden` chip extends to `N props · M links` on cards whose rows are gated away.
- The row options change card heights, the edge option changes the node set; both re-run the existing relayout path (the `effectiveHidden` effect), and manually moved nodes still win.

## Object props as rows

The walker gains a row for every object prop it currently emits only as an edge — direct ref, array-of-ref, map alias, `patternProperties`, and inline containment — flagged as a link row (`link: { edgeId, targetId }` on `RowInfo`) and sitting in its `x-propertyOrder` position. The walker always emits it; the renderer decides whether to draw it. That keeps depth gating a pure view concern and gives the detail panel and breadcrumb a stable id to select.

- The chip is the target plus its marker: `person_details`, `tax_residency[]`, `kit-component{}`; inline containment chips the child card's label. Required `*` and nullability render exactly as on a scalar row — the two things edge labels cannot carry, and the reason feature-visibility-controls.md wanted demotion in the first place.
- A union prop (anyOf branches) is **one** row with several edges leaving it.
- The row does not depend on the edge being drawn: when the target is hidden by collapse or focus, the row survives and is the only remaining evidence of the link.
- Selecting the row and selecting the edge must land on the same detail-panel payload, so the panel needs both ids resolving to one prop.

## Edges leave from their row

When a link row is drawn, its edge leaves from that row, not from the card's midpoint.

- `EntityNode` renders a per-row source `Handle` (`id = row.id`, `Position.Right`) on every link row it draws; `EdgeInfo` carries the emitting row id, and App.tsx sets `sourceHandle` when the source card is actually drawing that row.
- When the row is not drawn (depth-gated, or the card is collapsed), the edge falls back to a laddered node-level handle — below.
- The target end keeps a single left port. The target's rows are its own props, not the link's; landing on a row would imply a foreign key that JSON Schema does not have.

## Laddering the un-anchored edges

Every card renders a strip of node-level handles down each border and assigns each edge a slot, instead of every edge sharing the vertical midpoint.

- Source slots follow property order, so the ladder reads in the order the rows would have appeared. Target slots order by the source card's y, so lines cross as little as possible; both are computed once per relayout, not per render.
- Rungs sit at a 14px pitch centred on the card; a card too short for that many edges tightens the pitch and bleeds up to 20px past its own border rather than stacking them at one height.
- Two props pointing at the same entity (`client` and `partner` → `person_details`) then differ at both ends and draw as two separately readable lines. Today they are two edges on one identical smoothstep path with their labels stacked on top of each other, which reads as one relationship.

## Cardinality markers

Edge ends state multiplicity: **circle = one, triangle = many** (crow's foot).

- Custom SVG `<marker>` defs mounted once in the canvas, referenced per edge via `markerEnd`.
- Many = `[]` array-of-ref, `{}` map, and containment into an `array` entity. One = everything else.
- For that to be uniform, the walker should set `marker: '[]'` on containment edges whose target is `kind: 'array'` — today only ref edges carry markers, and array-of-inline-object containment is exactly as "many" as array-of-ref.
- Required/optional at the source end is deliberately left off: `*` already lives on the row.

## Relationship to feature-visibility-controls.md

That feature models row-vs-edge as a **switch** — demoting an edge to a row removes the edge. This one adds a third state, *row and edge together*, and makes the baseline depth-graded rather than all-or-nothing. They compose cleanly if the depth options set the baseline and the per-relationship demote/promote becomes an override on top of it; visibility-controls' global "relationships as rows" is then `object rows: all` plus edge suppression. Its wording needs a pass once this lands.

## Resolved while building

1. **The defaults shipped as asked**: scalars `1`, objects `1`, edges `all`. Every card except the anchor is header-only until you raise a gate, which is a much emptier canvas than before — `scalars: all` restores the old reading view in one click.
2. **Persistence**: `depth: { scalar, object, edges }` joins `positions`/`collapsed` in `<schema>.layout.json`, per schema. `Infinity` has no JSON spelling, so `all` is the on-disk form. Focus mode stays session-only as before.
3. **Focus and depth compose by union** — an entity is hidden if either rule hides it. Collapse composes the same way, except focus still overrides it, as it did before. **With one exception, added later:** focus's *inbound* neighbours are exempt from the edge gate. They have no downstream level, so a plain union hid every one of them at any finite edge depth — the inbound half of focus existed only at `all`, and `focus + edges 2` did not mean what line 19 above says it means.
4. **Row anchors have to exist before the edge asks for one.** React Flow drops an edge whose handle id it cannot find, so the ladder pool is sized by the schema rather than by what is visible, and a link row keeps its anchor (parked, carrying nothing) in the frames where the card is not drawing that row. Same reason a collapsed card never hosts a row anchor: it renders header-only, so the row is not there to leave from.
5. **A string `markerEnd` is a marker *id*** in React Flow — it wraps it as `url('#id')` itself. Passing `url(#id)` yields `url('#url(#id)')` and silently draws nothing.

Done when: with scalar `1` + object `2` and `client` selected, the client card shows both prop kinds with its object rows in `x-propertyOrder` position, its children show object rows only, grandchildren are header-only with a `N props · M links` chip; the `client` and `partner` edges into `person_details` leave their own rows at different heights and are both readable; an array-valued relationship ends in a triangle where a single-valued one ends in a circle; and dropping edges to `1` leaves the client card, its direct children, and nothing below them — with the children's link rows still naming the subgraphs that went away.
