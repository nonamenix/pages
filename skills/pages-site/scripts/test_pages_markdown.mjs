import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { convertMarkdown } from './pages_markdown.mjs';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('./pages_markdown.mjs', import.meta.url));
const fixed = { now: new Date('2026-09-27T22:00:00Z') };
const convert = (source, options = {}) => convertMarkdown(source, { ...fixed, ...options }).data;

test('extracts a leading title and prepares a native Pages payload', () => {
  const data = convert('# Привет, мир!\n\nПервый абзац.\n\n## Раздел\n\nПродолжение.');
  assert.equal(data.title, 'Привет, мир!');
  assert.equal(data.slug, 'privet-mir');
  assert.equal(data.excerpt, 'Первый абзац.');
  assert.equal(data.publishedOn, '2026-09-28');
  assert.equal(data.body[0].children[0].text, 'Первый абзац.');
  assert.deepEqual(data.body[1], { type: 'heading', level: 2, children: [{ type: 'text', text: 'Раздел' }] });
});

test('YAML and CLI metadata override defaults without copying arbitrary fields', () => {
  const source = '---\ntitle: "Title: one"\nslug: yaml-slug\ndate: 2026-01-05\nlanguage: en\nauthor: Author\nexcerpt: Summary\nprivateSetting: ignored\n---\n# Original title\n\nBody.';
  const data = convert(source, { title: 'Override', slug: 'cli-slug' });
  assert.equal(data.title, 'Override');
  assert.equal(data.slug, 'cli-slug');
  assert.equal(data.publishedOn, '2026-01-05');
  assert.equal(data.language, 'en');
  assert.equal(data.author, 'Author');
  assert.equal(data.excerpt, 'Summary');
  assert.equal(Object.hasOwn(data, 'privateSetting'), false);
  assert.equal(data.body.length, 1);
});

test('filename fallback, Unicode slugs and generated excerpts remain bounded', () => {
  assert.equal(convert('Text', { filename: '/tmp/My article.markdown' }).title, 'My article');
  assert.equal(convert('# Café Ёж\n\n' + 'Я'.repeat(450)).slug, 'cafe-yozh');
  assert.equal(convert('# Title\n\n' + 'Я'.repeat(450)).excerpt.length, 320);
  assert.match(convert('# 中文\n\nText').slug, /^page-[a-f0-9]{12}$/);
});

test('empty frontmatter and soft-wrapped paragraphs retain Markdown semantics', () => {
  const data = convert('---\n---\n# Title\n\nFirst line\nsecond line.');
  assert.equal(data.title, 'Title');
  assert.equal(data.body[0].children[0].text, 'First line second line.');
  assert.equal(data.excerpt, 'First line second line.');
});

test('preserves nested emphasis, inline code, strike-through and hard breaks', () => {
  const tick = String.fromCharCode(96);
  const data = convert('# Title\n\n**bold and *italic***, ~~old~~, ' + tick + 'a < b' + tick + '  \nnext.');
  const children = data.body[0].children;
  assert.ok(children.some(node => node.bold && node.italic && node.text === 'italic'));
  assert.ok(children.some(node => node.strikethrough && node.text === 'old'));
  assert.ok(children.some(node => node.code && node.text === 'a < b'));
  assert.ok(children.some(node => node.text === '\n'));
});

test('reference links retain formatting and definitions do not become prose', () => {
  const data = convert('# Title\n\n[**Read**][site]\n\n[site]: https://pages.live4.dev/');
  assert.equal(data.body.length, 1);
  assert.deepEqual(data.body[0].children, [{ type: 'link', url: 'https://pages.live4.dev/', children: [{ type: 'text', text: 'Read', bold: true }] }]);
});

test('fenced code retains language, punctuation and line breaks', () => {
  const data = convert('# Title\n\n~~~javascript\nconst x = "<tag>";\n// code\n~~~');
  assert.deepEqual(data.body[0], { type: 'code', language: 'javascript', children: [{ type: 'text', text: 'const x = "<tag>";\n// code' }] });
});

test('nested lists use the native Strapi sibling representation', () => {
  const data = convert('# Title\n\n1. First\n   - Child\n     1. Deeper\n2. Second');
  const list = data.body[0];
  assert.equal(list.format, 'ordered');
  assert.deepEqual(list.children.map(node => node.type), ['list-item', 'list', 'list-item']);
  assert.equal(list.children[1].format, 'unordered');
  assert.equal(list.children[1].children[1].children[0].children[0].text, 'Deeper');
  assert.equal(list.children[2].children[0].text, 'Second');
});

test('loose list and quote paragraphs retain separation', () => {
  const data = convert('# Title\n\n- First\n\n  More.\n\n> One\n>\n> **Two**');
  assert.equal(data.body[0].children[0].children.map(node => node.text).join(''), 'First\n\nMore.');
  assert.equal(data.body[1].type, 'quote');
  assert.equal(data.body[1].children.map(node => node.text).join(''), 'One\n\nTwo');
});

test('links require supported schemes or explicit mapping of file links', () => {
  assert.throws(() => convert('# Title\n\n[Bad](javascript:alert)'), /protocol/);
  assert.throws(() => convert('# Title\n\n[Private](https://user:pass@example.com/)'), /credentials/);
  assert.throws(() => convert('# Title\n\n[Other](other.md)'), /link-map/);
  assert.equal(convert('# Title\n\n[Other](other.md)', { linkMap: { 'other.md': '/other/' } }).body[0].children[0].url, '/other/');
  assert.equal(convert('# Title\n\n[Email](mailto:test@example.test)').body[0].children[0].url, 'mailto:test@example.test');
});

test('mapped Pages images retain media metadata, alt text and captions', () => {
  const media = { name: 'diagram.png', url: '/uploads/diagram.png', width: 200, height: 100, hash: 'diagram', mime: 'image/png', alternativeText: 'Old' };
  const data = convert('# Title\n\n![Схема](./diagram.png "Подпись")', { mediaMap: { './diagram.png': media } });
  assert.equal(data.body[0].type, 'image');
  assert.equal(data.body[0].image.alternativeText, 'Схема');
  assert.equal(data.body[0].image.caption, 'Подпись');
  assert.equal(data.body[0].image.url, 'https://pages.live4.dev/uploads/diagram.png');
  assert.equal(data.body[0].image.hash, 'diagram');
  assert.equal(media.alternativeText, 'Old');
  assert.throws(() => convert('# Title\n\n![Alt](image.png)'), /media-map/);
  assert.throws(() => convert('# Title\n\n![Alt](image.png)', { mediaMap: { 'image.png': { ...media, url: 'https://outside.example/image.png' } } }), /Pages uploads/);
});

test('unsupported structures fail with source line numbers rather than losing content', () => {
  for (const source of [
    '| A | B |\n| --- | --- |\n| 1 | 2 |',
    '- [ ] Task', '<script>alert(1)</script>', '---', '##### Too deep',
    'Footnote[^1]\n\n[^1]: Note', 'See [[Other page]].', '![[image.png]]',
    '- First\n  - Child\n\n  After child', '> ## Heading',
  ]) assert.throws(() => convert('# Title\n\n' + source), /line /);
  assert.throws(() => convert('---\ntitle: Title\n---\n\n<p>Raw HTML</p>'), /line 5,/);
});

test('invalid metadata, duplicate YAML keys, empty bodies and reserved routes fail', () => {
  for (const slug of ['new', 'fonts', 'admin', '../bad', 'UPPER']) assert.throws(() => convert('Body', { slug }), /slug/);
  assert.throws(() => convert('Body', { date: '2026-02-30' }), /real date/);
  assert.equal(convert('Body', { date: '2024-02-29' }).publishedOn, '2024-02-29');
  assert.throws(() => convert('Body', { language: 'de' }), /language/);
  assert.throws(() => convert('---\ntitle: One\ntitle: Two\n---\n\nBody'), /YAML/);
  assert.throws(() => convert('# Only a title'), /empty/);
});

test('CLI writes private JSON from any working directory and refuses overwrites', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-md-test-'));
  try {
    const source = path.join(directory, 'example.md');
    const output = path.join(directory, 'article.json');
    await fs.writeFile(source, '# CLI title\n\nContent.');
    const result = await run(process.execPath, [cli, source, '--output', output], { cwd: directory,
      env: { ...process.env, PAGES_API_TOKEN: 'unused-test-only-secret' } });
    assert.equal(JSON.parse(result.stdout).ok, true);
    assert.equal(JSON.parse(await fs.readFile(output, 'utf8')).data.title, 'CLI title');
    assert.equal((await fs.stat(output)).mode & 0o077, 0);
    const before = await fs.readFile(output, 'utf8');
    await assert.rejects(run(process.execPath, [cli, source, '--output', output]), /Command failed/);
    assert.equal(await fs.readFile(output, 'utf8'), before);
    await fs.writeFile(source, Buffer.from([0xff, 0xff]));
    await assert.rejects(run(process.execPath, [cli, source, '--output', path.join(directory, 'invalid.json')]), /Command failed/);
    assert.equal(result.stdout.includes('unused-test-only-secret'), false);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
