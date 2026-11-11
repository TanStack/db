/**
 * A rejected direct write changes neither row authority nor Query freshness.
 * Query's staleTime is observer-local: an observer that becomes stale cannot
 * convert a successfully fetched response into a local cache edit. A new peer
 * with staleTime Infinity acquires that response without another request.
 * Authority: Query guide Understanding the Data Stores item 1, Direct Writes
 * and Query Sync; Query Core staleTime/refetchOnMount options; existing primary
 * ownership direct-write-order model's cacheStillFetched rule. Failed update
 * or delete has no accepted write in that rule.
 *
 * The clock abstraction changes Date.now and only Query Core's timer provider.
 * It records and delivers the actual scheduled stale callback. SQLite, browser
 * workers and host timers stay real. No Query state or Collection row is faked.
 * One eager startup, an empty saved baseline, one successful response and one
 * later on-demand peer. No failed I/O, accepted write, cache edit or invalidation.
 */
import fc from 'fast-check'
import { QueryClient, hashKey, timeoutManager } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { queryCollectionOptions } from '../src/query'
import {
  startupTurn,
  untilStartup,
} from '../../db-adapter-conformance/tests/persisted-startup-driver'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { declareOracle } from '../../db/tests/oracle-declaration'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type { ConstructedHistory } from '../../db/tests/oracle-property'
import type { TimeoutProvider } from '@tanstack/query-core'

export type Row = { id: string; value: number }
export type History = {
  shape: 'raw' | 'wrapped'
  write:
    | 'none'
    | 'before-update'
    | 'before-delete'
    | 'during-update'
    | 'during-delete'
  firstValue: number
  nextValue: number
  staleMs: number
}
export type SeenRow = Row & { owners: Array<string> }
export type Trace = Array<{ checkpoint: string; value: unknown }>
export const arbitrary = fc.record({
  shape: fc.constantFrom('raw' as const, 'wrapped' as const),
  write: fc.constantFrom(
    'none' as const,
    'before-update' as const,
    'before-delete' as const,
    'during-update' as const,
    'during-delete' as const,
  ),
  firstValue: fc.integer({ min: -10, max: 10 }),
  nextValue: fc.integer({ min: -10, max: 10 }),
  staleMs: fc.integer({ min: 10, max: 1000 }),
})
export const states = [
  'raw',
  'wrapped',
  'no-write',
  'before-rejected-write',
  'during-rejected-write',
  'update-rejection',
  'delete-rejection',
  'stale-callback-delivered',
  'peer-acquired-fetched-cache',
] as const
export const obligations = new WeakMap<History, ReadonlyArray<string>>()
export const constructed: Array<ConstructedHistory<History>> = states.map(
  (state) => ({
    name: state,
    enters: [state],
    build(h) {
      const built = { ...h }
      if (state === 'raw' || state === 'wrapped') built.shape = state
      if (state === 'no-write') built.write = 'none'
      if (state === 'before-rejected-write') built.write = 'before-update'
      if (state === 'during-rejected-write') built.write = 'during-update'
      if (state === 'update-rejection') built.write = 'during-update'
      if (state === 'delete-rejection') built.write = 'during-delete'
      obligations.set(built, [state])
      return built
    },
  }),
)
// A failed operation adds no authored event to the response authority model.
// Each legal history therefore leaves the first fetched response authoritative.
export function expected(h: History) {
  return {
    rows: [{ id: 'x', value: h.firstValue, owners: ['source'] }],
    calls: 1,
    rejection:
      h.write === 'none'
        ? undefined
        : h.write.endsWith('update')
          ? 'UpdateOperationItemNotFoundError'
          : 'DeleteOperationItemNotFoundError',
  }
}
function gate() {
  let release!: () => void
  const promise = new Promise<void>((r) => (release = r))
  return { promise, release }
}
function rowOwners(metadata: unknown, queryHash: string): Array<string> {
  if (!metadata || typeof metadata !== 'object') return []
  const part = (metadata as Record<string, unknown>).queryCollection
  if (!part || typeof part !== 'object') return []
  const owners = (part as Record<string, unknown>).owners
  return owners && typeof owners === 'object'
    ? Object.keys(owners)
        .map((owner) => (owner === queryHash ? 'source' : owner))
        .sort()
    : []
}
// The fixture advances only timers that Query Core scheduled. It does not call
// an observer update itself. Cleanup removes every scheduled Query timer first.
function queryClock() {
  let now = Date.now(),
    next = 1,
    delivered = 0
  const nativeNow = Date.now
  const tasks = new Map<number, { at: number; callback: (_: void) => void }>()
  const provider: TimeoutProvider<number> = {
    setTimeout(callback, delay) {
      const id = next++
      tasks.set(id, { at: now + delay, callback })
      return id
    },
    clearTimeout(id) {
      if (id !== undefined) tasks.delete(id)
    },
    setInterval() {
      throw new Error('This history schedules no Query interval')
    },
    clearInterval() {},
  }
  Date.now = () => now
  timeoutManager.setTimeoutProvider(provider)
  return {
    get delivered() {
      return delivered
    },
    get scheduled() {
      return tasks.size
    },
    advance(ms: number) {
      const target = now + ms
      for (;;) {
        const due = [...tasks]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        tasks.delete(due[0])
        now = due[1].at
        delivered++
        due[1].callback()
      }
      now = target
    },
    restore() {
      const pending = tasks.size
      Date.now = nativeNow
      timeoutManager.setTimeoutProvider({
        setTimeout: (cb, delay) => globalThis.setTimeout(cb, delay),
        clearTimeout: (id) => globalThis.clearTimeout(id),
        setInterval: (cb, delay) => globalThis.setInterval(cb, delay),
        clearInterval: (id) => globalThis.clearInterval(id),
      })
      if (pending) throw new Error('Leaked Query timers: ' + pending)
    },
  }
}
export async function observeCutoff(
  persistence: PersistedCollectionPersistence,
  h: History,
  id: string,
  observe?: (checkpoint: string, value: unknown) => void,
): Promise<Trace> {
  const trace: Trace = []
  const record = (checkpoint: string, value: unknown) => {
    trace.push({ checkpoint, value })
    observe?.(checkpoint, value)
  }
  const clock = queryClock()
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  })
  const hydration = gate()
  const key = [id],
    queryHash = hashKey(key)
  const receipts: Array<Promise<void>> = []
  let enabled = false,
    entered = false,
    calls = 0,
    commits = 0,
    rejection: string | undefined
  const cacheActions: Array<string> = []
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type === 'updated') cacheActions.push(event.action.type)
  })
  type Response = Array<Row> | { rows: Array<Row> }
  const encode = (value: number): Response =>
    h.shape === 'raw' ? [{ id: 'x', value }] : { rows: [{ id: 'x', value }] }
  const decode = (response: Response) =>
    Array.isArray(response) ? response : response.rows
  const fn = (): Promise<Response> =>
    Promise.resolve(encode(++calls === 1 ? h.firstValue : h.nextValue))
  const options = queryCollectionOptions({
    id,
    queryKey: key,
    queryClient: client,
    queryFn: fn,
    select: decode,
    getKey: (r: Row) => r.id,
    staleTime: h.staleMs,
    enabled: () => enabled,
  })
  const sync = options.sync.sync
  const collection = createCollection(
    persistedCollectionOptions({
      ...options,
      persistence,
      sync: {
        ...options.sync,
        sync(params) {
          const capability = params.metadata!.persistence!
          return sync({
            ...params,
            commit(signal) {
              commits++
              const receipt = params.commit(signal)
              receipts.push(Promise.resolve(receipt).then(() => undefined))
              return receipt
            },
            metadata: {
              ...params.metadata!,
              persistence: {
                ...capability,
                async hydrateBaseline() {
                  await capability.hydrateBaseline()
                  entered = true
                  await hydration.promise
                },
              },
            },
          })
        },
      },
    }),
  )
  const snapshot = (c: {
    values: () => Iterable<Row>
    _state: { syncedMetadata: Map<string | number, unknown> }
  }) =>
    Array.from(c.values(), (row) => ({
      id: row.id,
      value: row.value,
      owners: rowOwners(c._state.syncedMetadata.get(row.id), queryHash),
    })).sort((a, b) => a.id.localeCompare(b.id))
  const durable = async () => {
    if (!persistence.adapter.scanRows)
      throw new Error('Cutoff receiver requires durable scans')
    return (
      await persistence.adapter.scanRows({ kind: 'eager', collectionId: id })
    )
      .map((row) => ({
        ...(row.value as Row),
        owners: rowOwners(row.metadata, queryHash),
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }
  const makePeer = () =>
    createCollection(
      queryCollectionOptions({
        id: id + '-peer',
        queryKey: key,
        queryClient: client,
        queryFn: fn,
        select: decode,
        getKey: (r: Row) => r.id,
        syncMode: 'on-demand',
        staleTime: Infinity,
        startSync: true,
      }),
    )
  let peer: ReturnType<typeof makePeer> | undefined
  const rejectWrite = async () => {
    try {
      if (h.write.endsWith('update'))
        await collection.utils.writeUpdate({ id: 'missing', value: 7 })
      else await collection.utils.writeDelete('missing')
    } catch (error) {
      rejection = (error as Error).constructor.name
    }
  }
  return withOracleCleanup(async () => {
    const preload = collection.preload()
    void preload.catch(() => {})
    await untilStartup(
      () =>
        client.getQueryCache().find({ queryKey: key, exact: true }) !==
        undefined,
    )
    if (h.write.startsWith('before')) await rejectWrite()
    enabled = true
    const fetched = client.fetchQuery({ queryKey: key, queryFn: fn })
    void fetched.catch(() => {})
    await untilStartup(() => entered)
    if (h.write.startsWith('during')) await rejectWrite()
    hydration.release()
    await fetched
    await preload
    record('rejection', rejection)
    record('first', snapshot(collection))
    record('firstDurable', await durable())
    const state = client.getQueryState(key)!
    record('firstFetches', calls)
    const before = {
      commits,
      actions: cacheActions.length,
      updatedAt: state.dataUpdatedAt,
      dataCount: state.dataUpdateCount,
    }
    const scheduled = clock.scheduled
    clock.advance(h.staleMs + 1)
    // Query's listener runs in the delivered callback. Its already-resolved
    // write-settlement continuation drains before the next host task. Await
    // every public applied receipt it returned; repeat if application returned
    // another receipt meanwhile. A valid no-op optimization owes no commit.
    await startupTurn()
    for (;;) {
      const captured = receipts.length
      await Promise.all(receipts)
      await startupTurn()
      if (receipts.length === captured) break
    }
    const afterState = client.getQueryState(key)!
    record('stalePremise', {
      scheduled,
      delivered: clock.delivered,
      adapterCommits: commits - before.commits,
      fetches: calls,
      updatedAtUnchanged: afterState.dataUpdatedAt === before.updatedAt,
      dataCountUnchanged: afterState.dataUpdateCount === before.dataCount,
      actions: cacheActions.slice(before.actions),
      invalidated: afterState.isInvalidated,
    })
    record('afterStale', snapshot(collection))
    record('afterStaleDurable', await durable())
    peer = makePeer()
    await peer._sync.loadSubset({})
    record('peer', snapshot(peer))
    record('peerFetches', calls)
    record('afterPeer', snapshot(collection))
    record('afterPeerDurable', await durable())
    for (const stateName of [
      h.shape,
      ...(h.write === 'none'
        ? ['no-write']
        : rejection
          ? [
              h.write.startsWith('before')
                ? 'before-rejected-write'
                : 'during-rejected-write',
              h.write.endsWith('update')
                ? 'update-rejection'
                : 'delete-rejection',
            ]
          : []),
      ...(clock.delivered === 1 ? ['stale-callback-delivered'] : []),
      ...(calls === 1 ? ['peer-acquired-fetched-cache'] : []),
    ])
      record('reach', stateName)
    record('completed', true)
    return trace
  }, [
    hydration.release,
    () => peer?.cleanup(),
    () => collection.cleanup(),
    () => {
      unsubscribe()
      client.clear()
    },
    () => clock.restore(),
  ])
}
export function cutoffViolations(
  h: History,
  trace: ReadonlyArray<{ checkpoint: string; value: unknown }>,
): Array<{ checkpoint: string; difference: string; law?: string }> {
  const predicted = expected(h)
  const failures: Array<{
    checkpoint: string
    difference: string
    law?: string
  }> = []
  const browserFailures: Array<{
    checkpoint: string
    difference: string
    law?: string
  }> = []
  const value = (cut: string) => trace.find((o) => o.checkpoint === cut)?.value
  const expectedByCut: Record<string, unknown> = {
    rejection: predicted.rejection,
    first: predicted.rows,
    firstDurable: predicted.rows,
    afterStale: predicted.rows,
    afterStaleDurable: predicted.rows,
    peer: predicted.rows,
    afterPeer: predicted.rows,
    afterPeerDurable: predicted.rows,
    firstFetches: predicted.calls,
    peerFetches: predicted.calls,
    completed: true,
  }
  // Judge recorded facts in arrival order. A later missing cut or cleanup
  // failure cannot replace an already recorded public mismatch.
  for (const observation of trace) {
    if (
      Object.prototype.hasOwnProperty.call(
        expectedByCut,
        observation.checkpoint,
      ) &&
      JSON.stringify(observation.value) !==
        JSON.stringify(expectedByCut[observation.checkpoint])
    )
      failures.push({
        checkpoint: observation.checkpoint,
        difference:
          'expected ' +
          JSON.stringify(expectedByCut[observation.checkpoint]) +
          ', observed ' +
          JSON.stringify(observation.value),
      })
    if (observation.checkpoint === 'stalePremise') {
      const premise = observation.value as
        | {
            scheduled: number
            delivered: number
            fetches: number
            updatedAtUnchanged: boolean
            dataCountUnchanged: boolean
            invalidated: boolean
          }
        | undefined
      if (
        !premise ||
        premise.scheduled < 1 ||
        premise.delivered !== 1 ||
        premise.fetches !== 1 ||
        !premise.updatedAtUnchanged ||
        !premise.dataCountUnchanged ||
        premise.invalidated
      )
        failures.push({
          checkpoint: 'stalePremise',
          difference:
            'Actual scheduled stale callback and unchanged fetch freshness were not established',
        })
    }
    if (
      observation.checkpoint === 'browserErrors' &&
      (!Array.isArray(observation.value) || observation.value.length)
    )
      browserFailures.push({
        checkpoint: 'browserErrors',
        difference:
          'Receiving page reported ' + JSON.stringify(observation.value),
        law: 'browser receiving fidelity',
      })
  }
  // Completeness is a separate terminal judgment after all recorded facts.
  const required = [
    ...Object.keys(expectedByCut),
    'stalePremise',
    ...(value('browserReceiver') === true ? ['browserErrors'] : []),
  ]
  for (const checkpoint of required)
    if (!trace.some((o) => o.checkpoint === checkpoint))
      failures.push({
        checkpoint,
        difference: 'Missing required receiving observation',
      })
  const reached = new Set(
    trace.filter((o) => o.checkpoint === 'reach').map((o) => o.value),
  )
  const missing = (obligations.get(h) ?? []).filter(
    (state) => !reached.has(state),
  )
  if (missing.length)
    failures.push({
      checkpoint: 'constructed states',
      difference: missing.join(', '),
    })
  failures.push(...browserFailures)
  const primary = failures[0],
    diagnostics = value('browserErrors')
  if (
    primary &&
    primary.checkpoint !== 'browserErrors' &&
    Array.isArray(diagnostics) &&
    diagnostics.length
  )
    primary.difference +=
      '; secondary browser errors: ' + JSON.stringify(diagnostics)
  return failures
}
declareOracle({
  model: [expected],
  grammar: [arbitrary],
  check: [cutoffViolations],
})
