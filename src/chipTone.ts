/**
 * Type tone for a chip. The colours come from the JSON syntax tokens the raw
 * and tree views already use, so a `string` is the same colour on a card, in
 * the panel and in the JSON — an all-grey chip made the type unreadable
 * without reading the word.
 *
 * Input is `RowInfo.chip` as the walker produced it ("string", "int",
 * "enum(7)", "=null", "date[]", a scalar def name, ...).
 */
export function chipTone(chip: string, link?: boolean): string {
  if (link) return 'chip-link';
  let t = chip;
  while (t.endsWith('[]')) t = t.slice(0, -2);
  if (t.startsWith('=')) return 'chip-const';
  if (t.startsWith('enum(')) return 'chip-enum';
  if (t === 'string' || t === 'date') return 'chip-str';
  if (t === 'number' || t === 'int') return 'chip-num';
  if (t === 'bool') return 'chip-const';
  // ref, any, and scalar def names ("orientation") have no type colour
  return '';
}
