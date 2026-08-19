import crypto from "node:crypto";

const ARTICLE_UID = "api::article.article";

const safeEqual = (actual: string, expected: string) => {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const publicMedia = (media: any) => media ? ({
  url: media.url,
  alternativeText: media.alternativeText || null,
  caption: media.caption || null,
  width: media.width || null,
  height: media.height || null,
  mime: media.mime || null,
}) : null;

const publicArticle = (article: any, draft: boolean) => ({
  slug: article.slug,
  title: article.title,
  excerpt: article.excerpt,
  author: article.author || null,
  publishedOn: article.publishedOn,
  language: article.language,
  cover: publicMedia(article.cover),
  body: article.body,
  updatedAt: article.updatedAt,
  draft,
});

const findArticles = async (strapi: any, status: "draft" | "published") => {
  const records = [];
  let start = 0;
  while (true) {
    const batch = await strapi.documents(ARTICLE_UID).findMany({
      status,
      populate: { cover: true },
      sort: ["publishedOn:desc", "title:asc"],
      start,
      limit: 100,
    });
    records.push(...batch);
    if (batch.length < 100) return records;
    start += batch.length;
  }
};

export default ({ strapi }) => ({
  async site(ctx: any) {
    const authorization = String(ctx.request.headers.authorization || "");
    const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    const expected = String(process.env.STRAPI_API_TOKEN || "");
    if (!safeEqual(supplied, expected)) return ctx.unauthorized("Unauthorized");

    const requestedStatus = String(ctx.query.status || "published");
    if (!["published", "preview"].includes(requestedStatus)) return ctx.badRequest("Unsupported status");

    const published = await findArticles(strapi, "published");
    const recordsByDocumentId = new Map(
      published.map((article: any) => [article.documentId, publicArticle(article, false)]),
    );

    if (requestedStatus === "preview") {
      const drafts = await findArticles(strapi, "draft");
      for (const article of drafts) {
        recordsByDocumentId.set(article.documentId, publicArticle(article, true));
      }
    }

    ctx.set("Cache-Control", "no-store");
    ctx.body = {
      schemaVersion: 1,
      siteId: "pages-live4dev",
      generatedAt: new Date().toISOString(),
      data: [...recordsByDocumentId.values()],
    };
  },
});
