# Feature: open any schema by URL

Part of: campaign-v1-schema-canvas.md
Follows: feature-remote-schemas.md

The URL map made remote schemas possible but kept them curated: to look at a
schema you had to commit it to `remote-schema-urls.json` first. That is the
right home for the handful you come back to, and entirely the wrong ceremony
for "what does *this* one look like".

Two ways in, both landing on the same ad-hoc source:

- **`?remote=<url>`** on the query string. The deployed app becomes a viewer you
  can link to: paste a URL after `?remote=` and that schema opens.
- **A box at the foot of the schema picker.** Type or paste a URL, press open.

Opened schemas are remembered in the browser (newest first, capped at ten) and
listed under a **from url** heading, so they survive a reload and are one click
away for the rest of the session — but they are never written to the URL map.
That file stays a deliberate, committed list.

## The address bar follows the selection

Whenever an ad-hoc schema is showing, `?remote=` is on the address bar; the
moment a listed one is, it is gone. What you copy out of the browser is
therefore a link to the schema you are looking at, not to the app — which is
the whole reason the query string is worth supporting over a text box alone.

## Resolved while building

1. **Names are identity, so two URLs must not collide into one.** The session,
   the layout file and the validation scope all key on the schema's name, and a
   URL's filename is a terrible unique key — half the schemas on GitHub are
   called `schema.json`. `uniqueName` appends `(2)`, `(3)` … so two of them are
   two entries with two sets of saved card positions.
2. **A deep link opened the default schema.** The effect that syncs the address
   bar runs on the first render too, when the source list is still undefined and
   nothing can match — so it deleted the incoming `?remote=` before the loader
   had read it. It now waits for the sources to arrive. Worth stating because
   the bug was invisible in the code and total in effect: the feature's headline
   case did nothing.
3. **Normalisation is shared with the URL map.** A bare host gets `https://`, a
   GitHub blob page becomes its raw file. Pasting the URL out of the address bar
   is the obvious thing to do and it now works.
4. **No new failure path.** An unreachable or non-JSON URL surfaces through the
   error the loader already had, CORS named as the likely cause.

Done when: `?remote=<mnx url>` opens MNX on a cold load and survives a reload,
a URL typed into the picker opens it and appears under **from url**, the query
string appears and disappears as the selection moves between ad-hoc and listed
schemas, and two schemas that share a filename remain two entries.
