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

async function setupMaterialize() {
  console.log(`Setting up Materialize...`)

  // Create connection to Materialize
  const mzPool = new Pool({
    host: process.env.MZ_HOST || `localhost`,
    port: parseInt(process.env.MZ_PORT || `6875`),
    user: process.env.MZ_USER || `materialize`,
    password: process.env.MZ_PASSWORD || ``,
    database: process.env.MZ_DATABASE || `materialize`,
  })

  const mzDb = drizzle(mzPool)

  try {
    // Execute Materialize setup commands
    await mzPool.query(`CREATE SECRET IF NOT EXISTS pgpass AS 'postgres'`)

    await mzPool.query(`
      CREATE CONNECTION IF NOT EXISTS pgconn TO POSTGRES (
        HOST 'postgres',
        PORT 5432,
        USER 'postgres',
        PASSWORD SECRET pgpass,
        DATABASE 'todo_app'
      )
    `)

    await mzPool.query(`
      CREATE SOURCE IF NOT EXISTS todo_source
        FROM POSTGRES CONNECTION pgconn (PUBLICATION 'mz_publication')
        FOR TABLES (public.todos, public.config)
        EXPOSE PROGRESS AS todo_source_progress
    `)

    await mzPool.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS todo_view AS 
        SELECT id, text, completed, created_at, updated_at 
        FROM public.todos
    `)

    await mzPool.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS config_view AS 
        SELECT id, key, value, created_at, updated_at 
        FROM public.config
    `)

    console.log(`Materialize setup completed!`)
  } catch (err) {
    console.warn(
      `Materialize setup failed (this is normal if Materialize is not running):`,
      err.message
    )
  } finally {
    await mzPool.end()
  }
}

async function main() {
  console.log(`Running migrations...`)
  try {
    await migrate(db, { migrationsFolder: `./drizzle` })
    console.log(`Migrations completed!`)
  } catch (err) {
    if (err.code === "42P07") {
      console.log(`Tables already exist, skipping PostgreSQL migrations...`)
    } else {
      throw err
    }
  }
  await pool.end()

  // Set up Materialize after PostgreSQL migrations
  await setupMaterialize()
}

main().catch((err) => {
  console.error(`Migration failed!`, err)
  process.exit(1)
})
