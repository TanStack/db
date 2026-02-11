import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { runRuntimeBridgeE2EContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-bridge-e2e-contract'
import type {
  RuntimeBridgeE2EContractError,
  RuntimeBridgeE2EContractHarness,
  RuntimeBridgeE2EContractHarnessFactory,
  RuntimeBridgeE2EContractTodo,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-bridge-e2e-contract'

type RuntimeProcessHarness = {
  baseUrl: string
  restart: () => Promise<void>
  stop: () => Promise<void>
}

type WranglerRuntimeResponse<TPayload> =
  | {
      ok: true
      rows?: TPayload
    }
  | {
      ok: false
      error: RuntimeBridgeE2EContractError
    }

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const wranglerConfigPath = join(packageDirectory, `fixtures`, `wrangler.toml`)

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

function createRuntimeError(message: string, stderr: string, stdout: string): Error {
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

async function startWranglerRuntime(options: {
  persistPath: string
}): Promise<RuntimeProcessHarness> {
  let child: ReturnType<typeof spawn> | undefined
  let stdoutBuffer = ``
  let stderrBuffer = ``
  const port = await getAvailablePort()

  const spawnProcess = async (): Promise<void> => {
    child = spawn(
      `pnpm`,
      [
        `exec`,
        `wrangler`,
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
      ],
      {
        cwd: packageDirectory,
        env: {
          ...process.env,
          CI: `1`,
          WRANGLER_SEND_METRICS: `false`,
        },
        stdio: [`ignore`, `pipe`, `pipe`],
      },
    )

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
  }
}

async function postJson<TPayload>(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<WranglerRuntimeResponse<TPayload>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: `POST`,
    headers: {
      'content-type': `application/json`,
    },
    body: JSON.stringify(body),
  })

  const parsed = (await response.json()) as WranglerRuntimeResponse<TPayload>
  return parsed
}

const createHarness: RuntimeBridgeE2EContractHarnessFactory = () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-cloudflare-do-e2e-`))
  const persistPath = join(tempDirectory, `wrangler-state`)
  const collectionId = `todos`
  let nextSequence = 1
  const runtimePromise = startWranglerRuntime({
    persistPath,
  })

  const harness: RuntimeBridgeE2EContractHarness = {
    writeTodoFromClient: async (todo: RuntimeBridgeE2EContractTodo) => {
      const runtime = await runtimePromise
      const result = await postJson<void>(runtime.baseUrl, `/write-todo`, {
        collectionId,
        todo,
        txId: `tx-${nextSequence}`,
        seq: nextSequence,
        rowVersion: nextSequence,
      })
      nextSequence++

      if (!result.ok) {
        throw new Error(`${result.error.name}: ${result.error.message}`)
      }
    },
    loadTodosFromClient: async (targetCollectionId?: string) => {
      const runtime = await runtimePromise
      const result = await postJson<
        Array<{ key: string; value: RuntimeBridgeE2EContractTodo }>
      >(runtime.baseUrl, `/load-todos`, {
        collectionId: targetCollectionId ?? collectionId,
      })
      if (!result.ok) {
        throw new Error(`${result.error.name}: ${result.error.message}`)
      }
      return result.rows ?? []
    },
    loadUnknownCollectionErrorFromClient:
      async (): Promise<RuntimeBridgeE2EContractError> => {
        const runtime = await runtimePromise
        const result = await postJson<never>(
          runtime.baseUrl,
          `/load-unknown-collection-error`,
          {
            collectionId: `missing`,
          },
        )
        if (result.ok) {
          throw new Error(
            `Expected unknown collection request to fail, but it succeeded`,
          )
        }
        return result.error
      },
    restartHost: async () => {
      const runtime = await runtimePromise
      await runtime.restart()
    },
    cleanup: async () => {
      try {
        const runtime = await runtimePromise
        await runtime.stop()
      } finally {
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    },
  }

  return harness
}

runRuntimeBridgeE2EContractSuite(
  `cloudflare durable object runtime bridge e2e (wrangler local)`,
  createHarness,
  {
    testTimeoutMs: 90_000,
  },
)
