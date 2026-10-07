/**
 * Sample constructor arguments for every error class exported from
 * `src/errors.ts`. The production error message oracle constructs each class
 * with these arguments in development and production modes.
 */
export const errorSampleArguments: Record<string, Array<Array<unknown>>> = {
  // Root and base classes (message passed by caller)
  TanStackDBError: [['Test error message']],
  NonRetriableError: [['Non retriable error']],

  // Schema validation (special fields: type, issues)
  SchemaValidationError: [
    ['insert', [{ message: 'Invalid field', path: ['name'] }]],
  ],

  // Module instance errors
  DuplicateDbInstanceError: [[]],

  // Collection configuration errors
  CollectionConfigurationError: [['Configuration error']],
  InvalidSyncPersistenceCapabilityError: [['reason']],
  CollectionRequiresConfigError: [[]],
  CollectionRequiresSyncConfigError: [[]],
  InvalidSchemaError: [[]],
  SchemaMustBeSynchronousError: [[]],

  // Collection state errors
  CollectionStateError: [['State error']],
  CollectionInErrorStateError: [['operation', 'collection-1']],
  InvalidCollectionStatusTransitionError: [
    ['pending', 'ready', 'collection-1'],
  ],
  CollectionIsInErrorStateError: [[]],
  NegativeActiveSubscribersError: [[]],
  LiveQueryObserverDisposedError: [[]],
  LiveQueryWindowControllerDisposedError: [[]],

  // Collection operation errors
  CollectionOperationError: [['Operation error']],
  UndefinedKeyError: [[{ name: 'item' }]],
  InvalidKeyError: [
    [null, { name: 'item' }],
    [{ id: 1 }, { name: 'item' }],
  ],
  DuplicateKeyError: [['key-1']],
  DuplicateKeySyncError: [
    [123, 'collection-1', { hasCustomGetKey: false }],
    ['key-1', 'collection-1', { hasCustomGetKey: true, hasDistinct: true }],
    ['key-1', 'collection-1', { hasCustomGetKey: true, hasJoins: true }],
  ],
  MissingUpdateArgumentError: [[]],
  NoKeysPassedToUpdateError: [[]],
  UpdateKeyNotFoundError: [['key-1']],
  KeyUpdateNotAllowedError: [['old-key', 'new-key']],
  NoKeysPassedToDeleteError: [[]],
  DeleteKeyNotFoundError: [['key-1']],

  // Collection handler errors
  MissingHandlerError: [['Missing handler']],
  MissingInsertHandlerError: [[]],
  MissingUpdateHandlerError: [[]],
  MissingDeleteHandlerError: [[]],

  // Transaction errors
  TransactionError: [['Transaction error']],
  PacedTransactionManualCommitError: [[]],
  QueueCapacityExceededError: [[]],
  QueueDisposedError: [[]],
  ThrottleCallDroppedError: [[]],
  DebounceCallDroppedError: [[]],
  MissingMutationFunctionError: [[]],
  OnMutateMustBeSynchronousError: [[]],
  TransactionNotPendingMutateError: [[]],
  TransactionAlreadyCompletedRollbackError: [[]],
  TransactionNotPendingCommitError: [[]],
  NoPendingSyncTransactionWriteError: [[]],
  SyncTransactionAlreadyCommittedWriteError: [[]],
  SyncRowReusedWithoutPreviousValueError: [['key-1']],
  NoPendingSyncTransactionCommitError: [[]],
  SyncTransactionAlreadyCommittedError: [[]],
  SyncQueueInvariantError: [['invariant detail']],

  // Query builder errors
  QueryBuilderError: [['Query error']],
  OnlyOneSourceAllowedError: [['join clause']],
  SubQueryMustHaveFromClauseError: [['join clause']],
  InvalidSourceError: [['todos']],
  InvalidSourceTypeError: [
    ['from clause', 'string'],
    ['join clause', 'number'],
    ['unionAll clause', 'undefined'],
  ],
  JoinConditionMustBeEqualityError: [[]],
  QueryMustHaveFromClauseError: [[]],
  InvalidWhereExpressionError: [['boolean']],

  // Query compilation errors
  QueryCompilationError: [['Compilation error']],
  UnsafeAliasPathError: [['__proto__']],
  DistinctRequiresSelectError: [[]],
  FnSelectWithGroupByError: [[]],
  UnsupportedFnSelectResultError: [['query builder']],
  UnsupportedRootScalarSelectError: [[]],
  HavingRequiresGroupByError: [[]],
  LimitOffsetRequireOrderByError: [[]],
  CollectionInputNotFoundError: [
    ['alias', 'collection-1', ['key1', 'key2']],
    ['alias'],
  ],
  DuplicateAliasInSubqueryError: [['alias', ['parent1', 'parent2']]],
  UnsupportedFromTypeError: [['string']],
  UnknownExpressionTypeError: [['custom']],
  EmptyReferencePathError: [[]],
  UnknownFunctionError: [['customFn']],
  JoinCollectionNotFoundError: [['collection-1']],

  // JOIN operation errors
  JoinError: [['Join error']],
  UnsupportedJoinTypeError: [['OUTER']],
  InvalidJoinConditionSameSourceError: [['todos']],
  InvalidJoinConditionSourceMismatchError: [[]],
  InvalidJoinConditionLeftSourceError: [['todos']],
  InvalidJoinConditionRightSourceError: [['comments']],
  InvalidJoinCondition: [[]],
  UnsupportedJoinSourceTypeError: [['custom']],

  // GROUP BY and aggregation errors
  GroupByError: [['Group error']],
  NonAggregateExpressionNotInGroupByError: [['field']],
  UnsupportedAggregateFunctionError: [['customAgg']],
  AggregateFunctionNotInSelectError: [['count']],
  UnknownHavingExpressionTypeError: [['custom']],

  // Storage errors
  StorageError: [['Storage error']],
  SerializationError: [['write', 'circular reference']],

  // LocalStorage collection errors
  LocalStorageCollectionError: [['Storage error']],
  StorageKeyRequiredError: [[]],
  InvalidStorageDataFormatError: [['storageKey', 'key']],
  InvalidStorageObjectFormatError: [['storageKey']],

  // Sync cleanup errors
  SyncCleanupError: [
    ['collection-1', 'Cleanup failed'],
    ['collection-1', new Error('Cleanup threw')],
  ],

  // Query optimizer errors
  QueryOptimizerError: [['Optimizer error']],
  CannotCombineEmptyExpressionListError: [[]],

  // Query compilation errors (continued)
  MissingAliasInputsError: [[['alias1', 'alias2']]],
  SetWindowRequiresOrderByError: [[]],

  // Window errors
  UnhashableQueryIRError: [['query.fnSelect', 'function select']],
  SetWindowReentrancyError: [[]],

  // Error classes with just message parameter (no special handling)
  // These inherit from base Error not TanStackDBError:
  SyncTransactionAbortedError: [[]],
  CollectionPreloadAbortedError: [[]],
  LoadSubsetOperationAbortedError: [[]],
}
