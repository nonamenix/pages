import { bridgeRequest } from './session.mjs';

const root = document.querySelector('[data-pages-root]');
if (root && root.dataset.preview !== 'true') {
  let session = null;
  let editor = null;
  let refreshing = false;
  let starting = false;
  const status = root.querySelector('[data-session-status]');
  const edit = root.querySelector('[data-edit]');
  const login = document.querySelector('[data-login]');

  const start = async () => {
    if (editor || starting) return;
    starting = true;
    try {
      const { mountEditor } = await import('./editor.mjs');
      editor = await mountEditor(root, session, bridgeRequest);
      if (edit) edit.hidden = true;
    } catch (error) {
      if (status) { status.hidden = false; status.textContent = error.message; }
    } finally { starting = false; }
  };
  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      session = await bridgeRequest('session');
      if (login) login.hidden = true;
      for (const element of document.querySelectorAll('[data-create]')) element.hidden = !session.canCreate || !session.canRead;
      if (edit && !editor) edit.hidden = !session.canRead || !session.canUpdate;
      if (root.dataset.mode === 'new') {
        const resuming = new URLSearchParams(location.search).has('draft');
        if (session.canRead && (resuming ? session.canUpdate : session.canCreate)) {
          if (status) status.hidden = true;
          await start();
        } else if (status) status.textContent = resuming ? 'Для открытия черновика нужны права на чтение и изменение статей.' : 'Для создания страницы нужны права на чтение и создание статей.';
      }
      editor?.setSession(session);
    } catch (error) {
      session = null;
      if (login) login.hidden = false;
      for (const element of document.querySelectorAll('[data-create]')) element.hidden = true;
      if (edit) edit.hidden = true;
      editor?.setSession(null);
      if (root.dataset.mode === 'new' && !editor && status) {
        status.hidden = false;
        status.textContent = error.status === 401 ? 'Войдите, чтобы написать новую страницу.' : error.message;
      }
    } finally { refreshing = false; }
  };
  edit?.addEventListener('click', start);
  window.addEventListener('focus', refresh);
  window.addEventListener('storage', (event) => { if (['jwtToken', 'isLoggedIn'].includes(event.key)) refresh(); });
  root.addEventListener('pages-editor-close', () => { editor = null; refresh(); });
  if (root.dataset.mode === 'new') refresh();
  else (window.requestIdleCallback || ((callback) => setTimeout(callback, 200)))(refresh);
}
