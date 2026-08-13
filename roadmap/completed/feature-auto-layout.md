# Feature: auto-layout

Part of: campaign-v1-schema-canvas.md

Initial positions computed by elkjs (layered algorithm, left-to-right), fed with the real measured node dimensions — entity boxes vary a lot in height, which is why ELK over dagre. Layout runs only for nodes with no saved position; anything the user has moved keeps its stored coordinates.

Done when: opening the fact-find schema with no layout file produces a readable left-to-right tree with no overlapping nodes; re-running layout never touches a manually placed node.
