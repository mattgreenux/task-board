// Reads one list out of a Markdown file and writes it back, leaving everything
// else in the file exactly as it was. The format rules this relies on are in
// docs/Task-Board.md › Markdown format.
//
// A list is a run of top-level items ("1. …" or "- …" starting at column 0).
// Each item can have indented lines under it (its notes / sub-bullets).

const ITEM = /^(?:\d+\.|[-*+])\s+(.*)$/; // a top-level item line
const INDENTED = /^[ \t]+\S/; // a line belonging to the item above it
const SECTION_END = /^#{1,2}\s/; // a "# " or "## " heading ends a section

export class ListFormatError extends Error {}

const isBlank = (line) => line.trim() === '';

// Splits `text` into { before, items, after }. `before` and `after` are the
// untouched lines around the list; each item is { title, details }, where
// `details` are its indented lines with the shared indentation removed.
// `section` is the "## " heading the list lives under, or null when the list
// is the first one in the file. Throws ListFormatError when the file doesn't
// follow the rules, so the board never saves over something it misread.
export function parseList(text, section) {
  const lines = text.split('\n');

  let start = 0;
  let end = lines.length; // where the region that may hold the list ends
  if (section) {
    const heading = lines.findIndex((l) => l.trimEnd() === `## ${section}`);
    if (heading < 0) throw new ListFormatError(`Couldn't find the "## ${section}" heading.`);
    start = heading + 1;
    const next = lines.findIndex((l, i) => i >= start && SECTION_END.test(l));
    if (next >= 0) end = next;
  }

  const first = lines.findIndex((l, i) => i >= start && i < end && ITEM.test(l));
  if (first < 0) {
    // An empty list: new items go after the section's last non-blank line.
    let insertAt = end;
    while (insertAt > start && isBlank(lines[insertAt - 1])) insertAt--;
    return { before: lines.slice(0, insertAt), items: [], after: lines.slice(insertAt) };
  }

  const items = [];
  let i = first;
  while (i < lines.length) {
    const line = lines[i];
    const match = ITEM.exec(line);
    if (match) {
      items.push({ title: match[1].trim(), detailLines: [] });
      i++;
    } else if (INDENTED.test(line)) {
      items.at(-1).detailLines.push(line);
      i++;
    } else if (isBlank(line)) {
      let j = i;
      while (j < lines.length && isBlank(lines[j])) j++;
      if (j < lines.length && INDENTED.test(lines[j])) {
        // Blank lines inside an item's notes are kept.
        for (; i < j; i++) items.at(-1).detailLines.push('');
      } else if (j < end && ITEM.test(lines[j])) {
        i = j; // Blank lines between items are dropped when saving.
      } else {
        break;
      }
    } else {
      break;
    }
  }

  // Anything that looks like an item after the list ended would be invisible
  // on the board and could get out of order, so refuse to work with it.
  const stray = lines.findIndex((l, k) => k >= i && k < end && ITEM.test(l));
  if (stray >= 0) {
    throw new ListFormatError(
      `Line ${stray + 1} looks like a list item, but it's separated from the list by other text.`,
    );
  }

  return {
    before: lines.slice(0, first),
    items: items.map(({ title, detailLines }) => ({ title, details: dedent(detailLines) })),
    after: lines.slice(i),
  };
}

// The reverse of parseList: rebuilds the whole file. `marker` starts each item
// ("1. " or "- ") and `indent` goes before each note line, so the notes line up
// under the item's text.
export function serializeList({ before, items, after }, { marker, indent }) {
  const out = [...before];
  if (items.length > 0) {
    if (out.length > 0 && !isBlank(out.at(-1))) out.push('');
    for (const item of items) {
      out.push(marker + item.title);
      for (const detail of item.details) out.push(detail === '' ? '' : indent + detail);
    }
  } else {
    while (out.length > 0 && isBlank(out.at(-1))) out.pop();
  }
  if (after.length > 0 && !isBlank(after[0])) out.push('');
  out.push(...after);
  return out.join('\n');
}

// What the editor shows for an item: its title on the first line, its notes below.
export function itemToText(item) {
  return [item.title, ...item.details].join('\n');
}

// Turns the editor's text back into an item, or null if it's empty.
export function textToItem(text) {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trimEnd());
  while (lines.length > 0 && isBlank(lines[0])) lines.shift();
  while (lines.length > 0 && isBlank(lines.at(-1))) lines.pop();
  if (lines.length === 0) return null;
  // If someone types "- " or "1. " in front of the title, don't double it up.
  const title = lines[0].trim().replace(/^(?:\d+\.|[-*+])\s+/, '');
  if (title === '') return null;
  return { title, details: dedent(lines.slice(1)) };
}

// Removes the indentation all non-blank lines share, keeping nested indents.
function dedent(lines) {
  const indents = lines.filter((l) => !isBlank(l)).map((l) => l.length - l.trimStart().length);
  const shared = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((l) => (isBlank(l) ? '' : l.slice(shared)));
}
