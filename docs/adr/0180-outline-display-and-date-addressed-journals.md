---
type: ADR
id: "0180"
title: "Outline display and date-addressed journals"
status: active
date: 2026-08-28
---

## Context

Tolaria's ordinary Markdown editor already supports nested list blocks, list
indentation, collapsed list children, and fenced code blocks. A Logseq-style
outline therefore does not need a second document model or a proprietary block
store. Users also need a predictable daily entry point that opens the note for
a calendar date without searching for or naming it manually.

## Decision

Outline notes remain ordinary Markdown notes and opt into a denser BlockNote
presentation with the system frontmatter field `_display: outline`. The mode
reuses the existing Markdown parser, serializer, nested-list commands, collapse
behavior, and code-block schema. Fenced code blocks nested beneath list items
stay nested Markdown children and round-trip through the same editor boundary.

Journals are outline notes with `type: Journal` stored at
`journals/YYYY-MM-DD.md`, where the date is the user's local calendar date.
Opening a journal resolves an existing note for that date before creating one.
The journal navigator moves by local calendar days and offers an explicit Today
action. Journal analytics contain only the navigation source and whether a note
was created; dates, paths, titles, and note content are excluded.

New-note surfaces expose Document, Outline, and Sheet as explicit choices while
the existing quick-new-document behavior remains unchanged.

## Consequences

- Outline notes remain portable Markdown and can switch display modes without
  migrating their body.
- Existing list, code-block, autosave, raw-mode, and Git behavior remains the
  source of truth instead of being duplicated for outlines.
- A journal date maps to one deterministic vault path. Existing files at that
  path remain subject to the normal create-collision safeguards.
- Journal navigation follows the user's local date rather than UTC, avoiding a
  day change at the wrong local hour.
- The `Journal` type is semantic metadata; `_display: outline` independently
  owns presentation.
