import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaUrl, readingMinutes, renderBlocks, safeLinkUrl } from '../src/lib/blocks.mjs';

test('renders supported Blocks nodes while escaping text', () => {
  const html = renderBlocks([
    { type: 'paragraph', children: [
      { type: 'text', text: '<safe>', bold: true },
      { type: 'link', url: 'https://example.com/path', children: [{ type: 'text', text: ' link' }] },
    ] },
    { type: 'heading', level: 2, children: [{ type: 'text', text: 'Heading' }] },
    { type: 'list', format: 'ordered', children: [{ type: 'list-item', children: [{ type: 'text', text: 'First' }] }] },
    { type: 'quote', children: [{ type: 'text', text: 'Quote' }] },
    { type: 'code', children: [{ type: 'text', text: '<script>' }] },
    { type: 'image', image: { url: '/uploads/example.webp', alternativeText: 'Example', width: 800, height: 600 } },
  ], { mediaBaseUrl: 'https://pages.live4.dev/uploads' });

  assert.match(html, /<strong>&lt;safe&gt;<\/strong>/);
  assert.match(html, /href="https:\/\/example\.com\/path" rel="noopener noreferrer"/);
  assert.match(html, /<h2>Heading<\/h2>/);
  assert.match(html, /<ol><li>First<\/li><\/ol>/);
  assert.match(html, /<pre><code>&lt;script&gt;<\/code><\/pre>/);
  assert.match(html, /src="https:\/\/pages\.live4\.dev\/uploads\/example\.webp"/);
});

test('rejects unsafe links, headings, images and unknown blocks', () => {
  assert.throws(() => safeLinkUrl('javascript:alert(1)'), /Unsafe link protocol/);
  assert.throws(() => renderBlocks([{ type: 'heading', level: 1, children: [{ type: 'text', text: 'No' }] }]), /Unsupported heading level/);
  assert.throws(() => renderBlocks([{ type: 'image', image: { url: '/uploads/x.webp' } }]), /alternative text/);
  assert.throws(() => renderBlocks([{ type: 'raw-html', html: '<b>no</b>' }]), /Unsupported block type/);
});

test('normalizes only configured media URLs', () => {
  assert.equal(mediaUrl('/uploads/a.webp', 'https://pages.live4.dev/uploads'), 'https://pages.live4.dev/uploads/a.webp');
  assert.throws(() => mediaUrl('https://other.example/a.webp', 'https://pages.live4.dev/uploads'), /outside/);
});

test('derives a minimum one-minute reading time', () => {
  assert.equal(readingMinutes([{ type: 'paragraph', children: [{ type: 'text', text: 'one two three' }] }]), 1);
  assert.equal(readingMinutes([{ type: 'paragraph', children: [{ type: 'text', text: Array(201).fill('word').join(' ') }] }]), 2);
});
