# Feature: the view as a link

Part of: campaign-v1-schema-canvas.md
Follows: feature-schema-by-url.md

`?remote=` shares a schema. It does not share a *view* — the recipient lands on
159 definitions with no idea which one you meant, at whatever depth their own
session last used. The interesting half of this tool is where you are standing
in a schema and how much of it you have chosen to draw, and none of that
travelled.

A second icon beside the breadcrumb's copy button puts the whole view on the
clipboard:

```
?remote=<schema url>&sel=$defs/arpeggio&focus=1&d=3.all.2
```

- **`sel`** — the selection: entity, row or edge. It is the anchor depth grades
  from, so it decides the shape of the graph and not just what the detail panel
  shows.
- **`focus`** — `1` when focus mode is on.
- **`d`** — all three axes, dot-separated, `all` for `Infinity` (the spelling
  the layout file already uses).
- **`schema=<name>`** stands in for `remote=` when the schema is a local file
  with no URL to give. It only means anything to someone with the same
  `schemas/` directory, which is why a URL is preferred whenever there is one.

## Applied once, then cleared

The parameters are read at import time — effects rewrite the address bar, and
by the time one runs they may already be gone — applied to the first schema
load, and then wiped off the URL. The session store already remembers
selection, depth and viewport per schema, so a reload keeps the view; leaving
the parameters up would only let them describe a view you had since clicked
away from.

A link whose URL matches something already in `remote-schema-urls.json` opens
*that* entry rather than a second copy of it under a filename nobody chose.

## Resolved while building

1. **The icon is drawn, not typed.** Every other glyph in the chrome is a
   character, which is a bet on font coverage — fine for `⧉` and `▾`, not for a
   chain link, where the fallback is an empty box. It is a two-path inline SVG
   at 11px, taking `currentColor` so it inherits the button's state.
2. **A link is only as good as its round trip**, so the check is: copy from one
   browser, open in a fresh one with no localStorage, and compare schema,
   anchor, focus, depth and the number of cards drawn. All five match.

Done when: the icon copies a link; opening it in a browser that has never seen
the app reproduces the schema, the anchored node, focus mode and all three
depth settings; and the address bar is clean afterwards.
