import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCitation, publishedOnFrom } from '../../src/preprocess';

test('buildCitation prefers DOI journal metadata and retains every author in order', () => {
  const authors = ['Acharya, Vivek', 'Jean Paul Sartre', 'Plato', 'Ada Lovelace', 'Alan Turing', 'Grace Hopper', 'Alonzo Church'];
  assert.deepEqual(buildCitation({
    authors,
    title: 'Bank runs',
    date: '2024/03/05',
    doi: 'doi:10.1000/xyz',
    journal: 'Journal of Finance',
  }, 'https://arxiv.org/html/2403.12345v2'), {
    authors: [
      { family: 'Acharya', given: 'V.' },
      { family: 'Sartre', given: 'J. P.' },
      { family: 'Plato' },
      { family: 'Lovelace', given: 'A.' },
      { family: 'Turing', given: 'A.' },
      { family: 'Hopper', given: 'G.' },
      { family: 'Church', given: 'A.' },
    ],
    title: 'Bank runs',
    year: 2024,
    venue: 'Journal of Finance',
    url: 'https://doi.org/10.1000/xyz',
  });
});

test('buildCitation uses the unversioned arXiv venue and versioned abstract URL', () => {
  assert.deepEqual(buildCitation({
    authors: ['Ada Lovelace'], title: 'Notes on engines', date: '2025-07', journal: 'Ignored journal',
  }, 'https://arxiv.org/html/2507.15003v2'), {
    authors: [{ family: 'Lovelace', given: 'A.' }],
    title: 'Notes on engines', year: 2025,
    venue: 'arXiv preprint arXiv:2507.15003',
    url: 'https://arxiv.org/abs/2507.15003v2',
  });
});

test('buildCitation requires a title and an author', () => {
  const source = 'https://example.org/paper';
  assert.equal(buildCitation({ authors: ['Plato'] }, source), undefined);
  assert.equal(buildCitation({ authors: [], title: 'Republic' }, source), undefined);
  assert.equal(buildCitation({ authors: [' '], title: 'Republic' }, source), undefined);
  assert.equal(buildCitation({ authors: ['Plato'], title: '<em></em>' }, source), undefined);
});

test('buildCitation decodes entities and removes tags in all text fields', () => {
  assert.deepEqual(buildCitation({
    authors: ['<i>Acharya</i>, <b>Vivek</b>'],
    title: '<em>Bank runs</em> &amp; liquidity when x < 3',
    journal: '<strong>Research</strong> &amp; Review',
  }, 'https://example.org/paper?a=1&amp;b=2'), {
    authors: [{ family: 'Acharya', given: 'V.' }],
    title: 'Bank runs & liquidity when x < 3',
    venue: 'Research & Review',
    url: 'https://example.org/paper?a=1&b=2',
  });
});

test('buildCitation omits absent initials, year and venue and falls back to the source URL', () => {
  assert.deepEqual(buildCitation({ authors: ['Plato'], title: 'Republic' }, 'https://example.org/republic'), {
    authors: [{ family: 'Plato' }], title: 'Republic', url: 'https://example.org/republic',
  });
});

test('publishedOnFrom extracts and zero-pads valid months', () => {
  for (const [input, expected] of [
    ['2024/03/05', '2024-03'], ['2024-11', '2024-11'],
    ['2024/3/5', '2024-03'], ['2024-1', '2024-01'], ['2024-12-31', '2024-12'],
    ['2024-03-05T12:00:00Z', '2024-03'],
  ]) assert.equal(publishedOnFrom(input), expected, input);
});

test('publishedOnFrom rejects missing months, malformed dates and months outside 1 to 12', () => {
  for (const input of [undefined, '', '2024', '2024-00', '2024-13', '2024-123', '2024-11junk', 'March 2024', 'not a date']) {
    assert.equal(publishedOnFrom(input), undefined, input);
  }
});
