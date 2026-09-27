const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const assertObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
};

export const safeLinkUrl = (rawUrl) => {
  const url = String(rawUrl || '').trim();
  if (!url) throw new Error('Link URL is empty');
  if ((url.startsWith('/') && !url.startsWith('//')) || url.startsWith('#')) return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Unsafe link URL: ${url}`);
  }
  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) throw new Error(`Unsafe link protocol: ${parsed.protocol}`);
  return parsed.href;
};

export const mediaUrl = (rawUrl, mediaBaseUrl = 'https://pages.live4.dev/uploads') => {
  const url = String(rawUrl || '').trim();
  const base = String(mediaBaseUrl || '').replace(/\/$/, '');
  if (!url || !base) throw new Error('Media URL is empty');
  if (url.startsWith('/uploads/')) return `${base}${url.slice('/uploads'.length)}`;

  let parsed;
  let parsedBase;
  try {
    parsed = new URL(url);
    parsedBase = new URL(`${base}/`);
  } catch {
    throw new Error(`Unsafe media URL: ${url}`);
  }
  const basePath = parsedBase.pathname.replace(/\/$/, '');
  if (parsed.origin !== parsedBase.origin || !parsed.pathname.startsWith(`${basePath}/`)) {
    throw new Error(`Media URL is outside the configured uploads origin: ${url}`);
  }
  return parsed.href;
};

const renderText = (node) => {
  if (typeof node.text !== 'string') throw new Error('Text node is missing text');
  let html = escapeHtml(node.text).replaceAll('\n', '<br>');
  if (node.code) html = `<code>${html}</code>`;
  if (node.bold) html = `<strong>${html}</strong>`;
  if (node.italic) html = `<em>${html}</em>`;
  if (node.underline) html = `<u>${html}</u>`;
  if (node.strikethrough) html = `<s>${html}</s>`;
  return html;
};

const renderInline = (node) => {
  assertObject(node, 'Inline node');
  if (node.type === 'text') return renderText(node);
  if (node.type === 'link') {
    if (!Array.isArray(node.children)) throw new Error('Link children must be an array');
    const href = safeLinkUrl(node.url);
    const external = href.startsWith('http://') || href.startsWith('https://');
    return `<a href="${escapeHtml(href)}"${external ? ' rel="noopener noreferrer"' : ''}>${node.children.map(renderInline).join('')}</a>`;
  }
  throw new Error(`Unsupported inline node: ${String(node.type)}`);
};

const inlineChildren = (node, label) => {
  if (!Array.isArray(node.children)) throw new Error(`${label} children must be an array`);
  return node.children.map(renderInline).join('');
};

const renderListItem = (node, options) => {
  assertObject(node, 'List item');
  if (node.type !== 'list-item' || !Array.isArray(node.children)) throw new Error('List contains an invalid item');
  const body = node.children.map((child) => {
    if (child?.type === 'paragraph') return inlineChildren(child, 'List paragraph');
    if (child?.type === 'list') return renderBlock(child, options);
    return renderInline(child);
  }).join('');
  return `<li>${body}</li>`;
};

const renderImage = (node, options) => {
  const image = assertObject(node.image, 'Image payload');
  const alt = String(image.alternativeText || '').trim();
  if (!alt) throw new Error('Article images require alternative text');
  const src = mediaUrl(image.url, options.mediaBaseUrl);
  const width = Number.isInteger(image.width) && image.width > 0 ? ` width="${image.width}"` : '';
  const height = Number.isInteger(image.height) && image.height > 0 ? ` height="${image.height}"` : '';
  const caption = String(image.caption || '').trim();
  return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${width}${height} loading="lazy" decoding="async">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`;
};

const renderBlock = (node, options) => {
  assertObject(node, 'Block');
  switch (node.type) {
    case 'paragraph':
      return `<p>${inlineChildren(node, 'Paragraph')}</p>`;
    case 'heading': {
      if (![2, 3, 4].includes(node.level)) throw new Error(`Unsupported heading level: ${String(node.level)}`);
      return `<h${node.level}>${inlineChildren(node, 'Heading')}</h${node.level}>`;
    }
    case 'quote':
      return `<blockquote>${inlineChildren(node, 'Quote')}</blockquote>`;
    case 'code': {
      const text = Array.isArray(node.children)
        ? node.children.map((child) => {
          if (child?.type !== 'text' || typeof child.text !== 'string') throw new Error('Code block contains a non-text node');
          return child.text;
        }).join('')
        : String(node.plainText || '');
      return `<pre><code>${escapeHtml(text)}</code></pre>`;
    }
    case 'list': {
      if (!Array.isArray(node.children)) throw new Error('List children must be an array');
      const tag = node.format === 'ordered' ? 'ol' : node.format === 'unordered' ? 'ul' : null;
      if (!tag) throw new Error(`Unsupported list format: ${String(node.format)}`);
      const items = [];
      for (const child of node.children) {
        if (child?.type === 'list') {
          if (!items.length) items.push('<li></li>');
          items[items.length - 1] = items.at(-1).replace(/<\/li>$/, `${renderBlock(child, options)}</li>`);
        } else items.push(renderListItem(child, options));
      }
      return `<${tag}>${items.join('')}</${tag}>`;
    }
    case 'image':
      return renderImage(node, options);
    default:
      throw new Error(`Unsupported block type: ${String(node.type)}`);
  }
};

export const renderBlocks = (blocks, options = {}) => {
  if (!Array.isArray(blocks) || blocks.length === 0) throw new Error('Article body must contain at least one block');
  return blocks.map((block) => renderBlock(block, options)).join('\n');
};

const collectText = (value, parts) => {
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, parts);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (value.type === 'text' && typeof value.text === 'string') parts.push(value.text);
  if (typeof value.plainText === 'string') parts.push(value.plainText);
  collectText(value.children, parts);
};

export const readingMinutes = (blocks, wordsPerMinute = 200) => {
  const parts = [];
  collectText(blocks, parts);
  const words = parts.join(' ').trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / wordsPerMinute));
};
