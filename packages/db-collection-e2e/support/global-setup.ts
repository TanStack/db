import type { GlobalSetupContext } from "vitest/node"
import { Client, type ClientConfig } from "pg"

const ELECTRIC_URL = process.env.ELECTRIC_URL ?? "http://localhost:3000"
const POSTGRES_HOST = process.env.POSTGRES_HOST ?? "localhost"
const POSTGRES_PORT = parseInt(process.env.POSTGRES_PORT ?? "54321")
const POSTGRES_USER = process.env.POSTGRES_USER ?? "postgres"
const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD ?? "password"
const POSTGRES_DB = process.env.POSTGRES_DB ?? "e2e_test"
const TEST_SCHEMA = "e2e_test"

// Module augmentation for type-safe context injection
declare module "vitest" {
  export interface ProvidedContext {
    baseUrl: string
    testSchema: string
    postgresConfig: {
      host: string
      port: number
      user: string
      password: string
      database: string
    }
  }
}

/**
 * Create a PostgreSQL client with default e2e test configuration
 */
export function makePgClient(overrides: ClientConfig = {}): Client {
  return new Client({
    host: POSTGRES_HOST,
    port: POSTGRES_PORT,
    user: POSTGRES_USER,
    password: POSTGRES_PASSWORD,
    database: POSTGRES_DB,
    options: `-csearch_path=${TEST_SCHEMA}`,
    ...overrides,
  })
}

/**
 * Wait for Electric server to be ready
 */
async function waitForElectric(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for Electric to be active at ${url}`))
    }, 10000)

    const check = async (): Promise<void> => {
      try {
        const res = await fetch(`${url}/v1/health`)
        if (res.ok) {
          const data = (await res.json()) as { status: string }
          if (data.status === "active") {
            clearTimeout(timeout)
            return resolve()
          }
        }
        setTimeout(() => void check(), 100)
      } catch {
        setTimeout(() => void check(), 100)
      }
    }

    void check()
  })
}

/**
 * Wait for Postgres to be ready
 */
async function waitForPostgres(client: Client): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for Postgres"))
    }, 10000)

    const check = async (): Promise<void> => {
      try {
        await client.connect()
        clearTimeout(timeout)
        return resolve()
      } catch {
        setTimeout(() => void check(), 100)
      }
    }

    void check()
  })
}

/**
 * Global setup for e2e test suite
 *
 * This runs once before all tests and:
 * 1. Waits for Electric server to be healthy
 * 2. Connects to Postgres
 * 3. Creates test schema
 * 4. Provides context to all tests
 * 5. Returns cleanup function
 */
export default async function ({ provide }: GlobalSetupContext) {
  console.log("🚀 Starting e2e test suite global setup...")

  // Wait for Electric server to be ready
  console.log(`⏳ Waiting for Electric at ${ELECTRIC_URL}...`)
  await waitForElectric(ELECTRIC_URL)
  console.log("✓ Electric is ready")

  // Connect to Postgres
  console.log(
    `⏳ Connecting to Postgres at ${POSTGRES_HOST}:${POSTGRES_PORT}...`
  )
  const client = makePgClient()
  await waitForPostgres(client)
  console.log("✓ Postgres is ready")

  // Create test schema
  console.log(`⏳ Creating test schema: ${TEST_SCHEMA}...`)
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA}`)
  console.log("✓ Test schema created")

  // Provide context values to all tests
  provide("baseUrl", ELECTRIC_URL)
  provide("testSchema", TEST_SCHEMA)
  provide("postgresConfig", {
    host: POSTGRES_HOST,
    port: POSTGRES_PORT,
    user: POSTGRES_USER,
    password: POSTGRES_PASSWORD,
    database: POSTGRES_DB,
  })

  console.log("✅ Global setup complete\n")

  // Return cleanup function (runs once after all tests)
  return async () => {
    console.log("\n🧹 Running global teardown...")
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`)
      console.log("✓ Test schema dropped")
    } catch (error) {
      console.error("Error dropping test schema:", error)
    } finally {
      await client.end()
      console.log("✓ Postgres connection closed")
      console.log("✅ Global teardown complete")
    }
  }
}
