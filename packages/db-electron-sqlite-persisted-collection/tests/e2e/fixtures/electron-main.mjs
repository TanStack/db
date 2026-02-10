import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AsyncLocalStorage } from 'node:async_hooks'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, app, ipcMain } from 'electron'
import { createSQLiteCorePersistenceAdapter } from '@tanstack/db-sqlite-persisted-collection-core'
import {
  createElectronPersistenceMainHost,
  registerElectronPersistenceMainIpcHandler,
} from '../../../dist/esm/main.js'

const E2E_RESULT_PREFIX = `__TANSTACK_DB_E2E_RESULT__:`
const execFileAsync = promisify(execFile)

function toSqlLiteral(value) {
  if (value === null || value === undefined) {
    return `NULL`
  }

  if (typeof value === `number`) {
    return Number.isFinite(value) ? String(value) : `NULL`
  }

  if (typeof value === `boolean`) {
    return value ? `1` : `0`
  }

  if (typeof value === `bigint`) {
    return value.toString()
  }

  const textValue = typeof value === `string` ? value : String(value)
  return `'${textValue.replace(/'/g, `''`)}'`
}

function interpolateSql(sql, params) {
  let parameterIndex = 0
  const renderedSql = sql.replace(/\?/g, () => {
    const currentParam = params[parameterIndex]
    parameterIndex++
    return toSqlLiteral(currentParam)
  })

  if (parameterIndex !== params.length) {
    throw new Error(
      `SQL interpolation mismatch: used ${parameterIndex} params, received ${params.length}`,
    )
  }

  return renderedSql
}

class SqliteCliDriver {
  transactionDbPath = new AsyncLocalStorage()
  queue = Promise.resolve()

  constructor(dbPath) {
    this.dbPath = dbPath
  }

  async exec(sql) {
    const activeDbPath = this.transactionDbPath.getStore()
    if (activeDbPath) {
      await execFileAsync(`sqlite3`, [activeDbPath, sql])
      return
    }

    await this.enqueue(async () => {
      await execFileAsync(`sqlite3`, [this.dbPath, sql])
    })
  }

  async query(sql, params = []) {
    const activeDbPath = this.transactionDbPath.getStore()
    const renderedSql = interpolateSql(sql, params)
    const queryDbPath = activeDbPath ?? this.dbPath

    const runQuery = async () => {
      const { stdout } = await execFileAsync(`sqlite3`, [
        `-json`,
        queryDbPath,
        renderedSql,
      ])
      const trimmedOutput = stdout.trim()
      if (!trimmedOutput) {
        return []
      }

      return JSON.parse(trimmedOutput)
    }

    if (activeDbPath) {
      return runQuery()
    }

    return this.enqueue(async () => runQuery())
  }

  async run(sql, params = []) {
    const activeDbPath = this.transactionDbPath.getStore()
    const renderedSql = interpolateSql(sql, params)
    const runDbPath = activeDbPath ?? this.dbPath

    if (activeDbPath) {
      await execFileAsync(`sqlite3`, [runDbPath, renderedSql])
      return
    }

    await this.enqueue(async () => {
      await execFileAsync(`sqlite3`, [runDbPath, renderedSql])
    })
  }

  async transaction(fn) {
    const activeDbPath = this.transactionDbPath.getStore()
    if (activeDbPath) {
      return fn()
    }

    return this.enqueue(async () => {
      const txDirectory = mkdtempSync(join(tmpdir(), `db-electron-e2e-tx-`))
      const txDbPath = join(txDirectory, `state.sqlite`)

      if (existsSync(this.dbPath)) {
        copyFileSync(this.dbPath, txDbPath)
      }

      try {
        const txResult = await this.transactionDbPath.run(txDbPath, async () =>
          fn(),
        )
        if (existsSync(txDbPath)) {
          copyFileSync(txDbPath, this.dbPath)
        }
        return txResult
      } finally {
        rmSync(txDirectory, { recursive: true, force: true })
      }
    })
  }

  enqueue(operation) {
    const queuedOperation = this.queue.then(operation, operation)
    this.queue = queuedOperation.then(
      () => undefined,
      () => undefined,
    )
    return queuedOperation
  }
}

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

function getRendererPagePath() {
  const currentFile = fileURLToPath(import.meta.url)
  return join(dirname(currentFile), `renderer-page.html`)
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
  app.commandLine.appendSwitch(`disable-gpu`)
  app.commandLine.appendSwitch(`disable-dev-shm-usage`)
  app.commandLine.appendSwitch(`no-sandbox`)

  const input = parseInputFromEnv()
  const driver = new SqliteCliDriver(input.dbPath)
  const adapter = createSQLiteCorePersistenceAdapter({
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

    await window.loadFile(getRendererPagePath())

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
