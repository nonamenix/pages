import path from "node:path";

export default ({ env }) => {
  const client = env("DATABASE_CLIENT", "sqlite");

  if (client === "postgres") {
    return {
      connection: {
        client: "postgres",
        connection: {
          connectionString: env("DATABASE_URL"),
          host: env("DATABASE_HOST", "127.0.0.1"),
          port: env.int("DATABASE_PORT", 5432),
          database: env("DATABASE_NAME", "pages_live4dev"),
          user: env("DATABASE_USERNAME", "pages_live4dev_app"),
          password: env("DATABASE_PASSWORD"),
          schema: env("DATABASE_SCHEMA", "public"),
          ssl: env.bool("DATABASE_SSL", false) && {
            rejectUnauthorized: env.bool("DATABASE_SSL_REJECT_UNAUTHORIZED", true),
          },
        },
        pool: {
          min: env.int("DATABASE_POOL_MIN", 0),
          max: env.int("DATABASE_POOL_MAX", 5),
        },
        acquireConnectionTimeout: env.int("DATABASE_CONNECTION_TIMEOUT", 60000),
      },
    };
  }

  if (client !== "sqlite") throw new Error(`Unsupported DATABASE_CLIENT: ${client}`);

  return {
    connection: {
      client: "sqlite",
      connection: { filename: path.resolve(env("DATABASE_FILENAME", ".tmp/data.db")) },
      useNullAsDefault: true,
      pool: { min: 1, max: 1 },
    },
  };
};
