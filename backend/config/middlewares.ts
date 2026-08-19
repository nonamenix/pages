const configuredOrigins = (value?: string) =>
  (value || "http://127.0.0.1:8095,http://localhost:4321")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

export default ({ env }) => [
  "strapi::logger",
  "strapi::errors",
  {
    name: "strapi::security",
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "connect-src": ["'self'", "https:"],
          "img-src": ["'self'", "data:", "blob:", "https:"],
          "media-src": ["'self'", "data:", "blob:", "https:"],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  {
    name: "strapi::cors",
    config: {
      origin: configuredOrigins(env("CORS_ORIGINS")),
      headers: ["Content-Type", "Authorization", "Origin", "Accept"],
    },
  },
  "strapi::poweredBy",
  "strapi::query",
  {
    name: "strapi::body",
    config: {
      jsonLimit: "1mb",
      formLimit: "1mb",
      textLimit: "1mb",
      formidable: { maxFileSize: 10 * 1024 * 1024 },
    },
  },
  {
    name: "global::upload-guard",
    config: {
      maxBytes: env.int("UPLOAD_MAX_BYTES", 10 * 1024 * 1024),
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
      allowedExtensions: [".jpg", ".jpeg", ".png", ".webp", ".avif"],
    },
  },
  "strapi::session",
  "strapi::favicon",
  "strapi::public",
];
