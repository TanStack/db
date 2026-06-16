import { execSync, spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChildProcess } from 'node:child_process'
import type { TestProject } from 'vitest/node'

const CONTAINER_NAME = 'trailbase-e2e-test'
const TRAILBASE_PORT = process.env.TRAILBASE_PORT ?? '4047'
const TRAILBASE_URL =
  process.env.TRAILBASE_URL ?? `http://localhost:${TRAILBASE_PORT}`

// Module augmentation for type-safe context injection
declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string
  }
}

function isDockerAvailable(): boolean {
  try {
    execSync('docker --version', { stdio: 'pipe' })
    return true
  } catch {}

  return false
}

async function isTrailBaseRunning(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/healthcheck`)
    return res.ok
  } catch {}

  return false
}

function buildDockerImage(): void {
  const DOCKER_DIR = dirname(fileURLToPath(import.meta.url))

  console.log('🔨 Building TrailBase Docker image...')
  execSync(`docker build -t trailbase-e2e ${DOCKER_DIR}`, {
    stdio: 'inherit',
  })
  console.log('✓ Docker image built')
}

function cleanupExistingContainer(): void {
  try {
    execSync(`docker stop ${CONTAINER_NAME}`, {
      stdio: 'pipe',
    })
    execSync(`docker rm ${CONTAINER_NAME}`, {
      stdio: 'pipe',
    })
  } catch {
    // Ignore errors - container might not exist
  }
}

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

  proc.stdout.on('data', (data) => {
    console.log(`[trailbase] ${data.toString().trim()}`)
  })

  proc.stderr.on('data', (data) => {
    console.error(`[trailbase] ${data.toString().trim()}`)
  })

  proc.on('error', (error) => {
    console.error('Failed to start TrailBase container:', error)
  })

  return proc
}

async function waitForTrailBase(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(`Timed out waiting for TrailBase to be active at ${url}`),
      )
    }, 60000) // 60 seconds timeout for startup

    const check = async (): Promise<void> => {
      try {
        // Try the healthz endpoint first, then fall back to root
        const res = await fetch(`${url}/api/healthcheck`)
        if (res.ok) {
          clearTimeout(timeout)
          return resolve()
        }
      } catch {}

      setTimeout(() => void check(), 500)
    }

    void check()
  })
}

/**
 * Global setup for TrailBase e2e test suite
 */
export default async function ({ provide }: TestProject) {
  let serverProcess: ChildProcess | null = null

  // Check if TrailBase is already running
  if (await isTrailBaseRunning(TRAILBASE_URL)) {
    console.log(`✓ TrailBase already running at ${TRAILBASE_URL}`)
  } else {
    if (!isDockerAvailable()) {
      throw new Error(
        `TrailBase is not running at ${TRAILBASE_URL} and no startup method is available.\n` +
          `Please either:\n` +
          `  1. Start TrailBase manually at ${TRAILBASE_URL}\n` +
          `  2. Install Docker and run the tests again\n`,
      )
    }

    // Clean up any existing container
    cleanupExistingContainer()
    // Build Docker image
    buildDockerImage()
    // Start container
    serverProcess = startDockerContainer()
  }

  // Wait for TrailBase server to be ready
  console.log(`⏳ Waiting for TrailBase at ${TRAILBASE_URL}...`)
  await waitForTrailBase(TRAILBASE_URL)
  console.log('✓ TrailBase is ready')

  // Provide context values to all tests
  provide('baseUrl', TRAILBASE_URL)

  console.log('✓ Global setup complete\n')

  // Return cleanup function (runs once after all tests)
  return () => {
    console.log('\n🧹 Running global teardown...')
    if (serverProcess !== null) {
      cleanupExistingContainer()
      serverProcess.kill()
      serverProcess = null
    }
    console.log('✅ Global teardown complete')
  }
}
