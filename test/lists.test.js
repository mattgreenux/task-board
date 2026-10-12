// Run with `npm test` (needs Node 18 or later).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseList, serializeList, itemToText, textToItem, ListFormatError,
} from '../site/lists.js';

const NUMBERED = { marker: '1. ', indent: '   ' };
const BULLETS = { marker: '- ', indent: '  ' };

// Snapshots of TimeRush's real list files (taken 2026-10-12), so the tests
// check the parser against the files it actually edits. Refresh them by copying
// the files over from TimeRush when its list format changes.
const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

// The same lists the board shows (site/app.js › LISTS).
const REAL_LISTS = [
  ['TODO.md', 'Next Steps', NUMBERED],
  ['BACKLOG.md', null, BULLETS],
  ['IDEAS.md', 'Feature ideas', BULLETS],
];

for (const [file, section, format] of REAL_LISTS) {
  test(`${file} reads and writes back unchanged`, () => {
    const text = fixture(file);
    const parsed = parseList(text, section);
    assert.ok(parsed.items.length > 0);
    assert.equal(serializeList(parsed, format), text);
  });
}

test('IDEAS.md only includes the Feature ideas section', () => {
  const parsed = parseList(fixture('IDEAS.md'), 'Feature ideas');
  assert.ok(parsed.items.every((item) => !item.title.startsWith('Prepare TimeRush for the App Store')));
});

const SAMPLE = `# TODO

Intro text.

## Next Steps

1. First task
   - Why: because
     - nested note
1. Second task

## Later

Other text.
`;

test('reads items and notes, removing the shared indentation', () => {
  const { items } = parseList(SAMPLE, 'Next Steps');
  assert.deepEqual(items, [
    { title: 'First task', details: ['- Why: because', '  - nested note'] },
    { title: 'Second task', details: [] },
  ]);
});

test('moving, adding and removing items only changes the list', () => {
  const parsed = parseList(SAMPLE, 'Next Steps');
  parsed.items.reverse();
  parsed.items.push({ title: 'Third', details: ['- note'] });
  assert.equal(serializeList(parsed, NUMBERED), SAMPLE.replace(
    '1. First task\n   - Why: because\n     - nested note\n1. Second task\n',
    '1. Second task\n1. First task\n   - Why: because\n     - nested note\n1. Third\n   - note\n',
  ));
});

test('an emptied list can be filled again', () => {
  const parsed = parseList(SAMPLE, 'Next Steps');
  parsed.items = [];
  const empty = serializeList(parsed, NUMBERED);
  assert.equal(empty, '# TODO\n\nIntro text.\n\n## Next Steps\n\n## Later\n\nOther text.\n');
  const reparsed = parseList(empty, 'Next Steps');
  assert.equal(reparsed.items.length, 0);
  reparsed.items.push({ title: 'New', details: [] });
  assert.equal(
    serializeList(reparsed, NUMBERED),
    '# TODO\n\nIntro text.\n\n## Next Steps\n\n1. New\n\n## Later\n\nOther text.\n',
  );
});

test('an empty section at the end of the file can be filled', () => {
  const parsed = parseList('# Ideas\n\n## Feature ideas\n', 'Feature ideas');
  parsed.items.push({ title: 'Idea', details: [] });
  assert.equal(serializeList(parsed, BULLETS), '# Ideas\n\n## Feature ideas\n\n- Idea\n');
});

test('keeps blank lines inside notes and drops them between items', () => {
  const text = '## L\n\n- A\n  - one\n\n  - two\n\n- B\n';
  const parsed = parseList(text, 'L');
  assert.deepEqual(parsed.items[0].details, ['- one', '', '- two']);
  assert.equal(serializeList(parsed, BULLETS), '## L\n\n- A\n  - one\n\n  - two\n- B\n');
});

test('refuses a list with items hidden after other text', () => {
  const text = '## L\n\n- A\n\nA paragraph.\n\n- B\n';
  assert.throws(() => parseList(text, 'L'), ListFormatError);
});

test('refuses a missing section', () => {
  assert.throws(() => parseList('# Nothing\n', 'Next Steps'), ListFormatError);
});

test('editor text round-trips, and stray markers or indentation are cleaned up', () => {
  const item = { title: 'Do it', details: ['- Why: x', '  - deeper'] };
  assert.deepEqual(textToItem(itemToText(item)), item);
  assert.deepEqual(textToItem('\n- Do it  \n    - Why: x\n      - deeper\n\n'), item);
  assert.equal(textToItem('   \n'), null);
});
