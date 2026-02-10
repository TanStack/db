import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runRuntimeBridgeE2EContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-bridge-e2e-contract'
import { E2E_RESULT_PREFIX } from './e2e/fixtures/runtime-bridge-types'
import type {
  RuntimeBridgeE2EContractError,
  RuntimeBridgeE2EContractHarness,
  RuntimeBridgeE2EContractHarnessFactory,
  RuntimeBridgeE2EContractTodo,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-bridge-e2e-contract'
import type {
  ElectronRuntimeBridgeInput,
  ElectronRuntimeBridgeProcessResult,
  ElectronRuntimeBridgeScenarioResult,
} from './e2e/fixtures/runtime-bridge-types'

const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const electronRunnerPath = join(
  packageRoot,
  `tests`,
  `e2e`,
  `fixtures`,
  `electron-main.mjs`,
)

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

async function runElectronScenario(
  input: ElectronRuntimeBridgeInput,
): Promise<ElectronRuntimeBridgeScenarioResult> {
  const electronBinaryPath = resolveElectronBinaryPath()
  const xvfbRunPath = `/usr/bin/xvfb-run`
  const hasXvfbRun = existsSync(xvfbRunPath)
  const electronArgs = [`--disable-gpu`, `--headless=new`, electronRunnerPath]
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
          TANSTACK_DB_E2E_INPUT: JSON.stringify(input),
          ELECTRON_DISABLE_SECURITY_WARNINGS: `true`,
        },
        stdio: [`ignore`, `pipe`, `pipe`],
      })
      let stdoutBuffer = ``
      let stderrBuffer = ``

      const timeout = setTimeout(() => {
        child.kill(`SIGKILL`)
        reject(
          new Error(
            [
              `Electron e2e scenario timed out after 20s`,
              `stderr=${stderrBuffer}`,
              `stdout=${stdoutBuffer}`,
            ].join(`\n`),
          ),
        )
      }, 20_000)
      child.on(`error`, (error) => {
        clearTimeout(timeout)
        reject(error)
      })

      child.stdout.on(`data`, (chunk: Buffer) => {
        stdoutBuffer += chunk.toString()
      })
      child.stderr.on(`data`, (chunk: Buffer) => {
        stderrBuffer += chunk.toString()
      })

      child.on(`close`, (exitCode) => {
        clearTimeout(timeout)
        try {
          const parsedResult = parseScenarioResult(
            stdoutBuffer,
            stderrBuffer,
            exitCode,
          )
          resolve(parsedResult)
        } catch (error) {
          reject(error)
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

const createHarness: RuntimeBridgeE2EContractHarnessFactory = () => {
  const tempDirectory = mkdtempSync(
    join(tmpdir(), `db-electron-runtime-bridge-`),
  )
  const dbPath = join(tempDirectory, `state.sqlite`)
  const collectionId = `todos`
  let nextSequence = 1

  const runScenario = async (
    scenario: ElectronRuntimeBridgeInput[`scenario`],
  ): Promise<ElectronRuntimeBridgeScenarioResult> =>
    runElectronScenario({
      dbPath,
      collectionId,
      timeoutMs: 4_000,
      scenario,
    })

  const harness: RuntimeBridgeE2EContractHarness = {
    writeTodoFromClient: async (todo: RuntimeBridgeE2EContractTodo) => {
      const result = await runScenario({
        type: `writeTodo`,
        todo,
        txId: `tx-${nextSequence}`,
        seq: nextSequence,
        rowVersion: nextSequence,
      })
      nextSequence++

      if (result.type !== `writeTodo`) {
        throw new Error(`Unexpected write scenario result: ${result.type}`)
      }
    },
    loadTodosFromClient: async (targetCollectionId?: string) => {
      const result = await runScenario({
        type: `loadTodos`,
        collectionId: targetCollectionId,
      })
      if (result.type !== `loadTodos`) {
        throw new Error(`Unexpected load scenario result: ${result.type}`)
      }
      return result.rows
    },
    loadUnknownCollectionErrorFromClient:
      async (): Promise<RuntimeBridgeE2EContractError> => {
        const result = await runScenario({
          type: `loadUnknownCollectionError`,
          collectionId: `missing`,
        })
        if (result.type !== `loadUnknownCollectionError`) {
          throw new Error(`Unexpected error scenario result: ${result.type}`)
        }
        return result.error
      },
    restartHost: async () => {
      const result = await runScenario({
        type: `noop`,
      })
      if (result.type !== `noop`) {
        throw new Error(`Unexpected restart scenario result: ${result.type}`)
      }
    },
    cleanup: () => {
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }

  return harness
}

runRuntimeBridgeE2EContractSuite(
  `electron runtime bridge e2e (real main/renderer IPC)`,
  createHarness,
  {
    testTimeoutMs: 45_000,
  },
)
