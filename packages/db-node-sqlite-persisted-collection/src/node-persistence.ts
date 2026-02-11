import {
  SingleProcessCoordinator,
  createSQLiteCorePersistenceAdapter,
} from '@tanstack/db-sqlite-persisted-collection-core'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionMode,
  PersistedCollectionPersistence,
  PersistenceAdapter,
  SQLiteCoreAdapterOptions,
  SQLiteDriver,
  SQLitePullSinceResult,
} from '@tanstack/db-sqlite-persisted-collection-core'

type NodeSQLiteCoreSchemaMismatchPolicy =
  | `sync-present-reset`
  | `sync-absent-error`
  | `reset`

export type NodeSQLiteSchemaMismatchPolicy =
  | NodeSQLiteCoreSchemaMismatchPolicy
  | `throw`

export type NodeSQLitePersistenceAdapterOptions = Omit<
  SQLiteCoreAdapterOptions,
  `driver` | `schemaMismatchPolicy`
> & {
  driver: SQLiteDriver
  schemaMismatchPolicy?: NodeSQLiteSchemaMismatchPolicy
}

export type NodeSQLitePersistenceOptions =
  NodeSQLitePersistenceAdapterOptions & {
    coordinator?: PersistedCollectionCoordinator
  }

export type NodeSQLitePersistenceAdapter<
  T extends object,
  TKey extends string | number = string | number,
> = PersistenceAdapter<T, TKey> & {
  pullSince: (
    collectionId: string,
    fromRowVersion: number,
  ) => Promise<SQLitePullSinceResult<TKey>>
}

function normalizeSchemaMismatchPolicy(
  policy: NodeSQLiteSchemaMismatchPolicy,
): NodeSQLiteCoreSchemaMismatchPolicy {
  if (policy === `throw`) {
    return `sync-absent-error`
  }

  return policy
}

function resolveSchemaMismatchPolicy(
  explicitPolicy: NodeSQLiteSchemaMismatchPolicy | undefined,
  mode: PersistedCollectionMode,
): NodeSQLiteCoreSchemaMismatchPolicy {
  if (explicitPolicy) {
    return normalizeSchemaMismatchPolicy(explicitPolicy)
  }

  return mode === `sync-present` ? `sync-present-reset` : `sync-absent-error`
}

export class NodeSQLitePersister {
  private readonly coordinator: PersistedCollectionCoordinator
  private readonly explicitSchemaMismatchPolicy: NodeSQLiteSchemaMismatchPolicy | undefined
  private readonly adapterBaseOptions: Omit<
    NodeSQLitePersistenceAdapterOptions,
    `schemaMismatchPolicy`
  >
  private readonly adaptersBySchemaPolicy = new Map<
    NodeSQLiteCoreSchemaMismatchPolicy,
    PersistenceAdapter<Record<string, unknown>, string | number>
  >()

  constructor(options: NodeSQLitePersistenceOptions) {
    const { coordinator, schemaMismatchPolicy, ...adapterBaseOptions } = options
    this.coordinator = coordinator ?? new SingleProcessCoordinator()
    this.explicitSchemaMismatchPolicy = schemaMismatchPolicy
    this.adapterBaseOptions = adapterBaseOptions
  }

  getAdapter<
    T extends object,
    TKey extends string | number = string | number,
  >(
    mode: PersistedCollectionMode = `sync-absent`,
  ): NodeSQLitePersistenceAdapter<T, TKey> {
    const resolvedSchemaPolicy = resolveSchemaMismatchPolicy(
      this.explicitSchemaMismatchPolicy,
      mode,
    )
    const cachedAdapter = this.adaptersBySchemaPolicy.get(resolvedSchemaPolicy)
    if (cachedAdapter) {
      return cachedAdapter as unknown as NodeSQLitePersistenceAdapter<T, TKey>
    }

    const adapter = createSQLiteCorePersistenceAdapter<
      Record<string, unknown>,
      string | number
    >({
      ...this.adapterBaseOptions,
      schemaMismatchPolicy: resolvedSchemaPolicy,
    })
    this.adaptersBySchemaPolicy.set(resolvedSchemaPolicy, adapter)
    return adapter as unknown as NodeSQLitePersistenceAdapter<T, TKey>
  }

  getPersistence<
    T extends object,
    TKey extends string | number = string | number,
  >(
    mode: PersistedCollectionMode = `sync-absent`,
    coordinator: PersistedCollectionCoordinator = this.coordinator,
  ): PersistedCollectionPersistence<T, TKey> {
    return {
      adapter: this.getAdapter<T, TKey>(mode),
      coordinator,
    }
  }
}

export function createNodeSQLitePersister(
  options: NodeSQLitePersistenceOptions,
): NodeSQLitePersister {
  return new NodeSQLitePersister(options)
}

export function createNodeSQLitePersistenceAdapter<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: NodeSQLitePersistenceAdapterOptions,
): NodeSQLitePersistenceAdapter<T, TKey> {
  const persister = createNodeSQLitePersister(options)
  return persister.getAdapter<T, TKey>(`sync-absent`)
}

/**
 * Returns mode-aware persistence that can be reused across collections.
 * `persistedCollectionOptions` calls `resolvePersistenceForMode` internally.
 */
export function createNodeSQLitePersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: NodeSQLitePersistenceOptions,
): PersistedCollectionPersistence<T, TKey> {
  const persister = createNodeSQLitePersister(options)
  const defaultPersistence = persister.getPersistence<T, TKey>(`sync-absent`)

  return {
    ...defaultPersistence,
    resolvePersistenceForMode: (mode) => persister.getPersistence<T, TKey>(mode),
  }
}
