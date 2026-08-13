// Run the validation groups against every schema in schemas/ and print a
// summary — a smoke check for the rule library without launching the app.
//   npm run check:validation

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runValidation, type GroupResult, type Scope } from '../src/validation';
import type { JsonSchema } from '../src/walker';

const dir = join(import.meta.dirname, '..', 'schemas');
const names = readdirSync(dir).filter((n) => n.endsWith('.json') && !n.endsWith('.layout.json'));

function report(groups: GroupResult[], indent: string): void {
  for (const group of groups) {
    if (group.skipped) {
      console.log(`${indent}${group.label}: skipped — ${group.skipped}`);
      continue;
    }
    if (group.rules.length === 0) {
      console.log(`${indent}${group.label}: pass`);
      continue;
    }
    console.log(`${indent}${group.label}:`);
    for (const { meta, findings } of group.rules) {
      const first = findings[0];
      const loc = first.path.length ? first.path.join('/') : '(root)';
      console.log(
        `${indent}  [${meta.severity}] ${meta.id} ×${findings.length}  e.g. ${loc}${first.note ? ` — ${first.note}` : ''}`,
      );
    }
  }
}

for (const name of names) {
  const raw = readFileSync(join(dir, name), 'utf8');
  let doc: JsonSchema | undefined;
  try {
    doc = JSON.parse(raw);
  } catch {
    doc = undefined;
  }
  const sections = Object.keys(doc?.properties ?? {});
  const scope: Scope = sections.length > 0 ? 'sections' : 'document';
  console.log(`\n=== ${name} (scope: ${scope}) ===`);
  report(runValidation(raw, doc, scope), '  ');

  // and the same rules narrowed to one section, the way the canvas selection
  // scopes them — the first section, or the first $defs entry when the
  // document has none of its own
  const one = sections[0] ?? Object.keys(doc?.$defs ?? {})[0];
  if (one !== undefined) {
    const section = sections.length > 0 ? one : `$defs/${one}`;
    console.log(`  --- scope: selection (${section}) ---`);
    report(runValidation(raw, doc, 'selection', section), '  ');
  }
}
