import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEnvelope } from '../src/lib/articles.mjs';

const article = (overrides = {}) => ({
  slug: 'hello-world',
  title: 'Hello world',
  excerpt: 'A valid article.',
  author: null,
  publishedOn: '2026-08-19',
  language: 'en',
  cover: null,
  body: [{ type: 'paragraph', children: [{ type: 'text', text: 'Body' }] }],
  updatedAt: '2026-08-19T00:00:00.000Z',
  draft: false,
  ...overrides,
});

const envelope = (data) => ({ schemaVersion: 1, siteId: 'pages-live4dev', generatedAt: '2026-08-19T00:00:00.000Z', data });

test('validates, sorts and derives article data', () => {
  const result = parseEnvelope(envelope([
    article({ slug: 'older', title: 'Older', publishedOn: '2026-01-01' }),
    article({ slug: 'newer', title: 'Newer', publishedOn: '2026-08-19' }),
  ]));
  assert.deepEqual(result.map(({ slug }) => slug), ['newer', 'older']);
  assert.equal(result[0].readingMinutes, 1);
});

test('rejects invalid envelope, duplicates and reserved routes', () => {
  assert.throws(() => parseEnvelope({}), /invalid envelope/);
  assert.throws(() => parseEnvelope(envelope([article(), article()])), /duplicate/);
  assert.throws(() => parseEnvelope(envelope([article({ slug: 'admin' })])), /Unsafe article slug/);
});
