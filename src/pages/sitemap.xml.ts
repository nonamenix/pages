import type { APIRoute } from 'astro';
import { getArticles } from '../lib/articles.mjs';

const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export const GET: APIRoute = async ({ site }) => {
  const origin = site || new URL('https://pages.live4.dev');
  const articles = (await getArticles()).filter((article) => !article.draft);
  const routes = [
    { loc: new URL('/', origin).href, lastmod: null },
    { loc: new URL('/pages-site.html', origin).href, lastmod: null },
    ...articles.map((article) => ({ loc: new URL(`/${article.slug}/`, origin).href, lastmod: article.updatedAt?.slice(0, 10) || article.publishedOn })),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routes.map(({ loc, lastmod }) => `  <url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
