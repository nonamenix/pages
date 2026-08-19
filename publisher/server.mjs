import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SITE_ID = 'pages-live4dev';
const PREVIEW_TTL_SECONDS = 15 * 60;
const port = Number(process.env.PORT || 3000);
const strapiUrl = (process.env.STRAPI_INTERNAL_URL || 'http://strapi:1337').replace(/\/$/, '');
const sourceRoot = path.resolve(process.env.SITE_SOURCE_DIR || '/workspace/site-source');
const outputRoot = path.resolve(process.env.SITE_OUTPUT_DIR || '/srv/pages-live4dev');
const strapiApiToken = process.env.STRAPI_API_TOKEN || '';
const webhookSecret = process.env.PUBLISHER_WEBHOOK_SECRET || '';
const previewSigningSecret = process.env.PREVIEW_SIGNING_SECRET || '';
const siteUrl = (process.env.SITE_URL || process.env.PUBLIC_URL || 'https://pages.live4.dev').replace(/\/$/, '');
const keepReleases = Math.max(4, Number(process.env.KEEP_RELEASES || 4));

let publishRunning = false;
let publishQueued = false;
let publishTimer = null;
let lastSuccessAt = null;
let lastError = null;
let buildTail = Promise.resolve();

export const safeEqual = (actual, expected) => {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

export const normalizePreviewRoute = (rawRoute) => {
  if (!rawRoute.startsWith('/')) throw new Error('Preview route must be absolute');
  const segments = rawRoute.split('/').slice(1).map((segment) => {
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error('Preview route contains invalid encoding');
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0') || decoded.includes('?') || decoded.includes('#')) {
      throw new Error('Unsafe preview route');
    }
    return decoded;
  });
  return `/${segments.join('/')}`;
};

export const previewSignature = ({ previewId, route, expires, secret = previewSigningSecret }) => {
  if (!secret) throw new Error('PREVIEW_SIGNING_SECRET is not configured');
  return crypto
    .createHmac('sha256', secret)
    .update(`${SITE_ID}\n${previewId}\n${route}\n${expires}`)
    .digest('hex');
};

export const resolvePreviewFile = (previewRoot, route) => {
  const normalizedRoute = normalizePreviewRoute(route);
  const relative = normalizedRoute === '/'
    ? 'index.html'
    : normalizedRoute.endsWith('/')
      ? `${normalizedRoute.slice(1)}index.html`
      : path.extname(normalizedRoute)
        ? normalizedRoute.slice(1)
        : `${normalizedRoute.slice(1)}/index.html`;
  const root = path.resolve(previewRoot);
  const filename = path.resolve(root, relative);
  if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) throw new Error('Unsafe preview file');
  return filename;
};

const fetchArticles = async (status) => {
  const response = await fetch(`${strapiUrl}/api/publisher/site?status=${status}`, {
    headers: { Authorization: `Bearer ${strapiApiToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Strapi publisher endpoint returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.schemaVersion !== 1 || payload?.siteId !== SITE_ID || typeof payload?.generatedAt !== 'string' || !Number.isFinite(Date.parse(payload.generatedAt)) || !Array.isArray(payload?.data)) {
    throw new Error('Strapi publisher endpoint returned an invalid payload');
  }
  return payload.data;
};

const runBuild = (destination, contentStatus) => new Promise((resolve, reject) => {
  const child = spawn('npm', ['run', 'build'], {
    cwd: sourceRoot,
    env: {
      ...process.env,
      ASTRO_OUT_DIR: destination,
      PAGES_CONTENT_SOURCE: 'strapi',
      PAGES_CONTENT_STATUS: contentStatus,
      STRAPI_INTERNAL_URL: strapiUrl,
      STRAPI_URL: strapiUrl,
      STRAPI_API_TOKEN: strapiApiToken,
      MEDIA_PUBLIC_BASE_URL: process.env.MEDIA_PUBLIC_BASE_URL || `${siteUrl}/uploads`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[astro] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[astro] ${chunk}`));
  child.on('error', reject);
  child.on('exit', (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`Astro build failed with ${signal ? `signal ${signal}` : `exit ${code}`}`));
  });
});

const walkFiles = async (root) => {
  const files = [];
  const visit = async (directory) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile()) files.push(filename);
    }
  };
  await visit(root);
  return files;
};

const reservedSlugs = new Set(['admin', 'api', 'uploads', '__preview', '_health', 'mcp']);
const containsPrivateValue = (html) => (strapiUrl && html.includes(strapiUrl)) || (strapiApiToken && html.includes(strapiApiToken));
const validateMetrikaVisibility = (html, expected, route) => {
  const markers = [
    html.includes('<script src="/metrika.js" defer></script>'),
    html.includes('https://mc.yandex.ru/watch/111762995'),
  ];
  if (markers.some(Boolean) !== markers.every(Boolean) || markers.every(Boolean) !== expected) {
    throw new Error(`Invalid Yandex Metrika visibility in ${route}`);
  }
};

const validateHtmlAssets = async (releaseRoot, html, route) => {
  const references = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((match) => match[1].split(/[?#]/, 1)[0]);
  for (const reference of references) {
    if (reference.startsWith('/uploads/') || reference === '/' || reference.endsWith('/')) continue;
    const filename = path.resolve(releaseRoot, reference.slice(1));
    if (!filename.startsWith(`${path.resolve(releaseRoot)}${path.sep}`)) throw new Error(`Unsafe asset reference in ${route}`);
    await fs.access(filename).catch(() => { throw new Error(`Missing asset ${reference} in ${route}`); });
  }
};

export const validateRelease = async (releaseRoot, articles) => {
  const requiredFiles = ['index.html', '404.html', 'sitemap.xml', 'robots.txt', 'metrika.js'];
  for (const filename of requiredFiles) await fs.access(path.join(releaseRoot, filename));
  const metrika = await fs.readFile(path.join(releaseRoot, 'metrika.js'), 'utf8');
  if (!metrika.includes("https://mc.yandex.ru/metrika/tag.js?id=111762995") || !metrika.includes("ym(111762995, 'init'")) {
    throw new Error('Invalid Yandex Metrika counter asset');
  }

  const entries = await fs.readdir(releaseRoot, { withFileTypes: true });
  const generatedSlugs = entries
    .filter((entry) => entry.isDirectory() && entry.name !== '_astro')
    .map((entry) => entry.name)
    .sort();
  const expectedSlugs = articles.map((article) => article.slug).sort();
  if (new Set(expectedSlugs).size !== expectedSlugs.length) throw new Error('Strapi returned duplicate article slugs');
  if (JSON.stringify(generatedSlugs) !== JSON.stringify(expectedSlugs)) {
    throw new Error(`Article route mismatch: generated ${generatedSlugs.length}, expected ${expectedSlugs.length}`);
  }

  const sitemap = await fs.readFile(path.join(releaseRoot, 'sitemap.xml'), 'utf8');
  for (const article of articles) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug) || reservedSlugs.has(article.slug)) throw new Error(`Unsafe slug: ${article.slug}`);
    const html = await fs.readFile(path.join(releaseRoot, article.slug, 'index.html'), 'utf8');
    if (!html.includes(`<link rel="canonical" href="${siteUrl}/${article.slug}/">`)) {
      throw new Error(`Invalid canonical URL for ${article.slug}`);
    }
    if ((html.match(/<h1\b/gi) || []).length !== 1) throw new Error(`Invalid h1 count for ${article.slug}`);
    if (containsPrivateValue(html)) throw new Error(`Private data leaked into ${article.slug}`);
    if (!article.draft && html.includes('draft-banner')) throw new Error(`Draft marker leaked into ${article.slug}`);
    validateMetrikaVisibility(html, !article.draft, `/${article.slug}/`);
    const sitemapHasRoute = sitemap.includes(`<loc>${siteUrl}/${article.slug}/</loc>`);
    if (sitemapHasRoute === article.draft) throw new Error(`Invalid sitemap visibility for ${article.slug}`);
    await validateHtmlAssets(releaseRoot, html, `/${article.slug}/`);
  }

  for (const filename of ['index.html', '404.html']) {
    const html = await fs.readFile(path.join(releaseRoot, filename), 'utf8');
    if (containsPrivateValue(html)) throw new Error(`Private data leaked into ${filename}`);
    validateMetrikaVisibility(html, filename === 'index.html', `/${filename}`);
    await validateHtmlAssets(releaseRoot, html, `/${filename}`);
  }

  const files = await walkFiles(releaseRoot);
  return {
    routeCount: files.filter((filename) => filename.endsWith('.html')).length,
    assetCount: files.filter((filename) => !filename.endsWith('.html')).length,
  };
};

const contentHash = (articles) => crypto.createHash('sha256').update(JSON.stringify(articles)).digest('hex');

const releaseMetadata = ({ releaseId, articles, metrics }) => ({
  schemaVersion: 1,
  siteId: SITE_ID,
  releaseId,
  release: releaseId,
  sourceCommit: process.env.SOURCE_COMMIT || 'unknown',
  builtAt: new Date().toISOString(),
  publishedAt: new Date().toISOString(),
  contentHash: contentHash(articles),
  articleCount: articles.length,
  routeCount: metrics.routeCount,
  assetCount: metrics.assetCount,
  nodeVersion: process.versions.node,
  astroVersion: '6.4.8',
});

const switchCurrentRelease = async (releaseName) => {
  const nextLink = path.join(outputRoot, '.current-next');
  const currentLink = path.join(outputRoot, 'current');
  await fs.rm(nextLink, { force: true });
  await fs.symlink(path.join('releases', releaseName), nextLink);
  await fs.rename(nextLink, currentLink);
};

const pruneReleases = async () => {
  const releasesRoot = path.join(outputRoot, 'releases');
  const currentTarget = await fs.readlink(path.join(outputRoot, 'current')).catch(() => '');
  const currentName = path.basename(currentTarget);
  const entries = await fs.readdir(releasesRoot, { withFileTypes: true });
  const releases = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name).sort().reverse();
  const keep = new Set([currentName, ...releases.filter((name) => name !== currentName).slice(0, keepReleases - 1)]);
  for (const release of releases) {
    if (!keep.has(release)) await fs.rm(path.join(releasesRoot, release), { recursive: true, force: true });
  }
};

const serializeBuild = (task) => {
  const pending = buildTail.then(task, task);
  buildTail = pending.catch(() => {});
  return pending;
};

const performPublish = async () => {
  const releaseName = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
  const releasesRoot = path.join(outputRoot, 'releases');
  const buildRoot = path.join(sourceRoot, '.publisher-output', releaseName);
  const temporaryRoot = path.join(releasesRoot, `.${releaseName}.tmp`);
  const finalRoot = path.join(releasesRoot, releaseName);

  try {
    const articles = await fetchArticles('published');
    await fs.mkdir(releasesRoot, { recursive: true });
    await fs.rm(buildRoot, { recursive: true, force: true });
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    await runBuild(buildRoot, 'published');
    const metrics = await validateRelease(buildRoot, articles);
    await fs.cp(buildRoot, temporaryRoot, { recursive: true, errorOnExist: true, force: false });
    await validateRelease(temporaryRoot, articles);
    await fs.writeFile(path.join(temporaryRoot, 'release.json'), `${JSON.stringify(releaseMetadata({
      releaseId: releaseName,
      articles,
      metrics,
    }), null, 2)}\n`);
    await fs.rename(temporaryRoot, finalRoot);
    await switchCurrentRelease(releaseName);
    await pruneReleases();
    lastSuccessAt = new Date().toISOString();
    console.log(`[publisher] Published ${releaseName} with ${articles.length} articles`);
  } catch (error) {
    lastError = String(error);
    await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
    console.error('[publisher] Publish failed', error);
    throw error;
  } finally {
    await fs.rm(buildRoot, { recursive: true, force: true }).catch(() => {});
  }
};

const publish = async () => {
  if (publishRunning) {
    publishQueued = true;
    return;
  }
  publishRunning = true;
  lastError = null;
  try {
    await serializeBuild(performPublish);
  } finally {
    publishRunning = false;
    if (publishQueued) {
      publishQueued = false;
      setTimeout(() => publish().catch(() => {}), 250);
    }
  }
};

const queuePublish = () => {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => publish().catch(() => {}), 750);
};

const rollback = async () => serializeBuild(async () => {
  const releasesRoot = path.join(outputRoot, 'releases');
  const currentTarget = await fs.readlink(path.join(outputRoot, 'current'));
  const currentName = path.basename(currentTarget);
  const entries = await fs.readdir(releasesRoot, { withFileTypes: true });
  const previous = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== currentName)
    .map((entry) => entry.name)
    .sort()
    .reverse()[0];
  if (!previous) throw new Error('No previous release is available');
  await switchCurrentRelease(previous);
  console.log(`[publisher] Rolled back to ${previous}`);
  return previous;
});

const prunePreviews = async () => {
  const previewsRoot = path.join(outputRoot, 'previews');
  const entries = await fs.readdir(previewsRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const previewRoot = path.join(previewsRoot, entry.name);
    const metadata = await fs.readFile(path.join(previewRoot, 'preview.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    if (!metadata || Date.parse(metadata.expiresAt) <= now || entry.name.startsWith('.')) {
      await fs.rm(previewRoot, { recursive: true, force: true });
    }
  }
};

const createPreview = async (route) => serializeBuild(async () => {
  if (!previewSigningSecret) throw new Error('PREVIEW_SIGNING_SECRET is not configured');
  const normalizedRoute = normalizePreviewRoute(route);
  const previewId = crypto.randomBytes(16).toString('hex');
  let expires;
  const previewsRoot = path.join(outputRoot, 'previews');
  const buildRoot = path.join(sourceRoot, '.publisher-output', `preview-${previewId}`);
  const temporaryRoot = path.join(previewsRoot, `.${previewId}.tmp`);
  const finalRoot = path.join(previewsRoot, previewId);

  try {
    const articles = await fetchArticles('preview');
    await fs.mkdir(previewsRoot, { recursive: true });
    await fs.rm(buildRoot, { recursive: true, force: true });
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    await runBuild(buildRoot, 'preview');
    await validateRelease(buildRoot, articles);
    await fs.cp(buildRoot, temporaryRoot, { recursive: true, errorOnExist: true, force: false });
    await fs.access(resolvePreviewFile(temporaryRoot, normalizedRoute));
    expires = Math.floor(Date.now() / 1000) + PREVIEW_TTL_SECONDS;
    await fs.writeFile(path.join(temporaryRoot, 'preview.json'), `${JSON.stringify({
      schemaVersion: 1,
      siteId: SITE_ID,
      previewId,
      route: normalizedRoute,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(expires * 1000).toISOString(),
      contentHash: contentHash(articles),
    }, null, 2)}\n`);
    await fs.rename(temporaryRoot, finalRoot);
    await prunePreviews();
  } catch (error) {
    await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    await fs.rm(buildRoot, { recursive: true, force: true }).catch(() => {});
  }

  const signature = previewSignature({ previewId, route: normalizedRoute, expires });
  const previewPath = `/__preview/${previewId}${normalizedRoute}`;
  return {
    previewId,
    route: normalizedRoute,
    expiresAt: new Date(expires * 1000).toISOString(),
    url: `${siteUrl}${previewPath}?expires=${expires}&signature=${signature}`,
  };
});

const readBody = (request, limit = 4096) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  request.on('data', (chunk) => {
    size += chunk.length;
    if (size > limit) {
      reject(new Error('Request body is too large'));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  request.on('error', reject);
});

const sendJson = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(`${JSON.stringify(body)}\n`);
};

const contentType = (filename) => ({
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
}[path.extname(filename).toLowerCase()] || 'application/octet-stream');

const servePreview = async (request, response) => {
  const rawPath = String(request.url || '').split('?', 1)[0];
  const match = /^\/__preview\/([a-f0-9]{32})(\/.*)?$/.exec(rawPath);
  if (!match) {
    sendJson(response, 404, { ok: false });
    return;
  }

  const previewId = match[1];
  const route = normalizePreviewRoute(match[2] || '/');
  const requestUrl = new URL(request.url, 'http://publisher.internal');
  const expires = Number(requestUrl.searchParams.get('expires'));
  const signature = String(requestUrl.searchParams.get('signature') || '');
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) {
    sendJson(response, 410, { ok: false, error: 'Preview expired' });
    return;
  }
  const expected = previewSignature({ previewId, route, expires });
  if (!safeEqual(signature, expected)) {
    sendJson(response, 401, { ok: false });
    return;
  }

  const previewRoot = path.join(outputRoot, 'previews', previewId);
  const metadata = JSON.parse(await fs.readFile(path.join(previewRoot, 'preview.json'), 'utf8'));
  if (metadata.siteId !== SITE_ID || metadata.previewId !== previewId || metadata.route !== route || Date.parse(metadata.expiresAt) !== expires * 1000) {
    sendJson(response, 401, { ok: false });
    return;
  }
  const filename = resolvePreviewFile(previewRoot, route);
  const body = await fs.readFile(filename);
  response.writeHead(200, {
    'Content-Type': contentType(filename),
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
};

export const createServer = () => http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { ok: true, siteId: SITE_ID, publishRunning, lastSuccessAt, lastError });
      return;
    }
    if (request.method === 'GET' && request.url?.startsWith('/__preview/')) {
      await servePreview(request, response);
      return;
    }
    if (request.method === 'POST' && ['/publish', '/rollback', '/preview'].includes(request.url)) {
      const rawBody = await readBody(request);
      if (!safeEqual(String(request.headers['x-webhook-secret'] || ''), webhookSecret)) {
        sendJson(response, 401, { ok: false });
        return;
      }
      if (request.url === '/publish') {
        queuePublish();
        sendJson(response, 202, { ok: true, queued: true });
      } else if (request.url === '/rollback') {
        sendJson(response, 200, { ok: true, release: await rollback() });
      } else {
        let payload = {};
        try {
          payload = rawBody ? JSON.parse(rawBody) : {};
        } catch {
          sendJson(response, 400, { ok: false, error: 'Request body must be JSON' });
          return;
        }
        sendJson(response, 201, { ok: true, ...await createPreview(String(payload.route || '/')) });
      }
      return;
    }
    sendJson(response, 404, { ok: false });
  } catch (error) {
    const status = error?.code === 'ENOENT' ? 404 : /Unsafe preview route|must be absolute|invalid encoding/.test(String(error)) ? 400 : 500;
    sendJson(response, status, { ok: false, error: String(error) });
  }
});

export const startServer = () => {
  const server = createServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`[publisher] Listening on ${port}`);
    if (process.env.PUBLISH_ON_START !== 'false') {
      const initialAttempt = () => publish().catch(() => setTimeout(initialAttempt, 15_000));
      setTimeout(initialAttempt, 2_000);
    }
  });
  return server;
};

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) startServer();
