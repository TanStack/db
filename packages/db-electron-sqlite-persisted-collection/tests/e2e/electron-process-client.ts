import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serialize } from 'node:v8'
import { DEFAULT_ELECTRON_PERSISTENCE_CHANNEL } from '../../src'
import { E2E_RESULT_PREFIX } from './fixtures/runtime-bridge-types'
import type { ElectronPersistenceInvoke } from '../../src'
import type {
  ElectronRuntimeBridgeAdapterOptions,
  ElectronRuntimeBridgeHostKind,
  ElectronRuntimeBridgeInput,
  ElectronRuntimeBridgeProcessResult,
  ElectronRuntimeBridgeScenarioResult,
} from './fixtures/runtime-bridge-types'

const ELECTRON_SCENARIO_TIMEOUT_MS = 20_000
const require = createRequire(import.meta.url)
const currentFilePath = fileURLToPath(import.meta.url)
const e2eDirectory = dirname(currentFilePath)
const testsDirectory = dirname(e2eDirectory)
const packageRoot = dirname(testsDirectory)
const electronRunnerPath = join(e2eDirectory, `fixtures`, `electron-main.mjs`)
const E2E_INPUT_ENV_VAR = `TANSTACK_DB_E2E_INPUT`
const E2E_INPUT_BASE64_ENV_VAR = `TANSTACK_DB_E2E_INPUT_BASE64`

export const ELECTRON_FULL_E2E_ENV_VAR = `TANSTACK_DB_ELECTRON_E2E_ALL`

export function isElectronFullE2EEnabled(): boolean {
  return process.env[ELECTRON_FULL_E2E_ENV_VAR] === `1`
}

type CreateElectronRuntimeBridgeInvokeOptions = {
  dbPath: string
  collectionId: string
  allowAnyCollectionId?: boolean
  timeoutMs?: number
  hostKind?: ElectronRuntimeBridgeHostKind
  adapterOptions?: ElectronRuntimeBridgeAdapterOptions
}

function resolveElectronBinaryPath(): string {
  const electronModuleValue: unknown = require(`electron`)
  if (
    typeof electronModuleValue !== `string` ||
    electronModuleValue.length === 0
  ) {
    throw new Error(`Failed to resolve electron binary path`)
  }
  return electronModuleValue
}

function parseScenarioResult(
  stdoutBuffer: string,
  stderrBuffer: string,
  exitCode: number | null,
): ElectronRuntimeBridgeProcessResult {
  const resultLine = stdoutBuffer
    .split(/\r?\n/u)
    .find((line) => line.startsWith(E2E_RESULT_PREFIX))

  if (!resultLine) {
    throw new Error(
      [
        `Electron e2e runner did not emit a result line`,
        `exitCode=${String(exitCode)}`,
        `stderr=${stderrBuffer}`,
        `stdout=${stdoutBuffer}`,
      ].join(`\n`),
    )
  }

  const rawResult = resultLine.slice(E2E_RESULT_PREFIX.length)
  return JSON.parse(rawResult) as ElectronRuntimeBridgeProcessResult
}

function encodeInputForEnv(input: ElectronRuntimeBridgeInput): string {
  return Buffer.from(serialize(input)).toString(`base64`)
}

export async function runElectronRuntimeBridgeScenario(
  input: ElectronRuntimeBridgeInput,
): Promise<ElectronRuntimeBridgeScenarioResult> {
  const electronBinaryPath = resolveElectronBinaryPath()
  const xvfbRunPath = `/usr/bin/xvfb-run`
  const hasXvfbRun = existsSync(xvfbRunPath)
  const electronArgs = [
    `--disable-gpu`,
    `--disable-dev-shm-usage`,
    `--no-sandbox`,
    electronRunnerPath,
  ]
  const command = hasXvfbRun ? xvfbRunPath : electronBinaryPath
  const args = hasXvfbRun
    ? [
        `-a`,
        `--server-args=-screen 0 1280x720x24`,
        electronBinaryPath,
        ...electronArgs,
      ]
    : electronArgs

  const processResult = await new Promise<ElectronRuntimeBridgeProcessResult>(
    (resolve, reject) => {
      const child = spawn(command, args, {
        cwd: packageRoot,
        env: {
          ...process.env,
          [E2E_INPUT_BASE64_ENV_VAR]: encodeInputForEnv(input),
          [E2E_INPUT_ENV_VAR]: JSON.stringify(input, (_key, value) =>
            typeof value === `bigint` ? value.toString() : value,
          ),
          ELECTRON_DISABLE_SECURITY_WARNINGS: `true`,
        },
        stdio: [`ignore`, `pipe`, `pipe`],
      })
      let stdoutBuffer = ``
      let stderrBuffer = ``
      let isSettled = false
      let resultFromStdout: ElectronRuntimeBridgeProcessResult | undefined
      let gracefulCloseTimeout: ReturnType<typeof setTimeout> | undefined

      const settle = (
        callback: (result: ElectronRuntimeBridgeProcessResult) => void,
        result: ElectronRuntimeBridgeProcessResult,
      ) => {
        if (isSettled) {
          return
        }
        isSettled = true
        clearTimeout(timeout)
        if (gracefulCloseTimeout) {
          clearTimeout(gracefulCloseTimeout)
        }
        callback(result)

        if (!child.killed) {
          child.kill(`SIGKILL`)
        }
      }

      const rejectOnce = (error: unknown) => {
        if (isSettled) {
          return
        }
        isSettled = true
        clearTimeout(timeout)
        if (gracefulCloseTimeout) {
          clearTimeout(gracefulCloseTimeout)
        }
        reject(error)
        if (!child.killed) {
          child.kill(`SIGKILL`)
        }
      }

      const timeout = setTimeout(() => {
        rejectOnce(
          new Error(
            [
              `Electron e2e scenario timed out after ${String(ELECTRON_SCENARIO_TIMEOUT_MS)}ms`,
              `stderr=${stderrBuffer}`,
              `stdout=${stdoutBuffer}`,
            ].join(`\n`),
          ),
        )
      }, ELECTRON_SCENARIO_TIMEOUT_MS)

      child.on(`error`, (error) => {
        rejectOnce(error)
      })

      child.stdout.on(`data`, (chunk: Buffer) => {
        stdoutBuffer += chunk.toString()

        try {
          const parsedResult = parseScenarioResult(
            stdoutBuffer,
            stderrBuffer,
            null,
          )
          if (!resultFromStdout) {
            resultFromStdout = parsedResult
            gracefulCloseTimeout = setTimeout(() => {
              settle(resolve, parsedResult)
            }, 1_000)
          }
        } catch {
          // Result line might not be complete yet.
        }
      })
      child.stderr.on(`data`, (chunk: Buffer) => {
        stderrBuffer += chunk.toString()
      })

      child.on(`close`, (exitCode) => {
        if (isSettled) {
          return
        }

        try {
          if (resultFromStdout) {
            settle(resolve, resultFromStdout)
            return
          }

          const parsedResult = parseScenarioResult(
            stdoutBuffer,
            stderrBuffer,
            exitCode,
          )
          settle(resolve, parsedResult)
        } catch (error) {
          rejectOnce(error)
        }
      })
    },
  )

  if (!processResult.ok) {
    throw new Error(
      `Electron e2e runner failed: ${processResult.error.name}: ${processResult.error.message}`,
    )
  }

  return processResult.result
}

export function createElectronRuntimeBridgeInvoke(
  options: CreateElectronRuntimeBridgeInvokeOptions,
): ElectronPersistenceInvoke {
  let queue: Promise<void> = Promise.resolve()

  return async (channel, request) => {
    const queuedInvoke = queue.then(
      () =>
        runElectronRuntimeBridgeScenario({
          dbPath: options.dbPath,
          collectionId: options.collectionId,
          allowAnyCollectionId: options.allowAnyCollectionId,
          hostKind: options.hostKind,
          adapterOptions: options.adapterOptions,
          channel,
          timeoutMs: options.timeoutMs ?? 4_000,
          scenario: {
            type: `invokeRequest`,
            request,
          },
        }),
      () =>
        runElectronRuntimeBridgeScenario({
          dbPath: options.dbPath,
          collectionId: options.collectionId,
          allowAnyCollectionId: options.allowAnyCollectionId,
          hostKind: options.hostKind,
          adapterOptions: options.adapterOptions,
          channel,
          timeoutMs: options.timeoutMs ?? 4_000,
          scenario: {
            type: `invokeRequest`,
            request,
          },
        }),
    )
    queue = queuedInvoke.then(
      () => undefined,
      () => undefined,
    )

    const result = await queuedInvoke

    if (result.type !== `invokeRequest`) {
      throw new Error(`Unexpected invokeRequest result: ${result.type}`)
    }

    return result.response
  }
}

export function withDefaultElectronChannel(
  invoke: ElectronPersistenceInvoke,
): ElectronPersistenceInvoke {
  return (channel, request) =>
    invoke(channel || DEFAULT_ELECTRON_PERSISTENCE_CHANNEL, request)
}
