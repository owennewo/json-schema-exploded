# Feature: raw JSON view polish

Part of: campaign-v1-schema-canvas.md

The Raw mode of the left panel was one `<pre>` of plain text with a `<mark>`
around the selection. Make it read like an editor.

- Gutter line numbers, indent guides, and syntax colors (keys, strings,
  numbers, `true`/`false`/`null`, punctuation) sharing the same `--syn-*`
  tokens as the JSON tree and the detail panel's keyword rows, so all three
  views color a value the same way in both themes.
- The selection is highlighted as a **block of lines** with an accent bar in
  the gutter, rather than as a text-flow `<mark>` that could start mid-line;
  its first line is still scrolled near the top of the panel.
- Lines wrap (the panel is 320px and this schema's descriptions are long), with
  continuations hanging off the indent instead of resetting to column 0 — so
  the raw view never scrolls horizontally.
- Clicking a line selects the nearest entity/row on the canvas, the reverse of
  the highlight that already flowed canvas → panel. A click anywhere inside a
  property's subtree resolves to that property.

`prettyJson.ts` now emits lines of typed tokens plus, per node, the span of
lines it occupies (and the inverse: line → deepest node). Its `text` output is
still byte-identical to `JSON.stringify(doc, null, 2)` — that is what
copy-to-clipboard emits, and it is checked against all four schemas.

Rendering a few thousand line components stays cheap because each line is
memoized: a selection change only re-renders the lines entering or leaving the
highlight.

Done when: Raw mode shows numbered, syntax-colored, wrapped lines with the
selection highlighted as a block, clicking a line selects it on the canvas, and
copy still yields exact `JSON.stringify(…, null, 2)` text.
