/**
 * Source ID reuse contract for React's derived live-query identity.
 *
 * A Collection ID names one source object for the lifetime of a mounted
 * derived-identity hook in one DbClient scope. Re-rendering that hook with a different object under
 * the same ID must reject before it can return rows from the old source.
 * Unmounting and cleaning up the old scope permits the ID in a new hook. Two
 * independent client scopes may use the same ID at the same time.
 *
 * Model: each mounted hook remembers the source object first seen for an ID
 * in each client scope. Same object and fresh ID transitions are legal. A
 * different object for a remembered ID is rejected. A new hook starts a new
 * model; switching clients selects that client's remembered bindings.
 * A render that starts a live query claims its source before a descendant
 * suspends, because the live query may still own that source until cleanup.
 * Separate hooks can use same-ID objects: their client-scoped Suspense cache
 * entries must remain distinct, including before the first hook commits.
 * A rejected render must release any sync-start deferral it acquired for a
 * shared client descriptor, so a later direct reader can start that Collection.
 * The release history grammar crosses every rejection cause (a source ID
 * collision, a query without a stable IR identity, a descriptor factory that
 * throws while the query binds its sources, a query the live query rejects
 * when it compiles, a single-result query in an infinite hook, which pages
 * many rows, a sibling that
 * throws after the hook returns, and a render that suspends and never
 * commits), every hook
 * path (live, infinite and Suspense, derived and explicit queryKey forms),
 * initial rejected mounts or rejected rerenders, and four direct readers
 * (another hook, preload, a subscription and startSyncImmediate()). The
 * release must also hold when earlier deferred sync starts throw: each pending
 * Collection is attempted before the first startup error is rethrown.
 * The bounded histories below distinguish this law from a hash-only check,
 * which would miss A(id=x) -> C(id=y) -> B(id=x), a changed predicate, and
 * two different same-ID sources in one query.
 *
 * Driver and observation: render the public hook, then rerender it with each
 * source. At the rerender boundary, compare a thrown error or the public row.
 * A nonempty queryKey owns its identity, so a keyed query skips the claim: a
 * same-ID swap under a changed key reads the new source. The release grammar
 * below runs explicit-key hook paths for rejection causes that remain valid. This does not assert a
 * process-wide Collection registry or other explicit-key semantics.
 */

import {
  act,
  cleanup as cleanupReact,
  render,
  renderHook,
  waitFor,
} from '@testing-library/react'
import {
  DbClient,
  SourceCollectionIdReuseError,
  UnhashableQueryIRError,
  UnsupportedRootScalarSelectError,
  collectionOptions,
  eq,
  gt,
} from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import { Suspense } from 'react'
import { DbProvider } from '../src/DbProvider'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  boundOptionHistories,
  captureBoundOptions,
  checkBoundOptions,
} from '../../db/tests/live-query-bound-options-oracle'
import { withOracleCleanup } from '../../db/tests/utils'
import { TestErrorBoundary, source } from './source-id-reuse-support'
import type {
  Collection,
  InitialQueryBuilder,
  NonSingleResult,
} from '@tanstack/db'
import type { Row } from './source-id-reuse-support'

/**
 * A render may allocate getKey/schema closures without changing the query.
 * Maintainer decision: options bind until the query or explicit queryKey changes.
 * This finite host grammar crosses both config-object hooks, each option and both identity
 * changes. It observes Collection/config references, keys and rows after normal
 * renders, a source update and identity replacement. A render budget catches a
 * loop. React is the real receiving host; other frameworks are not claimed here.
 */

it.each(
  [`live`, `suspense`].flatMap((hook) =>
    boundOptionHistories.map((history) => ({ hook, ...history })),
  ),
)(
  `retains inline options until identity changes: %j`,
  async ({ hook, option, identity }) => {
    const rows = source(
      `inline-options-${hook}-${option}-${identity}`,
      `before`,
    )
    let renders = 0
    const reach = createOracleReach(`inline options ${hook}`, [
      `rerender`,
      `source-update`,
      `identity-change`,
    ])
    reach.beginHistory()
    const { result, rerender, unmount } = renderHook(
      ({ revision }) => {
        if (++renders > 30)
          throw new Error(`inline options rebuilt on every render`)
        const getKey = (row: Row) => row.id
        const schema = {
          '~standard': {
            version: 1 as const,
            vendor: `identity-oracle`,
            validate: (value: unknown) => ({ value: value as Row }),
          },
        }
        const config = {
          query: (q: InitialQueryBuilder) =>
            q
              .from({ row: rows })
              .where(({ row }) =>
                gt(row.rank, identity === `query` ? -revision : 0),
              ),
          ...(identity === `queryKey` ? { queryKey: [revision] } : {}),
          ...(option !== `schema` ? { getKey } : {}),
        }
        // Exercise schema at the JavaScript config boundary: its current
        // public TS declaration is `never`, independently of runtime identity.
        if (option !== `getKey`) Object.assign(config, { schema })
        if (hook === `suspense`) return useLiveSuspenseQuery(config)
        return useLiveQuery(config)
      },
      { initialProps: { revision: 0 } },
    )
    const collections = new Set<{ cleanup: () => Promise<void> }>()
    await withOracleCleanup(async () => {
      await waitFor(() =>
        expect(result.current.collection.status).toBe(`ready`),
      )
      const initial = result.current.collection
      const initialBinding = captureBoundOptions(initial)
      collections.add(initial)
      for (let turn = 0; turn < 3; turn++) {
        rerender({ revision: 0 })
        // Absent options have no binding to compare; the Collection still must stay.
        checkBoundOptions(
          initialBinding,
          result.current.collection,
          false,
          option,
        )
        expect(result.current.data.map((row) => row.id)).toEqual([`one`])
        reach.reach(`rerender`)
      }
      act(() => {
        rows.utils.begin()
        rows.utils.write({
          type: `update`,
          value: { id: `one`, value: `after`, rank: 1 },
        })
        rows.utils.commit()
      })
      expect(result.current.data[0]?.value).toBe(`after`)
      expect(result.current.collection).toBe(initial)
      checkBoundOptions(
        initialBinding,
        result.current.collection,
        false,
        option,
      )
      reach.reach(`source-update`)
      rerender({ revision: 1 })
      collections.add(result.current.collection)
      await waitFor(() =>
        expect(result.current.collection.status).toBe(`ready`),
      )
      // The comparison judges only configured options; absent options may be
      // synthesized by the Collection and have no user binding contract.
      expect(result.current.collection).not.toBe(initial)
      checkBoundOptions(initialBinding, result.current.collection, true, option)
      expect(result.current.data.map((row) => row.id)).toEqual([`one`])
      reach.reach(`identity-change`)
      reach.assertReached()
    }, [
      () => unmount(),
      () =>
        withOracleCleanup(() => {}, [
          ...[...collections].map((collection) => () => collection.cleanup()),
          () => rows.cleanup({ dependents: true }),
        ]),
    ])
  },
)

type Binding = { source: ReturnType<typeof source>; client?: DbClient }

// A prior source with the same ID in this client scope forbids a new object.
// Pairwise history comparison is independent of the hook's token maps.
function expectedCollision(history: ReadonlyArray<Binding>, next: Binding) {
  return history.some(
    (prior) =>
      prior.client === next.client &&
      prior.source.id === next.source.id &&
      prior.source !== next.source,
  )
}

function checkRerender(
  history: ReadonlyArray<Binding>,
  next: Binding,
  rerender: () => void,
) {
  if (expectedCollision(history, next)) {
    expect(rerender).toThrow(SourceCollectionIdReuseError)
  } else {
    expect(rerender).not.toThrow()
  }
}

declareOracle({
  check: [checkRerender, checkReleaseHistory, checkBoundOptions],
  model: [expectedCollision],
  grammar: [boundOptionHistories],
})

/*
 * Release law. A hook in one DbClient scope first reads only its own source,
 * then rerenders into a rejected query that also reads a shared descriptor.
 * The rejected render may defer the shared Collection's sync start, and it
 * must release that deferral: the source stays unstarted until a direct
 * reader asks, and that reader then starts it exactly once and reads its row.
 *
 * Declared reach: every enumerated history must enter the state the law is
 * about, a rejected render that materialized the shared descriptor. Each cell
 * asserts that the descriptor factory ran once before the reader, so a
 * history that rejects before binding the shared source fails instead of
 * passing vacuously.
 */
type ReleaseStep = { current: ReturnType<typeof source>; reject: boolean }

const releaseCauses: Record<
  string,
  (
    shared: any,
    failing: any,
    failures?: { factory: Error; sibling: Error },
  ) => {
    matchesRejection?: (error: unknown) => boolean
    rejected: (step: ReleaseStep) => ReleaseStep
    query: (q: any, step: ReleaseStep, ordered: boolean) => any
    /** Which hook paths the cause rejects in; all of them by default. */
    rejectsIn?: (hook: ReleaseHook) => boolean
    /** A source collision requires a prior mounted claim. */
    requiresPriorClaim?: boolean
    /**
     * What the component does after the hook returns in the rejected step:
     * throw to an error boundary, or suspend on a promise that never settles.
     * Either way the render never commits; the hook itself rejected nothing.
     */
    afterHook?: `throw` | `suspend`
  }
> = {
  'a source ID collision': (shared) => ({
    matchesRejection: (error) => error instanceof SourceCollectionIdReuseError,
    requiresPriorClaim: true,
    rejectsIn: (hook) => !hook.keyed,
    rejected: () => ({
      current: source(`settings`, `replacement`),
      reject: true,
    }),
    query: (q, step, ordered) =>
      orderIf(
        step.reject
          ? q
              .from({ settings: step.current })
              .join({ shared }, ({ settings, shared: row }: any) =>
                eq(settings.id, row.id),
              )
          : q.from({ settings: step.current }),
        ordered,
      ),
  }),
  'a query without a stable IR identity': (shared) => ({
    matchesRejection: (error) => error instanceof UnhashableQueryIRError,
    rejectsIn: (hook) => !hook.keyed,
    rejected: (step) => ({ ...step, reject: true }),
    query: (q, step, ordered) =>
      orderIf(
        step.reject
          ? q
              .from({ settings: step.current })
              .join({ shared }, ({ settings, shared: row }: any) =>
                eq(settings.id, row.id),
              )
              .fn.where(() => true)
          : q.from({ settings: step.current }),
        ordered,
      ),
  }),
  'a descriptor factory that throws': (shared, failing, failures) => ({
    matchesRejection: (error) => error === failures?.factory,
    rejected: (step) => ({ ...step, reject: true }),
    query: (q, step, ordered) =>
      orderIf(
        step.reject
          ? q
              .from({ settings: step.current })
              .join({ shared }, ({ settings, shared: row }: any) =>
                eq(settings.id, row.id),
              )
              .join({ failing }, ({ settings, failing: row }: any) =>
                eq(settings.id, row.id),
              )
          : q.from({ settings: step.current }),
        ordered,
      ),
  }),
  'a query the live query rejects when it compiles': (shared) => ({
    matchesRejection: (error) =>
      error instanceof UnsupportedRootScalarSelectError,
    rejected: (step) => ({ ...step, reject: true }),
    // A root scalar select is valid IR that compilation refuses.
    query: (q, step, ordered) =>
      step.reject
        ? orderIf(
            q
              .from({ settings: step.current })
              .join({ shared }, ({ settings, shared: row }: any) =>
                eq(settings.id, row.id),
              ),
            ordered,
          ).select(({ settings }: any) => settings.value)
        : orderIf(q.from({ settings: step.current }), ordered),
  }),
  'a single-result window query': (shared) => ({
    matchesRejection: (error) =>
      error instanceof Error &&
      error.message.includes(
        `Infinite queries do not support single-result queries`,
      ),
    rejected: (step) => ({ ...step, reject: true }),
    query: (q, step, ordered) => {
      const query = orderIf(
        step.reject
          ? q
              .from({ settings: step.current })
              .join({ shared }, ({ settings, shared: row }: any) =>
                eq(settings.id, row.id),
              )
          : q.from({ settings: step.current }),
        ordered,
      )
      return step.reject ? query.findOne() : query
    },
    // A live query may read one row; an infinite query must page many.
    rejectsIn: (hook) => hook.ordered,
  }),
  'a sibling that throws after the hook returns': (
    shared,
    _failing,
    failures,
  ) => ({
    matchesRejection: (error) => error === failures?.sibling,
    rejected: (step) => ({ ...step, reject: true }),
    query: (q, step, ordered) =>
      orderIf(
        step.reject
          ? q
              .from({ settings: step.current })
              .join({ shared }, ({ settings, shared: row }: any) =>
                eq(settings.id, row.id),
              )
          : q.from({ settings: step.current }),
        ordered,
      ),
    afterHook: `throw`,
    // A Suspense hook that returns has already preloaded its query, which
    // starts its sources, so no deferral is left to release.
    rejectsIn: (hook) => !hook.suspense,
  }),
  'a render that suspends and never commits': (shared) => ({
    rejected: (step) => ({ ...step, reject: true }),
    query: (q, step, ordered) =>
      orderIf(
        step.reject
          ? q
              .from({ settings: step.current })
              .join({ shared }, ({ settings, shared: row }: any) =>
                eq(settings.id, row.id),
              )
          : q.from({ settings: step.current }),
        ordered,
      ),
    afterHook: `suspend`,
    // As above: a Suspense hook's own read is a preload.
    rejectsIn: (hook) => !hook.suspense,
  }),
}

function orderIf(query: any, ordered: boolean) {
  return ordered ? query.orderBy(({ settings }: any) => settings.rank) : query
}

type ReleaseHook = {
  ordered: boolean
  suspense: boolean
  keyed: boolean
  use: (query: (q: any) => any, rejectedIdentity: boolean) => void
}

const releaseHooks: Record<string, ReleaseHook> = {
  'useLiveQuery with derived identity': {
    ordered: false,
    suspense: false,
    keyed: false,
    use: (query) => void useLiveQuery(query),
  },

  'useLiveInfiniteQuery with derived identity': {
    ordered: true,
    suspense: false,
    keyed: false,
    use: (query) => void useLiveInfiniteQuery(query, { pageSize: 1 }),
  },

  // A config can turn off the reclaim: gcTime 0 or Infinity disables GC, and
  // startSync false never arms it. A render that never commits must still
  // release its deferral.
  'useLiveQuery with gcTime 0': {
    ordered: false,
    suspense: false,
    keyed: false,
    use: (query) => void useLiveQuery({ query, gcTime: 0 }),
  },
  'useLiveQuery with gcTime Infinity': {
    ordered: false,
    suspense: false,
    keyed: false,
    use: (query) => void useLiveQuery({ query, gcTime: Infinity }),
  },
  'useLiveQuery with startSync false': {
    ordered: false,
    suspense: false,
    keyed: false,
    use: (query) => void useLiveQuery({ query, startSync: false }),
  },
  'useLiveSuspenseQuery with derived identity': {
    ordered: false,
    suspense: true,
    keyed: false,
    use: (query) => void useLiveSuspenseQuery(query),
  },
}

// Explicit keys skip source-ID and derived-IR guards. Factory, compiler,
// window-shape and abandoned-render failures still owe release on these paths.
// The key changes with the authored query; a constant key would legally retain
// the accepted query and never acquire the rejected render's shared descriptor.
releaseHooks[`useLiveQuery with queryKey`] = {
  ordered: false,
  suspense: false,
  keyed: true,
  use: (query, rejectedIdentity) =>
    void useLiveQuery({
      query,
      queryKey: [`release-keyed-live`, rejectedIdentity],
    }),
}
releaseHooks[`useLiveInfiniteQuery with queryKey`] = {
  ordered: true,
  suspense: false,
  keyed: true,
  use: (query, rejectedIdentity) =>
    void useLiveInfiniteQuery(query, {
      pageSize: 1,
      queryKey: [`release-keyed-infinite`, rejectedIdentity],
    }),
}
releaseHooks[`useLiveSuspenseQuery with queryKey`] = {
  ordered: false,
  suspense: true,
  keyed: true,
  use: (query, rejectedIdentity) =>
    void useLiveSuspenseQuery({
      query,
      queryKey: [`release-keyed-suspense`, rejectedIdentity],
    }),
}

type SharedReleaseCollection = Collection<Row, string, {}, never, Row> &
  NonSingleResult
type ReleaseObservation = { starts: number; status: string; rows: Array<Row> }
type ReleaseReader = (shared: SharedReleaseCollection) => {
  observe: () => Omit<ReleaseObservation, `starts`>
  ready?: Promise<unknown>
  dispose?: () => void
}
const projectReleaseRows = (rows: ReadonlyArray<Row>) =>
  rows
    .map(({ id, value, rank }) => ({ id, value, rank }))
    .sort((a, b) => a.id.localeCompare(b.id))
const releaseReaders: Record<string, ReleaseReader> = {
  'another hook over the Collection': (shared) => {
    const reader = renderHook(() => useLiveQuery(shared))
    return {
      observe: () => ({
        status: reader.result.current.status,
        rows: projectReleaseRows(reader.result.current.data),
      }),
      dispose: () => reader.unmount(),
    }
  },
  'startSyncImmediate()': (shared) => {
    shared.startSyncImmediate()
    return {
      observe: () => ({
        status: shared.status,
        rows: projectReleaseRows(shared.toArray),
      }),
    }
  },
  'preload()': (shared) => {
    const ready = shared.preload()
    void ready.catch(() => {})
    return {
      ready,
      observe: () => ({
        status: shared.status,
        rows: projectReleaseRows(shared.toArray),
      }),
    }
  },
  'a direct subscription': (shared) => {
    // Observe this receiving subscription's deliveries. Reading shared.toArray
    // would let missing callbacks pass whenever Collection storage was correct.
    const replica = new Map<string, Row>()
    const subscription = shared.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.type === `delete`) replica.delete(change.key)
          else {
            const { id, value, rank } = change.value
            replica.set(change.key, { id, value, rank })
          }
        }
      },
      {
        includeInitialState: true,
      },
    )
    return {
      observe: () => ({
        status: shared.status,
        rows: projectReleaseRows([...replica.values()]),
      }),
      dispose: () => subscription.unsubscribe(),
    }
  },
}

/** The release judgment knows authored source facts, not hook/cache machinery.
 * Independent demand starts one healthy source. A later source publication
 * replaces the row's value, and every direct reader must receive that whole row.
 * An after-hook throw/suspension can be reclaimed before or after the read; it
 * owes the same final result. No synchronous reclaim deadline is imposed.
 */
function expectedReleaseObservation(row: Row): ReleaseObservation {
  return { starts: 1, status: `ready`, rows: [{ ...row }] }
}
function checkReleaseObservation(
  actual: ReleaseObservation,
  expected: ReleaseObservation,
): void {
  expect(actual).toEqual(expected)
}

/** Every rendered history must first materialize its shared descriptor. The
 * premise is checked before independent demand, rather than inferred from final
 * rows. Initial mount and rerender are different receiving paths. The source-ID
 * collision requires the rerender's prior claim; a keyed input intentionally
 * bypasses that rejection and is excluded only from those identity causes.
 *
 * Cleanup registers React's native root inventory before calling render. It
 * therefore releases a partially constructed mount even without a returned
 * handle. Independent subscriptions, client ownership and plain source objects
 * are released separately; one cleanup failure cannot erase the primary error.
 */
let releaseSequence = 0
async function checkReleaseHistory(
  makeCause: (typeof releaseCauses)[string],
  hook: ReleaseHook,
  read: ReleaseReader,
  atMount: boolean,
) {
  const reach = createOracleReach(`React descriptor release`, [
    `prepared`,
    `reader-ready`,
    `source-update`,
  ])
  reach.beginHistory()
  const client = new DbClient()
  const sources = new Set<ReturnType<typeof source>>()
  const id = `release-shared-${releaseSequence++}`
  let syncStarts = 0
  let materialized = 0
  const initialRow: Row = { id: `one`, value: `shared`, rank: 1 }
  const nextRow: Row = { ...initialRow, value: `updated`, rank: 2 }
  let publish!: (row: Row) => void
  const shared = collectionOptions(id, () => {
    materialized++
    return {
      id,
      getKey: (row: Row) => row.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          syncStarts++
          begin()
          write({ type: `insert`, value: { ...initialRow } })
          commit()
          markReady()
          publish = (row) => {
            begin()
            write({ type: `update`, value: { ...row } })
            commit()
          }
        },
      },
    }
  })
  const failures = {
    factory: new Error(`descriptor factory failed`),
    sibling: new Error(`sibling failed`),
  }
  const failing = collectionOptions(`${id}-failing`, () => {
    throw failures.factory
  })
  const cause = makeCause(shared, failing, failures)
  const rejections: Array<unknown> = []
  let afterHookReached = 0
  class CaptureBoundary extends TestErrorBoundary {
    componentDidCatch(error: Error) {
      rejections.push(error)
    }
  }
  const never = new Promise<void>(() => {})
  function View({ step }: { step: ReleaseStep }) {
    hook.use((q) => cause.query(q, step, hook.ordered), step.reject)
    if (step.reject && cause.afterHook) {
      afterHookReached++
      if (cause.afterHook === `throw`) throw failures.sibling
      throw never
    }
    return <div>Query</div>
  }
  const tree = (step: ReleaseStep) => (
    <DbProvider client={client}>
      <CaptureBoundary>
        <Suspense fallback={<div>Loading</div>}>
          <View step={step} />
        </Suspense>
      </CaptureBoundary>
    </DbProvider>
  )
  const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
  let reader: ReturnType<ReleaseReader> | undefined
  const cleanups: Array<() => unknown> = [
    () => reader?.dispose?.(),
    () => cleanupReact(),
    () => client.cleanup(),
    () => consoleError.mockRestore(),
  ]
  const remember = (collection: ReturnType<typeof source>) => {
    if (!sources.has(collection)) cleanups.push(() => collection.cleanup())
    sources.add(collection)
  }
  await withOracleCleanup(async () => {
    const initial = { current: source(`settings`, `first`), reject: false }
    remember(initial.current)
    const rejected = cause.rejected(initial)
    remember(rejected.current)
    const root = render(tree(atMount ? rejected : initial))
    await act(async () => {})
    if (!atMount) root.rerender(tree(rejected))
    expect(
      root.getByText(cause.afterHook === `suspend` ? `Loading` : `Rejected`),
    ).toBeDefined()
    expect(materialized, `shared descriptor bound before rejected render`).toBe(
      1,
    )
    if (cause.afterHook) expect(afterHookReached).toBeGreaterThan(0)
    else expect(afterHookReached).toBe(0)
    if (cause.afterHook === `suspend`) expect(rejections).toEqual([])
    else {
      expect(
        rejections.length,
        `authored rejection reached boundary`,
      ).toBeGreaterThan(0)
      for (const error of rejections)
        expect(
          cause.matchesRejection?.(error),
          `intended rejection: ${String(error)}`,
        ).toBe(true)
    }
    if (!cause.afterHook) expect(syncStarts).toBe(0)
    reach.reach(`prepared`)
    const collection = client.collection(shared)
    act(() => {
      reader = read(collection)
    })
    if (cause.afterHook) await waitFor(() => expect(syncStarts).toBe(1))
    else expect(syncStarts).toBe(1)
    await reader!.ready
    await act(async () => {})
    checkReleaseObservation(
      { starts: syncStarts, ...reader!.observe() },
      expectedReleaseObservation(initialRow),
    )
    reach.reach(`reader-ready`)
    act(() => {
      publish(nextRow)
    })
    await act(async () => {})
    checkReleaseObservation(
      { starts: syncStarts, ...reader!.observe() },
      expectedReleaseObservation(nextRow),
    )
    reach.reach(`source-update`)
    reach.assertReached()
  }, cleanups)
}

describe(`React source ID reuse: rejected renders release deferred sync starts`, () => {
  for (const [causeName, makeCause] of Object.entries(releaseCauses))
    for (const [hookName, hook] of Object.entries(releaseHooks)) {
      const probe = makeCause(undefined, undefined)
      if (probe.rejectsIn && !probe.rejectsIn(hook)) continue
      for (const [readerName, read] of Object.entries(releaseReaders))
        for (const atMount of probe.requiresPriorClaim
          ? [false]
          : [false, true])
          it(`after ${causeName} in ${hookName}, ${readerName} starts the shared source (${atMount ? `mount` : `rerender`})`, () =>
            checkReleaseHistory(makeCause, hook, read, atMount))
    }
})
it.each([
  `missing-start`,
  `extra-start`,
  `wrong-row`,
  `duplicate-row`,
] as const)(`rejects wrong descriptor release observation: %s`, (fault) => {
  const expected = expectedReleaseObservation({
    id: `one`,
    value: `authored`,
    rank: 2,
  })
  const actual = { ...expected, rows: expected.rows.map((row) => ({ ...row })) }
  checkReleaseObservation(actual, expected)
  if (fault === `missing-start`) actual.starts = 0
  if (fault === `extra-start`) actual.starts = 2
  if (fault === `wrong-row`) actual.rows[0]!.rank++
  if (fault === `duplicate-row`) actual.rows.push({ ...actual.rows[0]! })
  expect(() => checkReleaseObservation(actual, expected)).toThrow()
})

declareOracle({
  check: [checkReleaseObservation],
  model: [expectedReleaseObservation],
  grammar: [releaseCauses, releaseHooks, releaseReaders],
})

describe(`React source ID reuse`, () => {
  it(`rejects a different active source with the same ID before exposing stale rows`, async () => {
    const first = source(`settings`, `first`)
    const second = source(`settings`, `second`)
    const hook = renderHook(
      ({ current }) =>
        useLiveQuery({ query: (q) => q.from({ settings: current }) }),
      { initialProps: { current: first } },
    )

    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    checkRerender([{ source: first }], { source: second }, () =>
      hook.rerender({ current: second }),
    )
  })

  it(`rejects a previously used ID after another source and a query change`, async () => {
    const first = source(`settings`, `first`)
    const other = source(`other`, `other`)
    const second = source(`settings`, `second`)
    const hook = renderHook(
      ({ current, minimum }) =>
        useLiveQuery({
          query: (q) =>
            q
              .from({ settings: current })
              .where(({ settings }) => gt(settings.rank, minimum)),
        }),
      { initialProps: { current: first, minimum: 0 } },
    )

    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    act(() => hook.rerender({ current: other, minimum: 0 }))
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`other`),
    )
    checkRerender(
      [{ source: first }, { source: other }],
      { source: second },
      () => hook.rerender({ current: second, minimum: -1 }),
    )
  })

  it(`accepts the same source object and a different source ID`, async () => {
    const first = source(`settings`, `first`)
    const other = source(`other`, `other`)
    const hook = renderHook(
      ({ current }) =>
        useLiveQuery({ query: (q) => q.from({ settings: current }) }),
      { initialProps: { current: first } },
    )

    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    checkRerender([{ source: first }], { source: first }, () =>
      hook.rerender({ current: first }),
    )
    expect(hook.result.current.data[0]?.value).toBe(`first`)
    checkRerender([{ source: first }], { source: other }, () =>
      hook.rerender({ current: other }),
    )
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`other`),
    )
  })

  it(`keeps a mounted hook's ID binding after source cleanup`, async () => {
    const first = source(`settings`, `first`)
    const second = source(`settings`, `second`)
    const hook = renderHook(
      ({ current }) =>
        useLiveQuery({ query: (q) => q.from({ settings: current }) }),
      { initialProps: { current: first } },
    )
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    await act(async () => first.cleanup({ dependents: true }))
    checkRerender([{ source: first }], { source: second }, () =>
      hook.rerender({ current: second }),
    )
  })

  it(`remembers each client scope when one mounted hook switches clients`, async () => {
    const firstClient = new DbClient()
    const secondClient = new DbClient()
    const first = source(`settings`, `first`)
    const otherScope = source(`settings`, `other`)
    const replacement = source(`settings`, `replacement`)
    const hook = renderHook(
      ({ client, current }) =>
        useLiveQuery({
          client,
          query: (q) => q.from({ settings: current }),
        }),
      { initialProps: { client: firstClient, current: first } },
    )

    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    hook.rerender({ client: secondClient, current: otherScope })
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`other`),
    )
    checkRerender(
      [
        { source: first, client: firstClient },
        { source: otherScope, client: secondClient },
      ],
      { source: replacement, client: firstClient },
      () => hook.rerender({ client: firstClient, current: replacement }),
    )
  })

  it(`rejects same-ID reuse after a suspended render starts a source query`, async () => {
    const first = source(`first`, `first`)
    const abandoned = source(`candidate`, `abandoned`)
    const replacement = source(`candidate`, `replacement`)
    const never = new Promise<void>(() => {})
    const View = ({
      current,
      suspend,
    }: {
      current: typeof first
      suspend: boolean
    }) => {
      const { data } = useLiveQuery({
        query: (q) => q.from({ settings: current }),
      })
      if (suspend) throw never
      return <div>{data[0]?.value}</div>
    }
    const root = render(
      <Suspense fallback={<div>Loading</div>}>
        <View current={first} suspend={false} />
      </Suspense>,
    )
    await waitFor(() => expect(root.getByText(`first`)).toBeDefined())

    root.rerender(
      <Suspense fallback={<div>Loading</div>}>
        <View current={abandoned} suspend={true} />
      </Suspense>,
    )
    checkRerender(
      [{ source: first }, { source: abandoned }],
      { source: replacement },
      () =>
        root.rerender(
          <Suspense fallback={<div>Loading</div>}>
            <View current={replacement} suspend={false} />
          </Suspense>,
        ),
    )
  })
})

/**
 * ## useLiveInfiniteQuery
 *
 * The infinite hook derives its identity the same way, and keeps the window
 * collection built by its latest render for a second render before commit.
 * That cache is keyed by derived identity, which names sources by ID, so the
 * same law applies: a different same-ID source must reject before the hook
 * can publish the old source's rows, from a committed or a suspended render.
 * This driver reuses the model above with the bounded histories that
 * distinguish the law from a hash-only check.
 */
describe(`React source ID reuse: useLiveInfiniteQuery`, () => {
  const useInfinite = (current: ReturnType<typeof source>) =>
    useLiveInfiniteQuery(
      (q) =>
        q.from({ settings: current }).orderBy(({ settings }) => settings.rank),
      { pageSize: 1 },
    )

  it(`rejects a different active source with the same ID before exposing stale rows`, async () => {
    const first = source(`settings`, `first`)
    const second = source(`settings`, `second`)
    const hook = renderHook(({ current }) => useInfinite(current), {
      initialProps: { current: first },
    })
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    checkRerender([{ source: first }], { source: second }, () =>
      hook.rerender({ current: second }),
    )
  })

  it(`rejects a previously used ID after another source`, async () => {
    const first = source(`settings`, `first`)
    const other = source(`other`, `other`)
    const second = source(`settings`, `second`)
    const hook = renderHook(({ current }) => useInfinite(current), {
      initialProps: { current: first },
    })
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    act(() => hook.rerender({ current: other }))
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`other`),
    )
    checkRerender(
      [{ source: first }, { source: other }],
      { source: second },
      () => hook.rerender({ current: second }),
    )
  })

  it(`accepts the same source object and a different source ID`, async () => {
    const first = source(`settings`, `first`)
    const other = source(`other`, `other`)
    const hook = renderHook(({ current }) => useInfinite(current), {
      initialProps: { current: first },
    })
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    checkRerender([{ source: first }], { source: first }, () =>
      hook.rerender({ current: first }),
    )
    checkRerender([{ source: first }], { source: other }, () =>
      hook.rerender({ current: other }),
    )
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`other`),
    )
  })

  it(`rejects same-ID reuse after a suspended render starts a source query`, async () => {
    const first = source(`first`, `first`)
    const abandoned = source(`candidate`, `abandoned`)
    const replacement = source(`candidate`, `replacement`)
    const never = new Promise<void>(() => {})
    const View = ({
      current,
      suspend,
    }: {
      current: typeof first
      suspend: boolean
    }) => {
      const { data } = useInfinite(current)
      if (suspend) throw never
      return <div>{data[0]?.value}</div>
    }
    const root = render(
      <Suspense fallback={<div>Loading</div>}>
        <View current={first} suspend={false} />
      </Suspense>,
    )
    await waitFor(() => expect(root.getByText(`first`)).toBeDefined())
    root.rerender(
      <Suspense fallback={<div>Loading</div>}>
        <View current={abandoned} suspend={true} />
      </Suspense>,
    )
    checkRerender(
      [{ source: first }, { source: abandoned }],
      { source: replacement },
      () =>
        root.rerender(
          <Suspense fallback={<div>Loading</div>}>
            <View current={replacement} suspend={false} />
          </Suspense>,
        ),
    )
  })
})
