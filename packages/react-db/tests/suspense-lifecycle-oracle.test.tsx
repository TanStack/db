/**
 * A Suspense binding owes the current initial attempt's fallback, rows or error.
 * Its first source failure reaches the ErrorBoundary as an Error (original Error
 * identity, otherwise wrapped cause); a failure after readiness keeps the data.
 * Cleanup/restart and a replacement client request start a new attempt: an old
 * rejection cannot poison it. A settled initial load must make retry progress,
 * even when React discarded the first suspended render's refs. Successful query
 * inputs own distinct Collections. Authority: error-handling.md, “Using Suspense
 * and Error Boundaries”, hook JSDoc, shared conformance contract, and the existing
 * useLiveSuspenseQuery-recovery.test.tsx replacement/cleanup promises.
 *
 * The model below retains only the newest attempt and its public view. It has no
 * cache, resolver token, observer or subscription state. Real React boundaries
 * receive controlled source-demand and client-request histories. Query-only
 * preload failures use the public Collection preload seam; no external provider,
 * native hydration, arbitrary React scheduler or nonfinite window claim follows.
 * Error messages remain with the supplied-query boundary contract examples; a
 * source problem message is not the derived live-query problem message.
 */
import { Component, Suspense, useLayoutEffect } from 'react'
import { act, render } from '@testing-library/react'
import {
  BTreeIndex,
  DbClient,
  createCollection,
  createLiveQueryCollection,
  getStableValueHash,
} from '@tanstack/db'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { DbProvider } from '../src/DbProvider'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import {
  checkWindowObservation,
  checkWindowState,
  windowRows,
} from '../../db/tests/conformance/window-history-oracle'
import { ScenarioLifetime } from '../../db/tests/conformance/scenario-lifetime'
import {
  expectKeyedRows,
  expectUnorderedRows,
} from '../../db/tests/conformance/result-laws'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  atOracleCheckpoint,
  createOracleFailureFidelity,
} from '../../db/tests/oracle-failure-fidelity'
import {
  declareOracle,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config'
import type { WindowRow } from '../../db/tests/conformance/window-history-oracle'
import type { ReactNode } from 'react'
import type { HealthNode, SyncConfig } from '@tanstack/db'

type Row = { id: string; version: number }
type CauseKind = `Error` | `record` | `undefined`
type Scope = `none` | `provider` | `explicit`
type View = {
  phase: `pending` | `ready` | `error`
  rows: Array<Row>
  cause?: unknown
  wrapCause: boolean
  healthError: boolean
}
// `attempt` is a model-only initial-view obligation. It combines a boundary
// reset with the source sync run or client request it now waits for. It does
// not represent an acquisition attempt, observer, or internal resolver token.
type Model = View & { attempt: number }
type Event =
  | { type: `start`; attempt: number }
  | { type: `ready`; attempt: number; rows: Array<Row> }
  | {
      type: `failure`
      attempt: number
      cause: unknown
      origin: `source` | `preload` | `client`
    }

// A new attempt replaces the visible obligation. A stale event has no authority.
// Source fail after readiness is health, not a new initial-load gate (glossary).
function advance(model: Model, event: Event): Model {
  if (event.type === `start`)
    return {
      attempt: event.attempt,
      phase: `pending`,
      rows: [],
      wrapCause: false,
      healthError: false,
    }
  if (event.attempt !== model.attempt) return model
  if (event.type === `ready`)
    return { ...model, phase: `ready`, rows: event.rows, cause: undefined }
  if (model.phase === `ready` && event.origin === `source`)
    return { ...model, cause: event.cause, healthError: true }
  return {
    ...model,
    phase: `error`,
    rows: [],
    cause: event.cause,
    wrapCause: event.origin !== `client`,
  }
}
const initial = (): Model => ({
  attempt: 0,
  phase: `pending`,
  rows: [],
  wrapCause: false,
  healthError: false,
})
function makeCause(kind: CauseKind, version: number): unknown {
  return kind === `Error`
    ? new Error(`load ${version} failed`)
    : kind === `record`
      ? { code: `offline`, version }
      : undefined
}
function rowsFor(count: number, version: number): Array<Row> {
  return Array.from({ length: count }, (_, id) => ({ id: String(id), version }))
}

type Result = {
  data: unknown
  state: ReadonlyMap<string | number, object>
  collection: object
  health: HealthNode | undefined
}
type Recorded = { result?: Result; error?: unknown }
class Boundary extends Component<
  { children: ReactNode; record: Recorded },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    this.props.record.error = error
  }
  render() {
    return this.state.failed ? (
      <output data-phase="error" />
    ) : (
      this.props.children
    )
  }
}
function frame(
  child: ReactNode,
  record: Recorded,
  key: number,
  client?: DbClient,
) {
  const content = (
    <Boundary key={key} record={record}>
      <Suspense fallback={<output data-phase="pending" />}>{child}</Suspense>
    </Boundary>
  )
  return client ? <DbProvider client={client}>{content}</DbProvider> : content
}

// Compare the actual committed host surface; a previously returned result cannot
// disguise a current fallback/error. Empty results remain distinguishable from it.
function compare(
  host: HTMLElement,
  record: Recorded,
  model: Model,
  cut: string,
) {
  atOracleCheckpoint(`current Suspense attempt`, cut, () => {
    expect(host.querySelector(`output`)?.getAttribute(`data-phase`)).toBe(
      model.phase,
    )
    if (model.phase === `ready`) {
      expect(record.result, `a successful binding committed`).toBeDefined()
      expectUnorderedRows(record.result!.data, model.rows)
      expectKeyedRows(record.result!.state, model.rows)
      if (model.healthError) {
        const problem = record.result!.health?.sources[0]?.error
        expect(problem, `a stopped source has a health problem`).toBeDefined()
        expect(problem?.cause).toBe(model.cause)
      }
    }
    if (model.phase === `error`) {
      if (model.wrapCause && !(model.cause instanceof Error)) {
        expect(record.error).toBeInstanceOf(Error)
        expect((record.error as Error).cause).toBe(model.cause)
      } else expect(record.error).toBe(model.cause)
    }
  })
}
async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

// Each history fails, crashes, or abandons its initial load, then cleans up
// before a new sync run. Only that new run may become ready. Bounded rows and
// pending rerenders vary the public result and discarded-render retry path.
const retryArbitrary = fc.record({
  count: fc.integer({ min: 0, max: 3 }),
  version: fc.integer({ min: 0, max: 3 }),
  rerenders: fc.integer({ min: 0, max: 2 }),
  cause: fc.constantFrom<CauseKind>(`Error`, `record`, `undefined`),
  first: fc.constantFrom(`fail` as const, `crash` as const, `abandon` as const),
  remount: fc.boolean(),
})
type HistoryOf<T> = T extends fc.Arbitrary<infer History> ? History : never
type RetryHistory = HistoryOf<typeof retryArbitrary>
const retryExamples: Array<[RetryHistory]> = [
  [
    {
      count: 0,
      version: 0,
      rerenders: 2,
      cause: `Error`,
      first: `fail`,
      remount: false,
    },
  ],
  [
    {
      count: 2,
      version: 1,
      rerenders: 0,
      cause: `undefined`,
      first: `crash`,
      remount: true,
    },
  ],
  [
    {
      count: 3,
      version: 2,
      rerenders: 1,
      cause: `record`,
      first: `abandon`,
      remount: false,
    },
  ],
]
const retryStates = [
  `fail`,
  `crash`,
  `abandon`,
  `root remount`,
  `boundary reset`,
  `initial fallback`,
  `first failure`,
  `pending retirement`,
  `new attempt pending`,
  `retry progress`,
  `independent peer`,
  `post-ready failure`,
] as const

async function checkRetry(
  history: RetryHistory,
  scope: Scope,
  keyed: boolean,
  reach: ReturnType<typeof createOracleReach<(typeof retryStates)[number]>>,
) {
  const lifetime = new ScenarioLifetime()
  const record: Recorded = {}
  const peerRecord: Recorded = {}
  let mounted: ReturnType<typeof render> | undefined
  let peer: ReturnType<typeof render> | undefined
  lifetime.defer(() => {
    mounted?.unmount()
    peer?.unmount()
  })
  const client = scope === `none` ? undefined : new DbClient()
  if (client) lifetime.defer(() => client.cleanup())
  const diagnostics = vi.spyOn(console, `error`).mockImplementation(() => {})
  lifetime.defer(() => {
    diagnostics.mockRestore()
  })
  await lifetime.run(async () => {
    const cause = makeCause(history.cause, history.version)
    let run = 0
    let current!: Parameters<SyncConfig<Row, string>[`sync`]>[0]
    const demands: Array<{
      run: number
      resolve: () => void
      reject: (error: unknown) => void
    }> = []
    const source = createCollection<Row, string>({
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          const thisRun = ++run
          current = params
          if (thisRun === 1 && history.first === `crash`) throw cause
          return {
            loadSubset: () =>
              new Promise<void>((resolve, reject) => {
                demands.push({ run: thisRun, resolve, reject })
              }),
          }
        },
      },
    })
    lifetime.defer(() => source.cleanup({ dependents: true }))
    function Consumer({ target }: { target: Recorded }) {
      const result = useLiveSuspenseQuery({
        query: (q) =>
          q
            .from({ row: source })
            .select(({ row }) => ({ id: row.id, version: row.version })),
        ...(scope === `explicit` ? { client } : {}),
        ...(keyed ? { queryKey: [`retry-source`] } : {}),
        gcTime: 0,
      })
      useLayoutEffect(() => {
        target.result = result
      })
      return <output data-phase="ready" />
    }
    const tree = (key: number) =>
      frame(
        <Consumer target={record} />,
        record,
        key,
        scope === `provider` ? client : undefined,
      )
    let model = initial()
    mounted = render(tree(0))
    await settle()
    if (history.first === `crash`) {
      model = advance(model, {
        type: `failure`,
        attempt: 0,
        cause,
        origin: `source`,
      })
      compare(mounted.container, record, model, `initial crash`)
      reach.reach(`first failure`)
      reach.reach(`crash`)
    } else {
      compare(mounted.container, record, model, `initial pending`)
      expect(demands.length, `real query demand started`).toBeGreaterThan(0)
      reach.reach(`initial fallback`)
      for (let n = 0; n < history.rerenders; n++) {
        mounted.rerender(tree(0))
        await settle()
        compare(mounted.container, record, model, `pending rerender`)
      }
      if (history.first === `fail`) {
        await act(() => current.fail(cause))
        await settle()
        model = advance(model, {
          type: `failure`,
          attempt: 0,
          cause,
          origin: `source`,
        })
        compare(mounted.container, record, model, `first load failure`)
        reach.reach(`first failure`)
        reach.reach(`fail`)
      } else {
        reach.reach(`pending retirement`)
        reach.reach(`abandon`)
      }
    }
    // Retire the failed/pending source run before resetting its boundary. Its
    // unresolved work may reject later; that event has no authority over run2.
    await act(() => source.cleanup({ dependents: true }))
    if (history.remount) {
      mounted.unmount()
      mounted = render(tree(1))
    } else mounted.rerender(tree(1))
    await settle()
    model = advance(model, { type: `start`, attempt: 1 })
    compare(mounted.container, record, model, `new attempt pending`)
    expect(run, `cleanup was followed by a new source sync run`).toBe(2)
    reach.reach(`new attempt pending`)
    reach.reach(history.remount ? `root remount` : `boundary reset`)
    await act(() => {
      for (const demand of demands.filter((d) => d.run === 1))
        demand.reject(cause)
    })
    await settle()
    model = advance(model, {
      type: `failure`,
      attempt: 0,
      cause,
      origin: `source`,
    })
    compare(
      mounted.container,
      record,
      model,
      `retired source rejects during new attempt`,
    )
    const rows = rowsFor(history.count, history.version + 1)
    await act(() => {
      current.begin()
      for (const value of rows) current.write({ type: `insert`, value })
      current.commit()
      current.markReady()
      for (const demand of demands.filter((d) => d.run === 2)) demand.resolve()
    })
    await settle()
    model = advance(model, {
      type: `ready`,
      attempt: 1,
      rows: rowsFor(history.count, history.version + 1),
    })
    compare(
      mounted.container,
      record,
      model,
      `settled load makes retry progress`,
    )
    reach.reach(`retry progress`)
    peer = render(
      frame(
        <Consumer target={peerRecord} />,
        peerRecord,
        0,
        scope === `provider` ? client : undefined,
      ),
    )
    await act(() => {
      for (const demand of demands.filter((d) => d.run === 2)) demand.resolve()
    })
    await settle()
    compare(peer.container, peerRecord, model, `successful peer`)
    atOracleCheckpoint(`exclusive successful outputs`, `peer ownership`, () => {
      expect(peerRecord.result!.collection).not.toBe(record.result!.collection)
    })
    reach.reach(`independent peer`)
    const stopped = makeCause(history.cause, history.version + 2)
    await act(() => current.fail(stopped))
    await settle()
    model = advance(model, {
      type: `failure`,
      attempt: 1,
      cause: stopped,
      origin: `source`,
    })
    compare(mounted.container, record, model, `source stops after readiness`)
    compare(
      peer.container,
      peerRecord,
      model,
      `peer keeps data after source stops`,
    )
    reach.reach(`post-ready failure`)
  })
}

// These request-only histories keep query preload pending. A client snapshot
// supplies the replacement rows; source writes cannot accidentally rescue it.
const replacementArbitrary = fc.record({
  count: fc.integer({ min: 0, max: 3 }),
  version: fc.integer({ min: 0, max: 3 }),
  cause: fc.constantFrom<CauseKind>(`Error`, `record`, `undefined`),
  schedule: fc.constantFrom(
    `failure-first` as const,
    `replace-first` as const,
    `cleanup-first` as const,
    `client-first` as const,
  ),
})
type ReplacementHistory = HistoryOf<typeof replacementArbitrary>
const replacementExamples: Array<[ReplacementHistory]> = [
  [{ count: 0, version: 0, cause: `undefined`, schedule: `failure-first` }],
  [{ count: 1, version: 1, cause: `Error`, schedule: `replace-first` }],
  [{ count: 2, version: 2, cause: `record`, schedule: `cleanup-first` }],
  [{ count: 3, version: 3, cause: `undefined`, schedule: `client-first` }],
]
const replacementStates = [
  `failure-first`,
  `replace-first`,
  `cleanup-first`,
  `client-first`,
  `first request pending`,
  `first request failure`,
  `replacement pending`,
  `late rejection ignored`,
  `replacement ready`,
] as const
async function checkReplacement(
  history: ReplacementHistory,
  reach: ReturnType<
    typeof createOracleReach<(typeof replacementStates)[number]>
  >,
) {
  const lifetime = new ScenarioLifetime()
  let mounted: ReturnType<typeof render> | undefined
  lifetime.defer(() => mounted?.unmount())
  const clients = [new DbClient(), new DbClient()]
  lifetime.defer(async () => {
    for (const client of clients) await client.cleanup()
  })
  const diagnostics = vi.spyOn(console, `error`).mockImplementation(() => {})
  lifetime.defer(() => {
    diagnostics.mockRestore()
  })
  await lifetime.run(async () => {
    const source = createCollection<Row, string>({
      getKey: (row) => row.id,
      sync: { sync: () => ({}) },
    })
    const query = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .select(({ row }) => ({ id: row.id, version: row.version })),
    )
    const preload = vi
      .spyOn(query, `preload`)
      .mockReturnValue(new Promise<void>(() => {}))
    lifetime.defer(() => {
      preload.mockRestore()
    })
    lifetime.defer(() => query.cleanup())
    lifetime.defer(() => source.cleanup({ dependents: true }))
    const hash = getStableValueHash([`collection`, query.id], `queryKey`)
    const cause = makeCause(history.cause, history.version)
    let rejectOld!: (error: unknown) => void
    const old = new Promise<{ rows: Array<{ key: string; value: Row }> }>(
      (_, reject) => {
        rejectOld = reject
      },
    )
    void clients[0]!._registerLiveQuery(hash, old).catch(() => {})
    const record: Recorded = {}
    function Consumer() {
      const result = useLiveSuspenseQuery(query)
      useLayoutEffect(() => {
        record.result = result
      })
      return <output data-phase="ready" />
    }
    let model = initial()
    mounted = render(frame(<Consumer />, record, 0, clients[0]))
    compare(mounted.container, record, model, `first client request`)
    reach.reach(`first request pending`)
    if (history.schedule === `failure-first`) {
      await act(async () => {
        rejectOld(cause)
        await old.catch(() => {})
      })
      await settle()
      model = advance(model, {
        type: `failure`,
        attempt: 0,
        cause,
        origin: `client`,
      })
      compare(
        mounted.container,
        record,
        model,
        `client failure before replacement`,
      )
      reach.reach(`first request failure`)
    }
    if (history.schedule === `cleanup-first`) {
      mounted.unmount()
      await query.cleanup()
      query.startSyncImmediate()
    }
    const client = clients[history.schedule === `client-first` ? 1 : 0]!
    let finish!: (snapshot: {
      rows: Array<{ key: string; value: Row }>
    }) => void
    const newer = new Promise<{ rows: Array<{ key: string; value: Row }> }>(
      (resolve) => {
        finish = resolve
      },
    )
    const register = () => {
      void client._registerLiveQuery(hash, newer).catch(() => {})
    }
    const reject = async () => {
      await act(async () => {
        rejectOld(cause)
        await old.catch(() => {})
      })
    }
    // Pending records deduplicate. Replacement on the same client is legal
    // only after its old record fails. This reaction registers the next record
    // before the old preload rejection reaches the suspended wrapper.
    if (history.schedule === `replace-first`) {
      void old.catch(register)
      await reject()
    } else if (history.schedule === `cleanup-first`) {
      await reject()
      register()
    } else register()
    expect(client._getLiveQuery(hash)?.status, `new request admitted`).toBe(
      `pending`,
    )
    const app = frame(<Consumer />, record, 1, client)
    if (history.schedule === `cleanup-first`) mounted = render(app)
    else mounted.rerender(app)
    await settle()
    model = advance(model, { type: `start`, attempt: 1 })
    compare(mounted.container, record, model, `replacement request is pending`)
    reach.reach(`replacement pending`)
    reach.reach(history.schedule)
    if (history.schedule === `client-first`) {
      await reject()
      await settle()
    }
    if (
      history.schedule === `replace-first` ||
      history.schedule === `client-first`
    ) {
      model = advance(model, {
        type: `failure`,
        attempt: 0,
        cause,
        origin: `client`,
      })
      compare(mounted.container, record, model, `obsolete client rejection`)
      reach.reach(`late rejection ignored`)
    }
    const rows = rowsFor(history.count, history.version + 1)
    await act(() =>
      finish({ rows: rows.map((value) => ({ key: value.id, value })) }),
    )
    await settle()
    model = advance(model, {
      type: `ready`,
      attempt: 1,
      rows: rowsFor(history.count, history.version + 1),
    })
    compare(mounted.container, record, model, `replacement request settled`)
    reach.reach(`replacement ready`)
  })
}

// Query-only preload failure has no source status transition. Keep this lane
// separate from source failure so source status cannot hide a stale wrapper error.
const preloadArbitrary = fc.record({
  count: fc.integer({ min: 0, max: 3 }),
  version: fc.integer({ min: 0, max: 3 }),
  cause: fc.constantFrom<CauseKind>(`Error`, `record`, `undefined`),
  rejectAfterCleanup: fc.boolean(),
  rerenders: fc.integer({ min: 0, max: 2 }),
})
type PreloadHistory = HistoryOf<typeof preloadArbitrary>
const preloadExamples: Array<[PreloadHistory]> = [
  [
    {
      count: 0,
      version: 0,
      cause: `undefined`,
      rejectAfterCleanup: false,
      rerenders: 2,
    },
  ],
  [
    {
      count: 2,
      version: 1,
      cause: `record`,
      rejectAfterCleanup: true,
      rerenders: 1,
    },
  ],
]
const preloadStates = [
  `pending`,
  `failure before cleanup`,
  `rejection after cleanup`,
  `restart pending`,
  `restart ready`,
] as const
async function checkPreload(
  history: PreloadHistory,
  scope: Exclude<Scope, `explicit`>,
  reach: ReturnType<typeof createOracleReach<(typeof preloadStates)[number]>>,
) {
  const lifetime = new ScenarioLifetime()
  let mounted: ReturnType<typeof render> | undefined
  lifetime.defer(() => mounted?.unmount())
  const client = scope === `none` ? undefined : new DbClient()
  if (client) lifetime.defer(() => client.cleanup())
  const diagnostics = vi.spyOn(console, `error`).mockImplementation(() => {})
  lifetime.defer(() => {
    diagnostics.mockRestore()
  })
  await lifetime.run(async () => {
    let sync!: Parameters<SyncConfig<Row, string>[`sync`]>[0]
    const source = createCollection<Row, string>({
      getKey: (row) => row.id,
      sync: {
        sync: (params) => {
          sync = params
          return {}
        },
      },
    })
    const query = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .select(({ row }) => ({ id: row.id, version: row.version })),
    )
    lifetime.defer(() => query.cleanup())
    lifetime.defer(() => source.cleanup({ dependents: true }))
    // The preload seam holds query work; start its source independently.
    source.startSyncImmediate()
    let rejectOld!: (error: unknown) => void
    const old = new Promise<void>((_, reject) => {
      rejectOld = reject
    })
    const preload = vi.spyOn(query, `preload`).mockReturnValue(old)
    lifetime.defer(() => {
      preload.mockRestore()
    })
    const record: Recorded = {}
    function Consumer() {
      const result = useLiveSuspenseQuery(query)
      useLayoutEffect(() => {
        record.result = result
      })
      return <output data-phase="ready" />
    }
    const tree = (key: number) =>
      frame(
        <Consumer />,
        record,
        key,
        scope === `provider` ? client : undefined,
      )
    let model = initial()
    mounted = render(tree(0))
    compare(mounted.container, record, model, `query preload pending`)
    expect(preload).toHaveBeenCalled()
    reach.reach(`pending`)
    for (let n = 0; n < history.rerenders; n++) {
      mounted.rerender(tree(0))
      await settle()
      compare(mounted.container, record, model, `preload pending rerender`)
    }
    const cause = makeCause(history.cause, history.version)
    if (!history.rejectAfterCleanup) {
      await act(() => rejectOld(cause))
      await settle()
      model = advance(model, {
        type: `failure`,
        attempt: 0,
        cause,
        origin: `preload`,
      })
      compare(mounted.container, record, model, `query-only preload failure`)
      reach.reach(`failure before cleanup`)
    }
    mounted.unmount()
    await query.cleanup()
    query.startSyncImmediate()
    let resolveNew!: () => void
    preload.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveNew = resolve
      }),
    )
    mounted = render(tree(1))
    model = advance(model, { type: `start`, attempt: 1 })
    compare(mounted.container, record, model, `query preload restart pending`)
    reach.reach(`restart pending`)
    if (history.rejectAfterCleanup) {
      await act(() => rejectOld(cause))
      await settle()
      // The old root is gone. Force a new render while its replacement is
      // still pending; waiting for readiness would clear and hide stale errors.
      mounted.rerender(tree(1))
      await settle()
      model = advance(model, {
        type: `failure`,
        attempt: 0,
        cause,
        origin: `preload`,
      })
      compare(mounted.container, record, model, `retired query preload rejects`)
      reach.reach(`rejection after cleanup`)
    }
    const rows = rowsFor(history.count, history.version + 1)
    await act(() => {
      sync.begin()
      for (const value of rows) sync.write({ type: `insert`, value })
      sync.commit()
      sync.markReady()
      resolveNew()
    })
    await settle()
    model = advance(model, {
      type: `ready`,
      attempt: 1,
      rows: rowsFor(history.count, history.version + 1),
    })
    compare(mounted.container, record, model, `query preload restart ready`)
    reach.reach(`restart ready`)
  })
}

declareOracle({
  model: [advance],
  grammar: [retryArbitrary, replacementArbitrary, preloadArbitrary],
  check: [compare, checkRetry, checkReplacement, checkPreload],
})

describe(`Suspense lifecycle histories`, () => {
  for (const scope of [`none`, `provider`, `explicit`] as const)
    for (const keyed of [false, true])
      for (const campaign of [`fixed`, `fresh`] as const) {
        const property = `react.suspense-retry-history`
        const test =
          campaign === `fixed`
            ? oracleReplayTest(it)
            : oracleReplayTest(it, property)
        test(`${scope}/${keyed ? `keyed` : `derived`} retry (${campaign})`, async () => {
          const reach = createOracleReach(
            `${property}/${scope}/${keyed}/${campaign}`,
            retryStates,
            { fixedHistories: retryExamples.length },
          )
          let index = 0
          const fidelity = createOracleFailureFidelity<RetryHistory>()
          try {
            await fidelity.assert(() =>
              fc.assert(
                fc.asyncProperty(retryArbitrary, async (history) => {
                  reach.beginHistory({ fixed: index++ < retryExamples.length })
                  await fidelity.run(history, () =>
                    checkRetry(history, scope, keyed, reach),
                  )
                }),
                campaign === `fixed`
                  ? {
                      numRuns: oracleRuns(24) + retryExamples.length,
                      seed: 2345,
                      examples: retryExamples,
                    }
                  : oraclePropertyOptions(24, property, {
                      examples: retryExamples,
                    }),
              ),
            )
            reach.assertReached()
          } finally {
            console.info(
              `retry lifecycle reach ${scope}/${keyed}/${campaign}`,
              Object.fromEntries(reach.counts()),
            )
          }
        }, 60_000)
      }
  for (const campaign of [`fixed`, `fresh`] as const) {
    const property = `react.suspense-replacement-history`
    const test =
      campaign === `fixed`
        ? oracleReplayTest(it)
        : oracleReplayTest(it, property)
    test(`client request replacement (${campaign})`, async () => {
      const reach = createOracleReach(
        `${property}/${campaign}`,
        replacementStates,
        { fixedHistories: replacementExamples.length },
      )
      let index = 0
      const fidelity = createOracleFailureFidelity<ReplacementHistory>()
      try {
        await fidelity.assert(() =>
          fc.assert(
            fc.asyncProperty(replacementArbitrary, async (history) => {
              reach.beginHistory({
                fixed: index++ < replacementExamples.length,
              })
              await fidelity.run(history, () =>
                checkReplacement(history, reach),
              )
            }),
            campaign === `fixed`
              ? {
                  numRuns: oracleRuns(32) + replacementExamples.length,
                  seed: 2345,
                  examples: replacementExamples,
                }
              : oraclePropertyOptions(32, property, {
                  examples: replacementExamples,
                }),
          ),
        )
        reach.assertReached()
      } finally {
        console.info(
          `replacement lifecycle reach ${campaign}`,
          Object.fromEntries(reach.counts()),
        )
      }
    }, 60_000)
  }
  for (const scope of [`none`, `provider`] as const)
    for (const campaign of [`fixed`, `fresh`] as const) {
      const property = `react.suspense-preload-restart-history`
      const test =
        campaign === `fixed`
          ? oracleReplayTest(it)
          : oracleReplayTest(it, property)
      test(`${scope} preload restart (${campaign})`, async () => {
        const reach = createOracleReach(
          `${property}/${scope}/${campaign}`,
          preloadStates,
          { fixedHistories: preloadExamples.length },
        )
        const fidelity = createOracleFailureFidelity<PreloadHistory>()
        let index = 0
        try {
          await fidelity.assert(() =>
            fc.assert(
              fc.asyncProperty(preloadArbitrary, async (history) => {
                reach.beginHistory({ fixed: index++ < preloadExamples.length })
                await fidelity.run(history, () =>
                  checkPreload(history, scope, reach),
                )
              }),
              campaign === `fixed`
                ? {
                    numRuns: oracleRuns(24) + preloadExamples.length,
                    seed: 2345,
                    examples: preloadExamples,
                  }
                : oraclePropertyOptions(24, property, {
                    examples: preloadExamples,
                  }),
            ),
          )
          reach.assertReached()
        } finally {
          console.info(
            `preload lifecycle reach ${scope}/${campaign}`,
            Object.fromEntries(reach.counts()),
          )
        }
      }, 60_000)
    }
})

/** Initial sibling histories cross boundary placement, query identity, and
 * readiness order. The existing current-attempt model predicts each ready view;
 * the shared window judgment checks rows and exclusive/retained Collections.
 * A ready sibling in a shared boundary has not committed while its peer waits.
 * Settling both obligations must permit the boundary to commit both outputs.
 * Source Collection readiness can lag settled on-demand subsets. A private
 * output keeps its completed seed's rows through a peer move and a later render
 * until its own startup settles; source readiness cannot hide that handoff.
 * Unlike the old peer lane, both hooks are present before any successful commit.
 */
const siblingsArbitrary = fc.record({
  sharedBoundary: fc.boolean(),
  sourceReady: fc.boolean(),
  sameQuery: fc.boolean(),
  first: fc.integer({ min: 0, max: 1 }),
  simultaneous: fc.boolean(),
  width: fc.integer({ min: 1, max: 3 }),
  offset: fc.integer({ min: 1, max: 4 }),
})
type SiblingsHistory = HistoryOf<typeof siblingsArbitrary>
// Each generated family includes the reported shapes plus its unconstrained
// history. Structural reach does not depend on random selection frequency.
function siblingHistories(history: SiblingsHistory): Array<SiblingsHistory> {
  return [
    history,
    {
      ...history,
      sharedBoundary: true,
      sameQuery: true,
      first: 0,
      sourceReady: false,
    },
    { ...history, sharedBoundary: true, sameQuery: false, simultaneous: false },
    {
      ...history,
      sharedBoundary: false,
      sameQuery: true,
      first: 1,
      sourceReady: true,
    },
  ]
}
function checkSiblingOwnership(left: object, right: object, cut: string) {
  atOracleCheckpoint(`independent successful outputs`, cut, () => {
    expect(left, `every successful sibling owns its output`).not.toBe(right)
  })
}
const siblingStates = [
  `co-mounted pending peers`,
  `shared boundary`,
  `separate boundaries`,
  `same query`,
  `different queries`,
  `staggered readiness`,
  `same-pass readiness`,
  `both committed`,
  `exclusive outputs`,
  `retained peer move`,
  `seed isolated during peer move`,
  `private startup handoff`,
  `lagging source readiness`,
  `ready source`,
] as const
async function checkSiblings(
  history: SiblingsHistory,
  scope: Scope,
  keyed: boolean,
  reach: ReturnType<typeof createOracleReach<(typeof siblingStates)[number]>>,
) {
  const lifetime = new ScenarioLifetime()
  let mounted: ReturnType<typeof render> | undefined
  lifetime.defer(() => mounted?.unmount())
  const client = scope === `none` ? undefined : new DbClient()
  if (client) lifetime.defer(() => client.cleanup())
  await lifetime.run(async () => {
    const rows: Array<WindowRow> = Array.from({ length: 12 }, (_, rank) => ({
      id: String(rank),
      rank,
    }))
    const releases: Array<() => void> = []
    const demands: Array<Array<() => void>> = [[], []]
    const sources = [0, 1].map((slot) =>
      createCollection<WindowRow, string>({
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            for (const value of rows)
              write({ type: `insert`, value: { ...value } })
            commit()
            releases[slot] = () => {
              if (history.sourceReady) markReady()
              for (const release of demands[slot]!.splice(0)) release()
            }
            return {
              loadSubset: () =>
                new Promise<void>((resolve) => {
                  demands[slot]!.push(resolve)
                }),
            }
          },
        },
      }),
    )
    lifetime.defer(async () => {
      for (const source of sources) await source.cleanup({ dependents: true })
    })
    const records: Array<{
      result?: {
        data: unknown
        state: ReadonlyMap<unknown, unknown>
        collection: object
      }
    }> = [{}, {}]
    const rendered = [0, 0]
    function Consumer({ slot, offset }: { slot: number; offset: number }) {
      rendered[slot]!++
      const sourceSlot = history.sameQuery ? 0 : slot
      const result = useLiveSuspenseQuery({
        ...(scope === `explicit` ? { client } : {}),
        ...(keyed ? { queryKey: [`siblings`, sourceSlot, offset] } : {}),
        query: (q) =>
          q
            .from({ row: sources[sourceSlot]! })
            .orderBy(({ row }) => row.rank)
            .limit(history.width)
            .offset(offset)
            .select(({ row }) => ({ id: row.id, rank: row.rank })),
      })
      useLayoutEffect(() => {
        const peer = records[1 - slot]!.result
        if (peer)
          checkSiblingOwnership(
            result.collection,
            peer.collection,
            `successful layout commit`,
          )
        records[slot]!.result = result
      })
      return <output data-slot={slot} data-phase="ready" />
    }
    const fallback = <output data-phase="pending" />
    const tree = (offset: number) => {
      const children = [0, 1].map((slot) => (
        <Consumer
          key={slot}
          slot={slot}
          offset={slot === history.first ? offset : 0}
        />
      ))
      const body = history.sharedBoundary ? (
        <Suspense fallback={fallback}>{children}</Suspense>
      ) : (
        children.map((child, slot) => (
          <Suspense key={slot} fallback={fallback}>
            {child}
          </Suspense>
        ))
      )
      return scope === `provider` ? (
        <DbProvider client={client!}>{body}</DbProvider>
      ) : (
        <>{body}</>
      )
    }
    mounted = render(tree(0))
    await settle()
    expect(
      rendered.every((n) => n > 0),
      `React attempted both co-mounted peers`,
    ).toBe(true)
    expect(
      mounted.container.querySelectorAll('[data-phase="ready"]'),
    ).toHaveLength(0)
    reach.reach(`co-mounted pending peers`)
    reach.reach(
      history.sharedBoundary ? `shared boundary` : `separate boundaries`,
    )
    reach.reach(history.sameQuery ? `same query` : `different queries`)
    if (!history.sameQuery && !history.simultaneous) {
      await act(() => releases[history.first]!())
      await settle()
      if (history.sharedBoundary) {
        expect(
          records.every((record) => record.result === undefined),
          `no sibling has committed through the shared pending boundary`,
        ).toBe(true)
      }
      reach.reach(`staggered readiness`)
    }
    await act(() => {
      for (const release of releases) release()
    })
    await settle()
    for (
      let turn = 0;
      turn < 4 &&
      mounted.container.querySelectorAll('[data-phase="ready"]').length < 2;
      turn++
    ) {
      await act(() => {
        for (const release of releases) release()
      })
      await settle()
    }
    // This bounded cut asks for host progress, not a particular retry count.
    // A fallback after every requested source is ready violates the model's view.
    expect(
      mounted.container.querySelectorAll('[data-phase="ready"]'),
      `both initial obligations made retry progress`,
    ).toHaveLength(2)
    reach.reach(`both committed`)
    reach.reach(
      history.sourceReady ? `ready source` : `lagging source readiness`,
    )
    if (history.sameQuery || history.simultaneous)
      reach.reach(`same-pass readiness`)
    const expected = (offset: number) =>
      windowRows(
        rows,
        {
          offset,
          limit: history.width,
          minimum: -1,
          descending: false,
          nestedLimit: rows.length,
        },
        false,
      )
    const before = records.map((record) => record.result!.collection)
    const comparePeers = (offset: number, cut: string) => {
      for (const slot of [0, 1]) {
        const record = records[slot]!.result!
        const page = slot === history.first ? offset : 0
        checkWindowObservation(
          { rows: record.data, collection: record.collection },
          {
            rows: expected(page),
            previousCollection: before[slot],
            retain: true,
          },
          `${cut}/${slot}`,
        )
        checkWindowState(record.state, expected(page), `${cut}/${slot}`)
      }
      checkSiblingOwnership(
        records[0]!.result!.collection,
        records[1]!.result!.collection,
        cut,
      )
    }
    comparePeers(0, `co-mounted exclusive outputs`)
    reach.reach(`exclusive outputs`)
    await act(() => mounted!.rerender(tree(history.offset)))
    // A same-query peer may still be acquiring its private output's first
    // subset. Keep that oldest demand held while the first output moves.
    const held =
      history.sameQuery && history.first === 0 ? demands[0]![0] : undefined
    for (let turn = 0; turn < 4; turn++) {
      await settle()
      await act(() => {
        for (const pending of demands) {
          const deliver = pending.filter((release) => release !== held)
          pending.splice(
            0,
            pending.length,
            ...pending.filter((release) => release === held),
          )
          for (const release of deliver) release()
        }
      })
    }
    await settle()
    if (held) {
      // Re-read both hooks after the moved output publishes, while the private
      // startup demand remains held. An unchanged-input host render must not
      // replace the peer's copied rows with the moved output's live snapshot.
      await act(() => mounted!.rerender(tree(history.offset)))
      await settle()
      comparePeers(history.offset, `seed while successful peer has moved`)
      reach.reach(`seed isolated during peer move`)
      await act(() => {
        for (const release of releases) release()
      })
      await settle()
      comparePeers(history.offset, `private startup handoff`)
      reach.reach(`private startup handoff`)
    }
    comparePeers(history.offset, `co-mounted page independence`)
    expect(
      mounted.container.querySelectorAll('[data-phase="ready"]'),
    ).toHaveLength(2)
    reach.reach(`retained peer move`)
  })
}
for (const scope of [`none`, `provider`, `explicit`] as const)
  for (const keyed of [false, true])
    for (const campaign of [`fixed`, `fresh`] as const) {
      const property = `react.suspense-siblings`
      const test =
        campaign === `fixed`
          ? oracleReplayTest(it)
          : oracleReplayTest(it, property)
      test(`co-mounted siblings/${scope}/${keyed}/${campaign}`, async () => {
        const reach = createOracleReach(
          `${property}/${scope}/${keyed}/${campaign}`,
          siblingStates,
        )
        const fidelity = createOracleFailureFidelity<SiblingsHistory>()
        try {
          await fidelity.assert(() =>
            fc.assert(
              fc.asyncProperty(siblingsArbitrary, async (history) => {
                for (const member of siblingHistories(history)) {
                  reach.beginHistory()
                  await fidelity.run(member, () =>
                    checkSiblings(member, scope, keyed, reach),
                  )
                }
              }),
              campaign === `fixed`
                ? { numRuns: oracleRuns(8), seed: 2348 }
                : oraclePropertyOptions(8, property),
            ),
          )
          reach.assertReached()
        } finally {
          console.info(
            `sibling reach ${scope}/${keyed}/${campaign}`,
            Object.fromEntries(reach.counts()),
          )
        }
      }, 60_000)
    }
declareOracle({
  grammar: [siblingsArbitrary, siblingHistories],
  check: [checkSiblings, checkSiblingOwnership],
})
