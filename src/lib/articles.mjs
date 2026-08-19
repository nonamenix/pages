import fixtureEnvelope from '../content/fixture-articles.json' with { type: 'json' };
import { mediaUrl, readingMinutes } from './blocks.mjs';

const SITE_ID = 'pages-live4dev';
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const reservedSlugs = new Set(['admin', 'api', 'uploads', '__preview', '_health', 'mcp']);
let contentPromise;

const requiredString = (value, field, maxLength) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Article ${field} is required`);
  if (maxLength && value.length > maxLength) throw new Error(`Article ${field} exceeds ${maxLength} characters`);
  return value.trim();
};

const optionalString = (value, field, maxLength) => {
  if (value == null || value === '') return null;
  return requiredString(value, field, maxLength);
};

const parseArticle = (record, mediaBaseUrl) => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Article must be an object');
  const slug = requiredString(record.slug, 'slug', 180);
  if (!slugPattern.test(slug) || reservedSlugs.has(slug)) throw new Error(`Unsafe article slug: ${slug}`);
  const publishedOn = requiredString(record.publishedOn, 'publishedOn', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedOn) || !Number.isFinite(Date.parse(`${publishedOn}T00:00:00Z`))) {
    throw new Error(`Invalid publishedOn for ${slug}`);
  }
  if (!['ru', 'en'].includes(record.language)) throw new Error(`Unsupported language for ${slug}`);
  if (!Array.isArray(record.body) || record.body.length === 0) throw new Error(`Article body is empty for ${slug}`);

  const cover = record.cover ? {
    url: mediaUrl(record.cover.url, mediaBaseUrl),
    alternativeText: optionalString(record.cover.alternativeText, 'cover alternativeText', 320),
    caption: optionalString(record.cover.caption, 'cover caption', 320),
    width: Number.isInteger(record.cover.width) ? record.cover.width : null,
    height: Number.isInteger(record.cover.height) ? record.cover.height : null,
  } : null;

  const body = structuredClone(record.body);
  return {
    slug,
    title: requiredString(record.title, 'title', 180),
    excerpt: requiredString(record.excerpt, 'excerpt', 320),
    author: optionalString(record.author, 'author', 180),
    publishedOn,
    language: record.language,
    cover,
    body,
    readingMinutes: readingMinutes(body),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
    draft: record.draft === true,
  };
};

export const parseEnvelope = (payload, mediaBaseUrl = process.env.MEDIA_PUBLIC_BASE_URL || 'https://pages.live4.dev/uploads') => {
  if (payload?.schemaVersion !== 1 || payload?.siteId !== SITE_ID || !Array.isArray(payload?.data)) {
    throw new Error('Publisher endpoint returned an invalid envelope');
  }
  const articles = payload.data.map((record) => parseArticle(record, mediaBaseUrl));
  const slugs = articles.map(({ slug }) => slug);
  if (new Set(slugs).size !== slugs.length) throw new Error('Publisher endpoint returned duplicate article slugs');
  return articles.sort((left, right) => right.publishedOn.localeCompare(left.publishedOn) || left.title.localeCompare(right.title));
};

const fetchEnvelope = async () => {
  const source = process.env.PAGES_CONTENT_SOURCE || 'empty';
  if (source === 'empty') return { schemaVersion: 1, siteId: SITE_ID, generatedAt: new Date().toISOString(), data: [] };
  if (source === 'fixture') return fixtureEnvelope;
  if (source !== 'strapi') throw new Error(`Unsupported PAGES_CONTENT_SOURCE: ${source}`);

  const strapiUrl = String(process.env.STRAPI_INTERNAL_URL || process.env.STRAPI_URL || '').replace(/\/$/, '');
  const token = process.env.STRAPI_API_TOKEN || '';
  const status = process.env.PAGES_CONTENT_STATUS === 'preview' ? 'preview' : 'published';
  if (!strapiUrl || !token) throw new Error('Strapi content source requires STRAPI_INTERNAL_URL and STRAPI_API_TOKEN');
  const response = await fetch(`${strapiUrl}/api/publisher/site?status=${status}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Strapi publisher endpoint returned HTTP ${response.status}`);
  return response.json();
};

export const getArticles = () => {
  contentPromise ||= fetchEnvelope().then((payload) => parseEnvelope(payload));
  return contentPromise;
};

export const formatPublishedOn = (date, language) => new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
}).format(new Date(`${date}T00:00:00Z`));
