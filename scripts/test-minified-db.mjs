// Consumer-build contract: public Collection/query behavior, error names, and
// index metadata have the same observations after identifier minification.
// The driver bundles the built packages/db/dist, which is what consumers
// install, so it also covers the private-member renaming in the db build.
// Authority: the corresponding source-facing tests in packages/db/tests for
// queryOnce, live queries, collection events/indexes, and errors. The model is
// a plain array filter/sort/projection over one initial and one updated source
// snapshot; the driver invokes only the bundled public entry. This fixed slice
// does not replace the generated oracles or framework adapter conformance.
// The --calibrate modes are hostile controls for this check, not CI jobs.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { assertDbDistFresh } from '../packages/db/scripts/assert-dist-fresh.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2]
assert.ok(
  mode === undefined ||
    mode === '--calibrate-error-name' ||
    mode === '--calibrate-public-member' ||
    mode === '--calibrate-output-shape',
  `Unknown mode: ${mode}`,
)

const dbNodeModules = path.join(root, 'packages/db/node_modules')
const dbNodeModulesInfo = await stat(dbNodeModules).catch((error) => {
  if (error.code !== 'ENOENT') throw error
  return null
})
assert.ok(
  dbNodeModulesInfo?.isDirectory(),
  'Install workspace dependencies before running test:minified-db',
)

const builtEntry = await assertDbDistFresh(root)
const bundleDirectory = await mkdtemp(path.join(dbNodeModules, '.minified-db-'))
const bundlePath = path.join(bundleDirectory, 'index.mjs')

const aliasIvm = {
  name: 'inline-db-ivm',
  setup(builder) {
    builder.onResolve({ filter: /^@tanstack\/db-ivm$/ }, () => ({
      path: path.join(root, 'packages/db-ivm/src/index.ts'),
    }))
  },
}

const errorNameMutant = {
  name: 'error-name-mutant',
  setup(builder) {
    builder.onLoad(
      { filter: /packages\/db\/dist\/esm\/errors\.js$/ },
      async ({ path: file }) => {
        const source = await readFile(file, 'utf8')
        const original = 'this.name = `CollectionConfigurationError`'
        assert.equal(
          source.split(original).length,
          2,
          'mutant target exists once',
        )
        return {
          contents: source.replace(original, 'this.name = new.target.name'),
          loader: 'js',
        }
      },
    )
  },
}

// These are the public names currently assigned by the exported error classes.
// Subclasses often deliberately inherit their family's name. Abort errors
// intentionally use the platform AbortError name. Keep the export inventory
// check below so a newly exported class must receive an explicit expectation.
const errorGroups = {
  TanStackDBError: `TanStackDBError`,
  NonRetriableError: `NonRetriableError`,
  SchemaValidationError: `SchemaValidationError`,
  DuplicateDbInstanceError: `DuplicateDbInstanceError`,
  CollectionConfigurationError: `CollectionConfigurationError CollectionRequiresConfigError CollectionRequiresSyncConfigError InvalidSchemaError SchemaMustBeSynchronousError`,
  InvalidSyncPersistenceCapabilityError: `InvalidSyncPersistenceCapabilityError`,
  CollectionStateError: `CollectionStateError CollectionInErrorStateError InvalidCollectionStatusTransitionError CollectionIsInErrorStateError NegativeActiveSubscribersError LiveQueryObserverDisposedError LiveQueryWindowControllerDisposedError`,
  CollectionOperationError: `CollectionOperationError UndefinedKeyError InvalidKeyError DuplicateKeyError DuplicateKeySyncError MissingUpdateArgumentError NoKeysPassedToUpdateError UpdateKeyNotFoundError KeyUpdateNotAllowedError NoKeysPassedToDeleteError DeleteKeyNotFoundError`,
  MissingHandlerError: `MissingHandlerError MissingInsertHandlerError MissingUpdateHandlerError MissingDeleteHandlerError`,
  TransactionError: `TransactionError MissingMutationFunctionError TransactionNotPendingMutateError TransactionAlreadyCompletedRollbackError TransactionNotPendingCommitError NoPendingSyncTransactionWriteError SyncTransactionAlreadyCommittedWriteError NoPendingSyncTransactionCommitError SyncTransactionAlreadyCommittedError`,
  QueueCapacityExceededError: `QueueCapacityExceededError`,
  QueueDisposedError: `QueueDisposedError`,
  ThrottleCallDroppedError: `ThrottleCallDroppedError`,
  DebounceCallDroppedError: `DebounceCallDroppedError`,
  OnMutateMustBeSynchronousError: `OnMutateMustBeSynchronousError`,
  QueryBuilderError: `QueryBuilderError OnlyOneSourceAllowedError SubQueryMustHaveFromClauseError InvalidSourceError InvalidSourceTypeError JoinConditionMustBeEqualityError QueryMustHaveFromClauseError InvalidWhereExpressionError`,
  QueryCompilationError: `QueryCompilationError DistinctRequiresSelectError FnSelectWithGroupByError UnsupportedFnSelectResultError UnsupportedRootScalarSelectError HavingRequiresGroupByError LimitOffsetRequireOrderByError CollectionInputNotFoundError DuplicateAliasInSubqueryError UnsupportedFromTypeError UnknownExpressionTypeError EmptyReferencePathError UnknownFunctionError JoinCollectionNotFoundError MissingAliasInputsError SetWindowRequiresOrderByError`,
  UnsafeAliasPathError: `UnsafeAliasPathError`,
  JoinError: `JoinError UnsupportedJoinTypeError InvalidJoinConditionSameSourceError InvalidJoinConditionSourceMismatchError InvalidJoinConditionLeftSourceError InvalidJoinConditionRightSourceError InvalidJoinCondition UnsupportedJoinSourceTypeError`,
  GroupByError: `GroupByError NonAggregateExpressionNotInGroupByError UnsupportedAggregateFunctionError AggregateFunctionNotInSelectError UnknownHavingExpressionTypeError`,
  StorageError: `StorageError SerializationError`,
  LocalStorageCollectionError: `LocalStorageCollectionError StorageKeyRequiredError InvalidStorageDataFormatError InvalidStorageObjectFormatError`,
  SyncCleanupError: `SyncCleanupError`,
  AbortError: `SyncTransactionAbortedError CollectionPreloadAbortedError LoadSubsetOperationAbortedError`,
  QueryOptimizerError: `QueryOptimizerError CannotCombineEmptyExpressionListError`,
  SetWindowReentrancyError: `SetWindowReentrancyError`,
  UnhashableQueryIRError: `UnhashableQueryIRError`,
}

function checkErrorNames(db) {
  const expected = new Map(
    Object.entries(errorGroups).flatMap(([name, exports]) =>
      exports.split(' ').map((exportName) => [exportName, name]),
    ),
  )
  const actual = Object.entries(db)
    .filter(
      ([, value]) =>
        typeof value === 'function' && value.prototype instanceof Error,
    )
    .map(([name]) => name)
    .sort()
  assert.deepEqual(
    actual,
    [...expected.keys()].sort(),
    'every exported error has a checked name',
  )

  for (const [exportName, name] of expected) {
    const args =
      exportName === 'MissingAliasInputsError' ? [[]] : ['insert', [], []]
    const error = new db[exportName](...args)
    assert.equal(error.name, name, `${exportName}.name`)
    assert.ok(error instanceof Error, `${exportName} is an Error`)
  }
  return expected.size
}

async function checkCollectionsAndQueries(db) {
  const initial = [
    { id: 1, name: 'Ada', age: 28 },
    { id: 2, name: 'Bea', age: 21 },
    { id: 3, name: 'Cal', age: 35 },
  ]
  let sync
  const source = db.createCollection({
    id: 'minified-public-source',
    getKey: (row) => row.id,
    defaultIndexType: db.BasicIndex,
    sync: {
      sync(actions) {
        sync = actions
        actions.begin()
        for (const value of initial) actions.write({ type: 'insert', value })
        actions.commit()
        actions.markReady()
      },
    },
  })
  let live
  try {
    const indexEvents = []
    source.on('index:added', (event) => indexEvents.push(event))
    const index = source.createIndex((row) => row.age, {
      indexType: db.BasicIndex,
      name: 'by-age',
    })
    assert.equal(
      typeof source.getIndexMetadata,
      'function',
      'public index metadata method',
    )
    const metadata = source.getIndexMetadata()
    assert.equal(metadata.length, 1)
    assert.equal(metadata[0].indexId, index.id)
    assert.equal(metadata[0].name, 'by-age')
    assert.equal(metadata[0].resolver.kind, 'constructor')
    assert.equal(metadata[0].resolver.name, 'BasicIndex')
    assert.equal(indexEvents.length, 1)
    assert.equal(indexEvents[0].index.signature, metadata[0].signature)
    assert.equal(indexEvents[0].index.name, 'by-age')
    assert.equal(indexEvents[0].index.resolver.name, 'BasicIndex')

    await source.preload()
    assert.deepEqual(
      [...source.values()].map((row) => row.id).sort(),
      [1, 2, 3],
    )

    // A small conformance and oracle slice: expected rows come from a plain
    // array filter/sort/projection, independent of the query/index machinery.
    const expected = (rows) =>
      rows
        .filter((row) => row.age > 25)
        .sort((a, b) => a.age - b.age)
        .map(({ id, name }) => ({ id, name }))
    const query = (q) =>
      q
        .from({ user: source })
        .where(({ user }) => db.gt(user.age, 25))
        .orderBy(({ user }) => user.age, 'asc')
        .select(({ user }) => ({ id: user.id, name: user.name }))
    const selectedRows = (rows) =>
      rows.map((row) => {
        const selected = { ...row }
        delete selected.$synced
        delete selected.$origin
        delete selected.$key
        delete selected.$collectionId
        return selected
      })
    const queryRows = [...(await db.queryOnce(query))]
    if (mode === '--calibrate-output-shape') {
      queryRows[0] = { ...queryRows[0], age: 28 }
    }
    assert.deepEqual(selectedRows(queryRows), expected(initial))

    live = db.createLiveQueryCollection(query)
    await live.preload()
    assert.deepEqual(selectedRows([...live.values()]), expected(initial))

    const changed = [
      { id: 1, name: 'Ada', age: 28 },
      { id: 2, name: 'Bea', age: 31 },
      { id: 3, name: 'Cal', age: 35 },
    ]
    sync.begin()
    sync.write({ type: 'update', value: changed[1] })
    await sync.commit()
    assert.deepEqual(selectedRows([...live.values()]), expected(changed))
    assert.deepEqual(selectedRows(await db.queryOnce(query)), expected(changed))
  } finally {
    if (live) await live.cleanup()
    await source.cleanup()
  }
}

try {
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: [builtEntry],
    outfile: bundlePath,
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2020',
    platform: 'node',
    metafile: true,
    external: ['@standard-schema/spec', '@tanstack/pacer-lite'],
    plugins: [
      aliasIvm,
      ...(mode === '--calibrate-error-name' ? [errorNameMutant] : []),
    ],
    ...(mode === '--calibrate-public-member'
      ? { mangleProps: /^getIndexMetadata$/ }
      : {}),
    logLevel: 'silent',
  })
  assert.ok(
    Object.keys(bundle.metafile.inputs).some((input) =>
      input.includes('packages/db-ivm/src/'),
    ),
    'db-ivm is inlined into the minified bundle',
  )
  const db = await import(pathToFileURL(bundlePath).href)
  const errorCount = checkErrorNames(db)
  await checkCollectionsAndQueries(db)
  console.log(
    `Minified public API: ${errorCount} error names, index metadata, query rows, live updates OK`,
  )
} finally {
  await rm(bundleDirectory, { recursive: true, force: true })
}
