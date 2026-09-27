#!/usr/bin/env node
// Local Markdown -> Pages JSON preparation. No network calls or token access.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { parseDocument } from 'yaml';

const reserved = new Set(['admin', 'api', 'uploads', '__preview', '_health', 'mcp', 'new', 'fonts']);
const cyrillic = Object.fromEntries([...('абвгдеёжзийклмнопрстуфхцчшщъыьэюя')].map((letter, i) =>
  [letter, ['a', 'b', 'v', 'g', 'd', 'e', 'yo', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u', 'f', 'kh', 'ts', 'ch', 'sh', 'shch', '', 'y', '', 'e', 'yu', 'ya'][i]]));
const text = (value, marks = {}) => ({ type: 'text', text: value, ...marks });
const plain = node => node.value ?? node.alt ?? (node.children || []).map(plain).join('');
const normalizedText = value => value.replace(/\s+/gu, ' ').trim();
const stringField = (value, label, max, optional = false) => {
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.trim().length > max) {
    throw new Error(label + ' must be ' + (optional ? '0' : '1') + '–' + max + ' characters.');
  }
  return value.trim();
};
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const moscowDate = now => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const field = name => parts.find(part => part.type === name).value;
  return field('year') + '-' + field('month') + '-' + field('day');
};

export function convertMarkdown(source, options = {}) {
  let markdown = source.replace(/^\uFEFF/u, '').replace(/\r\n?/g, '\n');
  let metadata = {};
  let lineOffset = 0;
  if (markdown.startsWith('---\n')) {
    const lines = markdown.split('\n');
    const end = lines.findIndex((line, i) => i > 0 && ['---', '...'].includes(line));
    if (end < 0) throw new Error('Frontmatter has no closing --- delimiter.');
    const header = lines.slice(1, end).join('\n');
    const document = parseDocument(header);
    if (document.errors.length || document.warnings.length) throw new Error('Invalid YAML frontmatter.');
    metadata = header.trim() ? document.toJS({ maxAliasCount: 50 }) : {};
    if (!isObject(metadata)) throw new Error('Frontmatter must be a YAML mapping.');
    lineOffset = end + 1;
    markdown = lines.slice(end + 1).join('\n');
  }
  const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const fail = (node, message) => {
    const location = node.position?.start;
    throw new Error(message + (location ? ' (line ' + (location.line + lineOffset) + ', column ' + location.column + ')' : ''));
  };
  const definitions = new Map();
  const inspect = node => {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
    if (node.type === 'text' && /\[\[[^\]]+\]\]/u.test(node.value)) fail(node, 'Resolve Obsidian wiki links/embeds to ordinary Markdown first.');
    for (const child of node.children || []) inspect(child);
  };
  inspect(tree);
  const titleHeading = tree.children[0]?.type === 'heading' && tree.children[0].depth === 1 ? tree.children.shift() : null;
  const title = stringField(options.title ?? metadata.title ?? (titleHeading && normalizedText(plain(titleHeading))) ??
    path.basename(options.filename || 'page.md').replace(/\.(md|markdown)$/iu, ''), 'title', 180);
  const slugBase = [...title.toLowerCase()].map(letter => cyrillic[letter] ?? letter).join('').normalize('NFKD')
    .replace(/\p{Mark}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const slug = stringField(options.slug ?? metadata.slug ?? (slugBase ||
    'page-' + crypto.createHash('sha256').update(source).digest('hex').slice(0, 12)), 'slug', 180);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || reserved.has(slug)) throw new Error('slug is invalid or reserved.');
  const publishedOn = options.date ?? metadata.publishedOn ?? metadata.date ?? moscowDate(options.now || new Date());
  if (typeof publishedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(publishedOn) ||
    !Number.isFinite(Date.parse(publishedOn)) || new Date(publishedOn + 'T00:00:00Z').toISOString().slice(0, 10) !== publishedOn) {
    throw new Error('publishedOn/date must be a real date in YYYY-MM-DD format.');
  }
  const language = options.language ?? metadata.language ?? 'ru';
  if (!['ru', 'en'].includes(language)) throw new Error('language must be ru or en.');
  const mediaMap = options.mediaMap || {};
  const linkMap = options.linkMap || {};
  if (!isObject(mediaMap) || !isObject(linkMap)) throw new Error('Media and link maps must be JSON objects.');
  const definition = node => {
    const found = definitions.get(node.identifier);
    if (!found) fail(node, 'Reference has no definition.');
    return found;
  };
  const safeLink = (url, node) => {
    const target = Object.hasOwn(linkMap, url) ? linkMap[url] : url;
    if (typeof target !== 'string' || !target.trim() || /[\u0000-\u0020\u007f\\]/u.test(target)) fail(node, 'Link URL is invalid.');
    if ((target.startsWith('/') && !target.startsWith('//')) || target.startsWith('#')) return target;
    let parsed;
    try { parsed = new URL(target); } catch { fail(node, 'Resolve relative file links through --link-map before publishing.'); }
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol) || parsed.username || parsed.password) fail(node, 'Link protocol or credentials are not supported.');
    return parsed.href;
  };
  const inline = (nodes, marks = {}) => nodes.flatMap(node => {
    switch (node.type) {
      case 'text': return [text(node.value.replace(/\n/g, ' '), marks)];
      case 'break': return [text('\n', marks)];
      case 'inlineCode': return [text(node.value, { ...marks, code: true })];
      case 'strong': return inline(node.children, { ...marks, bold: true });
      case 'emphasis': return inline(node.children, { ...marks, italic: true });
      case 'delete': return inline(node.children, { ...marks, strikethrough: true });
      case 'link':
      case 'linkReference': {
        const target = node.type === 'linkReference' ? definition(node) : node;
        return [{ type: 'link', url: safeLink(target.url, node), children: inline(node.children, marks) }];
      }
      default: return fail(node, 'Unsupported inline Markdown element: ' + node.type + '.');
    }
  });
  const joinedParagraphs = nodes => nodes.flatMap((node, i) => {
    if (node.type !== 'paragraph') fail(node, 'This quote/list item supports paragraphs and nested lists only.');
    return [...(i ? [text('\n\n')] : []), ...inline(node.children)];
  });
  const image = node => {
    const target = node.type === 'imageReference' ? definition(node) : node;
    const stored = Object.hasOwn(mediaMap, target.url) ? mediaMap[target.url] : null;
    if (!isObject(stored)) fail(node, 'Image requires existing Pages media in --media-map; no image was uploaded.');
    let parsed;
    try { parsed = new URL(stored.url, 'https://pages.live4.dev'); } catch { fail(node, 'Media URL is invalid.'); }
    if (parsed.origin !== 'https://pages.live4.dev' || !parsed.pathname.startsWith('/uploads/') ||
      parsed.username || parsed.password || parsed.hash || parsed.search) fail(node, 'Image must reference Pages uploads.');
    if (!Number.isInteger(stored.width) || stored.width <= 0 || !Number.isInteger(stored.height) || stored.height <= 0 ||
      typeof stored.name !== 'string' || !stored.name.trim()) fail(node, 'Media map needs the existing image name, width and height.');
    const alternativeText = stringField(node.alt || stored.alternativeText, 'image alternative text', 320);
    return { type: 'image', image: { ...structuredClone(stored), url: parsed.href, alternativeText,
      ...(target.title ? { caption: target.title } : {}) }, children: [text('')] };
  };
  const list = node => {
    if (node.ordered && node.start !== 1) fail(node, 'Numbered lists must start at 1.');
    const children = [];
    for (const item of node.children) {
      if (item.checked != null) fail(item, 'Task lists need adaptation to ordinary lists before publishing.');
      const paragraphs = [];
      const nested = [];
      for (const child of item.children) {
        if (child.type === 'list') nested.push(child);
        else if (child.type === 'paragraph' && !nested.length) paragraphs.push(child);
        else fail(child, 'List items support paragraphs followed by nested lists; adapt this item first.');
      }
      children.push({ type: 'list-item', children: paragraphs.length ? joinedParagraphs(paragraphs) : [text('')] });
      children.push(...nested.map(list));
    }
    return { type: 'list', format: node.ordered ? 'ordered' : 'unordered', children };
  };
  const body = tree.children.flatMap(node => {
    switch (node.type) {
      case 'definition': return [];
      case 'paragraph':
        if (node.children.length === 1 && ['image', 'imageReference'].includes(node.children[0].type)) return [image(node.children[0])];
        return [{ type: 'paragraph', children: inline(node.children) }];
      case 'heading':
        if (![2, 3, 4].includes(node.depth)) fail(node, 'Body headings must be H2–H4; only the leading H1 becomes the title.');
        return [{ type: 'heading', level: node.depth, children: inline(node.children) }];
      case 'blockquote': return [{ type: 'quote', children: joinedParagraphs(node.children) }];
      case 'list': return [list(node)];
      case 'code':
        if (node.meta) fail(node, 'Code-fence metadata is not supported; keep the language only.');
        return [{ type: 'code', language: node.lang || 'plaintext', children: [text(node.value)] }];
      default: return fail(node, 'Unsupported Markdown block: ' + node.type + '. Adapt it before publishing.');
    }
  });
  if (!body.length) throw new Error('Article body is empty after extracting the title.');
  const firstParagraph = tree.children.find(node => node.type === 'paragraph' && !node.children.some(child => ['image', 'imageReference'].includes(child.type)));
  const fallback = normalizedText(firstParagraph ? plain(firstParagraph) : title);
  const excerpt = stringField(options.excerpt ?? metadata.excerpt ?? metadata.description ??
    (fallback.length > 320 ? fallback.slice(0, 319).trimEnd() + '…' : fallback), 'excerpt', 320);
  const data = { title, slug, excerpt, publishedOn, language, body };
  const author = options.author ?? metadata.author;
  if (author != null) data.author = stringField(author, 'author', 180, true);
  return { data };
}

const help = 'Prepare one UTF-8 Markdown file for Pages; never sends HTTP requests.\n' +
  'node pages_markdown.mjs FILE.md --output /private/article.json\n' +
  'Options: --title --slug --excerpt --author --date YYYY-MM-DD --language ru|en\n' +
  '         --media-map /private/media.json --link-map /private/links.json\n' +
  'CLI values override YAML frontmatter. Existing output files are never overwritten.';

async function main() {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      output: { type: 'string' }, title: { type: 'string' }, slug: { type: 'string' }, excerpt: { type: 'string' },
      author: { type: 'string' }, date: { type: 'string' }, language: { type: 'string' },
      'media-map': { type: 'string' }, 'link-map': { type: 'string' }, help: { type: 'boolean' },
    } });
    if (values.help) { console.log(help); return; }
    if (positionals.length !== 1 || !values.output) throw new Error('Provide one Markdown file and --output. Use --help for options.');
    const sourcePath = path.resolve(positionals[0]);
    if (!/\.(md|markdown)$/iu.test(sourcePath)) throw new Error('Input file must end in .md or .markdown.');
    const buffer = await fs.readFile(sourcePath);
    if (buffer.byteLength > 2 * 1024 * 1024) throw new Error('Markdown file is larger than 2 MiB.');
    const source = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    const readMap = async name => values[name] ? JSON.parse(await fs.readFile(values[name], 'utf8')) : {};
    const payload = convertMarkdown(source, { ...values, filename: sourcePath,
      mediaMap: await readMap('media-map'), linkMap: await readMap('link-map') });
    await fs.writeFile(values.output, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ ok: true, output: path.resolve(values.output), title: payload.data.title,
      slug: payload.data.slug, blocks: payload.data.body.length }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.code ? 'Cannot read input or create a new output file (' + error.code + ').' : error.message }));
    process.exitCode = 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
