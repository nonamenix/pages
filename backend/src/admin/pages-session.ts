import { getFetchClient } from '@strapi/strapi/admin';

const UID = 'api::article.article';
const collection = `/content-manager/collection-types/${UID}`;
const channel = 'pages-editor-v1';
const reserved = new Set(['admin', 'api', 'uploads', '__preview', '_health', 'mcp', 'new', 'fonts']);
const identifier = (value: unknown) => {
  if (typeof value !== 'string' || !/^[a-z0-9]{12,64}$/.test(value)) throw new Error('Некорректный идентификатор.');
  return value;
};
const slugValue = (value: unknown) => {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || reserved.has(value)) throw new Error('Некорректный адрес статьи.');
  return value;
};

// Keep Strapi's cookie path and token refresh implementation inside /admin.
window.strapi = { ...window.strapi, backendURL: window.location.origin };
const client = getFetchClient();
const options = () => ({ signal: AbortSignal.timeout(30_000) });
const findSlug = async (slug: string, status = 'draft') => {
  const { data } = await client.get(collection, {
    ...options(), params: { status, pageSize: 2, filters: { slug: { $eq: slugValue(slug) } } },
  });
  if (data.results?.length > 1) throw new Error('Найдено несколько статей с одним адресом.');
  return data.results?.[0] || null;
};
const read = async (documentId: string) => {
  const { data } = await client.get(`${collection}/${identifier(documentId)}`, { ...options(), params: { status: 'draft' } });
  return data.data;
};
const plainText = (body: any[]) => {
  const collect = (node: any): string => node.text || node.image?.alternativeText || node.plainText || (node.children || []).map(collect).join(' ');
  return body.map(collect).join(' ').replace(/\s+/gu, ' ').trim();
};
const moscowDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const fields = (input: any) => {
  if (typeof input?.title !== 'string' || !input.title.trim() || input.title.length > 180) throw new Error('Некорректный заголовок.');
  if (typeof input.author !== 'string' || input.author.length > 180 || !Array.isArray(input.body)) throw new Error('Некорректное содержимое статьи.');
  return { title: input.title.trim(), author: input.author.trim(), body: input.body };
};

const operations = {
  async session() {
    const [{ data: me }, { data: permissions }] = await Promise.all([
      client.get('/admin/users/me', options()), client.get('/admin/users/me/permissions', options()),
    ]);
    const can = (action: string) => permissions.data.some((permission: any) => permission.action === `plugin::content-manager.explorer.${action}` && permission.subject === UID);
    return { name: [me.data.firstname, me.data.lastname].filter(Boolean).join(' ') || me.data.username || '', canRead: can('read'), canCreate: can('create'), canUpdate: can('update'), canPublish: can('publish') };
  },
  async read(input: any) {
    if (input.documentId) return read(input.documentId);
    const record = await findSlug(input.slug) || await findSlug(input.slug, 'published');
    if (!record) throw new Error('Статья не найдена или недоступна.');
    return read(record.documentId);
  },
  async prepare(input: any) {
    const data = fields(input.data);
    const key = identifier(input.creationKey);
    const { data: generated } = await client.post('/content-manager/uid/generate', { contentTypeUID: UID, field: 'slug', data }, options());
    const base = reserved.has(generated.data) ? 'page' : slugValue(generated.data);
    return { slug: `${base.slice(0, 140).replace(/-$/, '')}-${key}` };
  },
  async save(input: any) {
    const data = fields(input.data);
    let existing = input.documentId ? await read(input.documentId) : await findSlug(input.slug);
    if (existing) {
      if (input.updatedAt && input.updatedAt !== existing.updatedAt) {
        const error: any = new Error('Статья была изменена в другом окне. Откройте её заново перед сохранением.');
        error.status = 409;
        throw error;
      }
      const { data: result } = await client.put(`${collection}/${identifier(existing.documentId)}`, data, options());
      return result.data;
    }
    const { data: result } = await client.post(collection, {
      ...data, slug: slugValue(input.slug), excerpt: (plainText(data.body) || data.title).slice(0, 320),
      language: 'ru', publishedOn: moscowDate(), status: 'draft',
    }, options());
    return result.data;
  },
  async publish(input: any) {
    const documentId = identifier(input.documentId);
    const draft = await read(documentId);
    if (input.updatedAt && draft.updatedAt !== input.updatedAt) {
      const error: any = new Error('Черновик изменён в другом окне. Откройте статью заново.'); error.status = 409; throw error;
    }
    if (!await findSlug(draft.slug, 'published')) await client.put(`${collection}/${documentId}`, { publishedOn: moscowDate() }, options());
    const { data } = await client.post(`${collection}/${documentId}/actions/publish`, {}, options());
    return data.data;
  },
  async upload(input: any) {
    if (!(input.file instanceof Blob) || input.file.size > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(input.file.type)) throw new Error('Выберите JPG, PNG, WebP или AVIF размером до 10 МБ.');
    if (typeof input.alt !== 'string' || !input.alt.trim() || input.alt.length > 320) throw new Error('Добавьте описание изображения до 320 символов.');
    const form = new FormData();
    form.append('files', input.file, input.filename);
    form.append('fileInfo', JSON.stringify({ alternativeText: input.alt.trim(), caption: String(input.caption || '').slice(0, 320) }));
    const { data } = await client.post('/upload', form, options());
    return data[0];
  },
};

let queue = Promise.resolve();
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== window.parent || window.parent === window || event.data?.channel !== channel) return;
  const { id, operation, input } = event.data;
  if (typeof id !== 'string' || !Object.hasOwn(operations, operation)) return;
  const execute = async () => {
    try {
      const result = await operations[operation](input);
      window.parent.postMessage({ channel, id, result }, location.origin);
    } catch (error: any) {
      const status = error.status || error.response?.status || (error.name === 'TokenRefreshError' ? 401 : 0);
      const message = status === 401 ? 'Войдите в аккаунт администратора.' : status === 403 ? 'Недостаточно прав для этого действия.' : status === 409 ? error.message : status >= 500 ? 'Сервер временно недоступен. Текст сохранён в редакторе.' : error.message || 'Не удалось выполнить действие.';
      window.parent.postMessage({ channel, id, error: { status, message } }, location.origin);
    }
  };
  // Serialize mutations and reads so a timed-out create is resolved before a retry.
  queue = queue.then(execute, execute);
});
if (window.parent !== window) window.parent.postMessage({ channel, ready: true }, location.origin);
