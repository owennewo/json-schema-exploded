/**
 * Where a loadable schema comes from.
 *
 * **Local** schemas are files in `schemas/`, listed by the dev server's
 * `/schemas` middleware. **Remote** ones are URLs in
 * `public/remote-schema-urls.json` — a committed `{ "<name>": "<url>" }` map —
 * fetched straight from the host by the browser. A remote schema is therefore
 * whatever that URL serves *now*: point one at a repo's raw file and the canvas
 * follows upstream instead of a copy that quietly went stale in `schemas/`.
 *
 * Deliberately no server of its own. The map is a static asset and the fetch is
 * the browser's, so remote schemas work identically on the dev server and on a
 * static host with no backend at all (GitHub Pages). Two consequences follow
 * from that and are worth stating rather than discovering:
 *
 * - **CORS is the limit.** The page can only read a host that sends
 *   `access-control-allow-origin`. `raw.githubusercontent.com` sends `*`, so
 *   anything in a public GitHub repo works; plenty of other hosts do not, and
 *   there is no proxy here to paper over it.
 * - **A missing local listing is not an error.** On a static host `/schemas`
 *   does not exist, so the local half comes back empty and the picker holds
 *   the remote entries alone. That is the deployed state, not a failure.
 */

/** paths resolve against the deployed base, which is "/" on a dev server */
const asset = (p: string): string => import.meta.env.BASE_URL + p;

/** the committed URL map, served as a static asset */
export const URL_MAP = 'remote-schema-urls.json';

export interface SchemaSource {
  name: string;
  /** absent = a file in `schemas/` */
  url?: string;
}

export interface SourceList {
  sources: SchemaSource[];
  /** problems with the URL map itself — reported in the schema picker */
  warnings: string[];
}

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** a bare host is assumed https, and a GitHub blob *page* means its raw file */
export function normalizeUrl(url: string): string {
  const abs = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return abs.replace(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/,
    'https://raw.githubusercontent.com/$1/$2/$3',
  );
}

/** the host a remote entry reads from, for the picker's second line */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function loadLocal(): Promise<SchemaSource[]> {
  try {
    const res = await fetch(asset('schemas'));
    if (!res.ok) return [];
    const names: unknown = await res.json();
    if (!Array.isArray(names)) return [];
    return names.filter((n): n is string => typeof n === 'string').map((name) => ({ name }));
  } catch {
    // no listing endpoint (static host), or it answered with something else
    return [];
  }
}

async function loadRemote(warnings: string[]): Promise<SchemaSource[]> {
  let raw: unknown;
  try {
    const res = await fetch(asset(URL_MAP));
    if (!res.ok) return res.status === 404 ? [] : failed(warnings, `${res.status} loading it`);
    raw = await res.json();
  } catch (err) {
    return failed(warnings, msg(err));
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return failed(warnings, 'expected an object of "name": "url" pairs');

  const out: SchemaSource[] = [];
  for (const [name, url] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof url !== 'string' || !url.trim()) {
      warnings.push(`${URL_MAP}: "${name}" has no URL`);
      continue;
    }
    out.push({ name, url: normalizeUrl(url.trim()) });
  }
  return out;
}

function failed(warnings: string[], why: string): SchemaSource[] {
  warnings.push(`${URL_MAP}: ${why}`);
  return [];
}

/** every schema the picker can offer, local first, remote appended */
export async function loadSources(): Promise<SourceList> {
  const warnings: string[] = [];
  const [local, remote] = await Promise.all([loadLocal(), loadRemote(warnings)]);
  const sources = [...local];
  const taken = new Set(local.map((s) => s.name));
  for (const r of remote) {
    // one name, one schema: the session, the layout file and the validation
    // scope are all keyed by it, so a duplicate would be two graphs sharing
    // one set of saved positions
    if (taken.has(r.name)) {
      warnings.push(`${URL_MAP}: "${r.name}" is also a file in schemas/ — the local one wins`);
      continue;
    }
    taken.add(r.name);
    sources.push(r);
  }
  return { sources, warnings };
}

/** the schema document's text, from wherever this source lives */
export async function fetchSchemaText(src: SchemaSource): Promise<string> {
  if (src.url === undefined) {
    const res = await fetch(asset(`schemas/${encodeURIComponent(src.name)}`));
    if (!res.ok) throw new Error(`${res.status} loading ${src.name}`);
    return res.text();
  }
  let res: Response;
  try {
    // no-cache, not no-store: revalidate every load so the canvas tracks
    // upstream, but let an ETag save the download when nothing has changed
    res = await fetch(src.url, { cache: 'no-cache' });
  } catch {
    // A cross-origin fetch the browser blocks fails opaquely — no status, no
    // body, nothing to report — so this is the one place worth naming the
    // likely cause instead of echoing "Failed to fetch".
    throw new Error(
      `cannot read ${src.url} — the host must send an access-control-allow-origin header, or be offline`,
    );
  }
  if (!res.ok) throw new Error(`${res.status} from ${src.url}`);
  return res.text();
}
