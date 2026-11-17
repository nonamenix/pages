// Runs against a disposable local Strapi database, never production content.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { validateRelease } from '../publisher/server.mjs';
import { parseEnvelope } from '../src/lib/articles.mjs';
import { blocksToEditor, editorToBlocks } from '../src/lib/editor-blocks.mjs';

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(repo, 'backend/package.json'));
const { createStrapi } = require('@strapi/strapi');
const UID = 'api::article.article';
const collection = `/content-manager/collection-types/${UID}`;
const png = await require('sharp')({ create: { width: 400, height: 180, channels: 3, background: '#e8eef3' } }).png().toBuffer();
const csp = "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'";
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.xml': 'application/xml' };

test('authenticated Pages editing and publication', { timeout: 180_000 }, async (t) => {
  let activePage;
  const step = async (name, fn) => {
    let failure;
    await t.test(name, async () => { try { await fn(); } catch (error) {
      failure = error;
      if (activePage) {
        await activePage.screenshot({ path: path.join(workspace, 'failure.png'), fullPage: true });
        await fs.writeFile(path.join(workspace, 'failure.txt'), await activePage.locator('body').innerText());
      }
      throw error;
    } });
    if (failure) throw failure;
  };
  await fs.mkdir(path.join(repo, '.tmp'), { recursive: true });
  const workspace = await fs.mkdtemp(path.join(repo, '.tmp/editor-e2e-'));
  const appDir = path.join(workspace, 'backend');
  await fs.cp(path.join(repo, 'backend/dist'), path.join(appDir, 'dist'), { recursive: true });
  await fs.copyFile(path.join(repo, 'backend/package.json'), path.join(appDir, 'package.json'));
  await fs.symlink(path.join(repo, 'backend/node_modules'), path.join(appDir, 'node_modules'));
  await fs.mkdir(path.join(appDir, 'public/uploads'), { recursive: true });
  let backendUrl;
  let release;
  let buildNumber = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (/^\/(admin|content-manager|upload|uploads)(\/|$)/.test(url.pathname)) {
      const upstream = http.request(new URL(req.url, backendUrl), { method: req.method, headers: req.headers }, (response) => {
        const headers = { ...response.headers };
        if (url.pathname === '/admin/pages-session.html') {
          headers['x-frame-options'] = 'SAMEORIGIN';
          headers['content-security-policy'] = csp;
          headers['cache-control'] = 'no-store';
        }
        res.writeHead(response.statusCode, headers);
        response.pipe(res);
      });
      upstream.on('error', () => { res.writeHead(502); res.end(); });
      req.pipe(upstream);
      return;
    }
    try {
      const relative = decodeURIComponent(url.pathname).replace(/^\//, '');
      if (relative.split('/').includes('..')) throw new Error('Unsafe path');
      const filename = path.join(release, !relative ? 'index.html' : path.extname(relative) ? relative : `${relative}/index.html`);
      const data = await fs.readFile(filename);
      res.writeHead(200, { 'content-type': mime[path.extname(filename)] || 'application/octet-stream', 'content-security-policy': csp, 'x-frame-options': 'DENY' });
      res.end(data);
    } catch { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>404</h1>'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const secret = () => crypto.randomBytes(32).toString('hex');
  const token = secret();
  const previousEnv = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0', PUBLIC_URL: origin, MEDIA_PUBLIC_BASE_URL: `${origin}/uploads`,
    APP_KEYS: `${secret()},${secret()}`, ADMIN_JWT_SECRET: secret(), API_TOKEN_SALT: secret(),
    TRANSFER_TOKEN_SALT: secret(), ENCRYPTION_KEY: secret(), JWT_SECRET: secret(),
    DATABASE_CLIENT: 'sqlite', DATABASE_FILENAME: path.join(workspace, 'data.db'),
    STRAPI_API_TOKEN: token, SEED_VERIFICATION_DRAFT: 'false', STRAPI_TELEMETRY_DISABLED: 'true',
    PUBLISHER_URL: '',
  });
  const previousCwd = process.cwd();
  process.chdir(appDir);
  let strapi;
  let browser;
  try {
    strapi = createStrapi({ appDir, distDir: path.join(appDir, 'dist') });
    await strapi.load();
    await strapi.listen();
    backendUrl = `http://127.0.0.1:${strapi.server.httpServer.address().port}`;
    const password = `Test9!${secret()}`;
    await strapi.admin.services.user.createFirstAdmin({ email: 'editor@example.test', firstname: 'Тестовый', lastname: 'Автор', password });
    const original = await strapi.documents(UID).create({ status: 'published', data: {
      title: 'Статья для проверки', slug: 'editor-fixture', author: 'Автор', excerpt: 'Описание для поиска',
      language: 'ru', publishedOn: '2026-01-01', body: editorToBlocks(blocksToEditor([
        { type: 'paragraph', children: [{ type: 'text', text: 'Опубликованный текст' }] },
        { type: 'heading', level: 2, children: [{ type: 'text', text: 'Раздел' }] },
        { type: 'quote', children: [{ type: 'text', text: 'Цитата', italic: true }] },
        { type: 'paragraph', children: [{ type: 'link', url: 'https://example.com/', children: [{ type: 'text', text: 'Ссылка', bold: true }] }] },
        { type: 'code', language: 'javascript', children: [{ type: 'text', text: 'const x = 1;\n// code' }] },
        { type: 'list', format: 'ordered', children: [
          { type: 'list-item', children: [{ type: 'text', text: 'Первый' }] },
          { type: 'list', format: 'unordered', children: [{ type: 'list-item', children: [{ type: 'text', text: 'Вложенный' }] }] },
        ] },
      ])),
    } });
    const build = async () => {
      const target = path.join(workspace, `release-${++buildNumber}`);
      await run(process.execPath, [path.join(repo, 'node_modules/astro/bin/astro.mjs'), 'build'], {
        cwd: repo, maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', PAGES_CONTENT_SOURCE: 'strapi', STRAPI_INTERNAL_URL: backendUrl, ASTRO_OUT_DIR: target },
      });
      const response = await fetch(`${backendUrl}/api/publisher/site`, { headers: { Authorization: `Bearer ${token}` } });
      await validateRelease(target, parseEnvelope(await response.json()));
      release = target;
    };
    await build();
    browser = await chromium.launch({ headless: true });
    const anonymous = await browser.newContext();
    const reader = await anonymous.newPage();
    const errors = [];
    reader.on('pageerror', (error) => errors.push(error.message));
    await step('anonymous users can read; /new requires an existing login', async () => {
      await reader.goto(`${origin}/editor-fixture/`);
      await reader.getByRole('heading', { name: original.title }).waitFor();
      assert.equal(await reader.locator('[data-edit]').isVisible(), false);
      assert.equal(await reader.locator('.article-body').evaluate((element) => getComputedStyle(element).fontSize), '18px');
      await reader.goto(`${origin}/new`);
      await reader.getByText('Войдите, чтобы написать новую страницу.').waitFor();
      assert.equal(await reader.locator('[contenteditable=true]').count(), 0);
      assert.equal(await reader.locator('script[src="/metrika.js"]').count(), 0);
    });
    const context = await browser.newContext();
    const login = await context.request.post(`${origin}/admin/login`, { data: { email: 'editor@example.test', password } });
    assert.equal(login.status(), 200);
    const accessToken = (await login.json()).data.token;
    await context.addCookies([{ name: 'jwtToken', value: encodeURIComponent(accessToken), domain: '127.0.0.1', path: '/admin', httpOnly: false, secure: false, sameSite: 'Lax' }]);
    const page = await context.newPage();
    activePage = page;
    page.on('pageerror', (error) => errors.push(error.message));
    const shell = page.locator('[data-editor-host]');
    const body = shell.getByRole('textbox', { name: 'Текст статьи' });
    let documentId;
    let slug;
    let uploadedImage;
    await step('new article supports formatting, images and repeatable draft saves', async () => {
      await page.goto(`${origin}/new`);
      await shell.getByRole('textbox', { name: 'Заголовок', exact: true }).fill('Новая тестовая страница');
      assert.equal(await page.evaluate(() => localStorage.getItem('jwtToken')), null);
      assert.equal(await page.evaluate(() => document.cookie.includes('jwtToken=')), false);
      await body.fill('Первый абзац');
      await page.keyboard.press('ControlOrMeta+A');
      await shell.locator('[data-format=bold]').click();
      assert.equal(await body.locator('strong').textContent(), 'Первый абзац');
      await body.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      await body.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('[contenteditable=true]').editor.state.selection.empty);
      await body.press('End');
      await page.waitForFunction(() => {
        const { $from } = document.querySelector('[contenteditable=true]').editor.state.selection;
        return $from.parentOffset === $from.parent.content.size;
      });
      await body.press('Enter');
      await body.locator('p').nth(1).waitFor({ timeout: 5_000 });
      await shell.locator('[data-insert-image]').click({ timeout: 5_000 });
      const dialog = shell.locator('[data-image-dialog]');
      await dialog.locator('[data-image-file]').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png });
      await dialog.locator('[data-image-alt]').fill('Тестовое изображение');
      await dialog.locator('[data-image-caption]').fill('Подпись изображения');
      await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
      await body.locator('img').waitFor();
      await shell.locator('[data-save]').click();
      await shell.getByText('Черновик сохранён.', { exact: true }).waitFor();
      documentId = new URL(page.url()).searchParams.get('draft');
      assert.ok(documentId);
      await shell.locator('[data-save]').click();
      await shell.getByText('Черновик сохранён.', { exact: true }).waitFor();
      const draft = await strapi.documents(UID).findOne({ documentId, status: 'draft' });
      slug = draft.slug;
      assert.equal(draft.author, 'Тестовый Автор');
      assert.equal(draft.body.find((block) => block.type === 'image').image.caption, 'Подпись изображения');
      uploadedImage = draft.body.find((block) => block.type === 'image').image;
      assert.equal((await strapi.documents(UID).findMany({ filters: { slug } })).length, 1);
      assert.equal(await strapi.documents(UID).findOne({ documentId, status: 'published' }), null);
      assert.equal((await fetch(`${origin}/${slug}/`)).status, 404);
      await page.reload();
      await body.locator('img').waitFor();
      assert.equal(await shell.locator('[data-title]').inputValue(), 'Новая тестовая страница');
      await page.screenshot({ path: path.join(workspace, 'editor-desktop.png'), fullPage: true });
    });
    await step('publication waits for the matching static release; existing article edits remain inline', async () => {
      await strapi.documents(UID).update({ documentId: original.documentId, data: { cover: uploadedImage.id } });
      await strapi.documents(UID).publish({ documentId: original.documentId });
      await shell.locator('[data-publish]').click();
      await shell.locator('[data-public-link]').waitFor();
      assert.ok(page.url().includes('/new?draft='));
      assert.ok(await strapi.documents(UID).findOne({ documentId, status: 'published' }));
      await build();
      await page.waitForURL(`${origin}/${slug}/`);
      await page.getByRole('heading', { name: 'Новая тестовая страница' }).waitFor();
      await page.locator('[data-edit]').click();
      await shell.getByRole('textbox', { name: 'Заголовок', exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, `/${slug}/`);
      await shell.locator('[data-cancel]').click();
      await page.goto(`${origin}/editor-fixture/`);
      await page.locator('[data-edit]').click();
      await shell.locator('[data-save]').click();
      await shell.getByText('Черновик сохранён.', { exact: true }).waitFor();
      await body.fill('Новый текст в черновике');
      await shell.locator('[data-save]').click();
      await shell.getByText('Черновик сохранён.', { exact: true }).waitFor();
      const draft = await strapi.documents(UID).findOne({ documentId: original.documentId, status: 'draft', populate: { cover: true } });
      assert.equal(draft.excerpt, original.excerpt);
      assert.equal(draft.publishedOn, original.publishedOn);
      assert.equal(draft.language, original.language);
      assert.equal(draft.cover.id, uploadedImage.id);
      const published = await strapi.documents(UID).findOne({ documentId: original.documentId, status: 'published' });
      assert.equal(published.body[0].children[0].text, 'Опубликованный текст');
      assert.match(await (await fetch(`${origin}/editor-fixture/`)).text(), /Опубликованный текст/);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await shell.locator('[data-title]').evaluate((element) => element.clientHeight >= element.scrollHeight), true);
      await page.screenshot({ path: path.join(workspace, 'editor-mobile.png'), fullPage: true });
      await shell.locator('[data-publish]').click();
      await shell.locator('[data-public-link]').waitFor();
      assert.equal(await body.isVisible(), true); // Same title in the old release cannot confirm publication.
      await build();
      await body.waitFor({ state: 'detached' });
      await page.getByText('Новый текст в черновике', { exact: true }).waitFor();
      await page.locator('[data-edit]').click();
      await body.waitFor();
    });
    await step('conflicting edits and expired sessions preserve the editor text', async () => {
      await strapi.documents(UID).update({ documentId: original.documentId, data: { author: 'Другой автор' } });
      await body.fill('Мой несохранённый текст');
      await shell.locator('[data-save]').click();
      await shell.getByText('Статья была изменена в другом окне.', { exact: false }).waitFor();
      assert.equal(await body.textContent(), 'Мой несохранённый текст');
      await context.clearCookies();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await shell.getByText('Войдите снова, чтобы сохранить изменения.', { exact: false }).waitFor();
      assert.equal(await body.textContent(), 'Мой несохранённый текст');
      assert.equal(await shell.locator('[data-save]').isDisabled(), true);
    });
    await step('reserved routes reject CMS writes and mobile readers fit the viewport', async () => {
      for (const reserved of ['new', 'fonts']) {
        await assert.rejects(() => strapi.documents(UID).create({ data: { ...original, id: undefined, documentId: undefined, slug: reserved } }), /зарезервирован/);
      }
      await reader.setViewportSize({ width: 390, height: 844 });
      await reader.goto(`${origin}/${slug}/`);
      await reader.evaluate(() => document.fonts.ready);
      assert.equal(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await reader.screenshot({ path: path.join(workspace, 'reader-mobile.png'), fullPage: true });
    });
    assert.deepEqual(errors, []);
    t.diagnostic(`Visual evidence: ${workspace}`);
  } finally {
    await browser?.close();
    await strapi?.destroy();
    await new Promise((resolve) => server.close(resolve));
    process.chdir(previousCwd);
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(previousEnv, key)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
});
