import assert from 'node:assert/strict';
import test from 'node:test';
import { articleVersion, blocksToEditor, bodyText, editorPayload, editorToBlocks } from '../src/lib/editor-blocks.mjs';
import { renderBlocks } from '../src/lib/blocks.mjs';

const text = (value, marks = {}) => ({ type: 'text', text: value, ...marks });
const paragraph = (...children) => ({ type: 'paragraph', children });

test('editing retains nested lists, formatting, links, code and image metadata', () => {
  const image = { url: '/uploads/photo.webp', alternativeText: 'Описание', caption: 'Подпись', width: 800, height: 600, hash: 'photo', formats: { small: { width: 400 } } };
  const blocks = [
    paragraph(text('Текст ', { bold: true, underline: true }), { type: 'link', url: 'https://example.com/', children: [text('ссылка', { italic: true })] }),
    { type: 'heading', level: 3, children: [text('Раздел')] },
    { type: 'quote', children: [text('Цитата')] },
    { type: 'code', children: [text('<code>\nsecond line')] },
    { type: 'list', format: 'ordered', children: [{ type: 'list-item', children: [text('Первый')] }, { type: 'list', format: 'unordered', children: [{ type: 'list-item', children: [text('Вложенный')] }] }] },
    { type: 'image', image },
  ];
  const result = editorToBlocks(blocksToEditor(blocks));
  assert.equal(renderBlocks(result), renderBlocks(blocks));
  assert.deepEqual(result.at(-1).image, image);
  assert.equal(bodyText(result), bodyText(blocks));
});

test('line breaks and separate list paragraphs survive conversion', () => {
  const result = editorToBlocks({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '<first>' }, { type: 'hardBreak' }, { type: 'text', text: 'second' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
    ] }] },
  ] });
  assert.match(renderBlocks(result), /&lt;first&gt;<br>second/);
  assert.match(renderBlocks(result), /<li>one<br>two<\/li>/);
  assert.equal(blocksToEditor(result).content[1].content[0].content[0].content[1].type, 'hardBreak');
});

test('unsafe or unsupported content cannot silently enter or leave the editor', () => {
  assert.throws(() => blocksToEditor([{ type: 'video', url: 'https://example.com' }]), /Unsupported block/);
  assert.throws(() => editorToBlocks({ type: 'doc', content: [{ type: 'iframe' }] }), /Неподдерживаемый блок/);
  assert.throws(() => editorToBlocks({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'unsafe', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] }), /Unsafe link/);
  assert.throws(() => editorPayload('Title', '', { type: 'doc', content: [{ type: 'paragraph' }] }), /Добавьте текст/);
});

test('publication fingerprint detects body changes despite identical title and ignores media URL normalization', async () => {
  const article = { title: 'Title', author: '', body: [{ type: 'image', image: { url: '/uploads/a.webp', alternativeText: 'Image' } }] };
  const absolute = structuredClone(article);
  absolute.body[0].image.url = 'https://pages.live4.dev/uploads/a.webp';
  assert.equal(await articleVersion(article), await articleVersion(absolute));
  absolute.body[0].image.caption = 'Changed';
  assert.notEqual(await articleVersion(article), await articleVersion(absolute));
});
