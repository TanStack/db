import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { RuntimeBridgeE2EContractError } from '../../../db-sqlite-persistence-core/tests/contracts/runtime-bridge-e2e-contract'

/**
 * Wrangler dev process helpers shared by the Cloudflare Durable Object e2e
 * witnesses. `startWranglerRuntime` runs the fixture worker in local workerd
 * with `--persist-to`, so a runtime that is stopped and started again over
 * the same directory reads the same Durable Object storage.
 */
export type RuntimeProcessHarness = {
  baseUrl: string
  restart: () => Promise<void>
  stop: () => Promise<void>
  getOutput: () => {
    stderr: string
    stdout: string
  }
}

export type WranglerRuntimeResponse<TPayload> =
  | {
      ok: true
      rows?: TPayload
    }
  | {
      ok: false
      error: RuntimeBridgeE2EContractError
    }

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const wranglerConfigPath = join(packageDirectory, `wrangler.toml`)
const require = createRequire(import.meta.url)
const wranglerBinPath = require.resolve(`wrangler/bin/wrangler.js`)

async function getAvailablePort(): Promise<number> {
  const netModule = await import('node:net')
  return new Promise<number>((resolve, reject) => {
    const server = netModule.createServer()
    server.listen(0, `127.0.0.1`, () => {
      const address = server.address()
      if (!address || typeof address === `string`) {
        server.close()
        reject(new Error(`Unable to allocate an available local port`))
        return
      }
      const selectedPort = address.port
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(selectedPort)
      })
    })
    server.on(`error`, reject)
  })
}

function createRuntimeError(
  message: string,
  stderr: string,
  stdout: string,
): Error {
  return new Error([message, `stderr=${stderr}`, `stdout=${stdout}`].join(`\n`))
}

async function stopWranglerProcess(
  child: ReturnType<typeof spawn> | undefined,
): Promise<void> {
  if (!child || child.exitCode !== null) {
    return
  }

  child.kill(`SIGTERM`)
  const closed = await Promise.race([
    new Promise<boolean>((resolve) => {
      child.once(`close`, () => resolve(true))
    }),
    delay(5_000).then(() => false),
  ])

  if (closed) {
    return
  }

  child.kill(`SIGKILL`)
  await new Promise<void>((resolve) => {
    child.once(`close`, () => resolve())
  })
}

export async function startWranglerRuntime(options: {
  persistPath: string
  syncEnabled?: boolean
  schemaVersion?: number
  collectionId?: string
}): Promise<RuntimeProcessHarness> {
  let child: ReturnType<typeof spawn> | undefined
  let stdoutBuffer = ``
  let stderrBuffer = ``
  const port = await getAvailablePort()

  const spawnProcess = async (): Promise<void> => {
    const runtimeVarEntries = [
      [
        `PERSISTENCE_WITH_SYNC`,
        options.syncEnabled !== undefined
          ? String(options.syncEnabled)
          : undefined,
      ],
      [
        `PERSISTENCE_SCHEMA_VERSION`,
        options.schemaVersion !== undefined
          ? String(options.schemaVersion)
          : undefined,
      ],
      [`PERSISTENCE_COLLECTION_ID`, options.collectionId],
    ].filter((entry): entry is [string, string] => entry[1] !== undefined)

    const wranglerArgs = [
      `dev`,
      `--local`,
      `--ip`,
      `127.0.0.1`,
      `--port`,
      String(port),
      `--persist-to`,
      options.persistPath,
      `--config`,
      wranglerConfigPath,
      ...runtimeVarEntries.flatMap(([key, value]) => [
        `--var`,
        `${key}:${value}`,
      ]),
    ]

    child = spawn(process.execPath, [wranglerBinPath, ...wranglerArgs], {
      cwd: packageDirectory,
      env: {
        ...process.env,
        CI: `1`,
        WRANGLER_SEND_METRICS: `false`,
      },
      stdio: [`ignore`, `pipe`, `pipe`],
    })

    if (!child.stdout || !child.stderr) {
      throw new Error(`Unable to capture wrangler dev process output streams`)
    }

    child.stdout.on(`data`, (chunk: Buffer) => {
      stdoutBuffer += chunk.toString()
    })
    child.stderr.on(`data`, (chunk: Buffer) => {
      stderrBuffer += chunk.toString()
    })

    const baseUrl = `http://127.0.0.1:${String(port)}`
    const startAt = Date.now()
    while (Date.now() - startAt < 45_000) {
      if (child.exitCode !== null) {
        throw createRuntimeError(
          `Wrangler dev exited before becoming healthy`,
          stderrBuffer,
          stdoutBuffer,
        )
      }

      try {
        const healthResponse = await fetch(`${baseUrl}/health`)
        if (healthResponse.ok) {
          return
        }
      } catch {
        // Runtime may still be starting.
      }

      await delay(250)
    }

    throw createRuntimeError(
      `Timed out waiting for wrangler dev runtime`,
      stderrBuffer,
      stdoutBuffer,
    )
  }

  await spawnProcess()

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    restart: async () => {
      await stopWranglerProcess(child)
      stdoutBuffer = ``
      stderrBuffer = ``
      await spawnProcess()
    },
    stop: async () => {
      await stopWranglerProcess(child)
    },
    getOutput: () => ({
      stderr: stderrBuffer,
      stdout: stdoutBuffer,
    }),
  }
}

export async function postJson<TPayload>(
  runtime: RuntimeProcessHarness,
  path: string,
  body: unknown,
): Promise<WranglerRuntimeResponse<TPayload>> {
  let response: Response
  try {
    response = await fetch(`${runtime.baseUrl}${path}`, {
      method: `POST`,
      headers: {
        'content-type': `application/json`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error) {
    const output = runtime.getOutput()
    throw createRuntimeError(
      `Timed out waiting for wrangler dev runtime response: ${String(error)}`,
      output.stderr,
      output.stdout,
    )
  }

  const parsed = (await response.json()) as WranglerRuntimeResponse<TPayload>
  return parsed
}
