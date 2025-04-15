import type { Config } from "drizzle-kit"

export default {
  schema: `./src/db/schema.ts`,
  out: `./drizzle`,
  dialect: `postgresql`,
  casing: `snake_case`,
  dbCredentials: {
    host: process.env.DB_HOST || `localhost`,
    port: parseInt(process.env.DB_PORT || `54322`),
    user: process.env.DB_USER || `postgres`,
    password: process.env.DB_PASSWORD || `postgres`,
    database: process.env.DB_NAME || `todo_app`,
  },
} satisfies Config
