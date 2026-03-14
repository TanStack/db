import { ensureExpoEmulatorRuntime } from './expo-emulator-runtime'
import type { ExpoSQLiteTestDatabase, ExpoSQLiteTestDatabaseFactory } from './expo-sqlite-test-db'

function resolvePlatform(): `ios` | `android` {
  const platform = process.env.TANSTACK_DB_EXPO_RUNTIME_PLATFORM?.trim()
  return platform === `android` ? `android` : `ios`
}

export function createMobileSQLiteTestDatabaseFactory(): ExpoSQLiteTestDatabaseFactory {
  const platform = resolvePlatform()
  let runtimePromise:
    | Promise<Awaited<ReturnType<typeof ensureExpoEmulatorRuntime>>>
    | undefined

  const getRuntime = () => {
    runtimePromise ??= ensureExpoEmulatorRuntime(platform)
    return runtimePromise
  }

  return (options): ExpoSQLiteTestDatabase => {
    let databasePromise:
      | Promise<ReturnType<Awaited<ReturnType<typeof ensureExpoEmulatorRuntime>>[`createDatabase`]>>
      | undefined

    const getDatabase = () => {
      databasePromise ??= getRuntime().then((runtime) => runtime.createDatabase(options))
      return databasePromise
    }

    return {
      execAsync: async (sql) => {
        await (await getDatabase()).execAsync(sql)
      },
      getAllAsync: async <T>(sql, params) =>
        (await getDatabase()).getAllAsync<T>(sql, params),
      runAsync: async (sql, params) => (await getDatabase()).runAsync(sql, params),
      withExclusiveTransactionAsync: async <T>(task): Promise<T> =>
        (await getDatabase()).withExclusiveTransactionAsync(task),
      closeAsync: async () => {
        if (!databasePromise) {
          return
        }

        await (await databasePromise).closeAsync()
      },
    }
  }
}

export default createMobileSQLiteTestDatabaseFactory
