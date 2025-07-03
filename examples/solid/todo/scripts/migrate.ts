import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pkg from "pg"
import * as dotenv from "dotenv"

dotenv.config()

const { Pool } = pkg
const pool = new Pool({
  host: process.env.DB_HOST || `localhost`,
  port: parseInt(process.env.DB_PORT || `54322`),
  user: process.env.DB_USER || `postgres`,
  password: process.env.DB_PASSWORD || `postgres`,
  database: process.env.DB_NAME || `todo_app`,
})

const db = drizzle(pool)

async function main() {
  console.log(`Running migrations...`)
  await migrate(db, { migrationsFolder: `./drizzle` })
  console.log(`Migrations completed!`)
  await pool.end()
}

main().catch((err) => {
  console.error(`Migration failed!`, err)
  process.exit(1)
})
