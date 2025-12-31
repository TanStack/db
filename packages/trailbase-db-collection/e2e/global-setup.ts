import type { GlobalSetupContext } from 'vitest/node'

const TRAILBASE_URL = process.env.TRAILBASE_URL ?? 'http://localhost:4000'

// Module augmentation for type-safe context injection
declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string
  }
}

/**
 * Wait for TrailBase server to be ready
 */
async function waitForTrailBase(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(`Timed out waiting for TrailBase to be active at ${url}`),
      )
    }, 30000)

    const check = async (): Promise<void> => {
      try {
        // TrailBase health check endpoint
        const res = await fetch(`${url}/api/healthcheck`)
        if (res.ok) {
          clearTimeout(timeout)
          return resolve()
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
 * Global setup for TrailBase e2e test suite
 *
 * This runs once before all tests and:
 * 1. Waits for TrailBase server to be healthy
 * 2. Provides context to all tests
 * 3. Returns cleanup function
 */
export default async function ({ provide }: GlobalSetupContext) {
  console.log('🚀 Starting TrailBase e2e test suite global setup...')

  // Wait for TrailBase server to be ready
  console.log(`⏳ Waiting for TrailBase at ${TRAILBASE_URL}...`)
  await waitForTrailBase(TRAILBASE_URL)
  console.log('✓ TrailBase is ready')

  // Provide context values to all tests
  provide('baseUrl', TRAILBASE_URL)

  console.log('✅ Global setup complete\n')

  // Return cleanup function (runs once after all tests)
  return async () => {
    console.log('\n🧹 Running global teardown...')
    console.log('✅ Global teardown complete')
  }
}
