import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GlobalSetupContext } from 'vitest/node'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DOCKER_DIR = resolve(__dirname, '../docker')
const CONTAINER_NAME = 'trailbase-e2e-test'
const TRAILBASE_PORT = process.env.TRAILBASE_PORT ?? '4000'
const TRAILBASE_URL =
  process.env.TRAILBASE_URL ?? `http://localhost:${TRAILBASE_PORT}`

// Module augmentation for type-safe context injection
declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string
  }
}

let dockerProcess: ChildProcess | null = null

/**
 * Build the TrailBase Docker image
 */
function buildDockerImage(): void {
  console.log('🔨 Building TrailBase Docker image...')
  execSync(`docker build -t trailbase-e2e ${DOCKER_DIR}`, {
    stdio: 'inherit',
  })
  console.log('✓ Docker image built')
}

/**
 * Stop and remove any existing container with the same name
 */
function cleanupExistingContainer(): void {
  try {
    execSync(`docker stop ${CONTAINER_NAME} 2>/dev/null || true`, {
      stdio: 'pipe',
    })
    execSync(`docker rm ${CONTAINER_NAME} 2>/dev/null || true`, {
      stdio: 'pipe',
    })
  } catch {
    // Ignore errors - container might not exist
  }
}

/**
 * Start the TrailBase Docker container
 */
function startDockerContainer(): ChildProcess {
  console.log('🚀 Starting TrailBase container...')

  const proc = spawn(
    'docker',
    [
      'run',
      '--rm',
      '--name',
      CONTAINER_NAME,
      '-p',
      `${TRAILBASE_PORT}:4000`,
      'trailbase-e2e',
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  proc.stdout?.on('data', (data) => {
    console.log(`[trailbase] ${data.toString().trim()}`)
  })

  proc.stderr?.on('data', (data) => {
    console.error(`[trailbase] ${data.toString().trim()}`)
  })

  proc.on('error', (error) => {
    console.error('Failed to start TrailBase container:', error)
  })

  return proc
}

/**
 * Stop the TrailBase Docker container
 */
function stopDockerContainer(): void {
  console.log('🛑 Stopping TrailBase container...')
  try {
    execSync(`docker stop ${CONTAINER_NAME}`, { stdio: 'pipe' })
    console.log('✓ Container stopped')
  } catch {
    // Container might have already stopped
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
    }, 60000) // 60 seconds timeout for container startup

    const check = async (): Promise<void> => {
      try {
        // Try the healthz endpoint first, then fall back to root
        let res = await fetch(`${url}/api/healthz`)
        if (res.ok) {
          clearTimeout(timeout)
          return resolve()
        }
        // Try root as fallback
        res = await fetch(url)
        if (res.ok || res.status === 404) {
          // 404 means server is up but no route at root
          clearTimeout(timeout)
          return resolve()
        }
        setTimeout(() => void check(), 500)
      } catch {
        setTimeout(() => void check(), 500)
      }
    }

    void check()
  })
}

/**
 * Global setup for TrailBase e2e test suite
 *
 * This runs once before all tests and:
 * 1. Builds TrailBase Docker image
 * 2. Starts TrailBase container
 * 3. Waits for TrailBase server to be healthy
 * 4. Provides context to all tests
 * 5. Returns cleanup function
 */
export default async function ({ provide }: GlobalSetupContext) {
  console.log('🚀 Starting TrailBase e2e test suite global setup...')

  // Clean up any existing container
  cleanupExistingContainer()

  // Build Docker image
  buildDockerImage()

  // Start container
  dockerProcess = startDockerContainer()

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
    stopDockerContainer()
    dockerProcess?.kill()
    dockerProcess = null
    console.log('✅ Global teardown complete')
  }
}
