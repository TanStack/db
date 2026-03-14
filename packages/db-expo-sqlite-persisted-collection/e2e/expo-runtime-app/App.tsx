import React, { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import * as SQLite from 'expo-sqlite'
import { createCollection } from '@tanstack/db'
import {
  createExpoSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/db-expo-sqlite-persisted-collection'
import type {
  ExpoRuntimeCommand,
  ExpoRuntimeCommandResult,
  ExpoRuntimeRegistration,
  ExpoRuntimeSmokeTestResult,
} from '../runtime-protocol'

type DatabaseHandle = Awaited<ReturnType<typeof SQLite.openDatabaseAsync>>
type TransactionHandleLike = {
  execAsync: (sql: string) => Promise<void>
  getAllAsync: (
    sql: string,
    params?: ReadonlyArray<unknown> | Record<string, unknown>,
  ) => Promise<ReadonlyArray<unknown>>
  runAsync: (
    sql: string,
    params?: ReadonlyArray<unknown> | Record<string, unknown>,
  ) => Promise<unknown>
}

type ActiveTransaction = {
  transaction: TransactionHandleLike
  complete: {
    resolve: () => void
    reject: (error?: unknown) => void
    promise: Promise<void>
  }
  taskPromise: Promise<void>
}

function createDeferred() {
  let resolve!: () => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<void>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { resolve, reject, promise }
}

async function postJson<TBody extends object>(
  url: string,
  body: TBody,
): Promise<void> {
  const response = await fetch(url, {
    method: `POST`,
    headers: {
      'content-type': `application/json`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`POST ${url} failed with status ${response.status}`)
  }
}

function normalizeSqliteParams(
  params?: ReadonlyArray<unknown> | Record<string, unknown>,
): ReadonlyArray<unknown> | Record<string, unknown> | undefined {
  return params === undefined ? undefined : params
}

async function closeDatabaseHandle(database: DatabaseHandle): Promise<void> {
  const closableDatabase = database as DatabaseHandle & {
    closeAsync?: () => Promise<void>
  }

  if (typeof closableDatabase.closeAsync === `function`) {
    await closableDatabase.closeAsync()
  }
}

export default function App() {
  const bridgeUrl = process.env.EXPO_PUBLIC_TSDB_BRIDGE_URL
  const sessionId = process.env.EXPO_PUBLIC_TSDB_SESSION_ID
  const [statusLines, setStatusLines] = useState<Array<string>>([
    `booting Expo SQLite runtime bridge`,
  ])

  const log = (message: string) => {
    setStatusLines((currentLines) => [...currentLines, message])
  }

  const databaseHandles = useMemo(
    () => new Map<string, DatabaseHandle>(),
    [],
  )
  const activeTransactions = useMemo(
    () => new Map<string, ActiveTransaction>(),
    [],
  )

  useEffect(() => {
    if (!bridgeUrl || !sessionId) {
      log(`missing bridge env vars`)
      return
    }

    let disposed = false

    const getDatabase = async (
      databaseId: string,
      databaseName: string,
    ): Promise<DatabaseHandle> => {
      const existingDatabase = databaseHandles.get(databaseId)
      if (existingDatabase) {
        return existingDatabase
      }

      const database = await SQLite.openDatabaseAsync(databaseName)
      databaseHandles.set(databaseId, database)
      return database
    }

    const reportResult = async (
      result: ExpoRuntimeCommandResult,
    ): Promise<void> => {
      await postJson(`${bridgeUrl}/command-result`, result)
    }

    const executeSmokeTest = async (
      databaseName: string,
    ): Promise<ExpoRuntimeSmokeTestResult> => {
      const database = await SQLite.openDatabaseAsync(databaseName)
      const collectionId = `expo-runtime-smoke-${Date.now().toString(36)}`
      const persistence = createExpoSQLitePersistence<{
        id: string
        title: string
        score: number
      }, string>({
        database,
      })
      const collection = createCollection(
        persistedCollectionOptions<{
          id: string
          title: string
          score: number
        }, string>({
          id: collectionId,
          getKey: (todo) => todo.id,
          persistence,
          syncMode: `eager`,
        }),
      )

      try {
        await collection.stateWhenReady()
        const insertTx = collection.insert({
          id: `1`,
          title: `Persisted from Expo runtime`,
          score: 7,
        })
        await insertTx.isPersisted.promise
        await collection.cleanup()
        collection.startSyncImmediate()
        await collection.stateWhenReady()

        const reloadedRows = await persistence.adapter.loadSubset(collectionId, {})
        return {
          insertedTitle: `Persisted from Expo runtime`,
          reloadedCount: reloadedRows.length,
        }
      } finally {
        await collection.cleanup()
        await closeDatabaseHandle(database)
      }
    }

    const handleCommand = async (command: ExpoRuntimeCommand): Promise<unknown> => {
      switch (command.type) {
        case `db:exec`: {
          const database = await getDatabase(command.databaseId, command.databaseName)
          await database.execAsync(command.sql)
          return undefined
        }
        case `db:getAll`: {
          const database = await getDatabase(command.databaseId, command.databaseName)
          const params = normalizeSqliteParams(command.params)
          return params === undefined
            ? database.getAllAsync(command.sql)
            : database.getAllAsync(command.sql, params)
        }
        case `db:run`: {
          const database = await getDatabase(command.databaseId, command.databaseName)
          const params = normalizeSqliteParams(command.params)
          return params === undefined
            ? database.runAsync(command.sql)
            : database.runAsync(command.sql, params)
        }
        case `db:close`: {
          const database = databaseHandles.get(command.databaseId)
          databaseHandles.delete(command.databaseId)
          if (database) {
            await closeDatabaseHandle(database)
          }
          return undefined
        }
        case `tx:start`: {
          const database = await getDatabase(command.databaseId, command.databaseName)
          const complete = createDeferred()
          let readyResolve!: () => void
          let readyReject!: (error?: unknown) => void
          const readyPromise = new Promise<void>((resolve, reject) => {
            readyResolve = resolve
            readyReject = reject
          })
          const activeTransaction: ActiveTransaction = {
            transaction: undefined as never,
            complete,
            taskPromise: Promise.resolve(),
          }
          activeTransaction.taskPromise = database
            .withExclusiveTransactionAsync(async (transaction) => {
              activeTransaction.transaction = transaction
              activeTransactions.set(command.transactionId, activeTransaction)
              readyResolve()
              try {
                await complete.promise
              } finally {
                activeTransactions.delete(command.transactionId)
              }
            })
            .catch((error) => {
              readyReject(error)
              throw error
            })

          await readyPromise
          return undefined
        }
        case `tx:exec`: {
          const transaction = activeTransactions.get(command.transactionId)
          if (!transaction) {
            throw new Error(`Unknown transaction id`)
          }
          await transaction.transaction.execAsync(command.sql)
          return undefined
        }
        case `tx:getAll`: {
          const transaction = activeTransactions.get(command.transactionId)
          if (!transaction) {
            throw new Error(`Unknown transaction id`)
          }
          const params = normalizeSqliteParams(command.params)
          return params === undefined
            ? transaction.transaction.getAllAsync(command.sql)
            : transaction.transaction.getAllAsync(command.sql, params)
        }
        case `tx:run`: {
          const transaction = activeTransactions.get(command.transactionId)
          if (!transaction) {
            throw new Error(`Unknown transaction id`)
          }
          const params = normalizeSqliteParams(command.params)
          return params === undefined
            ? transaction.transaction.runAsync(command.sql)
            : transaction.transaction.runAsync(command.sql, params)
        }
        case `tx:commit`: {
          const transaction = activeTransactions.get(command.transactionId)
          if (!transaction) {
            throw new Error(`Unknown transaction id`)
          }
          transaction.complete.resolve()
          await transaction.taskPromise
          return undefined
        }
        case `tx:rollback`: {
          const transaction = activeTransactions.get(command.transactionId)
          if (!transaction) {
            throw new Error(`Unknown transaction id`)
          }
          transaction.complete.reject(new Error(`Host requested rollback`))
          await transaction.taskPromise.catch(() => undefined)
          return undefined
        }
        case `app:runPersistenceSmokeTest`:
          return executeSmokeTest(command.databaseName)
        default:
          throw new Error(`Unsupported command type`)
      }
    }

    const register = async (): Promise<void> => {
      const registration: ExpoRuntimeRegistration = {
        sessionId,
        platform: process.env.EXPO_PUBLIC_TSDB_RUNTIME_PLATFORM ?? `unknown`,
      }
      await postJson(`${bridgeUrl}/register`, registration)
      log(`registered with host bridge`)
    }

    const pollCommands = async (): Promise<void> => {
      while (!disposed) {
        const response = await fetch(`${bridgeUrl}/next-command`)
        if (response.status === 204) {
          await new Promise((resolve) => setTimeout(resolve, 200))
          continue
        }

        if (!response.ok) {
          throw new Error(
            `Host bridge command poll failed with status ${response.status}`,
          )
        }

        const command = (await response.json()) as ExpoRuntimeCommand
        try {
          const result = await handleCommand(command)
          await reportResult({
            commandId: command.id,
            ok: true,
            result,
          })
        } catch (error) {
          await reportResult({
            commandId: command.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    void (async () => {
      try {
        await register()
        await pollCommands()
      } catch (error) {
        log(
          `runtime bridge failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    })()

    return () => {
      disposed = true
    }
  }, [activeTransactions, bridgeUrl, databaseHandles, sessionId])

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: `#111827`,
        paddingTop: 64,
        paddingHorizontal: 24,
      }}
    >
      <Text
        style={{
          color: `#f9fafb`,
          fontSize: 24,
          fontWeight: `700`,
          marginBottom: 12,
        }}
      >
        Expo SQLite Runtime Bridge
      </Text>
      <ScrollView
        style={{
          flex: 1,
        }}
      >
        {statusLines.map((line, index) => (
          <Text
            key={`${index}:${line}`}
            style={{
              color: `#d1d5db`,
              fontSize: 14,
              marginBottom: 8,
            }}
          >
            {line}
          </Text>
        ))}
      </ScrollView>
    </View>
  )
}
