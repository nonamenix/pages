import { defineConfig, envField } from 'astro/config';

export default defineConfig({
  site: 'https://pages.live4.dev',
  output: 'static',
  build: { format: 'directory' },
  outDir: process.env.ASTRO_OUT_DIR || './dist',
  trailingSlash: 'always',
  env: {
    schema: {
      STRAPI_INTERNAL_URL: envField.string({ context: 'server', access: 'public', optional: true }),
      STRAPI_API_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      SITE_URL: envField.string({ context: 'server', access: 'public', optional: true }),
      MEDIA_PUBLIC_BASE_URL: envField.string({ context: 'server', access: 'public', optional: true }),
    },
  },
});
