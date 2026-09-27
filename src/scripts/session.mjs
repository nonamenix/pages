const channel = 'pages-editor-v1';
let bridge;
let readiness;
const pending = new Map();

export const bridgeRequest = async (operation, input = {}) => {
  if (!readiness) {
    readiness = new Promise((resolve, reject) => {
      bridge = document.createElement('iframe');
      bridge.hidden = true;
      bridge.title = 'Сессия Pages';
      bridge.src = '/admin/pages-session.html';
      const timeout = setTimeout(() => reject(new Error('Не удалось подключиться к редактору. Попробуйте обновить страницу.')), 15_000);
      window.addEventListener('message', (event) => {
        if (event.origin !== location.origin || event.source !== bridge.contentWindow || event.data?.channel !== channel) return;
        if (event.data.ready) { clearTimeout(timeout); resolve(); return; }
        const request = pending.get(event.data.id);
        if (!request) return;
        clearTimeout(request.timeout);
        pending.delete(event.data.id);
        if (event.data.error) request.reject(Object.assign(new Error(event.data.error.message), { status: event.data.error.status }));
        else request.resolve(event.data.result);
      });
      document.body.append(bridge);
    });
  }
  await readiness;
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Сервер не ответил вовремя. Текст остался в редакторе; повторное сохранение проверит результат предыдущего запроса.'));
    }, 65_000);
    pending.set(id, { resolve, reject, timeout });
    bridge.contentWindow.postMessage({ channel, id, operation, input }, location.origin);
  });
};
