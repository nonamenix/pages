export default ({ env }) => ({
  upload: {
    config: { sizeLimit: env.int("UPLOAD_MAX_BYTES", 10 * 1024 * 1024) },
  },
});
