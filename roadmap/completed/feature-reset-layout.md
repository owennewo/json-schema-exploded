# Feature: reset layout

Part of: campaign-v1-schema-canvas.md

A canvas control (⟲, next to snap-to-grid) that discards every hand-placed position and lays the graph out again with ELK. Hand-placed positions always win over auto-layout, so once a canvas has been dragged around there is no way back to a clean arrangement — this is that way back.

- Clears `positionsRef`, saves (the layout file keeps only `depth` afterwards), re-runs `layoutPositions` over the visible subgraph, then refits the viewport.
- Cards depth currently hides get no fresh coordinate; the base layout effect places them against the now-empty positions when depth next draws them.
- Disabled while focused: the focus overlay ignores saved positions entirely, so there is nothing there to reset.
- No confirmation and no undo — auto-layout is deterministic, so a reset arrangement is exactly the one a first open of the schema would have produced.

Done when: drag cards into a heap, press the button, the graph is laid out cleanly again and the layout file's `positions` is `{}`.
