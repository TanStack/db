import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AsyncLocalStorage } from 'node:async_hooks'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { serialize } from 'node:v8'
import { BrowserWindow, app, ipcMain } from 'electron'
import { createSQLiteCorePersistenceAdapter } from '@tanstack/db-sqlite-persisted-collection-core'
import {
  createElectronNodeSQLiteMainRegistry,
  createElectronPersistenceMainHost,
  registerElectronPersistenceMainIpcHandler,
} from '../../../dist/esm/main.js'

const E2E_RESULT_PREFIX = `__TANSTACK_DB_E2E_RESULT__:`
const E2E_RESULT_BASE64_PREFIX = `__TANSTACK_DB_E2E_RESULT_BASE64__:`
const E2E_INPUT_ENV_VAR = `TANSTACK_DB_E2E_INPUT`
const E2E_TRANSPORT_TYPE_TAG = `__tanstack_db_e2e_transport_type__`
const E2E_TRANSPORT_VALUE_TAG = `value`
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
      return fn(this)
    }

    return this.enqueue(async () => {
      const txDirectory = mkdtempSync(join(tmpdir(), `db-electron-e2e-tx-`))
      const txDbPath = join(txDirectory, `state.sqlite`)

      if (existsSync(this.dbPath)) {
        copyFileSync(this.dbPath, txDbPath)
      }

      try {
        const txResult = await this.transactionDbPath.run(txDbPath, async () =>
          fn(this),
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
  const rawInput = process.env[E2E_INPUT_ENV_VAR]
  if (!rawInput) {
    throw new Error(`Missing ${E2E_INPUT_ENV_VAR}`)
  }

  const parsed = JSON.parse(rawInput)
  const decoded = decodeTransportValue(parsed)
  if (!decoded || typeof decoded !== `object`) {
    throw new Error(`Invalid ${E2E_INPUT_ENV_VAR} payload`)
  }

  return decoded
}

function isEncodedTransportValue(value) {
  return (
    value &&
    typeof value === `object` &&
    typeof value[E2E_TRANSPORT_TYPE_TAG] === `string`
  )
}

function decodeTransportValue(value) {
  if (value === null) {
    return null
  }

  if (
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `boolean`
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => decodeTransportValue(item))
  }

  if (isEncodedTransportValue(value)) {
    switch (value[E2E_TRANSPORT_TYPE_TAG]) {
      case `bigint`:
        return BigInt(value[E2E_TRANSPORT_VALUE_TAG])
      case `date`:
        return new Date(value[E2E_TRANSPORT_VALUE_TAG])
      case `date_invalid`:
        return new Date(Number.NaN)
      case `nan`:
        return Number.NaN
      case `infinity`:
        return Number.POSITIVE_INFINITY
      case `-infinity`:
        return Number.NEGATIVE_INFINITY
      default:
        break
    }
  }

  if (typeof value === `object`) {
    const decodedObject = {}
    for (const [key, objectValue] of Object.entries(value)) {
      decodedObject[key] = decodeTransportValue(objectValue)
    }
    return decodedObject
  }

  return value
}

function printProcessResult(result) {
  try {
    const serializedResult = Buffer.from(serialize(result)).toString(`base64`)
    process.stdout.write(`${E2E_RESULT_BASE64_PREFIX}${serializedResult}\n`)
  } catch {
    process.stdout.write(`${E2E_RESULT_PREFIX}${JSON.stringify(result)}\n`)
  }
}

function getPreloadPath() {
  const currentFile = fileURLToPath(import.meta.url)
  return join(dirname(currentFile), `renderer-preload.cjs`)
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

function createMainHost(input, driver) {
  if (input.hostKind === `node-registry`) {
    const registry = createElectronNodeSQLiteMainRegistry([
      {
        collectionId: input.collectionId,
        adapterOptions: {
          driver,
          ...(input.adapterOptions ?? {}),
        },
      },
    ])

    return {
      host: registry.createHost(),
      cleanup: () => {
        registry.clear()
      },
    }
  }

  const adapter = createSQLiteCorePersistenceAdapter({
    driver,
    ...(input.adapterOptions ?? {}),
  })

  return {
    host: createElectronPersistenceMainHost({
      getAdapter: (collectionId) =>
        input.allowAnyCollectionId || collectionId === input.collectionId
          ? adapter
          : undefined,
    }),
    cleanup: () => {},
  }
}

async function run() {
  app.commandLine.appendSwitch(`disable-gpu`)
  app.commandLine.appendSwitch(`disable-dev-shm-usage`)
  app.commandLine.appendSwitch(`no-sandbox`)

  const input = parseInputFromEnv()
  const driver = new SqliteCliDriver(input.dbPath)
  const hostRuntime = createMainHost(input, driver)
  const disposeIpc = registerElectronPersistenceMainIpcHandler({
    ipcMain,
    host: hostRuntime.host,
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
        sandbox: false,
        preload: getPreloadPath(),
      },
    })

    const rendererDiagnostics = []
    window.webContents.on(
      `console-message`,
      (_event, level, message, line, sourceId) => {
        rendererDiagnostics.push(
          `[console:${String(level)}] ${sourceId}:${String(line)} ${message}`,
        )
      },
    )
    window.webContents.on(`preload-error`, (_event, path, error) => {
      rendererDiagnostics.push(
        `[preload-error] ${path}: ${error?.message ?? `unknown preload error`}`,
      )
    })

    await window.loadFile(getRendererPagePath())

    const scenarioInputBase64 = Buffer.from(
      serialize({
        collectionId: input.collectionId,
        allowAnyCollectionId: input.allowAnyCollectionId,
        hostKind: input.hostKind,
        adapterOptions: input.adapterOptions,
        channel: input.channel,
        timeoutMs: input.timeoutMs,
        scenario: input.scenario,
      }),
    ).toString(`base64`)

    const hasBridgeApi = await window.webContents.executeJavaScript(
      `typeof window.__tanstackDbRuntimeBridge__ === 'object'`,
      true,
    )
    if (!hasBridgeApi) {
      throw new Error(
        `Renderer preload bridge is unavailable.\n${rendererDiagnostics.join(`\n`)}`,
      )
    }

    let result
    try {
      result = await window.webContents.executeJavaScript(
        `window.__tanstackDbRuntimeBridge__.runScenarioFromBase64('${scenarioInputBase64}')`,
        true,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unknown error`
      throw new Error(
        `Renderer scenario execution failed: ${message}\n${rendererDiagnostics.join(`\n`)}`,
      )
    }

    return {
      ok: true,
      result,
    }
  } finally {
    if (window) {
      window.destroy()
    }
    disposeIpc()
    hostRuntime.cleanup()
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
