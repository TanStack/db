import { QueryClient } from '@tanstack/query-core'
import {
  BasicIndex,
  IR,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import { TraceAssertionError } from '../../db/tests/trace-runner.js'
import { createDeferred } from '../../db/src/deferred.js'
import { queryCollectionOptions } from '../src/query.js'
import type { QueryFunctionContext } from '@tanstack/query-core'
import type { LoadSubsetOptions, SyncMetadataApi } from '@tanstack/db'

type Row = {
  id: string
  group?: string
}

let collectionSequence = 0

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  })
}

async function expectInitialQueryFailureStatus(): Promise<void> {
  const error = new Error(`initial query failed`)
  const queryClient = createQueryClient()
  const id = `load-subset-error-status-${collectionSequence++}`
  const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const queryFn = vi
    .fn()
    .mockRejectedValueOnce(error)
    .mockResolvedValueOnce([{ id: `recovered` }])
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      retry: false,
    }),
  )
  const live = createLiveQueryCollection((query) =>
    query.from({ row: collection }).select(({ row }) => ({ id: row.id })),
  )
  const preloadOutcomes = Promise.allSettled([
    collection.preload(),
    live.preload(),
  ])

  try {
    await vi.waitFor(() => {
      expect(collection.utils.lastError).toBe(error)
      expect(collection.utils.isError).toBe(true)
    })
    expect(loggedError).toHaveBeenCalled()
    try {
      expect(collection.status).toBe(`error`)
      expect(live.status).toBe(`error`)
      expect((await preloadOutcomes).map(({ status }) => status)).toEqual([
        `rejected`,
        `rejected`,
      ])
    } catch (caught) {
      throw new TraceAssertionError(0, caught)
    }

    await collection.utils.clearError()
    await vi.waitFor(() => {
      expect(collection.status).toBe(`ready`)
      expect(collection.get(`recovered`)).toBeDefined()
      expect(live.status).toBe(`ready`)
      expect(live.get(`recovered`)).toBeDefined()
    })
    await expect(collection.preload()).resolves.toBeUndefined()
    await expect(live.preload()).resolves.toBeUndefined()
  } finally {
    await live.cleanup()
    await collection.cleanup()
    queryClient.clear()
    loggedError.mockRestore()
  }
}

async function expectLateDependentObservesInitialFailure(): Promise<void> {
  const error = new Error(`source failed before dependent construction`)
  const queryClient = createQueryClient()
  const id = `load-subset-late-dependent-error-${collectionSequence++}`
  const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn: vi.fn().mockRejectedValue(error),
      getKey: (row) => row.id,
      startSync: true,
      retry: false,
    }),
  )

  await expect(collection.preload()).rejects.toBe(error)
  expect(collection.status).toBe(`error`)

  const live = createLiveQueryCollection((query) =>
    query.from({ row: collection }).select(({ row }) => ({ id: row.id })),
  )
  const livePreload = live.preload()
  void livePreload.catch(() => undefined)

  try {
    expect(live.status).toBe(`error`)
    await expect(livePreload).rejects.toThrow()
  } finally {
    await live.cleanup()
    await collection.cleanup()
    await Promise.allSettled([livePreload])
    queryClient.clear()
    loggedError.mockRestore()
  }
}

async function expectEveryFailedSourceToRecover(): Promise<void> {
  const createControlledSource = (id: string) => {
    let fail: () => void = () => {
      throw new Error(`Source '${id}' has not started`)
    }
    let recover: (row: Row) => void = (_row) => {
      throw new Error(`Source '${id}' has not started`)
    }
    const collection = createCollection<Row>({
      id,
      getKey: (row) => row.id,
      startSync: false,
      autoIndex: `eager`,
      defaultIndexType: BasicIndex,
      sync: {
        sync: ({ begin, write, commit, markReady, markError }) => {
          fail = markError
          recover = (row) => {
            begin()
            write({ type: `insert`, value: row })
            commit()
            markReady()
          }
        },
      },
    })
    return {
      collection,
      fail: () => fail(),
      recover: (row: Row) => recover(row),
    }
  }

  const left = createControlledSource(
    `load-subset-multi-error-left-${collectionSequence++}`,
  )
  const right = createControlledSource(
    `load-subset-multi-error-right-${collectionSequence++}`,
  )
  const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const live = createLiveQueryCollection((query) =>
    query
      .from({ left: left.collection })
      .join({ right: right.collection }, ({ left: leftRow, right: rightRow }) =>
        eq(leftRow.id, rightRow.id),
      )
      .select(({ left: row }) => ({ id: row.id })),
  )
  const preload = live.preload()
  void preload.catch(() => undefined)

  try {
    left.fail()
    right.fail()
    await expect(preload).rejects.toThrow()
    expect(live.status).toBe(`error`)

    left.recover({ id: `shared` })
    expect(left.collection.status).toBe(`ready`)
    expect(right.collection.status).toBe(`error`)
    expect(live.status).toBe(`error`)

    right.recover({ id: `shared` })
    await expect(live.preload()).resolves.toBeUndefined()
    expect(live.status).toBe(`ready`)
    expect(live.toArray.map((row) => row.id)).toEqual([`shared`])
  } finally {
    await live.cleanup()
    await left.collection.cleanup()
    await right.collection.cleanup()
    await Promise.allSettled([preload])
    loggedError.mockRestore()
  }
}

async function expectRefetchFailureKeepsReadySnapshot(): Promise<void> {
  const error = new Error(`refetch failed`)
  const queryClient = createQueryClient()
  const id = `load-subset-refetch-status-${collectionSequence++}`
  const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const queryFn = vi
    .fn()
    .mockResolvedValueOnce([{ id: `cached` }])
    .mockRejectedValueOnce(error)
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      retry: false,
    }),
  )
  const live = createLiveQueryCollection((query) =>
    query.from({ row: collection }).select(({ row }) => ({ id: row.id })),
  )

  try {
    await live.preload()
    await collection.utils.refetch()
    await vi.waitFor(() => {
      expect(collection.utils.lastError).toBe(error)
    })
    expect(collection.status).toBe(`ready`)
    expect(live.status).toBe(`ready`)
    expect(collection.get(`cached`)).toBeDefined()
    expect(live.get(`cached`)).toBeDefined()
  } finally {
    await live.cleanup()
    await collection.cleanup()
    queryClient.clear()
    loggedError.mockRestore()
  }
}

async function expectDeferredStartupReadyDoesNotOverrideError(): Promise<void> {
  // Internal ordering seam: this deliberately reuses old sync controls and
  // observers. It does not establish a public cleanup/restart path; real
  // cleanup clears those observers before a new sync session starts.
  const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const queryClient = createQueryClient()
  const id = `load-subset-deferred-ready-${collectionSequence++}`
  const queryError = new Error(`cached observer failed`)
  const queryFn = vi.fn().mockRejectedValue(queryError)
  const baseOptions = queryCollectionOptions<Row>({
    id,
    queryClient,
    queryKey: [id],
    queryFn,
    getKey: (row) => row.id,
    startSync: true,
    syncMode: `on-demand`,
    retry: false,
  })
  const originalSync = baseOptions.sync
  let syncParams!: Parameters<typeof originalSync.sync>[0]
  const collection = createCollection({
    ...baseOptions,
    sync: {
      sync: (params) => {
        syncParams = params
        return originalSync.sync(params)
      },
    },
  })

  const firstLoad = collection._sync.loadSubset({})
  if (!(firstLoad instanceof Promise)) {
    throw new Error(`The failing query must be asynchronous`)
  }
  await expect(firstLoad).rejects.toBe(queryError)
  expect(collection.status).toBe(`ready`)

  let releaseScan!: () => void
  const scanReleased = new Promise<void>((resolve) => {
    releaseScan = resolve
  })
  let resolveMaintenanceDelete!: () => void
  const maintenanceDeleted = new Promise<void>((resolve) => {
    resolveMaintenanceDelete = resolve
  })
  type MetadataWithPersistedScan = SyncMetadataApi<string | number> & {
    row: SyncMetadataApi<string | number>[`row`] & {
      scanPersisted: () => Promise<
        Array<{ key: string | number; value: Row; metadata?: unknown }>
      >
    }
  }
  const metadata: MetadataWithPersistedScan = {
    row: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      scanPersisted: async () => {
        await scanReleased
        return []
      },
    },
    collection: {
      get: () => undefined,
      set: () => {},
      delete: () => {
        resolveMaintenanceDelete()
      },
      list: () => [
        {
          key: `queryCollection:gc:expired`,
          value: { queryHash: `expired`, mode: `ttl`, expiresAt: 0 },
        },
      ],
    },
  }

  collection._lifecycle.setStatus(`cleaned-up`)
  collection._lifecycle.setStatus(`loading`)
  const secondSync = originalSync.sync({ ...syncParams, metadata })

  try {
    expect(collection.status).toBe(`error`)
    releaseScan()
    await maintenanceDeleted
    for (let turn = 0; turn < 10; turn++) await Promise.resolve()
    expect(collection.status).toBe(`error`)
    expect(collection.utils.lastError).toBe(queryError)
  } finally {
    if (typeof secondSync === `function`) {
      await secondSync()
    } else {
      await secondSync?.cleanup?.()
    }
    await collection.cleanup()
    queryClient.clear()
    loggedError.mockRestore()
  }
}

async function expectEquivalentPredicatesShareOneLoad(
  form: `commutative-and` | `commutative-or` | `reversed-equality`,
): Promise<void> {
  const { queryClient, collection, queryFn } = createOnDemandCollection(
    `load-subset-canonical-predicate`,
    [{ id: `a`, group: `x` }],
  )
  const firstComparison = new IR.Func<boolean>(`eq`, [
    new IR.PropRef([`id`]),
    new IR.Value(`a`),
  ])
  const secondComparison = new IR.Func<boolean>(`eq`, [
    new IR.PropRef([`group`]),
    new IR.Value(`x`),
  ])
  let first: IR.BasicExpression<boolean>
  let second: IR.BasicExpression<boolean>
  switch (form) {
    case `commutative-and`:
      first = new IR.Func(`and`, [firstComparison, secondComparison])
      second = new IR.Func(`and`, [secondComparison, firstComparison])
      break
    case `commutative-or`:
      first = new IR.Func(`or`, [firstComparison, secondComparison])
      second = new IR.Func(`or`, [secondComparison, firstComparison])
      break
    case `reversed-equality`:
      first = firstComparison
      second = new IR.Func(`eq`, [new IR.Value(`a`), new IR.PropRef([`id`])])
      break
  }

  try {
    await collection._sync.loadSubset({ where: first })
    await collection._sync.loadSubset({ where: second })
    try {
      expect(queryFn.mock.calls.length).toBe(1)
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  } finally {
    await collection.cleanup()
    queryClient.clear()
  }
}

async function expectEquivalentComparisonValuesShareOneLoad(
  firstValue: unknown,
  secondValue: unknown,
): Promise<void> {
  const { queryClient, collection, queryFn } = createOnDemandCollection(
    `load-subset-comparison-value`,
    [{ id: `a` }],
  )
  const value = new IR.PropRef([`value`])

  try {
    await collection._sync.loadSubset({
      where: new IR.Func(`eq`, [value, new IR.Value(firstValue)]),
    })
    await collection._sync.loadSubset({
      where: new IR.Func(`eq`, [value, new IR.Value(secondValue)]),
    })
    expect(queryFn).toHaveBeenCalledOnce()
  } finally {
    await collection.cleanup()
    queryClient.clear()
  }
}

function createOnDemandCollection(idPrefix: string, rows: Array<Row>) {
  const queryClient = createQueryClient()
  const id = `${idPrefix}-${collectionSequence++}`
  const queryFn = vi.fn().mockResolvedValue(rows)
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      retry: false,
    }),
  )
  return { queryClient, collection, queryFn }
}

type IdentityForm =
  | `commutative-and`
  | `commutative-or`
  | `reversed-equality`
  | `valid Date`
  | `invalid Date`

type IdentityRow = { id: string; group: string; value: Date }
type IdentityCheckpoint = {
  stage: string
  calls: number
  requests: Array<LoadSubsetOptions>
  rows: Array<IdentityRow>
}

function identityDemandFixture(form: IdentityForm) {
  const firstDate =
    form === `invalid Date`
      ? new Date(Number.NaN)
      : new Date(`2024-01-15T00:00:00Z`)
  const secondDate = new Date(`2024-01-16T00:00:00Z`)
  const rows: Array<IdentityRow> = [
    { id: `a`, group: `x`, value: firstDate },
    { id: `b`, group: `y`, value: secondDate },
  ]
  const comparison = (field: string, value: unknown, reversed = false) => {
    const operands = [new IR.PropRef([field]), new IR.Value(value)]
    return new IR.Func<boolean>(`eq`, reversed ? operands.reverse() : operands)
  }
  const predicate = (index: number, reversed = false) => {
    const row = rows[index]!
    if (form === `valid Date` || form === `invalid Date`) {
      return comparison(`value`, new Date(row.value.getTime()), reversed)
    }
    const id = comparison(`id`, row.id, reversed)
    if (form === `reversed-equality`) return id
    const group = comparison(`group`, row.group)
    const operands = reversed ? [group, id] : [id, group]
    return new IR.Func<boolean>(
      form === `commutative-and` ? `and` : `or`,
      operands,
    )
  }
  return {
    rows,
    first: { where: predicate(0) },
    equivalent: { where: predicate(0, true) },
    distinct: { where: predicate(1) },
  }
}

function validateIdentityRequest(options: LoadSubsetOptions): void {
  if (
    options.orderBy !== undefined ||
    options.limit !== undefined ||
    options.offset !== undefined ||
    options.cursor !== undefined
  ) {
    throw new Error(`Identity fixture does not support ordering or windows`)
  }
  const validate = (expression: IR.BasicExpression): void => {
    if (expression.type !== `func` || expression.args.length !== 2) {
      throw new Error(`Unsupported identity fixture predicate`)
    }
    if (expression.name === `and` || expression.name === `or`) {
      // Validation traverses both branches, even when evaluation short-circuits
      // or there are no provider rows to evaluate.
      expression.args.forEach(validate)
      return
    }
    if (expression.name !== `eq`) {
      throw new Error(`Unsupported identity fixture operator`)
    }
    const [left, right] = expression.args
    const ref = left?.type === `ref` ? left : right
    const constant = left?.type === `val` ? left : right
    if (
      ref?.type !== `ref` ||
      ref.path.length !== 1 ||
      constant?.type !== `val`
    ) {
      throw new Error(
        `Identity fixture equality requires one field and one constant`,
      )
    }
    const field = ref.path[0]
    if (
      ((field === `id` || field === `group`) &&
        typeof constant.value === `string`) ||
      (field === `value` && constant.value instanceof Date)
    )
      return
    throw new Error(`Unsupported identity fixture field or value`)
  }
  if (!options.where) throw new Error(`Identity fixture requires a predicate`)
  validate(options.where)
}

function selectIdentityRows(
  options: LoadSubsetOptions,
  rows: ReadonlyArray<IdentityRow>,
): Array<IdentityRow> {
  // This fixture accepts only eq/and/or over its three declared fields. It is
  // not a SQL server and does not use the production evaluator or demand key.
  validateIdentityRequest(options)
  const operand = (
    expression: IR.BasicExpression,
    row: IdentityRow,
  ): unknown => {
    if (expression.type === `val`) return expression.value
    if (expression.type === `ref` && expression.path.length === 1) {
      const field = expression.path[0]
      if (field === `id` || field === `group` || field === `value`) {
        return row[field]
      }
    }
    throw new Error(`Unsupported identity fixture operand`)
  }
  const matches = (
    expression: IR.BasicExpression,
    row: IdentityRow,
  ): boolean => {
    if (expression.type !== `func` || expression.args.length !== 2) {
      throw new Error(`Unsupported identity fixture predicate`)
    }
    const [left, right] = expression.args as [
      IR.BasicExpression,
      IR.BasicExpression,
    ]
    if (expression.name === `and`)
      return matches(left, row) && matches(right, row)
    if (expression.name === `or`)
      return matches(left, row) || matches(right, row)
    if (expression.name !== `eq`) {
      throw new Error(`Unsupported identity fixture operator`)
    }
    const a = operand(left, row)
    const b = operand(right, row)
    // The existing comparison contract treats invalid Dates as equal. Native
    // Object.is on timestamps gives this fixture that declared finite relation.
    return a instanceof Date && b instanceof Date
      ? Object.is(a.getTime(), b.getTime())
      : a === b
  }
  return rows
    .filter((row) => matches(options.where!, row))
    .map((row) => structuredClone(row))
}

async function observeDemandIdentity(
  form: IdentityForm,
  fault?: `constant key` | `wrong value`,
): Promise<Array<IdentityCheckpoint>> {
  const fixture = identityDemandFixture(form)
  const providerRows = structuredClone(fixture.rows)
  const queryClient = createQueryClient()
  const id = `distinct-demand-${collectionSequence++}`
  const requests: Array<LoadSubsetOptions> = []
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    const options = context.meta?.loadSubsetOptions ?? {}
    // Direct calls in this fixture supply only immutable request data, not a
    // signal/subscription. Capture the complete received request before checks.
    requests.push(structuredClone(options))
    const result = selectIdentityRows(options, providerRows)
    return Promise.resolve(
      fault === `wrong value`
        ? result.map((row) => ({ ...row, group: `wrong` }))
        : result,
    )
  })
  const collection = createCollection(
    queryCollectionOptions<IdentityRow>({
      id,
      queryClient,
      queryKey: fault === `constant key` ? () => [id] : [id],
      queryFn,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      retry: false,
    }),
  )
  const observations: Array<IdentityCheckpoint> = []
  const capture = (stage: string): void => {
    observations.push({
      stage,
      calls: queryFn.mock.calls.length,
      requests: structuredClone(requests),
      // Compare every provider field, excluding Collection's virtual metadata.
      rows: collection.toArray
        .map(({ id: rowId, group, value }) => ({
          id: rowId,
          group,
          value: new Date(value.getTime()),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    })
  }
  try {
    await collection._sync.loadSubset(fixture.first)
    capture(`first`)
    await collection._sync.loadSubset(fixture.equivalent)
    capture(`equivalent`)
    await collection._sync.loadSubset(fixture.distinct)
    capture(`distinct`)
    collection._sync.unloadSubset(fixture.first)
    capture(`one equivalent owner leaves`)
    collection._sync.unloadSubset(fixture.equivalent)
    capture(`final equivalent owner leaves`)
    collection._sync.unloadSubset(fixture.distinct)
    capture(`final distinct owner leaves`)
    return observations
  } finally {
    try {
      await collection.cleanup()
    } finally {
      queryClient.clear()
    }
  }
}

function expectDemandIdentity(
  observations: Array<IdentityCheckpoint>,
  form: IdentityForm,
): void {
  // Literal result sets are the authority; do not run the provider predicate
  // against expected data or derive expected membership from collection keys.
  const fixture = identityDemandFixture(form)
  const [first, second] = fixture.rows
  const initialRequests = [structuredClone(fixture.first)]
  const bothRequests = [...initialRequests, structuredClone(fixture.distinct)]
  expect(observations).toEqual([
    { stage: `first`, calls: 1, requests: initialRequests, rows: [first] },
    { stage: `equivalent`, calls: 1, requests: initialRequests, rows: [first] },
    {
      stage: `distinct`,
      calls: 2,
      requests: bothRequests,
      rows: [first, second],
    },
    {
      stage: `one equivalent owner leaves`,
      calls: 2,
      requests: bothRequests,
      rows: [first, second],
    },
    {
      stage: `final equivalent owner leaves`,
      calls: 2,
      requests: bothRequests,
      rows: [second],
    },
    {
      stage: `final distinct owner leaves`,
      calls: 2,
      requests: bothRequests,
      rows: [],
    },
  ])
}

async function expectFinalOwnerCleanupAbortsQuery(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `load-subset-cancel-final-owner-${collectionSequence++}`
  let capturedSignal: AbortSignal | undefined
  let resolveStarted!: () => void
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve
  })
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    capturedSignal = context.signal
    resolveStarted()
    return new Promise<Array<Row>>((_resolve, reject) => {
      context.signal.addEventListener(`abort`, () => {
        const error = new Error(`query aborted`)
        error.name = `AbortError`
        reject(error)
      })
    })
  })
  const source = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      retry: false,
    }),
  )
  const live = createLiveQueryCollection((query) =>
    query.from({ row: source }).select(({ row }) => ({ id: row.id })),
  )
  const preloadOutcome = live.preload().catch((error: unknown) => error)

  try {
    await started
    expect(queryFn).toHaveBeenCalledOnce()
    expect(capturedSignal?.aborted).toBe(false)

    await live.cleanup()
    expect(capturedSignal?.aborted).toBe(true)
  } finally {
    await live.cleanup()
    await source.cleanup()
    queryClient.clear()
    await preloadOutcome
  }
}

async function expectRemountAfterAbortStartsFreshQuery(): Promise<void> {
  const queryClient = createQueryClient()
  const id = `load-subset-remount-after-abort-${collectionSequence++}`
  let resolveFirstStarted!: () => void
  const firstStarted = new Promise<void>((resolve) => {
    resolveFirstStarted = resolve
  })
  const queryFn = vi
    .fn<(context: QueryFunctionContext) => Promise<Array<Row>>>()
    .mockImplementationOnce((context) => {
      resolveFirstStarted()
      return new Promise<Array<Row>>((_resolve, reject) => {
        context.signal.addEventListener(`abort`, () => {
          const error = new Error(`first query aborted`)
          error.name = `AbortError`
          reject(error)
        })
      })
    })
    .mockResolvedValueOnce([{ id: `fresh` }])
  const source = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      retry: false,
    }),
  )
  const buildLive = () =>
    createLiveQueryCollection((query) =>
      query.from({ row: source }).select(({ row }) => ({ id: row.id })),
    )
  const first = buildLive()
  const firstOutcome = first.preload().catch((error: unknown) => error)
  let second: ReturnType<typeof buildLive> | undefined

  try {
    await firstStarted
    await first.cleanup()
    await firstOutcome

    second = buildLive()
    const rows = await second.toArrayWhenReady()
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(rows.map(({ id: rowId }) => rowId)).toEqual([`fresh`])
  } finally {
    await first.cleanup()
    await second?.cleanup()
    await source.cleanup()
    queryClient.clear()
  }
}

type RetiredOutcome =
  | { status: `fulfilled` }
  | { status: `rejected`; error: unknown }
type ReplacementSnapshot = {
  source: Array<Row>
  live: Array<Row>
  sourceStatus: string
  liveStatus: string
  sourceError: unknown
}
type RetiredQueryObservation = {
  retired: RetiredOutcome
  retiredStatus: string
  aborted: boolean
  calls: number
  snapshots: Array<ReplacementSnapshot>
}

async function observeLateRetiredQuery(
  settlement: `resolve` | `reject`,
): Promise<RetiredQueryObservation> {
  const queryClient = createQueryClient()
  const id = `retired-query-completion-${collectionSequence++}`
  const old = createDeferred<Array<Row>>()
  const started = createDeferred<void>()
  let signal: AbortSignal | undefined
  const providerOutcome = old.promise.then(
    () => `resolved`,
    () => `rejected`,
  )
  const queryFn = vi
    .fn<(context: QueryFunctionContext) => Promise<Array<Row>>>()
    .mockImplementationOnce((context) => {
      // Consuming the signal lets Query cancel its retryer, even though this
      // simulated endpoint finishes its underlying promise later.
      signal = context.signal
      started.resolve()
      return old.promise
    })
    .mockResolvedValueOnce([{ id: `fresh`, group: `current` }])
  const source = createCollection(
    queryCollectionOptions<Row>({
      id,
      queryClient,
      queryKey: [id],
      queryFn,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      retry: false,
    }),
  )
  const buildLive = () =>
    createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .select(({ row }) => ({ id: row.id, group: row.group })),
    )
  const first = buildLive()
  const firstOutcome = first.preload().then<RetiredOutcome, RetiredOutcome>(
    () => ({ status: `fulfilled` }),
    (error: unknown) => ({ status: `rejected`, error }),
  )
  let second: ReturnType<typeof buildLive> | undefined
  const unsubscribe: Array<() => void> = []
  try {
    await started.promise
    expect(signal?.aborted).toBe(false)
    await first.cleanup()
    const retired = await firstOutcome
    // This cut precedes both the replacement and old provider settlement.
    expect(retired).toMatchObject({
      status: `rejected`,
      error: { name: `AbortError` },
    })
    const retiredStatus = first.status
    second = buildLive()
    await second.preload()
    const current = second
    const snapshots: Array<ReplacementSnapshot> = []
    const capture = (): void => {
      const values = (rows: Array<Row>) =>
        rows
          .map(({ id: rowId, group }) => ({ id: rowId, group }))
          .sort((a, b) => a.id.localeCompare(b.id))
      snapshots.push({
        source: values(source.toArray),
        live: values(current.toArray),
        sourceStatus: source.status,
        liveStatus: current.status,
        sourceError: source.utils.lastError,
      })
    }
    const sourceSubscription = source.subscribeChanges(capture)
    const liveSubscription = current.subscribeChanges(capture)
    unsubscribe.push(
      () => sourceSubscription.unsubscribe(),
      () => liveSubscription.unsubscribe(),
    )
    capture()
    if (settlement === `resolve`)
      old.resolve([{ id: `obsolete`, group: `old` }])
    else old.reject(new Error(`retired endpoint failed`))
    expect(await providerOutcome).toBe(
      settlement === `resolve` ? `resolved` : `rejected`,
    )
    // One host turn drains this controlled Query/native-promise continuation;
    // it is not a network or scheduler fairness bound.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    capture()
    expect(await firstOutcome).toBe(retired)
    return {
      retired,
      retiredStatus,
      aborted: signal?.aborted === true,
      calls: queryFn.mock.calls.length,
      snapshots,
    }
  } finally {
    old.resolve([])
    unsubscribe.forEach((stop) => stop())
    try {
      await first.cleanup()
    } finally {
      try {
        await second?.cleanup()
      } finally {
        try {
          await source.cleanup()
        } finally {
          queryClient.clear()
        }
      }
    }
  }
}

function expectLateRetiredQuery(observation: RetiredQueryObservation): void {
  expect(observation.retired).toMatchObject({
    status: `rejected`,
    error: { name: `AbortError` },
  })
  expect(observation.retiredStatus).toBe(`cleaned-up`)
  expect(observation.aborted).toBe(true)
  expect(observation.calls).toBe(2)
  expect(observation.snapshots.length).toBeGreaterThanOrEqual(2)
  for (const snapshot of observation.snapshots) {
    expect(snapshot).toEqual({
      source: [{ id: `fresh`, group: `current` }],
      live: [{ id: `fresh`, group: `current` }],
      sourceStatus: `ready`,
      liveStatus: `ready`,
      sourceError: undefined,
    })
  }
}

describe(`loadSubset lifecycle oracle`, () => {
  it(`reports an initial query failure and recovers after a successful refetch`, async () => {
    await expectInitialQueryFailureStatus()
  })

  it(`reports an initial failure to a dependent created after the source failed`, async () => {
    await expectLateDependentObservesInitialFailure()
  })

  it(`recovers a dependent only after every failed source recovers`, async () => {
    await expectEveryFailedSourceToRecover()
  })

  it(`keeps the last ready snapshot after a refetch failure`, async () => {
    await expectRefetchFailureKeepsReadySnapshot()
  })

  it(`does not let deferred startup readiness override a replayed error in the internal sync seam`, async () => {
    await expectDeferredStartupReadyDoesNotOverrideError()
  })

  it.each([`commutative-and`, `commutative-or`] as const)(
    `%s predicate forms share one query-db transport load`,
    async (form) => {
      await expectEquivalentPredicatesShareOneLoad(form)
    },
  )

  it(`reversed equality operands share one query-db transport load`, async () => {
    await expectEquivalentPredicatesShareOneLoad(`reversed-equality`)
  })

  it.each([
    [
      `valid Date`,
      new Date(`2024-01-15T00:00:00Z`),
      new Date(`2024-01-15T00:00:00Z`),
    ],
    [`invalid Date`, new Date(Number.NaN), new Date(Number.NaN)],
  ])(
    `shares one query-db transport load for equivalent %s values`,
    async (_label, firstValue, secondValue) => {
      await expectEquivalentComparisonValuesShareOneLoad(
        firstValue,
        secondValue,
      )
    },
  )

  const identityForms: Array<IdentityForm> = [
    `commutative-and`,
    `commutative-or`,
    `reversed-equality`,
    `valid Date`,
    `invalid Date`,
  ]
  it.each(identityForms)(
    `shares equivalent %s demands without collapsing distinct results or owners`,
    async (form) => {
      expectDemandIdentity(await observeDemandIdentity(form), form)
    },
  )

  it.each(identityForms)(
    `rejects a constant demand key despite valid %s sharing`,
    async (form) => {
      const observations = await observeDemandIdentity(form, `constant key`)
      expect(observations.slice(0, 2).map(({ calls }) => calls)).toEqual([1, 1])
      expect(() => expectDemandIdentity(observations, form)).toThrow()
    },
  )

  it(`rejects correct demand counts with wrong returned values`, async () => {
    const observations = await observeDemandIdentity(
      `commutative-and`,
      `wrong value`,
    )
    expect(observations.map(({ calls }) => calls)).toEqual([1, 1, 2, 2, 2, 2])
    expect(() =>
      expectDemandIdentity(observations, `commutative-and`),
    ).toThrow()
  })

  it.each([`or`, `and`, `empty`] as const)(
    `validates unvisited predicate branches for %s provider evaluation`,
    (form) => {
      const fixture = identityDemandFixture(`reversed-equality`)
      const where = new IR.Func<boolean>(form === `and` ? `and` : `or`, [
        new IR.Func(`eq`, [
          new IR.PropRef([`id`]),
          new IR.Value(form === `and` ? `absent` : `a`),
        ]),
        new IR.Func(`unsupported`, [new IR.Value(1), new IR.Value(2)]),
      ])
      expect(() =>
        selectIdentityRows(
          { where },
          form === `empty` ? [] : [fixture.rows[0]!],
        ),
      ).toThrow(`Unsupported identity fixture operator`)
      expect(selectIdentityRows(fixture.first, fixture.rows)).toEqual([
        fixture.rows[0],
      ])
    },
  )

  it.each([
    { limit: 0 },
    { offset: 0 },
    { orderBy: [] },
    {
      cursor: {
        whereFrom: new IR.Value(true),
        whereCurrent: new IR.Value(true),
      },
    },
  ] satisfies Array<LoadSubsetOptions>)(
    `rejects undeclared provider ordering/window requests: %j`,
    (extra) => {
      const fixture = identityDemandFixture(`reversed-equality`)
      expect(() =>
        selectIdentityRows({ ...fixture.first, ...extra }, fixture.rows),
      ).toThrow(`Identity fixture does not support ordering or windows`)
    },
  )

  it(`aborts an in-flight query when its final live-query owner cleans up`, async () => {
    await expectFinalOwnerCleanupAbortsQuery()
  })

  it(`starts a fresh query after an aborted owner immediately remounts`, async () => {
    await expectRemountAfterAbortStartsFreshQuery()
  })

  it.each([`resolve`, `reject`] as const)(
    `settles the retired caller before a late endpoint can %s against its replacement`,
    async (settlement) => {
      expectLateRetiredQuery(await observeLateRetiredQuery(settlement))
    },
  )

  it(`rejects lost caller cancellation and a stale replacement snapshot`, async () => {
    const observation = await observeLateRetiredQuery(`resolve`)
    expectLateRetiredQuery(observation)
    expect(() =>
      expectLateRetiredQuery({
        ...observation,
        retired: { status: `fulfilled` },
      }),
    ).toThrow()
    const snapshots = observation.snapshots.map((snapshot) => ({
      ...snapshot,
      source: [{ id: `obsolete`, group: `old` }],
    }))
    expect(() =>
      expectLateRetiredQuery({ ...observation, snapshots }),
    ).toThrow()
  })
})
