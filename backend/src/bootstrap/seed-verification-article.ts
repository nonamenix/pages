const ARTICLE_UID = "api::article.article";
const seedKey = "verification-draft-v1";

const seedStore = (strapi: any) => strapi.store({
  type: "plugin",
  name: "pages-live4dev",
  key: seedKey,
});

export async function seedVerificationArticle(strapi: any) {
  if (process.env.SEED_VERIFICATION_DRAFT !== "true") return;
  const store = seedStore(strapi);
  if (await store.get()) return;

  const existing = await strapi.documents(ARTICLE_UID).findFirst({
    filters: { slug: "verification-draft" },
    status: "draft",
  });

  if (!existing) {
    await strapi.documents(ARTICLE_UID).create({
      status: "draft",
      data: {
        title: "Черновик для проверки публикации",
        slug: "verification-draft",
        excerpt: "Служебный неопубликованный материал для проверки предпросмотра.",
        author: null,
        publishedOn: new Date().toISOString().slice(0, 10),
        language: "ru",
        body: [
          {
            type: "paragraph",
            children: [
              { type: "text", text: "Этот материал должен быть виден только в подписанном предпросмотре." },
            ],
          },
        ],
      },
    });
  }

  await store.set({ value: { completedAt: new Date().toISOString() } });
  strapi.log.info("Verification draft seed is complete");
}
