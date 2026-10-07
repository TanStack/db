import { codedMessage, devBuild } from './error-message'

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
    message?: string,
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

// Module Instance Errors
export class DuplicateDbInstanceError extends TanStackDBError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Multiple instances of @tanstack/db detected!\n\n` +
            `This causes transaction context to be lost because each instance maintains ` +
            `its own transaction stack.\n\n` +
            `Common causes:\n` +
            `1. Different versions of @tanstack/db installed\n` +
            `2. Incompatible peer dependency versions in packages\n` +
            `3. Module resolution issues in bundler configuration\n\n` +
            `To fix:\n` +
            `1. Check installed versions: npm list @tanstack/db (or pnpm/yarn list)\n` +
            `2. Force a single version using package manager overrides:\n` +
            `   - npm: "overrides" in package.json\n` +
            `   - pnpm: "pnpm.overrides" in package.json\n` +
            `   - yarn: "resolutions" in package.json\n` +
            `3. Clear node_modules and lockfile, then reinstall\n\n` +
            `To temporarily disable this check (not recommended):\n` +
            `Set environment variable: TANSTACK_DB_DISABLE_DUP_CHECK=1\n\n` +
            `See: https://tanstack.com/db/latest/docs/troubleshooting#duplicate-instances`
        : codedMessage(2),
    )
    this.name = `DuplicateDbInstanceError`
  }
}

// Collection Configuration Errors
export class CollectionConfigurationError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `CollectionConfigurationError`
  }
}

export class InvalidSyncPersistenceCapabilityError extends CollectionConfigurationError {
  constructor(reason: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Invalid sync persistence capability at metadata.persistence: ${reason}. ` +
            `Custom sync wrappers must forward metadata.persistence unchanged.`
        : codedMessage(3, { reason }),
    )
    this.name = `InvalidSyncPersistenceCapabilityError`
  }
}

export class CollectionRequiresConfigError extends CollectionConfigurationError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Collection requires a config`
        : codedMessage(4),
    )
  }
}

export class CollectionRequiresSyncConfigError extends CollectionConfigurationError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Collection requires a sync config`
        : codedMessage(5),
    )
  }
}

export class InvalidSchemaError extends CollectionConfigurationError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Schema must implement the standard-schema interface`
        : codedMessage(6),
    )
  }
}

export class SchemaMustBeSynchronousError extends CollectionConfigurationError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Schema validation must be synchronous`
        : codedMessage(7),
    )
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
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Cannot perform ${operation} on collection "${collectionId}" - collection is in error state. Try calling cleanup() and restarting the collection.`
        : codedMessage(8, { operation, collectionId }),
    )
  }
}

export class InvalidCollectionStatusTransitionError extends CollectionStateError {
  constructor(from: string, to: string, collectionId: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Invalid collection status transition from "${from}" to "${to}" for collection "${collectionId}"`
        : codedMessage(9, { from, to, collectionId }),
    )
  }
}

export class CollectionIsInErrorStateError extends CollectionStateError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Collection is in error state`
        : codedMessage(10),
    )
  }
}

export class NegativeActiveSubscribersError extends CollectionStateError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Active subscribers count is negative - this should never happen`
        : codedMessage(11),
    )
  }
}

export class LiveQueryObserverDisposedError extends CollectionStateError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Cannot subscribe to a disposed LiveQueryObserver`
        : codedMessage(12),
    )
  }
}

export class LiveQueryWindowControllerDisposedError extends CollectionStateError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Cannot subscribe to a disposed LiveQueryWindowController`
        : codedMessage(13),
    )
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
      devBuild() && process.env.NODE_ENV !== `production`
        ? `An object was created without a defined key: ${JSON.stringify(item)}`
        : codedMessage(14, { item }),
    )
  }
}

export class InvalidKeyError extends CollectionOperationError {
  constructor(key: unknown, item: unknown) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `getKey returned an invalid key type. Expected string or number, but got ${key === null ? `null` : typeof key}: ${JSON.stringify(key)}. Item: ${JSON.stringify(item)}`
        : codedMessage(15, { key }),
    )
  }
}

export class DuplicateKeyError extends CollectionOperationError {
  constructor(key: string | number) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Cannot insert document with ID "${key}" because it already exists in the collection`
        : codedMessage(16, { key }),
    )
  }
}

export class DuplicateKeySyncError extends CollectionOperationError {
  constructor(
    key: string | number,
    collectionId: string,
    options?: {
      hasCustomGetKey?: boolean
      hasJoins?: boolean
      hasDistinct?: boolean
    },
  ) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? (() => {
            const base = `Cannot insert document with key "${key}" from sync because it already exists in the collection "${collectionId}"`

            // Provide enhanced guidance when custom getKey is used with distinct
            if (options?.hasCustomGetKey && options.hasDistinct) {
              return (
                `${base}. ` +
                `This collection uses a custom getKey with .distinct(). ` +
                `The .distinct() operator deduplicates by the ENTIRE selected object (standard SQL behavior), ` +
                `but your custom getKey extracts only a subset of fields. This causes multiple distinct rows ` +
                `(with different values in non-key fields) to receive the same key. ` +
                `To fix this, either: (1) ensure your SELECT only includes fields that uniquely identify each row, ` +
                `(2) use .groupBy() with min()/max() aggregates to select one value per group, or ` +
                `(3) remove the custom getKey to use the default key behavior.`
              )
            }
            if (options?.hasCustomGetKey && options.hasJoins) {
              // Provide enhanced guidance when custom getKey is used with joins
              return (
                `${base}. ` +
                `This collection uses a custom getKey with joined queries. ` +
                `Joined queries can produce multiple rows with the same key when relationships are not 1:1. ` +
                `Consider: (1) using a composite key in your getKey function (e.g., \`\${item.key1}-\${item.key2}\`), ` +
                `(2) ensuring your join produces unique rows per key, or (3) removing the custom getKey ` +
                `to use the default composite key behavior.`
              )
            }
            return base
          })()
        : codedMessage(17, { key, collectionId, ...options }),
    )
  }
}

export class MissingUpdateArgumentError extends CollectionOperationError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `The first argument to update is missing`
        : codedMessage(18),
    )
  }
}

export class NoKeysPassedToUpdateError extends CollectionOperationError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `No keys were passed to update`
        : codedMessage(19),
    )
  }
}

export class UpdateKeyNotFoundError extends CollectionOperationError {
  constructor(key: string | number) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `The key "${key}" was passed to update but an object for this key was not found in the collection`
        : codedMessage(20, { key }),
    )
  }
}

export class KeyUpdateNotAllowedError extends CollectionOperationError {
  constructor(originalKey: string | number, newKey: string | number) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Updating the key of an item is not allowed. Original key: "${originalKey}", Attempted new key: "${newKey}". Please delete the old item and create a new one if a key change is necessary.`
        : codedMessage(21, { originalKey, newKey }),
    )
  }
}

export class NoKeysPassedToDeleteError extends CollectionOperationError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `No keys were passed to delete`
        : codedMessage(22),
    )
  }
}

export class DeleteKeyNotFoundError extends CollectionOperationError {
  constructor(key: string | number) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Collection.delete was called with key '${key}' but there is no item in the collection with this key`
        : codedMessage(23, { key }),
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
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Collection.insert called directly (not within an explicit transaction) but no 'onInsert' handler is configured.`
        : codedMessage(24),
    )
  }
}

export class MissingUpdateHandlerError extends MissingHandlerError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Collection.update called directly (not within an explicit transaction) but no 'onUpdate' handler is configured.`
        : codedMessage(25),
    )
  }
}

export class MissingDeleteHandlerError extends MissingHandlerError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Collection.delete called directly (not within an explicit transaction) but no 'onDelete' handler is configured.`
        : codedMessage(26),
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

export class PacedTransactionManualCommitError extends TransactionError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Paced mutations are committed by their strategy. Await the transaction receipt or roll it back instead.`
        : codedMessage(86),
    )
    this.name = `PacedTransactionManualCommitError`
  }
}

export class QueueCapacityExceededError extends TransactionError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Queue capacity exceeded; the mutation was not admitted`
        : codedMessage(27),
    )
    this.name = `QueueCapacityExceededError`
  }
}

export class QueueDisposedError extends TransactionError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Queue has been cleaned up; the mutation was not admitted`
        : codedMessage(28),
    )
    this.name = `QueueDisposedError`
  }
}

export class ThrottleCallDroppedError extends TransactionError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Throttle call was dropped because trailing execution is disabled`
        : codedMessage(29),
    )
    this.name = `ThrottleCallDroppedError`
  }
}

export class DebounceCallDroppedError extends TransactionError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Debounce call was dropped because trailing execution is disabled`
        : codedMessage(30),
    )
    this.name = `DebounceCallDroppedError`
  }
}

export class MissingMutationFunctionError extends TransactionError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `mutationFn is required when creating a transaction`
        : codedMessage(31),
    )
  }
}

export class OnMutateMustBeSynchronousError extends TransactionError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `onMutate must be synchronous and cannot return a promise. Remove async/await or returned promises from onMutate.`
        : codedMessage(32),
    )
    this.name = `OnMutateMustBeSynchronousError`
  }
}

export class TransactionNotPendingMutateError extends TransactionError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `You can no longer call .mutate() as the transaction is no longer pending`
        : codedMessage(33),
    )
  }
}

export class TransactionAlreadyCompletedRollbackError extends TransactionError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `You can no longer call .rollback() as the transaction is already completed`
        : codedMessage(34),
    )
  }
}

export class TransactionNotPendingCommitError extends TransactionError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `You can no longer call .commit() as the transaction is no longer pending`
        : codedMessage(35),
    )
  }
}

export class NoPendingSyncTransactionWriteError extends TransactionError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `No pending sync transaction to write to`
        : codedMessage(36),
    )
  }
}

export class SyncTransactionAlreadyCommittedWriteError extends TransactionError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `The pending sync transaction is already committed, you can't still write to it.`
        : codedMessage(37),
    )
  }
}

export class SyncRowReusedWithoutPreviousValueError extends TransactionError {
  constructor(key: string | number) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `A sync update for key "${key}" wrote a row object that changed in place since it was last written. ` +
            `The change overwrote the row's previous value. ` +
            `Write a new object, or pass the row's previous value as \`previousValue\`.`
        : codedMessage(38, { key }),
    )
  }
}

export class NoPendingSyncTransactionCommitError extends TransactionError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `No pending sync transaction to commit`
        : codedMessage(39),
    )
  }
}

export class SyncTransactionAlreadyCommittedError extends TransactionError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `The pending sync transaction is already committed, you can't commit it again.`
        : codedMessage(40),
    )
  }
}

/**
 * An internal sync-queue invariant failed: a cancel targeted a transaction
 * that is not the open last one, or replaying the queue invalidated a
 * transaction. No public path should reach this.
 */
export class SyncQueueInvariantError extends TransactionError {
  constructor(detail: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Sync queue invariant failed: ${detail}`
        : codedMessage(41, { detail }),
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
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Only one source is allowed in the ${context}`
        : codedMessage(42, { context }),
    )
  }
}

export class SubQueryMustHaveFromClauseError extends QueryBuilderError {
  constructor(context: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `A sub query passed to a ${context} must have a from clause itself`
        : codedMessage(43, { context }),
    )
  }
}

export class InvalidSourceError extends QueryBuilderError {
  constructor(alias: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Invalid source for live query: The value provided for alias "${alias}" is not a Collection or subquery. Live queries only accept Collection instances or subqueries. Please ensure you're passing a valid Collection or QueryBuilder, not a plain array or other data type.`
        : codedMessage(44, { alias }),
    )
  }
}

export type SourceClauseContext =
  | `from clause`
  | `unionAll clause`
  | `join clause`

export class InvalidSourceTypeError extends QueryBuilderError {
  constructor(context: SourceClauseContext, type: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? (() => {
            const expected =
              context === `unionAll clause`
                ? `an object with one or more key-value pairs like { alias: collection }`
                : `an object with a single key-value pair like { alias: collection }`
            const example =
              context === `unionAll clause`
                ? `.unionAll({ todos: todosCollection, events: eventsCollection })`
                : context === `join clause`
                  ? `.join({ todos: todosCollection }, ({ todo, todos }) => eq(todo.id, todos.id))`
                  : `.from({ todos: todosCollection })`
            return (
              `Invalid source for ${context}: Expected ${expected}. ` +
              `For example: ${example}. Got: ${type}`
            )
          })()
        : codedMessage(45, { context, type }),
    )
  }
}

export class JoinConditionMustBeEqualityError extends QueryBuilderError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Join condition must be an equality expression or a nonempty conjunction of equality expressions`
        : codedMessage(46),
    )
  }
}

export class QueryMustHaveFromClauseError extends QueryBuilderError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Query must have a from clause`
        : codedMessage(47),
    )
  }
}

export class InvalidWhereExpressionError extends QueryBuilderError {
  constructor(valueType: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Invalid where() expression: Expected a query expression, but received a ${valueType}. ` +
            `This usually happens when using JavaScript's comparison operators (===, !==, <, >, etc.) directly. ` +
            `Instead, use the query builder functions:\n\n` +
            `  ❌ .where(({ user }) => user.id === 'abc')\n` +
            `  ✅ .where(({ user }) => eq(user.id, 'abc'))\n\n` +
            `Available comparison functions: eq, gt, gte, lt, lte, and, or, not, like, ilike, isNull, isUndefined`
        : codedMessage(48, { valueType }),
    )
  }
}

// Query Compilation Errors
export class QueryCompilationError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `QueryCompilationError`
  }
}

export class UnsafeAliasPathError extends QueryCompilationError {
  constructor(segment: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Unsafe alias path segment "${segment}" is not allowed in .select(). ` +
            `Aliases must not contain "__proto__", "prototype", or "constructor".`
        : codedMessage(49, { segment }),
    )
    this.name = `UnsafeAliasPathError`
  }
}

export class DistinctRequiresSelectError extends QueryCompilationError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `DISTINCT requires a SELECT clause.`
        : codedMessage(50),
    )
  }
}

export class FnSelectWithGroupByError extends QueryCompilationError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `fn.select() cannot be used with groupBy(). ` +
            `groupBy requires the compiler to statically analyze aggregate functions (count, sum, max, etc.) in the SELECT clause, ` +
            `which is not possible with fn.select() since it is an opaque function. ` +
            `Use .select() instead of .fn.select() when combining with groupBy().`
        : codedMessage(51),
    )
  }
}

export class UnsupportedFnSelectResultError extends QueryCompilationError {
  constructor(valueDescription: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `fn.select() cannot return ${valueDescription}. ` +
            `Child query builders, query expressions, and helpers such as eq(), toArray(), materialize(), concat(toArray()), and caseWhen() are query-construction values. ` +
            `Use them as direct fields in .select() instead.`
        : codedMessage(52, { valueDescription }),
    )
  }
}

export class UnsupportedRootScalarSelectError extends QueryCompilationError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Top-level scalar select() is not supported by createLiveQueryCollection() or queryOnce(). ` +
            `Return an object from .select(), or use the scalar query inside toArray(...) or concat(toArray(...)).`
        : codedMessage(53),
    )
  }
}

export class HavingRequiresGroupByError extends QueryCompilationError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `HAVING clause requires GROUP BY clause`
        : codedMessage(54),
    )
  }
}

export class LimitOffsetRequireOrderByError extends QueryCompilationError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `LIMIT and OFFSET require an ORDER BY clause to ensure deterministic results`
        : codedMessage(55),
    )
  }
}

/**
 * Error thrown when a collection input stream is not found during query compilation.
 * In self-joins, each alias (e.g., 'employee', 'manager') requires its own input stream.
 */
export class CollectionInputNotFoundError extends QueryCompilationError {
  constructor(
    alias: string,
    collectionId?: string,
    availableKeys?: Array<string>,
  ) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? (() => {
            const details = collectionId
              ? `alias "${alias}" (collection "${collectionId}")`
              : `collection "${alias}"`
            const availableKeysMsg = availableKeys?.length
              ? `. Available keys: ${availableKeys.join(`, `)}`
              : ``
            return `Input for ${details} not found in inputs map${availableKeysMsg}`
          })()
        : codedMessage(56, {
            alias,
            collectionId,
            availableKeys,
          }),
    )
  }
}

/**
 * Error thrown when a subquery uses the same alias as its parent query.
 * This causes issues because parent and subquery would share the same input streams,
 * leading to empty results or incorrect data (aggregation cross-leaking).
 */
export class DuplicateAliasInSubqueryError extends QueryCompilationError {
  constructor(alias: string, parentAliases: Array<string>) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Subquery uses alias "${alias}" which is already used in the parent query. ` +
            `Each alias must be unique across parent and subquery contexts. ` +
            `Parent query aliases: ${parentAliases.join(`, `)}. ` +
            `Please rename "${alias}" in either the parent query or subquery to avoid conflicts.`
        : codedMessage(57, { alias, parentAliases }),
    )
  }
}

export class UnsupportedFromTypeError extends QueryCompilationError {
  constructor(type: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Unsupported FROM type: ${type}`
        : codedMessage(58, { type }),
    )
  }
}

export class UnknownExpressionTypeError extends QueryCompilationError {
  constructor(type: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Unknown expression type: ${type}`
        : codedMessage(59, { type }),
    )
  }
}

export class EmptyReferencePathError extends QueryCompilationError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Reference path cannot be empty`
        : codedMessage(60),
    )
  }
}

export class UnknownFunctionError extends QueryCompilationError {
  constructor(functionName: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Unknown function: ${functionName}`
        : codedMessage(61, { functionName }),
    )
  }
}

export class JoinCollectionNotFoundError extends QueryCompilationError {
  constructor(collectionId: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Collection "${collectionId}" not found during compilation of join`
        : codedMessage(62, { collectionId }),
    )
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
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Unsupported join type: ${joinType}`
        : codedMessage(63, { joinType }),
    )
  }
}

export class InvalidJoinConditionSameSourceError extends JoinError {
  constructor(sourceAlias: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Invalid join condition: both expressions refer to the same source "${sourceAlias}"`
        : codedMessage(64, { sourceAlias }),
    )
  }
}

export class InvalidJoinConditionSourceMismatchError extends JoinError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Invalid join condition: expressions must reference source aliases`
        : codedMessage(65),
    )
  }
}

export class InvalidJoinConditionLeftSourceError extends JoinError {
  constructor(sourceAlias: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Invalid join condition: left expression refers to an unavailable source "${sourceAlias}"`
        : codedMessage(66, { sourceAlias }),
    )
  }
}

export class InvalidJoinConditionRightSourceError extends JoinError {
  constructor(sourceAlias: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Invalid join condition: right expression does not refer to the joined source "${sourceAlias}"`
        : codedMessage(67, { sourceAlias }),
    )
  }
}

export class InvalidJoinCondition extends JoinError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Invalid join condition`
        : codedMessage(68),
    )
  }
}

export class UnsupportedJoinSourceTypeError extends JoinError {
  constructor(type: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Unsupported join source type: ${type}`
        : codedMessage(69, { type }),
    )
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
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Non-aggregate expression '${alias}' in SELECT must also appear in GROUP BY clause`
        : codedMessage(70, { alias }),
    )
  }
}

export class UnsupportedAggregateFunctionError extends GroupByError {
  constructor(functionName: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Unsupported aggregate function: ${functionName}`
        : codedMessage(71, { functionName }),
    )
  }
}

export class AggregateFunctionNotInSelectError extends GroupByError {
  constructor(functionName: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Aggregate function in HAVING clause must also be in SELECT clause: ${functionName}`
        : codedMessage(72, { functionName }),
    )
  }
}

export class UnknownHavingExpressionTypeError extends GroupByError {
  constructor(type: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Unknown expression type in HAVING clause: ${type}`
        : codedMessage(73, { type }),
    )
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
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Cannot ${operation} item because it cannot be JSON serialized: ${originalError}`
        : codedMessage(74, { operation, originalError }),
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
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `[LocalStorageCollection] storageKey must be provided.`
        : codedMessage(75),
    )
  }
}

export class InvalidStorageDataFormatError extends LocalStorageCollectionError {
  constructor(storageKey: string, key: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `[LocalStorageCollection] Invalid data format in storage key "${storageKey}" for key "${key}".`
        : codedMessage(76, { storageKey, key }),
    )
  }
}

export class InvalidStorageObjectFormatError extends LocalStorageCollectionError {
  constructor(storageKey: string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `[LocalStorageCollection] Invalid data format in storage key "${storageKey}". Expected object format.`
        : codedMessage(77, { storageKey }),
    )
  }
}

// Sync Cleanup Errors
export class SyncCleanupError extends TanStackDBError {
  constructor(collectionId: string, error: Error | string) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Collection "${collectionId}" sync cleanup function threw an error: ${error instanceof Error ? error.message : String(error)}`
        : codedMessage(78, { collectionId, error }),
    )
    this.name = `SyncCleanupError`
  }
}

/** A sync transaction was canceled before its writes became visible. */
export class SyncTransactionAbortedError extends Error {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Sync transaction was aborted before application`
        : codedMessage(79),
    )
    this.name = `AbortError`
  }
}

/** A collection was cleaned up before its initial preload became ready. */
export class CollectionPreloadAbortedError extends Error {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Collection preload was abandoned during cleanup`
        : codedMessage(80),
    )
    this.name = `AbortError`
  }
}

/** A subset operation was canceled before its result became visible. */
export class LoadSubsetOperationAbortedError extends Error {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Load subset operation was aborted before its result became visible`
        : codedMessage(81),
    )
    this.name = `AbortError`
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
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Cannot combine empty expression list`
        : codedMessage(82),
    )
  }
}

/**
 * Internal error when the compiler returns aliases that don't have corresponding input streams.
 * This should never happen since all aliases come from user declarations.
 */
export class MissingAliasInputsError extends QueryCompilationError {
  constructor(missingAliases: Array<string>) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Internal error: compiler returned aliases without inputs: ${missingAliases.join(`, `)}. ` +
            `This indicates a bug in query compilation. Please report this issue.`
        : codedMessage(83, { missingAliases }),
    )
  }
}

/**
 * Error thrown when setWindow is called on a collection without an ORDER BY clause.
 */
export class SetWindowRequiresOrderByError extends QueryCompilationError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `setWindow() can only be called on collections with an ORDER BY clause. ` +
            `Add .orderBy() to your query to enable window movement.`
        : codedMessage(84),
    )
  }
}

/** Error thrown when setWindow is called from inside another setWindow call. */
export class SetWindowReentrancyError extends TanStackDBError {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `setWindow() cannot run reentrantly. Wait for the current window operation to return before starting another one.`
        : codedMessage(85),
    )
    this.name = `SetWindowReentrancyError`
  }
}

export class UnhashableQueryIRError extends Error {
  constructor(
    public readonly path: string,
    public readonly reason: string,
  ) {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Query IR is not stably hashable at ${path}: ${reason}`
        : codedMessage(87, { path, reason }),
    )
    this.name = `UnhashableQueryIRError`
  }
}
