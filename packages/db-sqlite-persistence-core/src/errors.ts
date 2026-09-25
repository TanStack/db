import { TanStackDBError } from '@tanstack/db'

export class PersistedCollectionCoreError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `PersistedCollectionCoreError`
  }
}

export class InvalidPersistedCollectionConfigError extends PersistedCollectionCoreError {
  constructor(message: string) {
    super(message)
    this.name = `InvalidPersistedCollectionConfigError`
  }
}

export class InvalidSyncConfigError extends InvalidPersistedCollectionConfigError {
  constructor(details?: string) {
    super(
      details
        ? `Invalid sync config: ${details}`
        : `Invalid sync config: expected an object with a callable sync function`,
    )
    this.name = `InvalidSyncConfigError`
  }
}

export class InvalidPersistedCollectionCoordinatorError extends InvalidPersistedCollectionConfigError {
  constructor(methodName: string) {
    super(
      `Invalid persisted collection coordinator: missing required "${methodName}" method`,
    )
    this.name = `InvalidPersistedCollectionCoordinatorError`
  }
}

export class InvalidPersistenceAdapterError extends InvalidPersistedCollectionConfigError {
  constructor(methodName: string) {
    super(
      `Invalid persistence adapter: missing required "${methodName}" method`,
    )
    this.name = `InvalidPersistenceAdapterError`
  }
}

export type PersistedCollectionDurabilityErrorOptions = {
  cause?: unknown
  code?: unknown
  path?: unknown
}

export class PersistedCollectionDurabilityError extends PersistedCollectionCoreError {
  override readonly cause: unknown
  readonly code: unknown
  readonly path: unknown

  constructor(
    message: string,
    options: PersistedCollectionDurabilityErrorOptions = {},
  ) {
    super(message)
    this.name = `PersistedCollectionDurabilityError`
    this.cause = options.cause
    this.code = options.code
    this.path = options.path
  }
}

export function toPersistedCollectionDurabilityError(
  collectionId: string,
  cause: unknown,
): PersistedCollectionDurabilityError {
  if (cause instanceof PersistedCollectionDurabilityError) {
    return cause
  }

  const details =
    typeof cause === `object` && cause !== null
      ? (cause as Record<string, unknown>)
      : undefined
  const message = cause instanceof Error ? cause.message : String(cause)
  return new PersistedCollectionDurabilityError(
    `Failed to durably persist collection "${collectionId}": ${message}`,
    {
      cause,
      code: details?.code,
      path: details?.path,
    },
  )
}

export type IndeterminateCommitRequestType =
  | `rpc:applyLocalMutations:req`
  | `rpc:applyCommittedTx:req`

export type IndeterminateCommitErrorOptions = {
  collectionId: string
  requestType: IndeterminateCommitRequestType
  previousLeaderId: string | null
  previousTerm: number | null
  currentLeaderId: string | null
  currentTerm: number | null
  cause: unknown
}

export class IndeterminateCommitError extends PersistedCollectionCoreError {
  readonly code: `INDETERMINATE_COMMIT` = `INDETERMINATE_COMMIT`
  readonly collectionId: string
  readonly requestType: IndeterminateCommitRequestType
  readonly previousLeaderId: string | null
  readonly previousTerm: number | null
  readonly currentLeaderId: string | null
  readonly currentTerm: number | null
  override readonly cause: unknown

  constructor(options: IndeterminateCommitErrorOptions) {
    super(
      `Commit outcome is indeterminate for collection "${options.collectionId}": ${options.requestType} crossed leadership from ${formatLeader(options.previousLeaderId, options.previousTerm)} to ${formatLeader(options.currentLeaderId, options.currentTerm)}`,
    )
    this.name = `IndeterminateCommitError`
    this.collectionId = options.collectionId
    this.requestType = options.requestType
    this.previousLeaderId = options.previousLeaderId
    this.previousTerm = options.previousTerm
    this.currentLeaderId = options.currentLeaderId
    this.currentTerm = options.currentTerm
    this.cause = options.cause
  }
}

function formatLeader(leaderId: string | null, term: number | null): string {
  return `${leaderId ?? `unknown leader`} (term ${term ?? `unknown`})`
}

export class DuplicateRemoteSubsetOwnerError extends PersistedCollectionCoreError {
  readonly collectionId: string

  constructor(collectionId: string) {
    super(
      `A remote subset owner is already registered for collection "${collectionId}"`,
    )
    this.name = `DuplicateRemoteSubsetOwnerError`
    this.collectionId = collectionId
  }
}

export class RetryableRemoteSubsetAcquisitionError extends PersistedCollectionCoreError {
  override readonly cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = `RetryableRemoteSubsetAcquisitionError`
    this.cause = cause
  }
}

export class InvalidPersistedStorageKeyError extends InvalidPersistedCollectionConfigError {
  constructor(key: string | number) {
    super(
      `Invalid persisted storage key "${String(key)}": numeric keys must be finite`,
    )
    this.name = `InvalidPersistedStorageKeyError`
  }
}

export class InvalidPersistedStorageKeyEncodingError extends InvalidPersistedCollectionConfigError {
  constructor(encoded: string) {
    super(
      `Invalid persisted storage key encoding "${encoded}": expected prefix "n:" or "s:"`,
    )
    this.name = `InvalidPersistedStorageKeyEncodingError`
  }
}

export class PersistenceUnavailableError extends PersistedCollectionCoreError {
  constructor(details?: string) {
    super(
      details
        ? `Persistence unavailable: ${details}`
        : `Persistence unavailable in this runtime`,
    )
    this.name = `PersistenceUnavailableError`
  }
}

/**
 * @deprecated Retained for compatibility with earlier PR-preview builds.
 * Current persistence failures use `PersistedCollectionDurabilityError`.
 */
export class PersistenceDurabilityError extends PersistedCollectionCoreError {
  readonly code: string | undefined
  readonly path: string

  constructor(cause: unknown, fallbackPath: string) {
    const causeMessage =
      cause instanceof Error ? cause.message : `Unknown persistence failure`
    const causeRecord =
      typeof cause === `object` && cause !== null
        ? (cause as Record<string, unknown>)
        : undefined
    const code =
      typeof causeRecord?.code === `string` ? causeRecord.code : undefined
    const path =
      typeof causeRecord?.path === `string` ? causeRecord.path : fallbackPath

    super(`Persistence durability failed at ${path}: ${causeMessage}`)
    this.name = `PersistenceDurabilityError`
    this.cause = cause
    this.code = code
    this.path = path
  }
}
