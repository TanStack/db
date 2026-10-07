import { D2, MultiSet } from '@tanstack/db-ivm'
import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { BucketFacadeAdapter } from '../../src/query/live/bucket-facade-adapter.js'
import { stripVirtualProps } from '../utils.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
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
 * Two laws hold at the adapter boundary:
 *
 * 1. **Flush atomicity** ("Coherent publication" in
 *    `packages/db/src/query/live/ARCHITECTURE.md`). If a facade write throws
 *    during a flush, or the root commit fails after `prepare()`, every facade
 *    returns to its rows, order and key mapping from before the flush, and no
 *    facade publishes an event. Pending graph output that the failed flush did
 *    not consume is still pending, so the next successful flush applies it.
 * 2. **Bounded rollback work.** A flush reads the stored rows only of the
 *    facades it writes. The rows it reads do not depend on the number or the
 *    size of facades that the flush does not touch.
 *
 * The model is a map from bucket key to the rows its facade shows, kept in
 * order by an order string. It also keeps the operations sent to the graph
 * since the last successful flush. A successful flush applies those
 * operations. A failed flush leaves the published rows unchanged and keeps
 * the operations pending. A rollback after `prepare()` is the last step of a
 * history, because the adapter has consumed its pending rows by then and the
 * builder above it owns the retry.
 *
 * The history grammar has one edge with ordered rows and buckets `b0`..`b3`.
 * Each step sends a batch of operations to the graph, then flushes. The
 * operations are: activate a bucket, insert a row, update a row's value or
 * order, delete a row, and retire a bucket. Operations apply only to active
 * buckets, as the graph guarantees. A flush either publishes, throws from the
 * commit of one facade it writes, or is rolled back after `prepare()`.
 *
 * The driver runs the real adapter over a D2 graph. After each flush it
 * compares each active facade's ordered rows, the key that `getKeyFromItem`
 * returns for each row, and the events each facade published. The work
 * counter wraps the iterators of each facade's stored rows during the flush
 * and records which facades the flush read.
 *
 * Limits: this owner covers one edge. Nested facades, facade indexes and the
 * root commit inside a live query are covered by `bucket-facade-adapter.test.ts`
 * and `includes-collection-oracle.property.test.ts`.
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

type Outcome = `publish` | `throw` | `rollback`

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
      for (const method of [Symbol.iterator, `entries`, `keys`, `values`]) {
        const original = stored[method]!.bind(stored)
        stored[method] = (...args: Array<unknown>) => {
          this.reads.set(facade, (this.reads.get(facade) ?? 0) + 1)
          return original(...args)
        }
      }
    }
  }

  eventCounts(): Map<object, number> {
    return new Map(this.events)
  }

  /** Facades read since the last call. */
  takeReads(): Map<object, number> {
    const reads = this.reads
    this.reads = new Map()
    return reads
  }

  check(model: Model, label: string): void {
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
  try {
    for (const [index, step] of steps.entries()) {
      const label = `step ${index}`
      const ops = legalize(applyOps(published, pending), step.choices)
      driver.send(ops)
      pending = [...pending, ...ops]
      driver.instrument()
      const written = writtenBuckets(pending)
      const before = driver.eventCounts()

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
      let outcome = step.outcome
      if (outcome === `throw` && throwTargets.length === 0) outcome = `publish`
      if (outcome === `throw`) {
        const target = driver.entry(
          throwTargets[step.throwPick % throwTargets.length]!,
        )!
        const sync = target.sync!
        const commit = sync.commit
        sync.commit = () => {
          sync.commit = commit
          commit()
          throw new Error(`injected facade write failure`)
        }
      }

      driver.takeReads()
      if (outcome === `throw`) {
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

      if (outcome === `publish`) {
        published = applyOps(published, pending)
        pending = []
        driver.check(published, label)
        continue
      }

      // A failed flush restores the published rows and publishes nothing.
      driver.check(published, `${label} (${outcome})`)
      const after = driver.eventCounts()
      for (const [facade, count] of before) {
        expect(after.get(facade), `${label}: events after ${outcome}`).toBe(
          count,
        )
      }
      if (outcome === `rollback`) return
    }
  } finally {
    await driver.cleanup()
  }
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
  outcome: fc.constantFrom<Outcome>(`publish`, `publish`, `throw`, `rollback`),
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
    try {
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
    } finally {
      await driver.cleanup()
    }
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
