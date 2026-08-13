# Feature: dark mode

Part of: campaign-v1-schema-canvas.md

A global theme for the whole app — canvas, both side panels, header and the
validation footer — not a per-panel setting.

- Three-state preference in the header: **system** (default) / **light** /
  **dark**, cycled by one button, persisted to `localStorage` (`jse.theme`).
- `system` follows the OS live: flipping the OS preference re-themes the app
  without a reload.
- `theme.ts` resolves the preference to `light`/`dark` and stamps it on
  `<html data-theme>` (plus `color-scheme`, so scrollbars and the schema
  `<select>` follow). Resolving in JS rather than in a media query means
  `styles.css` carries **one** dark block instead of duplicating it for the
  attribute and the media query. It is applied in `main.tsx` before the first
  render, so a dark session never flashes light.
- Every color in `styles.css` is a token on `:root`, overridden in
  `:root[data-theme='dark']` — no rule holds a raw color. New colors go in the
  palette block.
- React Flow gets `colorMode={resolvedTheme}` (its own dark defaults for
  controls, minimap and background dots), with the few variables that show
  through pointed at our palette so the canvas matches the panels.

Done when: one header control switches the whole app between light and dark,
the choice survives a reload, and `system` tracks the OS preference live.
