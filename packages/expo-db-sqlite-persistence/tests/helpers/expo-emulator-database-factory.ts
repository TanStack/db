import { ensureExpoEmulatorRuntime } from './expo-emulator-runtime'
import type {
  ExpoSQLiteTestDatabase,
  ExpoSQLiteTestDatabaseFactory,
} from './expo-sqlite-test-db'
import type {
  ExpoSQLiteBindParams,
  ExpoSQLiteTransaction,
} from '../../src/expo-sqlite-driver'

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
      | Promise<
          ReturnType<
            Awaited<
              ReturnType<typeof ensureExpoEmulatorRuntime>
            >[`createDatabase`]
          >
        >
      | undefined

    const getDatabase = () => {
      databasePromise ??= getRuntime().then((runtime) =>
        runtime.createDatabase(options),
      )
      return databasePromise
    }

    return {
      execAsync: async (sql: string) => {
        await (await getDatabase()).execAsync(sql)
      },
      getAllAsync: async <T>(sql: string, params?: ExpoSQLiteBindParams) =>
        (await getDatabase()).getAllAsync<T>(sql, params),
      runAsync: async (sql: string, params?: ExpoSQLiteBindParams) =>
        (await getDatabase()).runAsync(sql, params),
      withExclusiveTransactionAsync: async <T>(
        task: (transaction: ExpoSQLiteTransaction) => Promise<T>,
      ): Promise<T> =>
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
