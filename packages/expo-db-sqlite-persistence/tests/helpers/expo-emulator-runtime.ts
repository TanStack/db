import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createServer as createNetServer } from 'node:net'
import { basename, delimiter, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type {
  ExpoSQLiteBindParams,
  ExpoSQLiteDatabaseLike,
  ExpoSQLiteRunResult,
  ExpoSQLiteTransaction,
} from '../../src/expo-sqlite-driver'
import type {
  ExpoRuntimeCommand,
  ExpoRuntimeCommandResult,
  ExpoRuntimeRegistration,
  ExpoRuntimeSmokeTestResult,
} from '../../e2e/runtime-protocol'

type RuntimePlatform = `ios` | `android`

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (error?: unknown) => void
}

type PendingCommand = {
  command: ExpoRuntimeCommand
  deferred: Deferred<unknown>
}

type ExpoRuntimeCommandInput = ExpoRuntimeCommand extends infer TCommand
  ? TCommand extends { id: string }
    ? Omit<TCommand, `id`>
    : never
  : never

function createDeferred<T>(): Deferred<T> {
  let resolveDeferred!: Deferred<T>[`resolve`]
  let reject!: Deferred<T>[`reject`]
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolveDeferred = innerResolve
    reject = innerReject
  })
  return { promise, resolve: resolveDeferred, reject }
}

function jsonResponse(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: unknown,
): void {
  response.statusCode = statusCode
  response.setHeader(`content-type`, `application/json`)
  response.end(JSON.stringify(body))
}

async function readJsonBody<T>(
  request: IncomingMessage,
): Promise<T | undefined> {
  const chunks: Array<Buffer> = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (chunks.length === 0) {
    return undefined
  }

  return JSON.parse(Buffer.concat(chunks).toString(`utf8`)) as T
}

function getRuntimeAppDirectory(): string {
  return resolve(process.cwd(), `e2e/expo-runtime-app`)
}

function getHostBridgeUrl(platform: RuntimePlatform, port: number): string {
  const hostname = platform === `android` ? `10.0.2.2` : `127.0.0.1`
  return `http://${hostname}:${port}`
}

function getProjectName(platform: RuntimePlatform): string {
  return platform === `android` ? `expo-emulator-android` : `expo-emulator-ios`
}

function getAndroidSdkDirectory(): string | undefined {
  const configuredSdkDirectory =
    process.env.ANDROID_HOME?.trim() || process.env.ANDROID_SDK_ROOT?.trim()

  if (configuredSdkDirectory && existsSync(configuredSdkDirectory)) {
    return configuredSdkDirectory
  }

  const homeDirectory = process.env.HOME?.trim()
  if (!homeDirectory) {
    return undefined
  }

  const defaultSdkDirectory = resolve(homeDirectory, `Library/Android/sdk`)
  return existsSync(defaultSdkDirectory) ? defaultSdkDirectory : undefined
}

function createRuntimeEnvironment(options: {
  platform: RuntimePlatform
  bridgeUrl: string
  sessionId: string
}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    EXPO_PUBLIC_TSDB_BRIDGE_URL: options.bridgeUrl,
    EXPO_PUBLIC_TSDB_SESSION_ID: options.sessionId,
    EXPO_PUBLIC_TSDB_RUNTIME_PLATFORM: options.platform,
    CI: process.env.CI ?? `1`,
  }

  if (options.platform !== `android`) {
    return environment
  }

  const sdkDirectory = getAndroidSdkDirectory()
  if (!sdkDirectory) {
    return environment
  }

  const pathEntries = [
    resolve(sdkDirectory, `platform-tools`),
    resolve(sdkDirectory, `emulator`),
    resolve(sdkDirectory, `tools`),
    resolve(sdkDirectory, `tools/bin`),
    environment.PATH ?? ``,
  ].filter((entry) => entry.length > 0)

  environment.PATH = pathEntries.join(delimiter)
  environment.ANDROID_HOME ??= sdkDirectory
  environment.ANDROID_SDK_ROOT ??= sdkDirectory

  return environment
}

async function getAvailablePort(): Promise<number> {
  return new Promise<number>((resolvePort, rejectPort) => {
    const server = createNetServer()
    server.once(`error`, rejectPort)
    server.listen(0, `127.0.0.1`, () => {
      const address = server.address()
      if (!address || typeof address === `string`) {
        server.close(() => {
          rejectPort(new Error(`Unable to allocate an Expo dev server port`))
        })
        return
      }

      server.close((closeError) => {
        if (closeError) {
          rejectPort(closeError)
          return
        }

        resolvePort(address.port)
      })
    })
  })
}

function createDefaultLaunchCommand(
  platform: RuntimePlatform,
  devServerPort: number,
): Array<string> {
  const platformFlag = platform === `android` ? `--android` : `--ios`
  return [
    `pnpm`,
    `exec`,
    `expo`,
    `start`,
    platformFlag,
    `--port`,
    String(devServerPort),
    `--clear`,
  ]
}

function parseCommandOverride(rawCommand: string): Array<string> {
  return rawCommand
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

class ExpoEmulatorRuntime {
  private static readonly instances = new Map<
    RuntimePlatform,
    ExpoEmulatorRuntime
  >()

  static async get(platform: RuntimePlatform): Promise<ExpoEmulatorRuntime> {
    let existing = this.instances.get(platform)
    if (!existing) {
      existing = new ExpoEmulatorRuntime(platform)
      this.instances.set(platform, existing)
    }

    await existing.start()
    return existing
  }

  private readonly pendingCommands: Array<PendingCommand> = []
  private readonly pendingByCommandId = new Map<string, PendingCommand>()
  private readonly sessionReady = createDeferred<void>()
  private readonly portReady = createDeferred<number>()
  private readonly platform: RuntimePlatform
  private readonly sessionId = randomUUID()
  private serverStarted = false
  private childProcess: ChildProcessWithoutNullStreams | null = null

  private constructor(platform: RuntimePlatform) {
    this.platform = platform
    process.once(`exit`, () => {
      this.dispose()
    })
  }

  createDatabase(options: { filename: string }): ExpoSQLiteDatabaseLike & {
    closeAsync: () => Promise<void>
  } {
    const databaseName = basename(options.filename)
    const databaseId = `${databaseName}:${randomUUID()}`

    return {
      execAsync: async (sql: string) => {
        await this.sendCommand({
          type: `db:exec`,
          databaseId,
          databaseName,
          sql,
        })
      },
      getAllAsync: async <T>(
        sql: string,
        params?: ExpoSQLiteBindParams,
      ): Promise<ReadonlyArray<T>> =>
        (await this.sendCommand({
          type: `db:getAll`,
          databaseId,
          databaseName,
          sql,
          params,
        })) as ReadonlyArray<T>,
      runAsync: async (
        sql: string,
        params?: ExpoSQLiteBindParams,
      ): Promise<ExpoSQLiteRunResult> =>
        (await this.sendCommand({
          type: `db:run`,
          databaseId,
          databaseName,
          sql,
          params,
        })) as ExpoSQLiteRunResult,
      withExclusiveTransactionAsync: async <T>(
        task: (transaction: ExpoSQLiteTransaction) => Promise<T>,
      ): Promise<T> => {
        const transactionId = randomUUID()
        await this.sendCommand({
          type: `tx:start`,
          databaseId,
          databaseName,
          transactionId,
        })
        const transaction: ExpoSQLiteTransaction = {
          execAsync: async (sql: string) => {
            await this.sendCommand({
              type: `tx:exec`,
              transactionId,
              sql,
            })
          },
          getAllAsync: async <TRow>(
            sql: string,
            params?: ExpoSQLiteBindParams,
          ): Promise<ReadonlyArray<TRow>> =>
            (await this.sendCommand({
              type: `tx:getAll`,
              transactionId,
              sql,
              params,
            })) as ReadonlyArray<TRow>,
          runAsync: async (
            sql: string,
            params?: ExpoSQLiteBindParams,
          ): Promise<ExpoSQLiteRunResult> =>
            (await this.sendCommand({
              type: `tx:run`,
              transactionId,
              sql,
              params,
            })) as ExpoSQLiteRunResult,
        }

        try {
          const result = await task(transaction)
          await this.sendCommand({
            type: `tx:commit`,
            transactionId,
          })
          return result
        } catch (error) {
          await this.sendCommand({
            type: `tx:rollback`,
            transactionId,
          })
          throw error
        }
      },
      closeAsync: async () => {
        await this.sendCommand({
          type: `db:close`,
          databaseId,
          databaseName,
        })
      },
    }
  }

  async runPersistenceSmokeTest(
    databaseName: string,
  ): Promise<ExpoRuntimeSmokeTestResult> {
    return (await this.sendCommand({
      type: `app:runPersistenceSmokeTest`,
      databaseName,
    })) as ExpoRuntimeSmokeTestResult
  }

  private async start(): Promise<void> {
    if (this.serverStarted) {
      await this.portReady.promise
      await this.sessionReady.promise
      return
    }

    this.serverStarted = true
    const server = createServer(async (request, response) => {
      try {
        await this.handleRequest(request, response)
      } catch (error) {
        jsonResponse(response, 500, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })

    await new Promise<void>((resolveServer, rejectServer) => {
      server.once(`error`, rejectServer)
      server.listen(0, `0.0.0.0`, () => {
        const address = server.address()
        if (!address || typeof address === `string`) {
          rejectServer(new Error(`Unable to resolve bridge server address`))
          return
        }
        this.portReady.resolve(address.port)
        resolveServer()
      })
    })

    const port = await this.portReady.promise
    const bridgeUrl = getHostBridgeUrl(this.platform, port)
    const devServerPort = await getAvailablePort()
    const launchCommandOverride =
      process.env.TANSTACK_DB_EXPO_RUNTIME_APP_COMMAND?.trim()
    const launchCommand = launchCommandOverride
      ? parseCommandOverride(launchCommandOverride)
      : createDefaultLaunchCommand(this.platform, devServerPort)

    const [command, ...args] = launchCommand
    if (!command) {
      throw new Error(`Expo runtime launch command is empty`)
    }

    this.childProcess = spawn(command, args, {
      cwd: getRuntimeAppDirectory(),
      stdio: `pipe`,
      env: createRuntimeEnvironment({
        platform: this.platform,
        bridgeUrl,
        sessionId: this.sessionId,
      }),
    })

    this.childProcess.stdout.on(`data`, (chunk) => {
      process.stdout.write(
        `[${getProjectName(this.platform)}] ${String(chunk)}`,
      )
    })
    this.childProcess.stderr.on(`data`, (chunk) => {
      process.stderr.write(
        `[${getProjectName(this.platform)}] ${String(chunk)}`,
      )
    })
    this.childProcess.once(`exit`, (code) => {
      if (code !== 0) {
        this.sessionReady.reject(
          new Error(
            `Expo emulator app exited before registering (code ${code})`,
          ),
        )
      }
    })

    await Promise.race([
      this.sessionReady.promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `Timed out waiting for Expo emulator app to register with the host bridge`,
            ),
          )
        }, 120_000)
      }),
    ])
  }

  private async sendCommand(
    commandInput: ExpoRuntimeCommandInput,
  ): Promise<unknown> {
    await this.start()
    const command = {
      id: randomUUID(),
      ...commandInput,
    } as ExpoRuntimeCommand
    const deferred = createDeferred<unknown>()
    const pending: PendingCommand = {
      command,
      deferred,
    }
    this.pendingCommands.push(pending)
    this.pendingByCommandId.set(command.id, pending)
    return deferred.promise
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>,
  ): Promise<void> {
    const requestUrl = new URL(request.url ?? `/`, `http://127.0.0.1`)

    if (request.method === `POST` && requestUrl.pathname === `/register`) {
      const body = await readJsonBody<ExpoRuntimeRegistration>(request)
      if (body?.sessionId !== this.sessionId) {
        jsonResponse(response, 400, {
          error: `Unexpected Expo runtime session id`,
        })
        return
      }

      this.sessionReady.resolve()
      jsonResponse(response, 200, { ok: true })
      return
    }

    if (request.method === `GET` && requestUrl.pathname === `/next-command`) {
      const pending = this.pendingCommands.shift()
      if (!pending) {
        response.statusCode = 204
        response.end()
        return
      }

      jsonResponse(response, 200, pending.command)
      return
    }

    if (
      request.method === `POST` &&
      requestUrl.pathname === `/command-result`
    ) {
      const body = await readJsonBody<ExpoRuntimeCommandResult>(request)
      if (!body) {
        jsonResponse(response, 400, { error: `Missing command result payload` })
        return
      }

      const pending = this.pendingByCommandId.get(body.commandId)
      if (!pending) {
        jsonResponse(response, 404, { error: `Unknown command id` })
        return
      }

      this.pendingByCommandId.delete(body.commandId)
      if (body.ok) {
        pending.deferred.resolve(body.result)
      } else {
        pending.deferred.reject(new Error(body.error))
      }

      jsonResponse(response, 200, { ok: true })
      return
    }

    jsonResponse(response, 404, { error: `Unknown bridge route` })
  }

  private dispose(): void {
    if (this.childProcess && !this.childProcess.killed) {
      this.childProcess.kill(`SIGTERM`)
    }
  }
}

export async function ensureExpoEmulatorRuntime(
  platform: RuntimePlatform,
): Promise<ExpoEmulatorRuntime> {
  return ExpoEmulatorRuntime.get(platform)
}
