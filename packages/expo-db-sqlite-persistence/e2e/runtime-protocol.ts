export type ExpoRuntimeCommand =
  | {
      id: string
      type: `db:exec`
      databaseId: string
      databaseName: string
      sql: string
    }
  | {
      id: string
      type: `db:getAll`
      databaseId: string
      databaseName: string
      sql: string
      params?: ReadonlyArray<unknown> | Record<string, unknown>
    }
  | {
      id: string
      type: `db:run`
      databaseId: string
      databaseName: string
      sql: string
      params?: ReadonlyArray<unknown> | Record<string, unknown>
    }
  | {
      id: string
      type: `db:close`
      databaseId: string
      databaseName: string
    }
  | {
      id: string
      type: `tx:start`
      databaseId: string
      databaseName: string
      transactionId: string
    }
  | {
      id: string
      type: `tx:exec`
      transactionId: string
      sql: string
    }
  | {
      id: string
      type: `tx:getAll`
      transactionId: string
      sql: string
      params?: ReadonlyArray<unknown> | Record<string, unknown>
    }
  | {
      id: string
      type: `tx:run`
      transactionId: string
      sql: string
      params?: ReadonlyArray<unknown> | Record<string, unknown>
    }
  | {
      id: string
      type: `tx:commit`
      transactionId: string
    }
  | {
      id: string
      type: `tx:rollback`
      transactionId: string
    }
  | {
      id: string
      type: `app:runPersistenceSmokeTest`
      databaseName: string
    }

export type ExpoRuntimeCommandResult =
  | {
      commandId: string
      ok: true
      result?: unknown
    }
  | {
      commandId: string
      ok: false
      error: string
    }

export type ExpoRuntimeRegistration = {
  sessionId: string
  platform: string
}

export type ExpoRuntimeSmokeTestResult = {
  insertedTitle: string
  reloadedCount: number
}
