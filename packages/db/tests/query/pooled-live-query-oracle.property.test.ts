/**
 * # Does a pooled live query publish what its live-query Collection would?
 *
 * Law and source: a live query that filters one source Collection only by
 * `eq(field, literal)` conjuncts is served from a partition of that source
 * shared by every query with the same fields. Its observer must publish the
 * rows the live-query Collection for the same query publishes: the visible
 * source rows whose fields equal the literals under `eq` semantics
 * (`src/query/compiler/evaluators.ts`: nullish is UNKNOWN, a Date equals its
 * timestamp, `NaN` equals `NaN`, `-0` equals `0`, other types differ), in
 * key order, with the same row values and status.
 *
 * Why an example can miss the failure: one query over static rows passes even
 * if rows never move between groups, a peer group never sees a row leave, a
 * remounted query reads a stale group, or a rollback leaves an optimistic row
 * behind.
 *
 * Model: `expectedKeys` filters the model's visible rows with an independent
 * `eq` over plain values. It does not import the evaluator, normalization, or
 * the partition. Order, row values, and status come from a second
 * formulation: a live-query Collection compiled for the same query.
 *
 * History grammar: rows have a field `f` from strings, numbers and their
 * look-alikes, `true`, a Date equal to 1, `NaN`, `-0`, `0`, `null`, and a
 * missing value, and a field `g` of `x` or `y`. Up to three peer queries use
 * `eq(f, literal)`, optionally with `eq(g, literal)`. Steps commit sync
 * transactions of one or two inserts, updates, or deletes; apply one
 * optimistic insert, update, or delete and then confirm or roll it back;
 * mount or unmount a peer; or clean up the source and restart it.
 *
 * Production driver: `createPooledLiveQuery` builds each peer's view from the
 * query builder's IR, and `createLiveQueryObserver` observes it in wholesale
 * and granular mode, as the framework adapters do.
 *
 * Refinement check: after every step, each mounted peer's wholesale snapshot
 * equals its live-query Collection's keys in order, row values, and status;
 * both observers' key sets equal the model. A peer mounted when its source
 * starts cleanup is terminal like its live query: status `error` with the
 * rows it had, through the restart and later writes. A peer mounted after
 * the restart follows the restarted source.
 *
 * Calibration: a partition that ignored the previous value, kept group rows
 * in arrival order, or compared literals without normalization fails the
 * pinned histories and both campaigns. A view that kept reporting the
 * source's status after cleanup fails the cleanup history.
 *
 * Known omissions: on-demand and persisted sources, `DbClient` hydration,
 * Suspense, `select`, and every other clause keep the live-query Collection
 * and are outside this owner.
 */
import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryObserver } from '../../src/live-query-observer.js'
import { Query } from '../../src/query/builder/index.js'
import { and, createLiveQueryCollection, eq } from '../../src/query/index.js'
import { createPooledLiveQuery } from '../../src/query/pooled-live-query.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from '../oracle-config.js'
import {
  flushPromises,
  mockSyncCollectionOptions,
  withExpectedRejection,
  withOracleCleanup,
} from '../utils.js'
import type { ChangeMessage } from '../../src/types.js'

const property = `pooled-live-query.publication`
const requestedReplayProperty = readOracleRunConfig().replayProperty

const MISSING = Symbol(`missing`)
type FieldValue = string | number | boolean | Date | null | typeof MISSING
type Row = { id: string; f?: unknown; g: string }
type Peer = { f: string | number | boolean; g?: string }
type Step =
  | { kind: `sync`; ops: Array<Op> }
  | { kind: `optimistic`; op: Op; confirm: boolean }
  | { kind: `mount`; peer: number }
  | { kind: `unmount`; peer: number }
  | { kind: `cleanup-restart` }
type Op =
  | { type: `insert`; id: number; f: FieldValue; g: string }
  | { type: `update`; id: number; f: FieldValue; g: string }
  | { type: `delete`; id: number }
type History = {
  rows: Array<{ f: FieldValue; g: string }>
  peers: Array<Peer>
  steps: Array<Step>
}

const DATE_ONE = new Date(1)
const fieldValues: ReadonlyArray<FieldValue> = [
  `a`,
  `b`,
  1,
  `1`,
  true,
  DATE_ONE,
  Number.NaN,
  -0,
  0,
  null,
  MISSING,
]
const literals: ReadonlyArray<Peer[`f`]> = [`a`, 1, `1`, true, Number.NaN, 0]

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

// `eq` keeps a row only when TRUE: nullish is UNKNOWN, a Date is its
// timestamp, NaN equals NaN, and -0 equals 0.
function modelEq(value: unknown, literal: unknown): boolean {
  if (value === null || value === undefined) return false
  const left = value instanceof Date ? value.getTime() : value
  if (typeof left === `number` && typeof literal === `number`) {
    return (Number.isNaN(left) && Number.isNaN(literal)) || left === literal
  }
  return typeof left === typeof literal && left === literal
}

function expectedKeys(
  rows: ReadonlyMap<string, Row>,
  peer: Peer,
): Array<string> {
  return [...rows.values()]
    .filter(
      (row) =>
        modelEq(row.f, peer.f) && (peer.g === undefined || row.g === peer.g),
    )
    .map((row) => row.id)
    .sort()
}

// Collection change detection treats 0 and -0, and NaN and NaN, as equal.
function sameValueZero(a: unknown, b: unknown): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b))
}

function sourceRow(id: string, f: FieldValue, g: string): Row {
  return f === MISSING ? { id, g } : { id, f, g }
}

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

const fieldArbitrary = fc.constantFrom(...fieldValues)
const gArbitrary = fc.constantFrom(`x`, `y`)
const opArbitrary: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    type: fc.constant(`insert` as const),
    id: fc.nat({ max: 5 }),
    f: fieldArbitrary,
    g: gArbitrary,
  }),
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant(`update` as const),
      id: fc.nat({ max: 5 }),
      f: fieldArbitrary,
      g: gArbitrary,
    }),
  },
  fc.record({ type: fc.constant(`delete` as const), id: fc.nat({ max: 5 }) }),
)
const peerArbitrary: fc.Arbitrary<Peer> = fc.record(
  { f: fc.constantFrom(...literals), g: gArbitrary },
  { requiredKeys: [`f`] },
)
const historyArbitrary: fc.Arbitrary<History> = fc.record({
  rows: fc.array(fc.record({ f: fieldArbitrary, g: gArbitrary }), {
    maxLength: 4,
  }),
  peers: fc.array(peerArbitrary, { minLength: 1, maxLength: 3 }),
  steps: fc.array(
    fc.oneof(
      {
        weight: 3,
        arbitrary: fc.record({
          kind: fc.constant(`sync` as const),
          ops: fc.array(opArbitrary, { minLength: 1, maxLength: 2 }),
        }),
      },
      fc.record({
        kind: fc.constant(`optimistic` as const),
        op: opArbitrary,
        confirm: fc.boolean(),
      }),
      fc.record({
        kind: fc.constant(`mount` as const),
        peer: fc.nat({ max: 2 }),
      }),
      fc.record({
        kind: fc.constant(`unmount` as const),
        peer: fc.nat({ max: 2 }),
      }),
      fc.constant({ kind: `cleanup-restart` as const }),
    ),
    { maxLength: 8 },
  ),
})

// Each pinned history moves a row across groups a short example would keep
// still.
const pinnedHistories: ReadonlyArray<{ name: string; history: History }> = [
  {
    name: `a Date row joins the group of its timestamp`,
    history: {
      rows: [{ f: `a`, g: `x` }],
      peers: [{ f: 1 }, { f: `a` }],
      steps: [
        { kind: `sync`, ops: [{ type: `update`, id: 0, f: DATE_ONE, g: `x` }] },
      ],
    },
  },
  {
    name: `rows keep key order across strings and numbers`,
    history: {
      rows: [
        { f: `a`, g: `x` },
        { f: `a`, g: `x` },
      ],
      peers: [{ f: `a` }],
      steps: [
        { kind: `sync`, ops: [{ type: `insert`, id: 4, f: `a`, g: `x` }] },
        { kind: `sync`, ops: [{ type: `update`, id: 0, f: `b`, g: `x` }] },
        { kind: `sync`, ops: [{ type: `update`, id: 0, f: `a`, g: `x` }] },
      ],
    },
  },
  {
    name: `a rolled-back optimistic insert leaves its group`,
    history: {
      rows: [],
      peers: [{ f: true, g: `y` }],
      steps: [
        {
          kind: `optimistic`,
          op: { type: `insert`, id: 2, f: true, g: `y` },
          confirm: false,
        },
      ],
    },
  },
  {
    name: `a peer mounted at cleanup stays failed while a new one follows the restart`,
    history: {
      rows: [{ f: `a`, g: `x` }],
      peers: [{ f: `a` }, { f: `a` }],
      steps: [
        { kind: `unmount`, peer: 1 },
        { kind: `sync`, ops: [{ type: `insert`, id: 2, f: `a`, g: `y` }] },
        { kind: `cleanup-restart` },
        { kind: `mount`, peer: 1 },
        { kind: `sync`, ops: [{ type: `insert`, id: 3, f: `a`, g: `x` }] },
      ],
    },
  },
  {
    name: `a remounted peer reads a group that changed while it was away`,
    history: {
      rows: [{ f: 0, g: `x` }],
      peers: [{ f: 0 }, { f: Number.NaN }],
      steps: [
        { kind: `unmount`, peer: 1 },
        {
          kind: `sync`,
          ops: [{ type: `update`, id: 0, f: Number.NaN, g: `x` }],
        },
        { kind: `mount`, peer: 1 },
        { kind: `sync`, ops: [{ type: `update`, id: 0, f: -0, g: `x` }] },
      ],
    },
  },
]

// ---------------------------------------------------------------------------
// Production driver and refinement check
// ---------------------------------------------------------------------------

let serial = 0
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function peerQuery(source: any, peer: Peer) {
  return (q: any) =>
    q
      .from({ r: source })
      .where(({ r }: any) =>
        peer.g === undefined
          ? eq(r.f, peer.f)
          : and(eq(r.f, peer.f), eq(r.g, peer.g)),
      )
}

function describeRow(row: Record<string, unknown>) {
  const f = row.f instanceof Date ? `Date(${row.f.getTime()})` : String(row.f)
  return `${String(row.id)}:${typeof row.f}:${f}:${String(row.g)}:${String(row.$synced)}`
}

async function runHistory(history: History): Promise<void> {
  const id = (n: number) => `r${n}`
  const rows = new Map<string, Row>()
  history.rows.forEach((row, n) =>
    rows.set(id(n), sourceRow(id(n), row.f, row.g)),
  )
  const source = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `pooled-${serial++}`,
      getKey: (row) => row.id,
      initialData: [...rows.values()].map((row) => ({ ...row })),
    }),
  )
  await source.stateWhenReady()
  const references: Array<ReturnType<typeof createLiveQueryCollection>> = []
  type Mounted = {
    reference: ReturnType<typeof createLiveQueryCollection>
    // The model keys when the source started cleanup, if it has since.
    frozen: Array<string> | undefined
    view: { collection?: unknown }
    layout: { keys: string; revision: number } | undefined
    wholesale: ReturnType<typeof createLiveQueryObserver<any, any>>
    granular: ReturnType<typeof createLiveQueryObserver<any, any>>
    granularKeys: Set<string | number>
    unsubscribe: () => void
  }
  const mounted = new Map<number, Mounted>()
  const mount = async (index: number) => {
    const peer = history.peers[index]
    if (!peer || mounted.has(index)) return
    const reference = createLiveQueryCollection(peerQuery(source, peer))
    references.push(reference)
    await reference.preload()
    const view = createPooledLiveQuery(peerQuery(source, peer)(new Query()))
    expect(view, `peer ${index} is poolable`).toBeDefined()
    const wholesale = createLiveQueryObserver(view as any, {
      mode: `wholesale`,
    })
    const granular = createLiveQueryObserver(view as any)
    const granularKeys = new Set<string | number>()
    const offWholesale = wholesale.subscribe(() => {})
    const offGranular = granular.subscribe((changes) => {
      for (const change of (changes ?? []) as Array<ChangeMessage<any, any>>) {
        if (change.type === `delete`) granularKeys.delete(change.key)
        else granularKeys.add(change.key)
      }
    })
    mounted.set(index, {
      reference,
      frozen: undefined,
      view: view as unknown as Mounted[`view`],
      layout: undefined,
      wholesale,
      granular,
      granularKeys,
      unsubscribe: () => {
        offWholesale()
        offGranular()
        wholesale.dispose()
        granular.dispose()
      },
    })
  }
  const check = (checkpoint: string) => {
    for (const [index, entry] of mounted) {
      const { view, wholesale, granularKeys } = entry
      const peer = history.peers[index]!
      const snapshot = wholesale.getSnapshot()
      const reference = entry.reference
      const label = `${checkpoint}, peer ${index}`
      expect(
        (snapshot.data as Array<Record<string, unknown>>).map(describeRow),
        `${label} rows`,
      ).toEqual(reference.toArray.map((row) => describeRow(row)))
      expect(snapshot.status, `${label} status`).toBe(reference.status)
      const model = entry.frozen ?? expectedKeys(rows, peer)
      expect(
        [...snapshot.state!.keys()].map(String).sort(),
        `${label} model`,
      ).toEqual(model)
      expect([...granularKeys].map(String).sort(), `${label} granular`).toEqual(
        model,
      )
      // A change in the ordered keys always advances the layout revision.
      const keys = JSON.stringify([...snapshot.state!.keys()])
      if (entry.layout && entry.layout.keys !== keys) {
        expect(snapshot.layoutRevision, `${label} layout`).toBeGreaterThan(
          entry.layout.revision,
        )
      }
      entry.layout = { keys, revision: snapshot.layoutRevision }
      // Observing a pooled view never builds its live-query Collection.
      expect(view.collection, `${label} materialized`).toBeUndefined()
    }
  }
  const applyOp = (op: Op): boolean => {
    const key = id(op.id)
    if (op.type === `insert`) {
      if (rows.has(key)) return false
      rows.set(key, sourceRow(key, op.f, op.g))
    } else if (op.type === `update`) {
      if (!rows.has(key)) return false
      rows.set(key, sourceRow(key, op.f, op.g))
    } else {
      if (!rows.delete(key)) return false
    }
    return true
  }
  const write = (op: Op) => {
    const key = id(op.id)
    source.utils.write(
      op.type === `delete`
        ? { type: `delete`, key }
        : op.type === `update` && op.f === MISSING
          ? // A synced update merges fields, so clear `f` explicitly.
            { type: `update`, value: { id: key, f: undefined, g: op.g } }
          : { type: op.type, value: sourceRow(key, op.f, op.g) },
    )
  }

  await withOracleCleanup(async () => {
    for (const index of history.peers.keys()) await mount(index)
    check(`after mount`)
    for (const [n, step] of history.steps.entries()) {
      const checkpoint = `after step ${n} (${step.kind})`
      if (step.kind === `mount`) await mount(step.peer)
      else if (step.kind === `cleanup-restart`) {
        for (const [index, entry] of mounted) {
          entry.frozen ??= expectedKeys(rows, history.peers[index]!)
        }
        await source.cleanup()
        check(`${checkpoint} cleaned up`)
        // The mock source re-syncs its initial rows when it restarts.
        rows.clear()
        history.rows.forEach((row, rowIndex) =>
          rows.set(id(rowIndex), sourceRow(id(rowIndex), row.f, row.g)),
        )
        await source.preload()
      } else if (step.kind === `unmount`) {
        mounted.get(step.peer)?.unsubscribe()
        mounted.delete(step.peer)
      } else if (step.kind === `sync`) {
        const accepted = step.ops.filter((op) => {
          const before = new Map(rows)
          if (applyOp(op)) return true
          rows.clear()
          for (const [k, v] of before) rows.set(k, v)
          return false
        })
        if (accepted.length === 0) continue
        source.utils.begin()
        for (const op of accepted) write(op)
        source.utils.commit()
      } else {
        const { op, confirm } = step
        const key = id(op.id)
        const before = new Map(rows)
        const previous = rows.get(key)
        // An update to the same value creates no pending transaction.
        if (
          op.type === `update` &&
          previous !== undefined &&
          `f` in previous === (op.f !== MISSING) &&
          sameValueZero(previous.f, op.f === MISSING ? undefined : op.f) &&
          previous.g === op.g
        ) {
          continue
        }
        if (!applyOp(op)) continue
        const transaction =
          op.type === `insert`
            ? source.insert(sourceRow(key, op.f, op.g))
            : op.type === `update`
              ? source.update(key, (draft) => {
                  if (op.f === MISSING) delete draft.f
                  else draft.f = op.f
                  draft.g = op.g
                })
              : source.delete(key)
        const persisted = transaction.isPersisted.promise.catch(() => undefined)
        check(`${checkpoint} pending`)
        if (confirm) {
          source.utils.begin()
          write(op)
          source.utils.commit()
          source.utils.resolveSync()
        } else {
          rows.clear()
          for (const [k, v] of before) rows.set(k, v)
          await withExpectedRejection(`rolled back`, async () => {
            source.utils.rejectSync(new Error(`rolled back`))
            await persisted
            await flushPromises()
          })
        }
        await tick()
      }
      check(checkpoint)
    }
    // Any other Collection member builds the live-query Collection.
    // A terminal peer's Collection would be a new query on the restarted
    // source, so only live peers compare forwarded rows.
    for (const [index, { wholesale, reference, frozen }] of mounted) {
      if (frozen) continue
      const collection = wholesale.getSnapshot().collection!
      expect(
        (collection.toArray as Array<Record<string, unknown>>).map(describeRow),
        `peer ${index} forwarded toArray`,
      ).toEqual(reference.toArray.map((row) => describeRow(row)))
      // Members the observer also reads must still behave as the Collection's.
      expect(
        [...collection.entries()].map(([key]) => key),
        `peer ${index} forwarded entries`,
      ).toEqual([...reference.entries()].map(([key]) => key))
      const narrower = new Func(`eq`, [new PropRef([`g`]), new Value(`x`)])
      const keysOf = (target: {
        currentStateAsChanges: (options: {
          where: typeof narrower
        }) => Array<{ key: unknown }> | void
      }) =>
        [...(target.currentStateAsChanges({ where: narrower }) || [])].map(
          (change) => change.key,
        )
      expect(
        keysOf(collection as unknown as Parameters<typeof keysOf>[0]),
        `peer ${index} forwarded filter`,
      ).toEqual(keysOf(reference as unknown as Parameters<typeof keysOf>[0]))
      expect(collection.config, `peer ${index} forwarded config`).toBeDefined()
    }
  }, [
    () => {
      for (const entry of mounted.values()) entry.unsubscribe()
    },
    () => Promise.all(references.map((reference) => reference.cleanup())),
    () => source.cleanup(),
  ])
}

describe(`pooled live query oracle`, () => {
  if (requestedReplayProperty === undefined) {
    for (const { name, history } of pinnedHistories) {
      it(`matches the live-query Collection when ${name}`, () =>
        runHistory(history))
    }
    fcTest.prop([historyArbitrary], {
      seed: 44_502_001,
      numRuns: oracleRuns(80),
    })(`matches the live-query Collection (fixed)`, runHistory)
    fcTest.prop([historyArbitrary], oraclePropertyOptions(80, property))(
      `matches the live-query Collection (random)`,
      runHistory,
    )
  } else if (requestedReplayProperty === property) {
    fcTest.prop([historyArbitrary], oraclePropertyOptions(80, property))(
      `matches the live-query Collection (replay)`,
      runHistory,
    )
  } else {
    it.skip(`runs only when its replay property is selected`, () => {})
  }
})
