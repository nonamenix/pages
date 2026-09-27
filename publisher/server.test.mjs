import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { normalizePreviewRoute, previewSignature, resolvePreviewFile, safeEqual, validateRelease } from './server.mjs';

test('preview signature covers site, preview id, route and expiry', () => {
  const first = previewSignature({ previewId: 'a'.repeat(32), route: '/test/', expires: 1_800_000_000, secret: 'secret' });
  const same = previewSignature({ previewId: 'a'.repeat(32), route: '/test/', expires: 1_800_000_000, secret: 'secret' });
  const otherRoute = previewSignature({ previewId: 'a'.repeat(32), route: '/other/', expires: 1_800_000_000, secret: 'secret' });
  assert.equal(first, same);
  assert.notEqual(first, otherRoute);
});

test('preview route rejects traversal and encoded separators', () => {
  assert.equal(normalizePreviewRoute('/test/'), '/test/');
  assert.throws(() => normalizePreviewRoute('/../secret'));
  assert.throws(() => normalizePreviewRoute('/%2e%2e/secret'));
  assert.throws(() => normalizePreviewRoute('/test%2fsecret/'));
  assert.throws(() => normalizePreviewRoute('/test%5csecret/'));
  assert.throws(() => normalizePreviewRoute('/test?draft=true'));
});

test('preview file remains inside its immutable preview root', () => {
  const root = path.resolve('/srv/pages-live4dev/previews/example');
  assert.equal(resolvePreviewFile(root, '/'), path.join(root, 'index.html'));
  assert.equal(resolvePreviewFile(root, '/test/'), path.join(root, 'test/index.html'));
  assert.throws(() => resolvePreviewFile(root, '/../secret'));
});

test('secret comparison fails closed for empty and different values', () => {
  assert.equal(safeEqual('secret', 'secret'), true);
  assert.equal(safeEqual('secret', 'other'), false);
  assert.equal(safeEqual('', ''), false);
});

test('release validation accepts root article routes and rejects reserved routes', async () => {
  const root = await fs.mkdtemp(path.join(process.cwd(), '.publisher-test-'));
  const article = { slug: 'test', draft: false };
  const metrikaMarkup = '<script src="/metrika.js" defer></script><noscript><img src="https://mc.yandex.ru/watch/111762995" alt=""></noscript>';
  try {
    await fs.mkdir(path.join(root, 'test'));
    await fs.mkdir(path.join(root, 'new'));
    await fs.mkdir(path.join(root, 'fonts'));
    await fs.writeFile(path.join(root, 'new/index.html'), '<html><head><meta name="robots" content="noindex, nofollow, noarchive"></head><body><h1>Новая страница</h1></body></html>');
    await fs.writeFile(path.join(root, 'favicon.svg'), '<svg/>');
    await fs.writeFile(path.join(root, 'metrika.js'), "https://mc.yandex.ru/metrika/tag.js?id=111762995; ym(111762995, 'init');");
    await fs.writeFile(path.join(root, 'robots.txt'), 'User-agent: *');
    await fs.writeFile(path.join(root, 'sitemap.xml'), '<urlset><url><loc>https://pages.live4.dev/test/</loc></url></urlset>');
    await fs.writeFile(path.join(root, 'index.html'), `<html><head><link rel="icon" href="/favicon.svg">${metrikaMarkup}</head><body><h1>Pages</h1></body></html>`);
    await fs.writeFile(path.join(root, '404.html'), '<html><head><link rel="icon" href="/favicon.svg"></head><body><h1>404</h1></body></html>');
    await fs.writeFile(path.join(root, 'test', 'index.html'), `<html><head><link rel="canonical" href="https://pages.live4.dev/test/"><link rel="icon" href="/favicon.svg">${metrikaMarkup}</head><body><h1>Test</h1></body></html>`);
    const metrics = await validateRelease(root, [article]);
    assert.equal(metrics.routeCount, 4);

    await fs.writeFile(path.join(root, 'new/index.html'), `<html><head><meta name="robots" content="noindex, nofollow, noarchive"></head><body>${metrikaMarkup}</body></html>`);
    await assert.rejects(() => validateRelease(root, [article]), /Metrika/);
    await fs.writeFile(path.join(root, 'new/index.html'), '<html><head><meta name="robots" content="noindex, nofollow, noarchive"></head><body>Editor</body></html>');
    await fs.writeFile(path.join(root, 'sitemap.xml'), '<urlset><url><loc>https://pages.live4.dev/test/</loc></url><url><loc>https://pages.live4.dev/new/</loc></url></urlset>');
    await assert.rejects(() => validateRelease(root, [article]), /editor|new|sitemap/i);
    await fs.writeFile(path.join(root, 'sitemap.xml'), '<urlset><url><loc>https://pages.live4.dev/test/</loc></url></urlset>');

    await fs.rename(path.join(root, 'test'), path.join(root, 'new-story'));
    const renamed = (await fs.readFile(path.join(root, 'new-story/index.html'), 'utf8')).replaceAll('/test/', '/new-story/');
    await fs.writeFile(path.join(root, 'new-story/index.html'), renamed);
    await fs.writeFile(path.join(root, 'sitemap.xml'), '<urlset><url><loc>https://pages.live4.dev/new-story/</loc></url></urlset>');
    await validateRelease(root, [{ slug: 'new-story', draft: false }]);
    await fs.rename(path.join(root, 'new-story'), path.join(root, 'test'));
    await fs.writeFile(path.join(root, 'test/index.html'), renamed.replaceAll('/new-story/', '/test/'));
    await fs.writeFile(path.join(root, 'sitemap.xml'), '<urlset><url><loc>https://pages.live4.dev/test/</loc></url></urlset>');

    await fs.rename(path.join(root, 'test'), path.join(root, 'admin'));
    await assert.rejects(() => validateRelease(root, [{ slug: 'admin', draft: false }]), /Unsafe slug/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
