import { seedVerificationArticle } from "./bootstrap/seed-verification-article";
import { errors } from '@strapi/utils';

const publishModels = ["api::article.article", "plugin::upload.file"];
let publishTimer: NodeJS.Timeout | null = null;

const requestPublish = (strapi: any) => {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(async () => {
    const url = process.env.PUBLISHER_URL;
    const secret = process.env.PUBLISHER_WEBHOOK_SECRET;
    if (!url || !secret) return;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "X-Webhook-Secret": secret },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`Publisher HTTP ${response.status}`);
    } catch (error) {
      strapi.log.warn(`Static publisher is not ready: ${String(error)}`);
    }
  }, 1_500);
};

export default {
  register({ strapi }) {
    strapi.db.lifecycles.subscribe({
      models: ['api::article.article'],
      beforeCreate(event) {
        if (['new', 'fonts'].includes(event.params.data?.slug)) throw new errors.ValidationError('Этот адрес зарезервирован для интерфейса Pages.');
      },
      beforeUpdate(event) {
        if (['new', 'fonts'].includes(event.params.data?.slug)) throw new errors.ValidationError('Этот адрес зарезервирован для интерфейса Pages.');
      },
    });
    strapi.db.lifecycles.subscribe({
      models: publishModels,
      afterCreate: () => requestPublish(strapi),
      afterUpdate: () => requestPublish(strapi),
      afterDelete: () => requestPublish(strapi),
    });
  },

  async bootstrap({ strapi }) {
    await seedVerificationArticle(strapi);
  },
};
