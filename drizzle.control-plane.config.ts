import type { Config } from "drizzle-kit";

export default {
  schema: "./src/control_plane/schema.ts",
  out: "./control-plane/drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.WEWEBPLUS_DATABASE_URL ??
      "postgres://localhost:5432/wewebplus",
  },
} satisfies Config;
