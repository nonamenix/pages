import { mediaUrl, renderBlocks, safeLinkUrl } from './blocks.mjs';

const markNames = { bold: 'bold', italic: 'italic', underline: 'underline', strikethrough: 'strike', code: 'code' };
const emptyText = () => [{ type: 'text', text: '' }];

const inlineToEditor = (children, inherited = []) => children.flatMap((node) => {
  if (node.type === 'link') return inlineToEditor(node.children, [...inherited, { type: 'link', attrs: { href: safeLinkUrl(node.url) } }]);
  if (node.type !== 'text' || typeof node.text !== 'string') throw new Error('Неподдерживаемый текстовый блок.');
  const marks = [...inherited, ...Object.entries(markNames).filter(([key]) => node[key]).map(([, type]) => ({ type }))];
  return node.text.split('\n').flatMap((text, index) => [
    ...(index ? [{ type: 'hardBreak' }] : []),
    ...(text ? [{ type: 'text', text, ...(marks.length ? { marks } : {}) }] : []),
  ]);
});

const inlineFromEditor = (children = []) => {
  const result = children.map((node) => {
    if (node.type === 'hardBreak') return { type: 'text', text: '\n' };
    if (node.type !== 'text') throw new Error('Неподдерживаемое содержимое абзаца.');
    const text = { type: 'text', text: node.text };
    for (const [key, name] of Object.entries(markNames)) if (node.marks?.some((mark) => mark.type === name)) text[key] = true;
    const link = node.marks?.find((mark) => mark.type === 'link');
    return link ? { type: 'link', url: safeLinkUrl(link.attrs.href), children: [text] } : text;
  });
  return result.length ? result : emptyText();
};

const blockToEditor = (block) => {
  switch (block.type) {
    case 'paragraph': return { type: 'paragraph', content: inlineToEditor(block.children) };
    case 'heading': return { type: 'heading', attrs: { level: block.level }, content: inlineToEditor(block.children) };
    case 'quote': return { type: 'blockquote', content: [{ type: 'paragraph', content: inlineToEditor(block.children) }] };
    case 'code': return { type: 'codeBlock', attrs: { language: block.language || null }, content: [{ type: 'text', text: block.plainText ?? block.children.map((node) => node.text).join('') }].filter((node) => node.text) };
    case 'image': return { type: 'image', attrs: {
      src: new URL(mediaUrl(block.image.url)).pathname,
      alt: block.image.alternativeText,
      strapiImage: structuredClone(block.image),
    } };
    case 'list': {
      const items = [];
      for (const item of block.children) {
        // Strapi nests a list beside the preceding list-item, not inside it.
        if (item.type === 'list') {
          if (!items.length) items.push({ type: 'listItem', content: [{ type: 'paragraph', content: [] }] });
          items.at(-1).content.push(blockToEditor(item));
          continue;
        }
        const content = [];
        let inline = [];
        const flush = () => { if (inline.length) { content.push({ type: 'paragraph', content: inlineToEditor(inline) }); inline = []; } };
        for (const child of item.children) {
          if (['paragraph', 'list'].includes(child.type)) { flush(); content.push(blockToEditor(child)); }
          else inline.push(child);
        }
        flush();
        if (!content.length || content[0].type !== 'paragraph') content.unshift({ type: 'paragraph', content: [] });
        items.push({ type: 'listItem', content });
      }
      return {
      type: block.format === 'ordered' ? 'orderedList' : 'bulletList',
      content: items,
      };
    }
    default: throw new Error(`Неподдерживаемый блок: ${block.type}.`);
  }
};

const blockFromEditor = (node) => {
  switch (node.type) {
    case 'paragraph': return [{ type: 'paragraph', children: inlineFromEditor(node.content) }];
    case 'heading': return [{ type: 'heading', level: node.attrs.level, children: inlineFromEditor(node.content) }];
    case 'blockquote': return node.content.map((child) => {
      if (child.type !== 'paragraph') throw new Error('В цитате допустим только текст.');
      return { type: 'quote', children: inlineFromEditor(child.content) };
    });
    case 'codeBlock': return [{ type: 'code', ...(node.attrs?.language ? { language: node.attrs.language } : {}), children: [{ type: 'text', text: (node.content || []).map((child) => child.text || '').join('') }] }];
    case 'image': {
      const image = { ...structuredClone(node.attrs.strapiImage || {}), url: node.attrs.src, alternativeText: node.attrs.alt };
      return [{ type: 'image', image, children: emptyText() }];
    }
    case 'orderedList':
    case 'bulletList': return [{
      type: 'list', format: node.type === 'orderedList' ? 'ordered' : 'unordered',
      children: node.content.flatMap((item) => {
        const result = [];
        let inline = [];
        let paragraphs = 0;
        const flush = () => { result.push({ type: 'list-item', children: inline.length ? inline : emptyText() }); inline = []; paragraphs = 0; };
        for (const child of item.content) {
          if (child.type === 'paragraph') {
            if (paragraphs++) inline.push({ type: 'text', text: '\n' });
            inline.push(...inlineFromEditor(child.content));
          } else if (['bulletList', 'orderedList'].includes(child.type)) {
            flush();
            result.push(...blockFromEditor(child));
          } else throw new Error('В пункте списка допустимы текст и вложенные списки.');
        }
        if (inline.length || !result.length) flush();
        return result;
      }),
    }];
    default: throw new Error(`Неподдерживаемый блок редактора: ${node.type}.`);
  }
};

export const blocksToEditor = (blocks) => {
  renderBlocks(blocks); // Refuse unsupported content rather than silently dropping it.
  return { type: 'doc', content: blocks.map(blockToEditor) };
};

export const editorToBlocks = (document) => {
  if (document?.type !== 'doc') throw new Error('Некорректный документ редактора.');
  const blocks = (document.content || []).flatMap(blockFromEditor);
  renderBlocks(blocks);
  return blocks;
};

export const bodyText = (blocks) => {
  const parts = [];
  const visit = (node) => {
    if (node.type === 'text') parts.push(node.text);
    if (node.image) parts.push(node.image.alternativeText || '');
    if (node.plainText) parts.push(node.plainText);
    for (const child of node.children || []) visit(child);
  };
  for (const block of blocks) { visit(block); parts.push(' '); }
  return parts.join('').replace(/\s+/gu, ' ').trim();
};

export const editorPayload = (title, author, document) => {
  const body = editorToBlocks(document);
  const data = { title: title.trim(), author: author.trim(), body };
  if (!data.title || data.title.length > 180) throw new Error('Заголовок должен содержать от 1 до 180 символов.');
  if (data.author.length > 180) throw new Error('Имя автора не должно превышать 180 символов.');
  if (!bodyText(body)) throw new Error('Добавьте текст или изображение.');
  return data;
};

export const articleVersion = async ({ title, author, body }) => {
  const bytes = new TextEncoder().encode(JSON.stringify([title.trim(), author || '', renderBlocks(body)]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
