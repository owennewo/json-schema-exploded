# Feature: entity nodes

Part of: campaign-v1-schema-canvas.md

Custom React Flow node type for entities: a title bar (schema `title` or property name, plus an object/array badge) and one row per scalar property showing the name and a compact type chip (`string?`, `enum(7)`, `date`, `int`, …). Edges connect a parent entity to its child entities. Simple types never get their own boxes.

Done when: the full fact-find schema renders as boxes and rows matching the walker output, readable at default zoom.
