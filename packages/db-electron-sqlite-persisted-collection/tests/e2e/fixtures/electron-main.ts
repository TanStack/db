import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, app, ipcMain } from 'electron'
import { createBetterSqlite3Driver, createNodeSQLitePersistenceAdapter  } from '@tanstack/db-node-sqlite-persisted-collection'
import {
  createElectronPersistenceMainHost,
  registerElectronPersistenceMainIpcHandler,
} from '../../../src/main'
import { E2E_RESULT_PREFIX } from './runtime-bridge-types'
import type {
  ElectronRuntimeBridgeInput,
  ElectronRuntimeBridgeProcessResult,
  ElectronRuntimeBridgeScenarioResult,
} from './runtime-bridge-types'

function serializeError(error: unknown): ElectronRuntimeBridgeProcessResult[`error`] {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }

  return {
    name: `Error`,
    message: `Unknown runtime error`,
  }
}

function parseInputFromEnv(): ElectronRuntimeBridgeInput {
  const rawInput = process.env.TANSTACK_DB_E2E_INPUT
  if (!rawInput) {
    throw new Error(`Missing TANSTACK_DB_E2E_INPUT`)
  }

  const parsed: unknown = JSON.parse(rawInput)
  if (!parsed || typeof parsed !== `object`) {
    throw new Error(`Invalid TANSTACK_DB_E2E_INPUT payload`)
  }

  const candidate = parsed as Partial<ElectronRuntimeBridgeInput>
  if (typeof candidate.collectionId !== `string` || candidate.collectionId === ``) {
    throw new Error(`Missing collectionId in TANSTACK_DB_E2E_INPUT`)
  }
  if (typeof candidate.dbPath !== `string` || candidate.dbPath === ``) {
    throw new Error(`Missing dbPath in TANSTACK_DB_E2E_INPUT`)
  }
  if (!(`scenario` in candidate)) {
    throw new Error(`Missing scenario in TANSTACK_DB_E2E_INPUT`)
  }

  return candidate as ElectronRuntimeBridgeInput
}

function printProcessResult(result: ElectronRuntimeBridgeProcessResult): void {
  process.stdout.write(`${E2E_RESULT_PREFIX}${JSON.stringify(result)}\n`)
}

function getPreloadPath(): string {
  const currentFile = fileURLToPath(import.meta.url)
  return join(dirname(currentFile), `renderer-preload.ts`)
}

async function run(): Promise<ElectronRuntimeBridgeProcessResult> {
  app.commandLine.appendSwitch(`headless`)
  app.commandLine.appendSwitch(`disable-gpu`)
  app.commandLine.appendSwitch(`no-sandbox`)

  const input = parseInputFromEnv()
  const driver = createBetterSqlite3Driver({
    filename: input.dbPath,
  })

  const adapter = createNodeSQLitePersistenceAdapter<Record<string, unknown>, string>(
    {
      driver,
    },
  )
  const host = createElectronPersistenceMainHost({
    getAdapter: (collectionId) =>
      collectionId === input.collectionId ? adapter : undefined,
  })
  const disposeIpc = registerElectronPersistenceMainIpcHandler({
    ipcMain,
    host,
    channel: input.channel,
  })

  let window: BrowserWindow | undefined
  try {
    await app.whenReady()

    window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: getPreloadPath(),
      },
    })

    await window.loadURL(`data:text/html,<html><body>runtime-bridge</body></html>`)

    const scenarioExpression = JSON.stringify({
      collectionId: input.collectionId,
      channel: input.channel,
      timeoutMs: input.timeoutMs,
      scenario: input.scenario,
    })

    const result = (await window.webContents.executeJavaScript(
      `window.__tanstackDbRuntimeBridge__.runScenario(${scenarioExpression})`,
      true,
    )) as ElectronRuntimeBridgeScenarioResult

    return {
      ok: true,
      result,
    }
  } finally {
    if (window) {
      window.destroy()
    }
    disposeIpc()
    driver.close()
    await app.quit()
  }
}

void run()
  .then((result) => {
    printProcessResult(result)
    process.exitCode = 0
  })
  .catch((error: unknown) => {
    printProcessResult({
      ok: false,
      error: serializeError(error),
    })
    process.exitCode = 1
  })
