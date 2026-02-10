import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deserialize } from 'node:v8'
import { DEFAULT_ELECTRON_PERSISTENCE_CHANNEL } from '../../src'
import {
  E2E_RESULT_BASE64_PREFIX,
  E2E_RESULT_PREFIX,
} from './fixtures/runtime-bridge-types'
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
const E2E_TRANSPORT_TYPE_TAG = `__tanstack_db_e2e_transport_type__`
const E2E_TRANSPORT_VALUE_TAG = `value`

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
  const outputLines = stdoutBuffer.split(/\r?\n/u)
  const base64ResultLine = outputLines.find((line) =>
    line.startsWith(E2E_RESULT_BASE64_PREFIX),
  )
  if (base64ResultLine) {
    const rawResult = base64ResultLine.slice(E2E_RESULT_BASE64_PREFIX.length)
    const serializedResult = Buffer.from(rawResult, `base64`)
    return deserialize(serializedResult) as ElectronRuntimeBridgeProcessResult
  }

  const jsonResultLine = outputLines.find((line) =>
    line.startsWith(E2E_RESULT_PREFIX),
  )

  if (!jsonResultLine) {
    throw new Error(
      [
        `Electron e2e runner did not emit a result line`,
        `exitCode=${String(exitCode)}`,
        `stderr=${stderrBuffer}`,
        `stdout=${stdoutBuffer}`,
      ].join(`\n`),
    )
  }

  const rawResult = jsonResultLine.slice(E2E_RESULT_PREFIX.length)
  return JSON.parse(rawResult) as ElectronRuntimeBridgeProcessResult
}

function encodeTransportValue(value: unknown): unknown {
  if (value === null) {
    return null
  }

  if (
    typeof value === `string` ||
    typeof value === `boolean` ||
    (typeof value === `number` && Number.isFinite(value))
  ) {
    return value
  }

  if (typeof value === `number`) {
    if (Number.isNaN(value)) {
      return {
        [E2E_TRANSPORT_TYPE_TAG]: `nan`,
      }
    }
    if (value === Number.POSITIVE_INFINITY) {
      return {
        [E2E_TRANSPORT_TYPE_TAG]: `infinity`,
      }
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return {
        [E2E_TRANSPORT_TYPE_TAG]: `-infinity`,
      }
    }
  }

  if (typeof value === `bigint`) {
    return {
      [E2E_TRANSPORT_TYPE_TAG]: `bigint`,
      [E2E_TRANSPORT_VALUE_TAG]: value.toString(),
    }
  }

  if (value instanceof Date) {
    const timestamp = value.getTime()
    if (Number.isNaN(timestamp)) {
      return {
        [E2E_TRANSPORT_TYPE_TAG]: `date_invalid`,
      }
    }
    return {
      [E2E_TRANSPORT_TYPE_TAG]: `date`,
      [E2E_TRANSPORT_VALUE_TAG]: value.toISOString(),
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      const encodedItem = encodeTransportValue(item)
      return encodedItem === undefined ? null : encodedItem
    })
  }

  if (
    typeof value === `undefined` ||
    typeof value === `function` ||
    typeof value === `symbol`
  ) {
    return undefined
  }

  if (typeof value === `object`) {
    const encodedObject: Record<string, unknown> = {}
    for (const [key, objectValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const encodedObjectValue = encodeTransportValue(objectValue)
      if (encodedObjectValue !== undefined) {
        encodedObject[key] = encodedObjectValue
      }
    }
    return encodedObject
  }

  return undefined
}

function encodeInputForEnv(input: ElectronRuntimeBridgeInput): string {
  const encodedInput = encodeTransportValue(input)
  if (!encodedInput || typeof encodedInput !== `object`) {
    throw new Error(`Failed to encode e2e runtime input`)
  }
  return JSON.stringify(encodedInput)
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
          [E2E_INPUT_ENV_VAR]: encodeInputForEnv(input),
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
