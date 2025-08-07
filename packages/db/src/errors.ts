// Root error class for all TanStack DB errors
export class TanStackDBError extends Error {
  constructor(message: string) {
    super(message)
    this.name = `TanStackDBError`
  }
}

// Base error classes
export class NonRetriableError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `NonRetriableError`
  }
}

// Schema validation error (exported from index for backward compatibility)
export class SchemaValidationError extends TanStackDBError {
  type: `insert` | `update`
  issues: ReadonlyArray<{
    message: string
    path?: ReadonlyArray<string | number | symbol>
  }>

  constructor(
    type: `insert` | `update`,
    issues: ReadonlyArray<{
      message: string
      path?: ReadonlyArray<string | number | symbol>
    }>,
    message?: string
  ) {
    const defaultMessage = `${type === `insert` ? `Insert` : `Update`} validation failed: ${issues
      .map((issue) => `\n- ${issue.message} - path: ${issue.path}`)
      .join(``)}`

    super(message || defaultMessage)
    this.name = `SchemaValidationError`
    this.type = type
    this.issues = issues
  }
}

// Collection Configuration Errors
export class CollectionConfigurationError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `CollectionConfigurationError`
  }
}

export class CollectionRequiresConfigError extends CollectionConfigurationError {
  constructor() {
    super(`Collection requires a config`)
  }
}

export class CollectionRequiresSyncConfigError extends CollectionConfigurationError {
  constructor() {
    super(`Collection requires a sync config`)
  }
}

export class InvalidSchemaError extends CollectionConfigurationError {
  constructor() {
    super(`Schema must implement the standard-schema interface`)
  }
}

export class SchemaMustBeSynchronousError extends CollectionConfigurationError {
  constructor() {
    super(`Schema validation must be synchronous`)
  }
}

// Collection State Errors
export class CollectionStateError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `CollectionStateError`
  }
}

export class CollectionInErrorStateError extends CollectionStateError {
  constructor(operation: string, collectionId: string) {
    super(
      `Cannot perform ${operation} on collection "${collectionId}" - collection is in error state. Try calling cleanup() and restarting the collection.`
    )
  }
}

export class InvalidCollectionStatusTransitionError extends CollectionStateError {
  constructor(from: string, to: string, collectionId: string) {
    super(
      `Invalid collection status transition from "${from}" to "${to}" for collection "${collectionId}"`
    )
  }
}

export class CollectionIsInErrorStateError extends CollectionStateError {
  constructor() {
    super(`Collection is in error state`)
  }
}

export class NegativeActiveSubscribersError extends CollectionStateError {
  constructor() {
    super(`Active subscribers count is negative - this should never happen`)
  }
}

// Collection Operation Errors
export class CollectionOperationError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `CollectionOperationError`
  }
}

export class UndefinedKeyError extends CollectionOperationError {
  constructor(item: any) {
    super(
      `An object was created without a defined key: ${JSON.stringify(item)}`
    )
  }
}

export class DuplicateKeyError extends CollectionOperationError {
  constructor(key: string | number) {
    super(
      `Cannot insert document with ID "${key}" because it already exists in the collection`
    )
  }
}

export class DuplicateKeySyncError extends CollectionOperationError {
  constructor(key: string | number, collectionId: string) {
    super(
      `Cannot insert document with key "${key}" from sync because it already exists in the collection "${collectionId}"`
    )
  }
}

export class MissingUpdateArgumentError extends CollectionOperationError {
  constructor() {
    super(`The first argument to update is missing`)
  }
}

export class NoKeysPassedToUpdateError extends CollectionOperationError {
  constructor() {
    super(`No keys were passed to update`)
  }
}

export class UpdateKeyNotFoundError extends CollectionOperationError {
  constructor(key: string | number) {
    super(
      `The key "${key}" was passed to update but an object for this key was not found in the collection`
    )
  }
}

export class KeyUpdateNotAllowedError extends CollectionOperationError {
  constructor(originalKey: string | number, newKey: string | number) {
    super(
      `Updating the key of an item is not allowed. Original key: "${originalKey}", Attempted new key: "${newKey}". Please delete the old item and create a new one if a key change is necessary.`
    )
  }
}

export class NoKeysPassedToDeleteError extends CollectionOperationError {
  constructor() {
    super(`No keys were passed to delete`)
  }
}

export class DeleteKeyNotFoundError extends CollectionOperationError {
  constructor(key: string | number) {
    super(
      `Collection.delete was called with key '${key}' but there is no item in the collection with this key`
    )
  }
}

// Collection Handler Errors
export class MissingHandlerError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `MissingHandlerError`
  }
}

export class MissingInsertHandlerError extends MissingHandlerError {
  constructor() {
    super(
      `Collection.insert called directly (not within an explicit transaction) but no 'onInsert' handler is configured.`
    )
  }
}

export class MissingUpdateHandlerError extends MissingHandlerError {
  constructor() {
    super(
      `Collection.update called directly (not within an explicit transaction) but no 'onUpdate' handler is configured.`
    )
  }
}

export class MissingDeleteHandlerError extends MissingHandlerError {
  constructor() {
    super(
      `Collection.delete called directly (not within an explicit transaction) but no 'onDelete' handler is configured.`
    )
  }
}

// Transaction Errors
export class TransactionError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `TransactionError`
  }
}

export class MissingMutationFunctionError extends TransactionError {
  constructor() {
    super(`mutationFn is required when creating a transaction`)
  }
}

export class TransactionNotPendingMutateError extends TransactionError {
  constructor() {
    super(
      `You can no longer call .mutate() as the transaction is no longer pending`
    )
  }
}

export class TransactionAlreadyCompletedRollbackError extends TransactionError {
  constructor() {
    super(
      `You can no longer call .rollback() as the transaction is already completed`
    )
  }
}

export class TransactionNotPendingCommitError extends TransactionError {
  constructor() {
    super(
      `You can no longer call .commit() as the transaction is no longer pending`
    )
  }
}

export class NoPendingSyncTransactionWriteError extends TransactionError {
  constructor() {
    super(`No pending sync transaction to write to`)
  }
}

export class SyncTransactionAlreadyCommittedWriteError extends TransactionError {
  constructor() {
    super(
      `The pending sync transaction is already committed, you can't still write to it.`
    )
  }
}

export class NoPendingSyncTransactionCommitError extends TransactionError {
  constructor() {
    super(`No pending sync transaction to commit`)
  }
}

export class SyncTransactionAlreadyCommittedError extends TransactionError {
  constructor() {
    super(
      `The pending sync transaction is already committed, you can't commit it again.`
    )
  }
}

// Query Builder Errors
export class QueryBuilderError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `QueryBuilderError`
  }
}

export class OnlyOneSourceAllowedError extends QueryBuilderError {
  constructor(context: string) {
    super(`Only one source is allowed in the ${context}`)
  }
}

export class SubQueryMustHaveFromClauseError extends QueryBuilderError {
  constructor(context: string) {
    super(`A sub query passed to a ${context} must have a from clause itself`)
  }
}

export class InvalidSourceError extends QueryBuilderError {
  constructor() {
    super(`Invalid source`)
  }
}

export class JoinConditionMustBeEqualityError extends QueryBuilderError {
  constructor() {
    super(`Join condition must be an equality expression`)
  }
}

export class QueryMustHaveFromClauseError extends QueryBuilderError {
  constructor() {
    super(`Query must have a from clause`)
  }
}

// Query Compilation Errors
export class QueryCompilationError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `QueryCompilationError`
  }
}

export class DistinctRequiresSelectError extends QueryCompilationError {
  constructor() {
    super(`DISTINCT requires a SELECT clause.`)
  }
}

export class HavingRequiresGroupByError extends QueryCompilationError {
  constructor() {
    super(`HAVING clause requires GROUP BY clause`)
  }
}

export class LimitOffsetRequireOrderByError extends QueryCompilationError {
  constructor() {
    super(
      `LIMIT and OFFSET require an ORDER BY clause to ensure deterministic results`
    )
  }
}

export class CollectionInputNotFoundError extends QueryCompilationError {
  constructor(collectionId: string) {
    super(`Input for collection "${collectionId}" not found in inputs map`)
  }
}

export class UnsupportedFromTypeError extends QueryCompilationError {
  constructor(type: string) {
    super(`Unsupported FROM type: ${type}`)
  }
}

export class UnknownExpressionTypeError extends QueryCompilationError {
  constructor(type: string) {
    super(`Unknown expression type: ${type}`)
  }
}

export class EmptyReferencePathError extends QueryCompilationError {
  constructor() {
    super(`Reference path cannot be empty`)
  }
}

export class UnknownFunctionError extends QueryCompilationError {
  constructor(functionName: string) {
    super(`Unknown function: ${functionName}`)
  }
}

// JOIN Operation Errors
export class JoinError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `JoinError`
  }
}

export class UnsupportedJoinTypeError extends JoinError {
  constructor(joinType: string) {
    super(`Unsupported join type: ${joinType}`)
  }
}

export class InvalidJoinConditionSameTableError extends JoinError {
  constructor(tableAlias: string) {
    super(
      `Invalid join condition: both expressions refer to the same table "${tableAlias}"`
    )
  }
}

export class InvalidJoinConditionTableMismatchError extends JoinError {
  constructor(mainTableAlias: string, joinedTableAlias: string) {
    super(
      `Invalid join condition: expressions must reference table aliases "${mainTableAlias}" and "${joinedTableAlias}"`
    )
  }
}

export class InvalidJoinConditionWrongTablesError extends JoinError {
  constructor(
    leftTableAlias: string,
    rightTableAlias: string,
    mainTableAlias: string,
    joinedTableAlias: string
  ) {
    super(
      `Invalid join condition: expressions reference tables "${leftTableAlias}" and "${rightTableAlias}" but join is between "${mainTableAlias}" and "${joinedTableAlias}"`
    )
  }
}

export class UnsupportedJoinSourceTypeError extends JoinError {
  constructor(type: string) {
    super(`Unsupported join source type: ${type}`)
  }
}

// GROUP BY and Aggregation Errors
export class GroupByError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `GroupByError`
  }
}

export class NonAggregateExpressionNotInGroupByError extends GroupByError {
  constructor(alias: string) {
    super(
      `Non-aggregate expression '${alias}' in SELECT must also appear in GROUP BY clause`
    )
  }
}

export class UnsupportedAggregateFunctionError extends GroupByError {
  constructor(functionName: string) {
    super(`Unsupported aggregate function: ${functionName}`)
  }
}

export class AggregateFunctionNotInSelectError extends GroupByError {
  constructor(functionName: string) {
    super(
      `Aggregate function in HAVING clause must also be in SELECT clause: ${functionName}`
    )
  }
}

export class UnknownHavingExpressionTypeError extends GroupByError {
  constructor(type: string) {
    super(`Unknown expression type in HAVING clause: ${type}`)
  }
}

// Storage Errors
export class StorageError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `StorageError`
  }
}

export class SerializationError extends StorageError {
  constructor(operation: string, originalError: string) {
    super(
      `Cannot ${operation} item because it cannot be JSON serialized: ${originalError}`
    )
  }
}

// LocalStorage Collection Errors
export class LocalStorageCollectionError extends StorageError {
  constructor(message: string) {
    super(message)
    this.name = `LocalStorageCollectionError`
  }
}

export class StorageKeyRequiredError extends LocalStorageCollectionError {
  constructor() {
    super(`[LocalStorageCollection] storageKey must be provided.`)
  }
}

export class NoStorageAvailableError extends LocalStorageCollectionError {
  constructor() {
    super(
      `[LocalStorageCollection] No storage available. Please provide a storage option or ensure window.localStorage is available.`
    )
  }
}

export class NoStorageEventApiError extends LocalStorageCollectionError {
  constructor() {
    super(
      `[LocalStorageCollection] No storage event API available. Please provide a storageEventApi option or ensure window is available.`
    )
  }
}

export class InvalidStorageDataFormatError extends LocalStorageCollectionError {
  constructor(storageKey: string, key: string) {
    super(
      `[LocalStorageCollection] Invalid data format in storage key "${storageKey}" for key "${key}".`
    )
  }
}

export class InvalidStorageObjectFormatError extends LocalStorageCollectionError {
  constructor(storageKey: string) {
    super(
      `[LocalStorageCollection] Invalid data format in storage key "${storageKey}". Expected object format.`
    )
  }
}

// Sync Cleanup Errors
export class SyncCleanupError extends TanStackDBError {
  constructor(collectionId: string, error: Error | string) {
    const message = error instanceof Error ? error.message : String(error)
    super(
      `Collection "${collectionId}" sync cleanup function threw an error: ${message}`
    )
    this.name = `SyncCleanupError`
  }
}

// Query Optimizer Errors
export class QueryOptimizerError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `QueryOptimizerError`
  }
}

export class CannotCombineEmptyExpressionListError extends QueryOptimizerError {
  constructor() {
    super(`Cannot combine empty expression list`)
  }
}
