# Feature: remote schemas from a URL map

Part of: campaign-v1-schema-canvas.md

Every schema the canvas can open is a file in `schemas/`, which means a schema
maintained in someone else's repo is only ever a copy — right the day it was
downloaded, quietly stale afterwards. `mnx-schema.v33.json` was that copy: the
MNX schema is edited upstream (three commits on the day this was written) and
nothing here would have noticed.

A schema can now be listed as a **URL** instead, in a committed
`public/remote-schema-urls.json`:

```json
{
  "mnx": "https://raw.githubusercontent.com/w3c-cg/mnx/main/docs/mnx-schema.json"
}
```

Those entries join the picker under a **remote** heading, each naming the host
it reads from, and the header marks a loaded remote schema with `⇗`. Opening one
fetches it — so it is whatever upstream serves now, not what it served the day
someone saved it. The URL map is read as a static asset, per load, so adding an
entry takes a reload rather than a restart.

## No backend, deliberately

The page fetches the remote URL itself. There is no proxy endpoint in
`vite.config.ts`, which is what makes the built app deployable as static files
with nothing behind it (GitHub Pages), and `base` is `'./'` so a build runs from
`/<repo>/` without being told the repo name.

Consequences, all of them stated rather than discovered:

- **CORS is the limit.** The page can only read a host that sends
  `access-control-allow-origin`. `raw.githubusercontent.com` sends `*`, so
  anything in a public GitHub repo works. A host that doesn't is not reachable
  from here, and a blocked cross-origin fetch fails opaquely — no status, no
  body — so `fetchSchemaText` names the likely cause instead of echoing
  "Failed to fetch".
- **A missing local listing is not an error.** `/schemas` is a dev-server
  middleware; on a static host it 404s, the local half comes back empty, and the
  picker holds the remote entries alone. That is the deployed state, not a
  failure — and it means a public deploy ships no local schema unless one is
  deliberately put in `public/`.
- **A GitHub blob URL is normalised to its raw file**, and a bare host is
  assumed `https`. Pasting the URL from the address bar is the obvious mistake
  and it costs three lines to accept it.
- **One name, one schema.** The session, the layout file and the validation
  scope are all keyed by the schema's name, so a remote entry whose name
  collides with a file in `schemas/` is dropped (local wins) and says so in the
  picker. Problems with the map are reported there too — it is the one place
  where a URL that doesn't work is worth reading about.

## Deliberate limits

- **No offline copy.** A remote schema is fetched on every load (`cache:
  'no-cache'` — revalidate, but let an ETag save the download). Upstream being
  unreachable means the schema does not open. Caching the last good copy is a
  plausible follow-up; tracking upstream was the point of the feature.
- **Positions still need a dev server.** `saveLayout` PUTs to the dev
  middleware; on a static host that write fails and is swallowed, and only depth
  survives a reload (it mirrors into the browser session). Hand-placed cards are
  a dev-server feature until the session store carries positions too.

Done when: `remote-schema-urls.json` lists the MNX schema, the picker shows it
under **remote** with its host, opening it draws the live upstream document with
its validation counts, the selection survives a reload — and the same thing is
true of `npm run build` served from a static directory at `/<repo>/` with no
server behind it.
