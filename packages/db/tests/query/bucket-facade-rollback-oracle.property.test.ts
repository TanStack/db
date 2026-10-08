import { D2, MultiSet } from '@tanstack/db-ivm'
import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { BucketFacadeAdapter } from '../../src/query/live/bucket-facade-adapter.js'
import { stripVirtualProps } from '../utils.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
import { BUCKET_FACADE_REF } from '../../src/query/live/materialized-pipeline.js'
import type { Collection } from '../../src/collection/index.js'
import type { SyncConfig } from '../../src/types.js'
import type { BucketRow } from '../../src/query/live/materialized-pipeline.js'

/**
 * # Does a failed facade flush restore exactly what it wrote, and only that?
 *
 * `BucketFacadeAdapter` turns bucket-row deltas from the materialization graph
 * into stable child-facade Collections. A flush writes every pending bucket
 * through ordinary Collection transactions while it defers their events.
 *
 * Three laws hold at the adapter boundary:
 *
 * 1. **Flush atomicity** ("Coherent publication" in
 *    `packages/db/src/query/live/ARCHITECTURE.md`). If a facade write or
 *    commit throws during a flush, or the root commit fails after `prepare()`,
 *    every facade returns to its rows, order and key mapping from before the
 *    flush, the facades the flush created leave the adapter, and no facade
 *    publishes an event or a layout revision. Every change pending at a failed
 *    flush, whether the facade write threw or the root commit failed, stays
 *    pending, so the next successful flush publishes it exactly once. The
 *    live-query builder keeps its pending root changes after a failed root
 *    commit; the facade rows those root rows refer to must survive with them.
 * 2. **Bounded rollback work.** A flush reads the stored rows only of the
 *    facades it writes, through any read path of the stored map. The rows it
 *    reads do not depend on the number or the size of facades that the flush
 *    does not touch.
 * 3. **Layout.** A facade is a Collection-valued include, and "an order-only
 *    change is a ... Collection layout" change ("Inline modes" in the
 *    architecture document). For a facade that exists before and after a
 *    successful flush, the model derives the owed layout revision from the
 *    rows a reader sees on each side. When the rows shown on both sides
 *    appear in a different relative order, exactly one revision is required.
 *    When the shown key sequence is identical, no revision is allowed.
 *    Otherwise membership changed while the common rows kept their relative
 *    order. Insert and delete events already convey that, so the contract
 *    allows zero or one revision. A failed flush publishes no revision.
 *
 * The model is a map from bucket key to the rows its facade shows, kept in
 * order by an order string. It also keeps the operations sent to the graph
 * since the last successful flush. A successful flush applies those
 * operations. A thrown flush leaves the published rows unchanged and keeps the
 * operations pending. A rollback after `prepare()` models a failed root commit:
 * it also leaves the published rows unchanged and keeps the operations
 * pending. The next flush must then compute order changes against the
 * restored state and publish the kept operations once.
 *
 * The history grammar has one edge with ordered rows and buckets `b0`..`b3`.
 * Each step sends a batch of operations to the graph, then flushes. The
 * operations are: activate a bucket, insert a row, update a row's value or
 * order, delete a row, and retire a bucket. Operations apply only to active
 * buckets, as the graph guarantees. A flush either publishes, throws from the
 * commit of an existing facade it writes, throws from the first write of such
 * a facade (leaving its sync transaction open), throws from the commit of a
 * facade it creates, or is rolled back after `prepare()`.
 *
 * The driver runs the real adapter over a D2 graph. After each flush it
 * compares the set of facades the adapter holds with the model's buckets,
 * each facade's ordered rows, the key that `getKeyFromItem` returns for each
 * row, the events each facade published, and each facade's layout revision.
 * The work counter wraps the iteration, `forEach`, `get` and `has` methods of
 * each facade's stored rows during the flush and records which facades the
 * flush read. A pinned case covers nested facades across two edges: the child
 * edge commits, then the parent edge throws.
 *
 * Limits:
 * - Facade indexes and the root commit inside a live query are covered by
 *   `bucket-facade-adapter.test.ts` and
 *   `includes-collection-oracle.property.test.ts`.
 * - In legal histories, retiring a bucket retracts its rows in the same flush,
 *   so the retire path always finds an empty facade. A mutant that copies a
 *   retired facade after its deletes is equivalent within this grammar.
 * - The flush still copies the adapter's edge and bucket maps, which grows
 *   with the number of buckets. That is bookkeeping, not row work, and this
 *   owner does not measure it.
 */

const PROPERTY = `bucket-facade.rollback-history`
const BUCKETS = [`b0`, `b1`, `b2`, `b3`] as const
const IDS = [1, 2, 3, 4, 5, 6] as const

type BucketKey = string
type Row = { id: number; v: number }
type ModelRow = { value: Row; order: string }
type Model = Map<BucketKey, Map<number, ModelRow>>

type Op =
  | { type: `activate`; bucket: BucketKey }
  | { type: `insert`; bucket: BucketKey; id: number; v: number; rank: number }
  | { type: `update`; bucket: BucketKey; id: number; v: number; rank: number }
  | { type: `delete`; bucket: BucketKey; id: number }
  | { type: `retire`; bucket: BucketKey }

type Outcome = `publish` | `throw` | `throwWrite` | `throwNew` | `rollback`

type FacadeSync = Parameters<SyncConfig<Record<string, unknown>>[`sync`]>[0]
type FacadeEntry = {
  collection: Collection<Row, number>
  sync: FacadeSync | undefined
}

/** The rows a facade must show, in order. */
function expectedRows(rows: Map<number, ModelRow> | undefined): Array<Row> {
  return [...(rows?.values() ?? [])]
    .sort((left, right) => (left.order < right.order ? -1 : 1))
    .map((row) => row.value)
}

type LayoutExpectation = `required` | `forbidden` | `permitted`

/**
 * The layout notification a successful flush owes a facade that exists on
 * both sides. "An order-only change is a ... Collection layout" change, so
 * when the rows the facade shows on both sides appear in a different
 * relative order, a revision is required. When the shown key sequence is
 * identical, a revision is forbidden. Otherwise membership changed while the
 * common rows kept their relative order: insert and delete events already
 * convey that, and the contract neither requires nor forbids a revision.
 */
function layoutExpectation(
  before: Map<number, ModelRow>,
  after: Map<number, ModelRow>,
): LayoutExpectation {
  const previousKeys = expectedRows(before).map((row) => row.id)
  const nextKeys = expectedRows(after).map((row) => row.id)
  if (
    previousKeys.length === nextKeys.length &&
    previousKeys.every((id, index) => id === nextKeys[index])
  ) {
    return `forbidden`
  }
  const common = (keys: Array<number>, other: Array<number>) =>
    keys.filter((id) => other.includes(id))
  const previousCommon = common(previousKeys, nextKeys)
  const nextCommon = common(nextKeys, previousKeys)
  return previousCommon.some((id, index) => id !== nextCommon[index])
    ? `required`
    : `permitted`
}

/**
 * Run `body`, then `cleanup`. When both throw, keep the body's failure as the
 * primary error: an AggregateError whose `cause` is that failure and whose
 * `errors` list it before the cleanup error (ORC-010).
 */
async function withCleanup(
  body: () => void | Promise<void>,
  cleanup: () => Promise<void>,
): Promise<void> {
  let failure: { error: unknown } | undefined
  try {
    await body()
  } catch (error) {
    failure = { error }
  }
  try {
    await cleanup()
  } catch (cleanupError) {
    if (!failure) throw cleanupError
    throw new AggregateError(
      [failure.error, cleanupError],
      `oracle failure, then cleanup failure`,
      { cause: failure.error },
    )
  }
  if (failure) throw failure.error
}

function cloneModel(model: Model): Model {
  return new Map([...model].map(([bucket, rows]) => [bucket, new Map(rows)]))
}

/** Apply operations to a copy of the model, as a successful flush does. */
function applyOps(model: Model, ops: ReadonlyArray<Op>): Model {
  const next = cloneModel(model)
  for (const op of ops) {
    if (op.type === `activate`) next.set(op.bucket, new Map())
    else if (op.type === `retire`) next.delete(op.bucket)
    else if (op.type === `delete`) next.get(op.bucket)!.delete(op.id)
    else
      next.get(op.bucket)!.set(op.id, {
        value: { id: op.id, v: op.v },
        order: orderOf(op.rank, op.id),
      })
  }
  return next
}

function orderOf(rank: number, id: number): string {
  return `${rank}:${id}`
}

/** Buckets whose facade a flush of these operations writes. */
function writtenBuckets(ops: ReadonlyArray<Op>): Set<BucketKey> {
  return new Set(
    ops.filter((op) => op.type !== `activate`).map((op) => op.bucket),
  )
}

/**
 * Turn abstract choices into operations that are legal against the effective
 * state: the published rows plus the operations still pending.
 */
function legalize(
  effective: Model,
  choices: ReadonlyArray<{
    kind: number
    bucket: number
    id: number
    v: number
    rank: number
  }>,
): Array<Op> {
  const state = cloneModel(effective)
  const ops: Array<Op> = []
  for (const choice of choices) {
    const bucket = BUCKETS[choice.bucket]!
    const rows = state.get(bucket)
    let op: Op
    if (!rows) {
      op = { type: `activate`, bucket }
    } else if (choice.kind === 4) {
      op = { type: `retire`, bucket }
    } else {
      const id = IDS[choice.id]!
      if (!rows.has(id)) {
        op = { type: `insert`, bucket, id, v: choice.v, rank: choice.rank }
      } else if (choice.kind === 3) {
        op = { type: `delete`, bucket, id }
      } else {
        op = { type: `update`, bucket, id, v: choice.v, rank: choice.rank }
      }
    }
    ops.push(op)
    const next = applyOps(state, [op])
    state.clear()
    for (const [key, value] of next) state.set(key, value)
  }
  return ops
}

/**
 * Make the next `commit` or `write` of a facade's sync throw once. A `write`
 * failure leaves the facade's sync transaction open, as a validation error
 * from a real write would.
 */
function injectFailure(sync: FacadeSync, method: `commit` | `write`): void {
  if (method === `commit`) {
    const commit = sync.commit
    sync.commit = () => {
      sync.commit = commit
      commit()
      throw new Error(`injected facade write failure`)
    }
    return
  }
  const write = sync.write
  sync.write = () => {
    sync.write = write
    throw new Error(`injected facade write failure`)
  }
}

class Driver {
  private readonly graph = new D2()
  private readonly rows = this.graph.newInput<[string, BucketRow]>()
  private readonly activity = this.graph.newInput<[string, true]>()
  readonly adapter: BucketFacadeAdapter
  private readonly events = new Map<object, number>()
  private readonly wrapped = new WeakSet<object>()
  private reads = new Map<object, number>()
  private readonly sent = new Map<BucketKey, Map<number, BucketRow>>()

  constructor() {
    this.adapter = new BucketFacadeAdapter(
      `rollback-oracle-${Math.random()}`,
      [
        {
          edgeId: `children`,
          rows: this.rows,
          activeBuckets: this.activity,
          hasOrderBy: true,
        },
      ],
      () => {},
    )
    this.graph.finalize()
  }

  private entries(): Map<string, FacadeEntry> {
    return (
      (
        this.adapter as unknown as {
          entries: Map<string, Map<string, FacadeEntry>>
        }
      ).entries.get(`children`) ?? new Map()
    )
  }

  entry(bucket: BucketKey): FacadeEntry | undefined {
    return this.entries().get(bucket)
  }

  /** Send operations to the graph as the materialization graph would. */
  send(ops: ReadonlyArray<Op>): void {
    for (const op of ops) {
      const sent = this.sent.get(op.bucket)
      if (op.type === `activate`) {
        this.activity.sendData(new MultiSet([[[op.bucket, true], 1]]))
        this.sent.set(op.bucket, new Map())
      } else if (op.type === `retire`) {
        for (const row of sent?.values() ?? []) {
          this.rows.sendData(new MultiSet([[[op.bucket, row], -1]]))
        }
        this.activity.sendData(new MultiSet([[[op.bucket, true], -1]]))
        this.sent.delete(op.bucket)
      } else if (op.type === `delete`) {
        this.rows.sendData(new MultiSet([[[op.bucket, sent!.get(op.id)!], -1]]))
        sent!.delete(op.id)
      } else {
        const previous = sent!.get(op.id)
        if (previous) {
          this.rows.sendData(new MultiSet([[[op.bucket, previous], -1]]))
        }
        const row: BucketRow = {
          publicKey: op.id,
          value: { id: op.id, v: op.v },
          order: orderOf(op.rank, op.id),
        }
        this.rows.sendData(new MultiSet([[[op.bucket, row], 1]]))
        sent!.set(op.id, row)
      }
    }
    this.graph.run()
  }

  /** Count events and stored-row reads for every facade that exists now. */
  instrument(): void {
    for (const entry of this.entries().values()) {
      const facade = entry.collection
      if (!this.events.has(facade)) {
        this.events.set(facade, 0)
        facade.subscribeChanges(() => {
          this.events.set(facade, (this.events.get(facade) ?? 0) + 1)
        })
      }
      const stored = facade._state.syncedData as unknown as Record<
        PropertyKey,
        (...args: Array<unknown>) => unknown
      >
      if (this.wrapped.has(stored)) continue
      this.wrapped.add(stored)
      // Every read path of the stored rows: iteration, forEach, and lookups.
      for (const method of [
        Symbol.iterator,
        `entries`,
        `keys`,
        `values`,
        `forEach`,
        `get`,
        `has`,
      ]) {
        const original = stored[method]!.bind(stored)
        stored[method] = (...args: Array<unknown>) => {
          this.reads.set(facade, (this.reads.get(facade) ?? 0) + 1)
          return original(...args)
        }
      }
    }
  }

  /**
   * Make the facade the flush creates for `bucket` throw from its first
   * commit. The facade does not exist before the flush, so wrap the adapter's
   * entry factory for this one flush.
   */
  failNewFacade(bucket: BucketKey): void {
    const adapter = this.adapter as unknown as {
      getEntry: (edgeId: string, bucketKey: string) => FacadeEntry
    }
    const getEntry = adapter.getEntry
    adapter.getEntry = (edgeId, bucketKey) => {
      const existed = this.entries().has(bucketKey)
      const entry = getEntry.call(this.adapter, edgeId, bucketKey)
      if (!existed && bucketKey === bucket) {
        adapter.getEntry = getEntry
        injectFailure(entry.sync!, `commit`)
      }
      return entry
    }
  }

  eventCounts(): Map<object, number> {
    return new Map(this.events)
  }

  /**
   * Each existing facade's layout revision. The live-query observer compares
   * it to detect a reorder of a Collection-valued include. A committed batch
   * advances it when it marks a layout change and the visible key order
   * changes; a discarded publication restores it.
   */
  layoutCounts(): Map<object, number> {
    return new Map(
      [...this.entries().values()].map((entry) => [
        entry.collection,
        entry.collection._layoutRevision,
      ]),
    )
  }

  /** Facades read since the last call. */
  takeReads(): Map<object, number> {
    const reads = this.reads
    this.reads = new Map()
    return reads
  }

  check(model: Model, label: string): void {
    // The adapter holds exactly the facades the model shows: a failed flush
    // removes the facades it created, and a retired bucket has no facade.
    expect(
      [...this.entries().keys()].sort(),
      `${label}: facades held by the adapter`,
    ).toEqual([...model.keys()].sort())
    for (const bucket of BUCKETS) {
      const rows = model.get(bucket)
      const facade = this.entry(bucket)?.collection
      if (!rows) continue
      expect(facade, `${label}: facade ${bucket}`).toBeDefined()
      expect(
        facade!.toArray.map(stripVirtualProps),
        `${label}: rows of ${bucket}`,
      ).toEqual(expectedRows(rows))
      for (const id of rows.keys()) {
        const stored = facade!.get(id)
        expect(stored, `${label}: row ${bucket}/${id}`).toBeDefined()
        expect(facade!.getKeyFromItem(stored!), `${label}: key ${id}`).toBe(id)
      }
    }
  }

  async cleanup(): Promise<void> {
    this.adapter.cleanup()
    await Promise.resolve()
  }
}

/** Run one history against the model, checking both laws after each flush. */
async function runHistory(
  steps: ReadonlyArray<{
    choices: ReadonlyArray<{
      kind: number
      bucket: number
      id: number
      v: number
      rank: number
    }>
    outcome: Outcome
    throwPick: number
  }>,
): Promise<void> {
  const driver = new Driver()
  let published: Model = new Map()
  let pending: Array<Op> = []
  await withCleanup(
    () => {
      for (const [index, step] of steps.entries()) {
        const label = `step ${index}`
        const ops = legalize(applyOps(published, pending), step.choices)
        driver.send(ops)
        pending = [...pending, ...ops]
        driver.instrument()
        const written = writtenBuckets(pending)
        const before = driver.eventCounts()
        const layoutsBefore = driver.layoutCounts()
        const facadesBefore = new Map(
          BUCKETS.map((bucket) => [bucket, driver.entry(bucket)?.collection]),
        )

        // Throw from the commit of one facade the flush writes. A facade commits
        // only when it has a pending row operation, so choose among existing
        // facades with one. Retiring an empty facade writes nothing.
        const rowBuckets = new Set(
          pending
            .filter((op) => op.type !== `activate` && op.type !== `retire`)
            .map((op) => op.bucket),
        )
        const throwTargets = [...rowBuckets].filter((bucket) =>
          driver.entry(bucket),
        )
        // A facade created in this flush: no facade before the flush, and the
        // pending operations leave its bucket active with rows to commit.
        const afterPending = applyOps(published, pending)
        const newTargets = BUCKETS.filter(
          (bucket) =>
            !driver.entry(bucket) && (afterPending.get(bucket)?.size ?? 0) > 0,
        )
        let outcome = step.outcome
        if (
          (outcome === `throw` || outcome === `throwWrite`) &&
          throwTargets.length === 0
        )
          outcome = `publish`
        if (outcome === `throwNew` && newTargets.length === 0)
          outcome = `publish`
        if (outcome === `throw` || outcome === `throwWrite`) {
          const target = driver.entry(
            throwTargets[step.throwPick % throwTargets.length]!,
          )!
          injectFailure(target.sync!, outcome === `throw` ? `commit` : `write`)
        } else if (outcome === `throwNew`) {
          driver.failNewFacade(newTargets[step.throwPick % newTargets.length]!)
        }

        driver.takeReads()
        if (outcome !== `publish` && outcome !== `rollback`) {
          expect(() => driver.adapter.flush(), label).toThrow(
            `injected facade write failure`,
          )
        } else {
          const publication = driver.adapter.flush()
          if (outcome === `rollback`) {
            publication.prepare()
            publication.rollback()
          } else {
            publication.publish()
          }
        }

        // Bounded rollback work: no facade outside the written buckets is read.
        const reads = driver.takeReads()
        for (const bucket of BUCKETS) {
          if (written.has(bucket)) continue
          const facade = driver.entry(bucket)?.collection
          if (!facade) continue
          expect(
            reads.get(facade) ?? 0,
            `${label}: reads of untouched ${bucket}`,
          ).toBe(0)
        }

        const layoutsAfter = driver.layoutCounts()
        if (outcome === `publish`) {
          const next = applyOps(published, pending)
          // Layout: the revision advances once for each facade whose shown rows
          // reorder, and stays put for any other facade that existed before.
          for (const bucket of BUCKETS) {
            const facade = facadesBefore.get(bucket)
            if (!facade || driver.entry(bucket)?.collection !== facade) continue
            const previous = published.get(bucket)
            const following = next.get(bucket)
            if (!previous || !following) continue
            const advanced =
              (layoutsAfter.get(facade) ?? 0) - (layoutsBefore.get(facade) ?? 0)
            const expectation = layoutExpectation(previous, following)
            if (expectation === `permitted`) {
              expect(
                advanced,
                `${label}: layout revision of ${bucket}`,
              ).toBeLessThanOrEqual(1)
            } else {
              expect(advanced, `${label}: layout revision of ${bucket}`).toBe(
                expectation === `required` ? 1 : 0,
              )
            }
          }
          published = next
          pending = []
          driver.check(published, label)
          continue
        }

        // A failed flush restores the published rows and publishes nothing,
        // neither row events nor a layout revision.
        driver.check(published, `${label} (${outcome})`)
        const after = driver.eventCounts()
        for (const [facade, count] of before) {
          expect(after.get(facade), `${label}: events after ${outcome}`).toBe(
            count,
          )
          expect(
            layoutsAfter.get(facade),
            `${label}: layout revision after ${outcome}`,
          ).toBe(layoutsBefore.get(facade))
        }
      }
    },
    () => driver.cleanup(),
  )
}

const choice = fc.record({
  kind: fc.integer({ min: 0, max: 4 }),
  bucket: fc.integer({ min: 0, max: BUCKETS.length - 1 }),
  id: fc.integer({ min: 0, max: IDS.length - 1 }),
  v: fc.integer({ min: 0, max: 9 }),
  rank: fc.integer({ min: 0, max: 9 }),
})
const step = fc.record({
  choices: fc.array(choice, { minLength: 1, maxLength: 6 }),
  outcome: fc.constantFrom<Outcome>(
    `publish`,
    `publish`,
    `throw`,
    `throwWrite`,
    `throwNew`,
    `rollback`,
  ),
  throwPick: fc.nat(3),
})
const history = fc.array(step, { minLength: 1, maxLength: 8 })

describe(`bucket facade rollback`, () => {
  it(`restores written facades and reads no others (fixed campaign)`, async () => {
    // A repeatable baseline. Seed 2081 is arbitrary.
    await fc.assert(fc.asyncProperty(history, runHistory), {
      numRuns: oracleRuns(150),
      seed: 2081,
    })
  })

  it(`restores written facades and reads no others (random or replayed)`, async () => {
    await fc.assert(
      fc.asyncProperty(history, runHistory),
      oraclePropertyOptions(150, PROPERTY),
    )
  })

  // Pinned: a list of 50 buckets with 3 rows each, where one insert touches
  // one bucket. The flush must read that bucket's rows and no others.
  it(`reads only the written facade in a wide list`, async () => {
    const driver = new Driver()
    await withCleanup(
      () => {
        const wide = Array.from({ length: 50 }, (_, index) => `w${index}`)
        for (const bucket of wide) {
          driver.send([
            { type: `activate`, bucket },
            ...[1, 2, 3].map((id): Op => ({
              type: `insert`,
              bucket,
              id,
              v: id,
              rank: id,
            })),
          ])
        }
        driver.adapter.flush().publish()
        driver.instrument()
        driver.send([{ type: `insert`, bucket: `w7`, id: 4, v: 4, rank: 4 }])
        driver.takeReads()
        driver.adapter.flush().publish()
        const written = driver.entry(`w7`)!.collection
        const untouchedReads = [...driver.takeReads()]
          .filter(([facade]) => facade !== written)
          .map(([facade]) => (facade as Collection<Row, number>).id)
        expect(untouchedReads).toEqual([])
      },
      () => driver.cleanup(),
    )
  })

  // Pinned: a flush that reorders a shown row throws. The retried flush must
  // still publish the layout change, so the failed flush must not leave its
  // new order behind as the facade's current order.
  it(`publishes a reorder on retry after a failed reordering flush`, async () => {
    await runHistory([
      {
        choices: [
          { kind: 0, bucket: 0, id: 0, v: 0, rank: 0 },
          { kind: 0, bucket: 0, id: 0, v: 1, rank: 1 },
          { kind: 0, bucket: 0, id: 1, v: 2, rank: 2 },
        ],
        outcome: `publish`,
        throwPick: 0,
      },
      {
        choices: [{ kind: 0, bucket: 0, id: 0, v: 1, rank: 5 }],
        outcome: `throw`,
        throwPick: 0,
      },
      {
        choices: [{ kind: 0, bucket: 1, id: 0, v: 0, rank: 0 }],
        outcome: `publish`,
        throwPick: 0,
      },
    ])
  })

  // Pinned: a reorder rolled back after `prepare()`, then sent again. The
  // rollback must restore the facade's current order, or the second flush
  // sees no order change and owes a layout revision it does not publish.
  it(`publishes a reorder sent again after a rolled-back reorder`, async () => {
    await runHistory([
      {
        choices: [
          { kind: 0, bucket: 0, id: 0, v: 0, rank: 0 },
          { kind: 0, bucket: 0, id: 0, v: 1, rank: 1 },
          { kind: 0, bucket: 0, id: 1, v: 2, rank: 2 },
        ],
        outcome: `publish`,
        throwPick: 0,
      },
      {
        choices: [{ kind: 0, bucket: 0, id: 0, v: 1, rank: 5 }],
        outcome: `rollback`,
        throwPick: 0,
      },
      {
        choices: [{ kind: 0, bucket: 0, id: 0, v: 1, rank: 5 }],
        outcome: `publish`,
        throwPick: 0,
      },
    ])
  })

  // Pinned: a failed root commit, then a retry that carries only changes to
  // other buckets, as a parent-only write would. The retry must still publish
  // the facade change that was pending when the root commit failed.
  it(`publishes a pending facade change after a failed root commit`, async () => {
    await runHistory([
      {
        choices: [
          { kind: 0, bucket: 0, id: 0, v: 0, rank: 0 },
          { kind: 0, bucket: 0, id: 0, v: 1, rank: 1 },
        ],
        outcome: `publish`,
        throwPick: 0,
      },
      {
        choices: [{ kind: 0, bucket: 0, id: 0, v: 2, rank: 1 }],
        outcome: `rollback`,
        throwPick: 0,
      },
      {
        choices: [{ kind: 0, bucket: 1, id: 0, v: 0, rank: 0 }],
        outcome: `publish`,
        throwPick: 0,
      },
    ])
  })

  // Pinned: nested facades. A parent facade's row refers to a child facade.
  // The child edge commits first, then the parent edge's commit throws. The
  // failed flush must restore the child's rows, keep the parent's reference
  // to the old child facade, and drop the child facade it created. The retry
  // then applies every change.
  it(`restores a child facade when its parent edge fails`, async () => {
    const graph = new D2()
    const childRows = graph.newInput<[string, BucketRow]>()
    const childActive = graph.newInput<[string, true]>()
    const parentRows = graph.newInput<[string, BucketRow]>()
    const parentActive = graph.newInput<[string, true]>()
    const adapter = new BucketFacadeAdapter(
      `rollback-oracle-nested-${Math.random()}`,
      [
        {
          edgeId: `children`,
          rows: childRows,
          activeBuckets: childActive,
          hasOrderBy: false,
        },
        {
          edgeId: `parents`,
          rows: parentRows,
          activeBuckets: parentActive,
          hasOrderBy: false,
        },
      ],
      () => {},
    )
    graph.finalize()
    const entries = (
      adapter as unknown as {
        entries: Map<string, Map<string, FacadeEntry>>
      }
    ).entries
    const facade = (edgeId: string, bucket: string) =>
      entries.get(edgeId)?.get(bucket)?.collection
    const ref = (bucketKey: string) => ({
      [BUCKET_FACADE_REF]: { edgeId: `children`, bucketKey },
    })
    const row = (publicKey: number, value: object): BucketRow => ({
      publicKey,
      value,
      order: undefined,
    })
    const child10 = row(10, { id: 10, v: 1 })
    const parent1 = row(1, { id: 1, kids: ref(`c1`) })

    await withCleanup(
      () => {
        childActive.sendData(new MultiSet([[[`c1`, true], 1]]))
        childRows.sendData(new MultiSet([[[`c1`, child10], 1]]))
        parentActive.sendData(new MultiSet([[[`p1`, true], 1]]))
        parentRows.sendData(new MultiSet([[[`p1`, parent1], 1]]))
        graph.run()
        adapter.flush().publish()
        const c1 = facade(`children`, `c1`)!
        const p1 = facade(`parents`, `p1`)!
        expect((p1.get(1) as { kids: unknown }).kids).toBe(c1)

        let events = 0
        c1.subscribeChanges(() => events++)
        p1.subscribeChanges(() => events++)

        // The flush updates c1, creates c2, and moves parent 1 to c2.
        const child10v2 = row(10, { id: 10, v: 2 })
        const child11 = row(11, { id: 11, v: 1 })
        const parent1moved = row(1, { id: 1, kids: ref(`c2`) })
        childRows.sendData(
          new MultiSet([
            [[`c1`, child10], -1],
            [[`c1`, child10v2], 1],
          ]),
        )
        childActive.sendData(new MultiSet([[[`c2`, true], 1]]))
        childRows.sendData(new MultiSet([[[`c2`, child11], 1]]))
        parentRows.sendData(
          new MultiSet([
            [[`p1`, parent1], -1],
            [[`p1`, parent1moved], 1],
          ]),
        )
        graph.run()
        injectFailure(entries.get(`parents`)!.get(`p1`)!.sync!, `commit`)

        expect(() => adapter.flush()).toThrow(`injected facade write failure`)
        expect(c1.toArray.map(stripVirtualProps)).toEqual([{ id: 10, v: 1 }])
        expect((p1.get(1) as { kids: unknown }).kids).toBe(c1)
        expect([...entries.get(`children`)!.keys()]).toEqual([`c1`])
        expect(events).toBe(0)

        // The retry applies the pending changes the failed flush kept.
        adapter.flush().publish()
        const c2 = facade(`children`, `c2`)!
        expect(c1.toArray.map(stripVirtualProps)).toEqual([{ id: 10, v: 2 }])
        expect(c2.toArray.map(stripVirtualProps)).toEqual([{ id: 11, v: 1 }])
        expect((p1.get(1) as { kids: unknown }).kids).toBe(c2)
      },
      async () => {
        adapter.cleanup()
        await Promise.resolve()
      },
    )
  })

  // Calibration for ORC-010: when the history fails and cleanup also throws,
  // the report keeps the history's failure as its cause.
  it(`keeps the oracle failure when cleanup also fails`, async () => {
    const failure = new Error(`oracle assertion`)
    const cleanupFailure = new Error(`cleanup failure`)
    const result = await withCleanup(
      () => Promise.reject(failure),
      () => Promise.reject(cleanupFailure),
    ).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(result).toBeInstanceOf(AggregateError)
    const aggregate = result as AggregateError
    expect(aggregate.cause).toBe(failure)
    expect(aggregate.errors).toEqual([failure, cleanupFailure])

    // Without a history failure, the cleanup failure is reported as is.
    await expect(
      withCleanup(
        () => Promise.resolve(),
        () => Promise.reject(cleanupFailure),
      ),
    ).rejects.toBe(cleanupFailure)
  })

  // Pinned: a failed flush that writes two existing buckets and retires a
  // third restores all three, then the retried flush applies everything.
  it(`restores two written buckets and a retired bucket, then retries`, async () => {
    await runHistory([
      {
        choices: [
          { kind: 0, bucket: 0, id: 0, v: 1, rank: 1 },
          { kind: 0, bucket: 1, id: 0, v: 1, rank: 1 },
          { kind: 0, bucket: 2, id: 0, v: 1, rank: 1 },
          { kind: 0, bucket: 0, id: 0, v: 1, rank: 1 },
          { kind: 0, bucket: 1, id: 1, v: 2, rank: 0 },
          { kind: 0, bucket: 2, id: 0, v: 1, rank: 1 },
        ],
        outcome: `publish`,
        throwPick: 0,
      },
      {
        choices: [
          { kind: 0, bucket: 0, id: 0, v: 5, rank: 9 },
          { kind: 3, bucket: 1, id: 1, v: 0, rank: 0 },
          { kind: 4, bucket: 2, id: 0, v: 0, rank: 0 },
        ],
        outcome: `throw`,
        throwPick: 1,
      },
      {
        choices: [{ kind: 0, bucket: 3, id: 2, v: 3, rank: 2 }],
        outcome: `publish`,
        throwPick: 0,
      },
    ])
  })
})
