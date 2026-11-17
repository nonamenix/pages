import { Editor, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Blockquote from '@tiptap/extension-blockquote';
import { ListItem } from '@tiptap/extension-list';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { blocksToEditor, editorPayload, articleVersion } from '../lib/editor-blocks.mjs';
import { safeLinkUrl } from '../lib/blocks.mjs';

const ArticleImage = Image.extend({
  addAttributes() {
    return { ...this.parent(), strapiImage: { default: null, rendered: false } };
  },
  renderHTML({ node, HTMLAttributes }) {
    const caption = node.attrs.strapiImage?.caption;
    return ['figure', { class: 'editor-image' }, ['img', mergeAttributes(HTMLAttributes)], ...(caption ? [['figcaption', {}, caption]] : [])];
  },
});

export const mountEditor = async (root, initialSession, request) => {
  const draftId = root.dataset.mode === 'new' ? new URLSearchParams(location.search).get('draft') : null;
  let record = root.dataset.mode === 'article' || draftId ? await request('read', draftId ? { documentId: draftId } : { slug: root.dataset.slug }) : null;
  const initialDocument = record ? blocksToEditor(record.body) : { type: 'doc', content: [{ type: 'paragraph' }] };
  let session = initialSession;
  let busy = false;
  let dirty = false;
  let closed = false;
  let pendingPublication = null;
  let preparedSlug = record?.slug || null;
  let selection = null;
  const creationKey = crypto.randomUUID().replaceAll('-', '');
  const host = root.querySelector('[data-editor-host]');
  const readView = root.querySelector('[data-read-view]');
  const fragment = root.querySelector('[data-editor-template]').content.cloneNode(true);
  host.append(fragment);
  const shell = host.querySelector('.pages-editor');
  const title = shell.querySelector('[data-title]');
  const author = shell.querySelector('[data-author]');
  const status = shell.querySelector('[data-status]');
  const menu = shell.querySelector('[data-format-menu]');
  const insertImage = shell.querySelector('[data-insert-image]');
  const publish = shell.querySelector('[data-publish]');
  const save = shell.querySelector('[data-save]');
  const publicLink = shell.querySelector('[data-public-link]');
  const checkPublic = shell.querySelector('[data-check-public]');
  title.value = record?.title || '';
  author.value = record?.author || (!record ? session.name : '');

  const showStatus = (message, error = false) => { status.textContent = message; status.classList.toggle('is-error', error); };
  const resizeTitle = () => { title.style.height = 'auto'; title.style.height = `${title.scrollHeight + 8}px`; };
  const updateControls = () => {
    const writable = session && (record ? session.canUpdate : session.canCreate);
    save.disabled = busy || !writable;
    publish.disabled = busy || !writable || !session?.canPublish;
    title.disabled = author.disabled = busy || !writable;
    editor.setEditable(!busy && !!writable, false);
    insertImage.disabled = busy || !writable;
    shell.querySelector('[data-relogin]').hidden = !!session;
    if (busy || !writable) { menu.hidden = true; insertImage.hidden = true; }
  };
  const markDirty = () => {
    dirty = true;
    if (!busy) showStatus('Есть несохранённые изменения.');
  };
  const positionTools = () => {
    if (!editor.isEditable || !editor.isFocused) { menu.hidden = true; insertImage.hidden = true; return; }
    const { from, to, empty, $from } = editor.state.selection;
    if (!empty) {
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      menu.hidden = false;
      const width = menu.offsetWidth;
      menu.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, (start.left + end.right - width) / 2))}px`;
      const desiredTop = Math.min(start.top, end.top) - menu.offsetHeight - 12;
      menu.style.top = `${Math.max(8, desiredTop < 8 ? Math.max(start.bottom, end.bottom) + 12 : desiredTop)}px`;
    } else menu.hidden = true;
    insertImage.hidden = !empty || $from.parent.type.name !== 'paragraph' || !!$from.parent.textContent;
    if (!insertImage.hidden) {
      const coords = editor.view.coordsAtPos(from);
      const bounds = shell.getBoundingClientRect();
      insertImage.style.top = `${coords.top - bounds.top - 2}px`;
    }
    for (const button of menu.querySelectorAll('[data-format]')) {
      const format = button.dataset.format;
      const active = format === 'heading' ? editor.isActive('heading', { level: 2 }) : format === 'subheading' ? editor.isActive('heading', { level: 3 }) : editor.isActive({ quote: 'blockquote', bullet: 'bulletList', ordered: 'orderedList' }[format] || format);
      button.setAttribute('aria-pressed', String(active));
    }
  };

  const editor = new Editor({
    element: shell.querySelector('[data-body]'),
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] }, horizontalRule: false, blockquote: false, listItem: false,
        link: { openOnClick: false, isAllowedUri: (url) => { try { safeLinkUrl(url); return true; } catch { return false; } } },
      }),
      Blockquote.extend({ content: 'paragraph+' }),
      ListItem.extend({ content: 'paragraph (paragraph | bulletList | orderedList)*' }),
      ArticleImage,
      Placeholder.configure({ placeholder: 'Ваш текст…' }),
    ],
    content: initialDocument,
    injectCSS: false,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': 'Текст статьи', 'aria-multiline': 'true', spellcheck: 'true' },
      transformPastedHTML: (html) => {
        const document = new DOMParser().parseFromString(html, 'text/html');
        for (const image of document.querySelectorAll('img')) image.remove();
        for (const link of document.querySelectorAll('a')) {
          try { link.setAttribute('href', safeLinkUrl(link.getAttribute('href'))); }
          catch { link.removeAttribute('href'); }
        }
        return document.body.innerHTML;
      },
    },
    onUpdate: () => { markDirty(); positionTools(); },
    onSelectionUpdate: positionTools,
    onFocus: positionTools,
    onBlur: () => { if (!shell.contains(document.activeElement)) { menu.hidden = true; insertImage.hidden = true; } },
  });
  readView.hidden = true;
  const oldActions = root.querySelector(':scope > .page-actions');
  if (oldActions) oldActions.hidden = true;
  resizeTitle();
  document.fonts?.ready.then(resizeTitle);
  updateControls();
  title.addEventListener('input', () => { resizeTitle(); markDirty(); });
  author.addEventListener('input', markDirty);
  const handleResize = () => { resizeTitle(); positionTools(); };
  window.addEventListener('scroll', positionTools, { passive: true });
  window.addEventListener('resize', handleResize);
  const beforeUnload = (event) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);

  const linkDialog = shell.querySelector('[data-link-dialog]');
  const linkInput = linkDialog.querySelector('[data-link-url]');
  const openLink = () => {
    selection = { from: editor.state.selection.from, to: editor.state.selection.to };
    linkInput.value = editor.getAttributes('link').href || '';
    linkDialog.querySelector('[data-dialog-error]').textContent = '';
    menu.hidden = true;
    linkDialog.showModal();
    linkInput.focus();
  };
  linkDialog.querySelector('form').addEventListener('submit', (event) => {
    if (event.submitter?.value !== 'save') return;
    event.preventDefault();
    try {
      const href = safeLinkUrl(linkInput.value);
      if (href.startsWith('#')) throw new Error('Укажите полный адрес или путь, начинающийся с /.');
      editor.chain().focus().setTextSelection(selection).extendMarkRange('link').setLink({ href }).run();
      linkDialog.close();
    } catch (error) { linkDialog.querySelector('[data-dialog-error]').textContent = error.message; }
  });
  linkDialog.querySelector('[data-remove-link]').addEventListener('click', () => {
    editor.chain().focus().setTextSelection(selection).extendMarkRange('link').unsetLink().run();
    linkDialog.close();
  });
  menu.addEventListener('mousedown', (event) => event.preventDefault());
  menu.addEventListener('click', (event) => {
    const format = event.target.closest('[data-format]')?.dataset.format;
    if (!format) return;
    if (format === 'link') return openLink();
    const chain = editor.chain().focus();
    const actions = {
      bold: () => chain.toggleBold(), italic: () => chain.toggleItalic(),
      heading: () => chain.toggleHeading({ level: 2 }), subheading: () => chain.toggleHeading({ level: 3 }),
      quote: () => chain.toggleBlockquote(), bullet: () => chain.toggleBulletList(), ordered: () => chain.toggleOrderedList(),
    };
    actions[format]?.().run();
  });

  const imageDialog = shell.querySelector('[data-image-dialog]');
  const imageForm = imageDialog.querySelector('form');
  insertImage.addEventListener('mousedown', (event) => event.preventDefault());
  insertImage.addEventListener('click', () => {
    selection = { from: editor.state.selection.from, to: editor.state.selection.to };
    imageForm.reset();
    imageDialog.querySelector('[data-dialog-error]').textContent = '';
    imageDialog.showModal();
  });
  imageForm.addEventListener('submit', async (event) => {
    if (event.submitter?.value !== 'save') return;
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const file = imageDialog.querySelector('[data-image-file]').files[0];
      const image = await request('upload', { file, filename: file.name, alt: imageDialog.querySelector('[data-image-alt]').value, caption: imageDialog.querySelector('[data-image-caption]').value });
      editor.chain().focus().setTextSelection(selection).insertContent([
        { type: 'image', attrs: { src: image.url, alt: image.alternativeText, strapiImage: image } },
        { type: 'paragraph' },
      ]).run();
      imageDialog.close();
    } catch (error) { imageDialog.querySelector('[data-dialog-error]').textContent = error.message; }
    finally { button.disabled = false; }
  });

  const waitForPublication = async () => {
    if (!pendingPublication || closed) return;
    const pending = pendingPublication;
    checkPublic.hidden = true;
    for (let attempt = 0; attempt < 30 && !closed && pendingPublication === pending; attempt++) {
      try {
        const response = await fetch(`/${pending.slug}/?publication=${Date.now()}`, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(8_000) });
        if (response.ok) {
          const document = new DOMParser().parseFromString(await response.text(), 'text/html');
          if (document.querySelector('[data-content-version]')?.dataset.contentVersion === pending.version) {
            pendingPublication = null;
            showStatus('Опубликовано.');
            if (!dirty) {
              closed = true;
              window.removeEventListener('beforeunload', beforeUnload);
              location.assign(`/${pending.slug}/`);
            }
            return;
          }
        }
      } catch { /* The CMS save is confirmed; the public build may still be running. */ }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    if (!closed && pendingPublication === pending) {
      showStatus('Сохранено в CMS. Публичная страница ещё обновляется.');
      checkPublic.hidden = false;
    }
  };
  const persist = async (shouldPublish) => {
    if (busy) return;
    try {
      const data = editorPayload(title.value, author.value, editor.getJSON());
      busy = true;
      updateControls();
      showStatus('Сохраняем…');
      if (!preparedSlug) preparedSlug = (await request('prepare', { data, creationKey })).slug;
      record = await request('save', { documentId: record?.documentId, slug: preparedSlug, updatedAt: record?.updatedAt, data });
      dirty = false;
      if (root.dataset.mode === 'new') history.replaceState({}, '', `/new?draft=${record.documentId}`);
      showStatus('Черновик сохранён.');
      if (shouldPublish) {
        showStatus('Статья публикуется…');
        await request('publish', { documentId: record.documentId, updatedAt: record.updatedAt });
        pendingPublication = { slug: record.slug, version: await articleVersion(data) };
        record = await request('read', { documentId: record.documentId });
        publicLink.href = `/${record.slug}/`;
        publicLink.hidden = false;
        void waitForPublication();
      }
    } catch (error) {
      showStatus(error.message, true);
      if (error.status === 401) { session = null; showStatus('Сессия истекла. Войдите снова — текст остался в редакторе.', true); }
    } finally { busy = false; updateControls(); }
  };
  save.addEventListener('click', () => persist(false));
  publish.addEventListener('click', () => persist(true));
  checkPublic.addEventListener('click', waitForPublication);
  shell.querySelector('[data-cancel]').addEventListener('click', () => {
    if (busy || (dirty && !window.confirm('Закрыть редактор без сохранения последних изменений?'))) return;
    closed = true;
    editor.destroy();
    window.removeEventListener('beforeunload', beforeUnload);
    window.removeEventListener('scroll', positionTools);
    window.removeEventListener('resize', handleResize);
    host.replaceChildren();
    readView.hidden = false;
    if (oldActions) oldActions.hidden = false;
    if (root.dataset.mode === 'new') location.assign('/');
    else root.dispatchEvent(new Event('pages-editor-close'));
  });
  if (!record) title.focus();
  return {
    setSession(next) {
      session = next;
      updateControls();
      if (!next) showStatus('Войдите снова, чтобы сохранить изменения. Текст остался в редакторе.', true);
    },
  };
};
