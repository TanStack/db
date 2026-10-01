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
 * History grammar: rows have ids 0 through 3, a field `f` from strings,
 * numbers and their look-alikes, `true`, a Date equal to 1, `NaN`, `-0`,
 * `0`, `null`, and a missing value, and a field `g` of `x` or `y`. Up to
 * three peer queries use `eq(f, literal)`, optionally with `eq(g, literal)`.
 * Values are weighted toward `a`, and toward the normalized values against
 * numeric literals, so groups hold rows that stay, move, and normalize.
 * Steps commit sync transactions of one or two inserts, updates, or deletes,
 * where an update may keep `f` so the row stays in its group; apply one
 * optimistic insert, update, or delete and then confirm or roll it back,
 * optionally after cleaning up and restarting the source while it is
 * pending; mount or unmount a peer; or clean up the source and restart it,
 * optionally (re)mounting a peer on the cleaned-up source first.
 *
 * Production driver: `createPooledLiveQuery` builds each peer's view from the
 * query builder's IR, and `createLiveQueryObserver` observes it in wholesale
 * and granular mode, as the framework adapters do. The view subscribes
 * before its live-query Collection preloads, so a peer mounted after cleanup
 * is the one that restarts the source.
 *
 * Refinement check: after every step, each mounted peer's wholesale snapshot
 * equals its live-query Collection's keys in order, row values, and status,
 * and its rows' fields equal the model's. The granular changes delivered since
 * the last checkpoint equal those of a granular observer of the live-query
 * Collection, by type, key, value, and previous value; folded in order, they
 * never insert a held key, update or delete an unheld one, or carry a stale
 * previous value, and they leave the model's rows. A peer mounted when its
 * source starts cleanup is terminal like its live query: status `error` with
 * the rows it had, pending optimistic rows included, through the restart and
 * later writes. A peer mounted after cleanup follows the restarted source.
 *
 * Calibration: a partition that ignored the previous value, kept group rows
 * in arrival order, or compared literals without normalization fails the
 * pinned histories and campaigns. A view that kept reporting the source's
 * status after cleanup fails the cleanup histories. An update delivered as a
 * delete and insert, with a stale previous value, or with the previous row as
 * its value fails the in-group update history and both campaigns; so do a
 * partition born terminal on a cleaned-up source and a freeze that drops
 * pending optimistic rows.
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
  | {
      kind: `optimistic`
      op: Op
      confirm: boolean
      // Clean up and restart the source before settling the write.
      cleanupFirst?: boolean
    }
  | { kind: `mount`; peer: number }
  | { kind: `unmount`; peer: number }
  // `mount` (re)mounts that peer after cleanup, before the restart.
  | { kind: `cleanup-restart`; mount?: number }
type Op =
  | { type: `insert`; id: number; f: FieldValue; g: string }
  // `keepF` keeps the row's current `f`, so the row stays in its group.
  | { type: `update`; id: number; f: FieldValue; g: string; keepF?: boolean }
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

// The model's matching rows, described by id and fields.
function expectedRows(
  rows: ReadonlyMap<string, Row>,
  peer: Peer,
): Array<string> {
  return expectedKeys(rows, peer).map((key) => describeFields(rows.get(key)!))
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

// Most rows and peers share `a`, so groups hold rows that stay or move;
// the normalized values have their own weight against numeric literals.
const fieldArbitrary = fc.oneof(
  { weight: 2, arbitrary: fc.constant<FieldValue>(`a`) },
  fc.constantFrom<FieldValue>(DATE_ONE, Number.NaN, -0),
  fc.constantFrom(...fieldValues),
)
const gArbitrary = fc.constantFrom(`x`, `y`)
const opArbitrary: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    type: fc.constant(`insert` as const),
    id: fc.nat({ max: 3 }),
    f: fieldArbitrary,
    g: gArbitrary,
  }),
  {
    weight: 2,
    arbitrary: fc.record(
      {
        type: fc.constant(`update` as const),
        id: fc.nat({ max: 3 }),
        f: fieldArbitrary,
        g: gArbitrary,
        keepF: fc.boolean(),
      },
      { requiredKeys: [`type`, `id`, `f`, `g`] },
    ),
  },
  fc.record({ type: fc.constant(`delete` as const), id: fc.nat({ max: 3 }) }),
)
const peerArbitrary: fc.Arbitrary<Peer> = fc.record(
  {
    f: fc.oneof(
      { weight: 2, arbitrary: fc.constant<Peer[`f`]>(`a`) },
      fc.constantFrom<Peer[`f`]>(1, Number.NaN, 0),
      fc.constantFrom(...literals),
    ),
    g: gArbitrary,
  },
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
      fc.record(
        {
          kind: fc.constant(`optimistic` as const),
          op: opArbitrary,
          confirm: fc.boolean(),
          cleanupFirst: fc.boolean(),
        },
        { requiredKeys: [`kind`, `op`, `confirm`] },
      ),
      fc.record({
        kind: fc.constant(`mount` as const),
        peer: fc.nat({ max: 2 }),
      }),
      fc.record({
        kind: fc.constant(`unmount` as const),
        peer: fc.nat({ max: 2 }),
      }),
      fc.record(
        {
          kind: fc.constant(`cleanup-restart` as const),
          mount: fc.nat({ max: 2 }),
        },
        { requiredKeys: [`kind`] },
      ),
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
    name: `peers clean up with a pending write and one mounts before the restart`,
    history: {
      rows: [{ f: `a`, g: `x` }],
      peers: [{ f: `a` }, { f: `a`, g: `y` }],
      steps: [
        {
          kind: `optimistic`,
          op: { type: `insert`, id: 2, f: `a`, g: `y` },
          confirm: false,
          cleanupFirst: true,
        },
        { kind: `sync`, ops: [{ type: `insert`, id: 3, f: `a`, g: `y` }] },
        { kind: `cleanup-restart`, mount: 1 },
        { kind: `sync`, ops: [{ type: `update`, id: 3, f: `a`, g: `x` }] },
      ],
    },
  },
  {
    name: `a row updated within its group reaches peers as one update`,
    history: {
      rows: [
        { f: 1, g: `x` },
        { f: `b`, g: `x` },
      ],
      peers: [{ f: 1 }, { f: 1, g: `y` }],
      steps: [
        { kind: `sync`, ops: [{ type: `update`, id: 0, f: DATE_ONE, g: `y` }] },
        {
          kind: `optimistic`,
          op: { type: `update`, id: 0, f: 1, g: `y` },
          confirm: true,
        },
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

// A row's id and fields, which the model also knows.
function describeFields(row: Record<string, unknown>) {
  const f = row.f instanceof Date ? `Date(${row.f.getTime()})` : String(row.f)
  return `${String(row.id)}:${typeof row.f}:${f}:${String(row.g)}`
}

function describeRow(row: Record<string, unknown>) {
  return `${describeFields(row)}:${String(row.$synced)}`
}

type Change = ChangeMessage<Record<string, unknown>, string | number>

function describeChange(change: Change) {
  const previous = change.previousValue
  return `${change.type}:${String(change.key)}:${describeRow(change.value)}:${previous ? describeRow(previous) : `-`}`
}

// Applies a granular batch to the rows a consumer has folded so far,
// recording each change that contradicts them.
function foldChanges(
  rows: Map<string | number, Record<string, unknown>>,
  changes: Array<Change>,
  violations: Array<string>,
) {
  for (const change of changes) {
    const held = rows.get(change.key)
    if (change.type === `insert`) {
      if (held) violations.push(`insert of held ${describeChange(change)}`)
      rows.set(change.key, change.value)
    } else if (!held) {
      violations.push(`${change.type} of unheld ${describeChange(change)}`)
    } else if (change.type === `delete`) {
      rows.delete(change.key)
    } else {
      if (
        !change.previousValue ||
        describeFields(change.previousValue) !== describeFields(held)
      ) {
        violations.push(`stale previousValue in ${describeChange(change)}`)
      }
      rows.set(change.key, change.value)
    }
  }
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
    // The model rows when the source started cleanup, if it has since.
    frozen: Array<string> | undefined
    view: { collection?: unknown }
    layout: { keys: string; revision: number } | undefined
    wholesale: ReturnType<typeof createLiveQueryObserver<any, any>>
    // Rows folded from the pooled granular stream, and contradictions.
    granularRows: Map<string | number, Record<string, unknown>>
    violations: Array<string>
    // Granular changes since the last checkpoint, pooled and reference.
    pooledChanges: Array<string>
    referenceChanges: Array<string>
    unsubscribe: () => void
  }
  const mounted = new Map<number, Mounted>()
  const mount = async (index: number) => {
    const peer = history.peers[index]
    if (!peer || mounted.has(index)) return
    // The pooled view subscribes first, so after cleanup it is the one that
    // restarts the source.
    const view = createPooledLiveQuery(peerQuery(source, peer)(new Query()))
    expect(view, `peer ${index} is poolable`).toBeDefined()
    const wholesale = createLiveQueryObserver(view as any, {
      mode: `wholesale`,
    })
    const granular = createLiveQueryObserver(view as any)
    const entry: Mounted = {
      reference: createLiveQueryCollection(peerQuery(source, peer)),
      frozen: undefined,
      view: view as unknown as Mounted[`view`],
      layout: undefined,
      wholesale,
      granularRows: new Map(),
      violations: [],
      pooledChanges: [],
      referenceChanges: [],
      unsubscribe: () => {},
    }
    references.push(entry.reference)
    const offWholesale = wholesale.subscribe(() => {})
    const offGranular = granular.subscribe((changes) => {
      const batch = (changes ?? []) as Array<Change>
      foldChanges(entry.granularRows, batch, entry.violations)
      entry.pooledChanges.push(...batch.map(describeChange))
    })
    await entry.reference.preload()
    const referenceGranular = createLiveQueryObserver(entry.reference as any)
    const offReference = referenceGranular.subscribe((changes) => {
      const batch = (changes ?? []) as Array<Change>
      entry.referenceChanges.push(...batch.map(describeChange))
    })
    entry.unsubscribe = () => {
      offWholesale()
      offGranular()
      offReference()
      wholesale.dispose()
      granular.dispose()
      referenceGranular.dispose()
    }
    mounted.set(index, entry)
  }
  const check = (checkpoint: string) => {
    for (const [index, entry] of mounted) {
      const { view, wholesale } = entry
      const peer = history.peers[index]!
      const snapshot = wholesale.getSnapshot()
      const reference = entry.reference
      const label = `${checkpoint}, peer ${index}`
      expect(
        (snapshot.data as Array<Record<string, unknown>>).map(describeRow),
        `${label} rows`,
      ).toEqual(reference.toArray.map((row) => describeRow(row)))
      expect(snapshot.status, `${label} status`).toBe(reference.status)
      const model = entry.frozen ?? expectedRows(rows, peer)
      expect(
        [...snapshot.state!.values()].map(describeFields).sort(),
        `${label} model`,
      ).toEqual(model)
      // The granular stream delivers each change once, with the type and
      // values the live-query Collection's stream has, and folds to the model.
      expect(entry.violations, `${label} granular contradictions`).toEqual([])
      expect(
        [...entry.granularRows.values()].map(describeFields).sort(),
        `${label} granular`,
      ).toEqual(model)
      expect(entry.pooledChanges.sort(), `${label} granular changes`).toEqual(
        entry.referenceChanges.sort(),
      )
      entry.pooledChanges.length = 0
      entry.referenceChanges.length = 0
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
  // Resolves `keepF` against the model's current row.
  const resolveOp = (op: Op): Op => {
    const row = rows.get(id(op.id))
    if (op.type !== `update` || !op.keepF || !row) return op
    return { ...op, f: `f` in row ? (row.f as FieldValue) : MISSING }
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

  const unmount = (index: number) => {
    mounted.get(index)?.unsubscribe()
    mounted.delete(index)
  }
  // Every mounted peer freezes with the rows it had, pending writes included.
  // `beforeRestart` runs once the source is cleaned up.
  const cleanupAndRestart = async (
    checkpoint: string,
    beforeRestart: () => Promise<void>,
  ) => {
    for (const [index, entry] of mounted) {
      entry.frozen ??= expectedRows(rows, history.peers[index]!)
    }
    await source.cleanup()
    check(`${checkpoint} cleaned up`)
    // The mock source re-syncs its initial rows when it restarts.
    rows.clear()
    history.rows.forEach((row, rowIndex) =>
      rows.set(id(rowIndex), sourceRow(id(rowIndex), row.f, row.g)),
    )
    await beforeRestart()
    await source.preload()
  }

  await withOracleCleanup(async () => {
    for (const index of history.peers.keys()) await mount(index)
    check(`after mount`)
    for (const [n, step] of history.steps.entries()) {
      const checkpoint = `after step ${n} (${step.kind})`
      if (step.kind === `mount`) await mount(step.peer)
      else if (step.kind === `cleanup-restart`) {
        const between = step.mount
        await cleanupAndRestart(checkpoint, async () => {
          // A peer mounted on the cleaned-up source restarts it.
          if (between === undefined) return
          unmount(between)
          await mount(between)
        })
      } else if (step.kind === `unmount`) {
        unmount(step.peer)
      } else if (step.kind === `sync`) {
        const accepted = step.ops.map(resolveOp).filter((op) => {
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
        const { confirm, cleanupFirst } = step
        const op = resolveOp(step.op)
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
        if (cleanupFirst) {
          // The write settles after cleanup, before the restart. The mock
          // server keeps no data, so either outcome leaves the initial rows.
          await cleanupAndRestart(checkpoint, async () => {
            if (confirm) {
              source.utils.resolveSync()
              await persisted
              return
            }
            await withExpectedRejection(`rolled back`, async () => {
              source.utils.rejectSync(new Error(`rolled back`))
              await persisted
              await flushPromises()
            })
          })
        } else if (confirm) {
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
