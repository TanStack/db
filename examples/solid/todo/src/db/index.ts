import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema"

// Create a PostgreSQL pool
const pool = new Pool({
  host: process.env.DB_HOST || `localhost`,
  port: parseInt(process.env.DB_PORT || `5432`),
  user: process.env.DB_USER || `postgres`,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || `todo_app`,
})

// Create drizzle database instance
export const db = drizzle(pool, { schema })
