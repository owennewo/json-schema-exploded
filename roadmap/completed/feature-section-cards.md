# Feature: section cards

Part of: campaign-v1-schema-canvas.md

Top-level sections are the app's real unit of work — each is lifted out whole and handed to an LLM as a standalone extraction schema — so treat them as first-class: one card per section (title + entity/property counts), collapsed by default, expanding into its entity subtree. Default view answers "which extraction owns this field?".

Each section card gets a **copy section schema** button that puts the exact flat JSON subtree on the clipboard — byte-for-byte what gets pasted into an extraction prompt. When viewing the deduped schema, the button runs the ref inliner first (replace `$ref` node with the def's contents, sibling keys win) so the copied output is identical to the flat schema's section.

Done when: the default view is ~20 section cards; copying `tax_status` from the deduped schema yields JSON deep-equal to the same section in the flat schema.
