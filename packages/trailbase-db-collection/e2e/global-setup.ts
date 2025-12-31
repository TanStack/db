import {  execSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {ChildProcess} from 'node:child_process';
import type { GlobalSetupContext } from 'vitest/node'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = resolvePath(__dirname, '..')
const REPO_ROOT = resolvePath(PACKAGE_DIR, '../..')
const DOCKER_DIR = resolvePath(PACKAGE_DIR, 'docker')
// Check multiple possible binary locations
const BINARY_PATHS = [
  resolvePath(PACKAGE_DIR, 'testing-bin-linux', 'trail'),
  resolvePath(REPO_ROOT, 'packages/trailbase/test-linux-bin', 'trail'),
]
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

let serverProcess: ChildProcess | null = null
let startedServer = false
let usedMethod: 'binary' | 'docker' | null = null
let tempDataDir: string | null = null
let binaryPath: string | null = null

/**
 * Find the TrailBase binary from available paths
 */
function findBinaryPath(): string | null {
  for (const path of BINARY_PATHS) {
    if (existsSync(path)) {
      return path
    }
  }
  return null
}

/**
 * Check if Docker is available
 */
function isDockerAvailable(): boolean {
  try {
    execSync('docker --version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Check if TrailBase is already running
 */
async function isTrailBaseRunning(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/healthz`)
    return res.ok
  } catch {
    try {
      const res = await fetch(url)
      return res.ok || res.status === 404
    } catch {
      return false
    }
  }
}

/**
 * Start TrailBase using the local binary
 */
function startBinaryServer(): ChildProcess {
  if (!binaryPath) {
    throw new Error('Binary path not set')
  }
  console.log(`🚀 Starting TrailBase using local binary at ${binaryPath}...`)

  // Create a temp data directory for this test run
  tempDataDir = resolvePath(PACKAGE_DIR, `.trailbase-e2e-data-${Date.now()}`)
  mkdirSync(tempDataDir, { recursive: true })
  mkdirSync(resolvePath(tempDataDir, 'migrations'), { recursive: true })

  // Copy config and migrations from docker dir
  cpSync(
    resolvePath(DOCKER_DIR, 'config.textproto'),
    resolvePath(tempDataDir, 'config.textproto'),
  )
  cpSync(
    resolvePath(DOCKER_DIR, 'init.sql'),
    resolvePath(tempDataDir, 'migrations', 'V10__init.sql'),
  )

  const proc = spawn(
    binaryPath,
    ['--data-dir', tempDataDir, 'run', '--address', `0.0.0.0:${TRAILBASE_PORT}`, '--dev'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: PACKAGE_DIR,
    },
  )

  proc.stdout.on('data', (data) => {
    console.log(`[trailbase] ${data.toString().trim()}`)
  })

  proc.stderr.on('data', (data) => {
    console.error(`[trailbase] ${data.toString().trim()}`)
  })

  proc.on('error', (error) => {
    console.error('Failed to start TrailBase binary:', error)
  })

  return proc
}

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
 * Stop the TrailBase binary server
 */
function stopBinaryServer(): void {
  console.log('🛑 Stopping TrailBase binary...')
  if (serverProcess) {
    serverProcess.kill('SIGTERM')
    console.log('✓ Binary stopped')
  }
  // Clean up temp data directory
  if (tempDataDir && existsSync(tempDataDir)) {
    try {
      rmSync(tempDataDir, { recursive: true, force: true })
      console.log('✓ Temp data cleaned up')
    } catch {
      // Ignore cleanup errors
    }
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
    }, 60000) // 60 seconds timeout for startup

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
 * 1. Checks if TrailBase is already running (uses external instance)
 * 2. If not, tries to start using local binary (preferred)
 * 3. Falls back to Docker if binary not available
 * 4. Waits for TrailBase server to be healthy
 * 5. Provides context to all tests
 * 6. Returns cleanup function
 */
export default async function ({ provide }: GlobalSetupContext) {
  console.log('🚀 Starting TrailBase e2e test suite global setup...')

  // Check if TrailBase is already running
  const alreadyRunning = await isTrailBaseRunning(TRAILBASE_URL)

  if (alreadyRunning) {
    console.log(`✓ TrailBase already running at ${TRAILBASE_URL}`)
  } else {
    // Try binary first (preferred for CI/local testing without Docker)
    binaryPath = findBinaryPath()
    if (binaryPath) {
      console.log(`✓ TrailBase binary found at ${binaryPath}`)
      serverProcess = startBinaryServer()
      startedServer = true
      usedMethod = 'binary'
    } else if (isDockerAvailable()) {
      console.log('ℹ Binary not found, using Docker...')
      // Clean up any existing container
      cleanupExistingContainer()
      // Build Docker image
      buildDockerImage()
      // Start container
      serverProcess = startDockerContainer()
      startedServer = true
      usedMethod = 'docker'
    } else {
      throw new Error(
        `TrailBase is not running at ${TRAILBASE_URL} and no startup method is available.\n` +
          `Please either:\n` +
          `  1. Start TrailBase manually at ${TRAILBASE_URL}\n` +
          `  2. Place the TrailBase binary at one of:\n` +
          BINARY_PATHS.map((p) => `     - ${p}`).join('\n') +
          `\n  3. Install Docker and run the tests again\n` +
          `\nTo download TrailBase binary:\n` +
          `  curl -sSL https://trailbase.io/install.sh | bash\n` +
          `\nTo start TrailBase with Docker manually:\n` +
          `  cd packages/trailbase-db-collection/docker\n` +
          `  docker-compose up -d`,
      )
    }

    // Wait for TrailBase server to be ready
    console.log(`⏳ Waiting for TrailBase at ${TRAILBASE_URL}...`)
    await waitForTrailBase(TRAILBASE_URL)
    console.log('✓ TrailBase is ready')
  }

  // Provide context values to all tests
  provide('baseUrl', TRAILBASE_URL)

  console.log('✅ Global setup complete\n')

  // Return cleanup function (runs once after all tests)
  return () => {
    console.log('\n🧹 Running global teardown...')
    if (startedServer) {
      if (usedMethod === 'docker') {
        stopDockerContainer()
      } else if (usedMethod === 'binary') {
        stopBinaryServer()
      }
      serverProcess?.kill()
      serverProcess = null
    }
    console.log('✅ Global teardown complete')
  }
}
