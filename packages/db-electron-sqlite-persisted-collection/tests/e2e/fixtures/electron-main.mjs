import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, app, ipcMain } from 'electron'
import {
  createBetterSqlite3Driver,
  createNodeSQLitePersistenceAdapter,
} from '@tanstack/db-node-sqlite-persisted-collection'
import {
  createElectronPersistenceMainHost,
  registerElectronPersistenceMainIpcHandler,
} from '../../../dist/esm/main.js'

const E2E_RESULT_PREFIX = `__TANSTACK_DB_E2E_RESULT__:`

function parseInputFromEnv() {
  const rawInput = process.env.TANSTACK_DB_E2E_INPUT
  if (!rawInput) {
    throw new Error(`Missing TANSTACK_DB_E2E_INPUT`)
  }

  const parsed = JSON.parse(rawInput)
  if (!parsed || typeof parsed !== `object`) {
    throw new Error(`Invalid TANSTACK_DB_E2E_INPUT payload`)
  }

  return parsed
}

function printProcessResult(result) {
  process.stdout.write(`${E2E_RESULT_PREFIX}${JSON.stringify(result)}\n`)
}

function getPreloadPath() {
  const currentFile = fileURLToPath(import.meta.url)
  return join(dirname(currentFile), `renderer-preload.mjs`)
}

function serializeError(error) {
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

async function run() {
  app.commandLine.appendSwitch(`headless`)
  app.commandLine.appendSwitch(`disable-gpu`)
  app.commandLine.appendSwitch(`no-sandbox`)

  const input = parseInputFromEnv()
  const driver = createBetterSqlite3Driver({
    filename: input.dbPath,
  })

  const adapter = createNodeSQLitePersistenceAdapter({
    driver,
  })
  const host = createElectronPersistenceMainHost({
    getAdapter: (collectionId) =>
      collectionId === input.collectionId ? adapter : undefined,
  })
  const disposeIpc = registerElectronPersistenceMainIpcHandler({
    ipcMain,
    host,
    channel: input.channel,
  })

  let window
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

    await window.loadURL(
      `data:text/html,<html><body>runtime-bridge-e2e</body></html>`,
    )

    const scenarioExpression = JSON.stringify({
      collectionId: input.collectionId,
      channel: input.channel,
      timeoutMs: input.timeoutMs,
      scenario: input.scenario,
    })

    const result = await window.webContents.executeJavaScript(
      `window.__tanstackDbRuntimeBridge__.runScenario(${scenarioExpression})`,
      true,
    )

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
  .catch((error) => {
    printProcessResult({
      ok: false,
      error: serializeError(error),
    })
    process.exitCode = 1
  })
