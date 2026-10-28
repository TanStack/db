import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { stripVirtualProps } from '../utils.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
import { declareOracle } from '../oracle-declaration.js'
import {
  BUCKETS,
  Driver,
  expectedRows,
  injectFailure,
  orderOf,
  withCleanup,
} from './bucket-facade-rollback-support.js'
import type {
  BucketKey,
  Model,
  ModelRow,
  Op,
} from './bucket-facade-rollback-support.js'

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
 *    A successful flush publishes, for each facade, an event for each row a
 *    pending operation touched, at most once per row, and no event for any
 *    other row. Replaying those events on the rows the facade showed before
 *    the flush gives the rows it shows after.
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
 * facade it creates, or is rolled back after `prepare()`. Before a step's
 * operations, the step may insert an optimistic row into a held facade
 * through a user transaction that stays pending until cleanup. That row may
 * take an id the graph does not hold in the bucket now, so a later graph row
 * can share its key (`shareId`); the comparison sets such ids aside until a
 * step rolls back the open optimistic rows (`settleLocal`), after which those
 * keys are compared by value. A step
 * may also try to clean up a shown facade from outside the adapter
 * (`cleanup`), as a holder might. The live query owns its facades, so the
 * call throws and the facade keeps receiving the graph's writes. The model
 * keeps only synced rows, so the comparison sets those optimistic rows aside
 * and checks that each stays visible while its facade is held. A step may
 * also hold one shown facade's sync commits behind a persisting user
 * transaction during the flush and up to two later flushes (`holdFor`). The
 * flushes' writes and a rollback's restoring writes then land only when the
 * transaction settles. Steps that end with the hold still open compare only
 * reads, because nothing they wrote has landed. The step that settles it
 * compares rows, and also events and layout when the hold covered only that
 * step. The settled transaction's own row and its events are set aside. A
 * hold still open at the end settles and its rows are compared.
 *
 * The driver runs the real adapter over a D2 graph. After each flush it
 * compares the set of facades the adapter holds with the model's buckets,
 * each facade's ordered rows, the key that `getKeyFromItem` returns for each
 * row, the change events each facade published, and each facade's layout
 * revision. For a facade that existed before a successful flush, it replays
 * the flush's events on the facade's previous rows and checks which rows the
 * events name. After a failed flush it checks that every facade the flush
 * created reports `status === 'cleaned-up'`. Every facade the model shows
 * must report `status === 'ready'`, and every change message a facade
 * delivers must be valid for its subscriber: an insert names an absent key,
 * and an update or delete names a present one.
 * While a hold settles after a failed flush, a restoring sync update can
 * still publish the value the facade already shows; that permitted false
 * positive is the only event a failed flush may publish.
 * The work counter wraps the iteration, `get` and `has` methods of
 * each facade's stored rows during the flush and records which facades the
 * flush read. A pinned case covers nested facades across two edges: the child
 * edge commits, then the parent edge throws. Pinned cases also cover a
 * facade subscriber that throws during publication, which must not hold back
 * another facade's events, and a restore that throws, which must still close
 * every facade's deferred events.
 *
 * Limits:
 * - Facade indexes and the root commit inside a live query are covered by
 *   `bucket-facade-adapter.test.ts` and
 *   `includes-collection-oracle.property.test.ts`.
 * - The graph retracts a bucket's synced rows before it retires the bucket,
 *   but a retired facade can still show rows the graph never sent: an
 *   optimistic row from a user transaction on the facade, or a sync commit
 *   held behind a persisting transaction. The grammar adds optimistic
 *   inserts and optimistic deletes and updates of shown graph rows (the
 *   `local` and `changeShown` step fields). An update builds a copy of the
 *   stored row, which must keep the row's key. The oracle requires a retired facade to show
 *   exactly its visible optimistic rows. Those rows have no synced row, so
 *   they leave when their transactions settle, and every history ends by
 *   settling them and comparing all rows again. A row the graph sent and
 *   never retracted is a contradictory graph
 *   signal, so retiring its bucket throws and the flush restores the facade.
 *   The `contradict` outcome generates it for a shown facade with rows; every
 *   other retirement follows the graph's retractions, including under a
 *   hold, and must not throw. Held
 *   commits are in the grammar (the `hold` and `holdFor` step fields), one
 *   hold at a time, for up to three flushes. A step that releases a hold
 *   opened earlier checks rows only, not events or layout. Optimistic rows
 *   that share a graph id are not compared by value.
 * - After a failed flush, each facade the flush created must report
 *   `status === 'cleaned-up'`. A facade the adapter retired or replaced is
 *   followed only for its rows. Its events after retirement are not checked.
 * - The adapter is internal. Its public surface is `flush`, `resolve` and
 *   `cleanup`, and `resolve` creates a facade for a bucket it does not hold.
 *   So the driver reads the adapter's private facade map to see which facades
 *   it holds, and wraps its private entry factory to fail a facade that a
 *   flush creates. The rows, events and layout revisions it compares are each
 *   facade's public Collection state.
 * - The flush still copies the adapter's edge and bucket maps, which grows
 *   with the number of buckets. That is bookkeeping, not row work, and this
 *   owner does not measure it.
 */

const PROPERTY = `bucket-facade.rollback-history`
const IDS = [1, 2, 3, 4, 5, 6] as const

/**
 * How a flush ends. `contradict` retires a shown bucket without the graph's
 * retractions, a contradictory graph signal: the flush throws code 240 and
 * restores every facade, as for any failed flush.
 */
type Outcome =
  | `publish`
  | `throw`
  | `throwWrite`
  | `throwStaged`
  | `throwNew`
  | `rollback`
  | `contradict`

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
 * The layout owed to a reader whose facade hides graph rows behind optimistic
 * deletes. The reader's rows decide what is required. The adapter orders only
 * graph rows, so a graph reorder that the hidden rows make invisible permits
 * one revision: a false-positive revision leaves the reader's rows unchanged.
 */
function shownLayoutExpectation(
  before: Map<number, ModelRow>,
  after: Map<number, ModelRow>,
  local: Map<number, boolean>,
): LayoutExpectation {
  const shown = (rows: Map<number, ModelRow>) =>
    new Map([...rows].filter(([id]) => local.get(id) !== false))
  const expectation = layoutExpectation(shown(before), shown(after))
  return expectation === `forbidden` &&
    layoutExpectation(before, after) !== `forbidden`
    ? `permitted`
    : expectation
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

/** The row ids a facade's events may name after these operations. */
function touchedIds(
  bucket: BucketKey,
  previous: Model,
  ops: ReadonlyArray<Op>,
): Set<number> {
  const ids = new Set<number>()
  for (const op of ops) {
    if (op.bucket !== bucket) continue
    if (op.type === `retire`) {
      for (const id of previous.get(bucket)?.keys() ?? []) ids.add(id)
    } else if (op.type !== `activate`) {
      ids.add(op.id)
    }
  }
  return ids
}

/**
 * Exactly-once publication. For each facade that existed before a successful
 * flush, its events name only rows a pending operation touched, each row at
 * most once, and replaying them on its previous rows gives the rows it shows
 * now. A retired or replaced facade must end empty.
 */
function checkEvents(
  previous: Model,
  next: Model,
  ops: ReadonlyArray<Op>,
  facadesBefore: Map<BucketKey, object | undefined>,
  driver: Driver,
  label: string,
): void {
  const changes = driver.takeChanges()
  for (const bucket of BUCKETS) {
    const facade = facadesBefore.get(bucket)
    if (!facade) continue
    const local = driver.local(facade)
    const messages = (changes.get(facade) ?? []).filter(
      (message) => !driver.heldIds.has(message.key) && !local.has(message.key),
    )
    const touched = touchedIds(bucket, previous, ops)
    const named = messages.map((message) => message.key)
    expect(
      named.filter((id) => !touched.has(id)),
      `${label}: events of ${bucket} for untouched rows`,
    ).toEqual([])
    expect(
      named.filter((id, index) => named.indexOf(id) !== index),
      `${label}: rows of ${bucket} published twice`,
    ).toEqual([])
    const replayed = new Map(
      [...(previous.get(bucket)?.values() ?? [])].map((row) => [
        row.value.id,
        row.value,
      ]),
    )
    for (const message of messages) {
      if (message.type === `delete`) replayed.delete(message.key)
      else replayed.set(message.key, stripVirtualProps(message.value))
    }
    const stillShown = driver.entry(bucket)?.collection === facade
    const expected = stillShown
      ? new Map(
          [...(next.get(bucket)?.values() ?? [])].map((row) => [
            row.value.id,
            row.value,
          ]),
        )
      : new Map()
    for (const id of local.keys()) {
      replayed.delete(id)
      expected.delete(id)
    }
    expect(
      Object.fromEntries(replayed),
      `${label}: replayed events of ${bucket}`,
    ).toEqual(Object.fromEntries(expected))
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
    local?: number
    shareId?: boolean
    changeShown?: `delete` | `update`
    hold?: number
    holdFor?: number
    cleanup?: number
    settleLocal?: boolean
  }>,
): Promise<void> {
  const driver = new Driver()
  let published: Model = new Map()
  let pending: Array<Op> = []
  // A hold can stay open for later steps. Until it settles, its facade's
  // writes have not landed, so those steps compare nothing but reads.
  let open:
    | { settle: () => Promise<void>; remaining: number; openedAt: number }
    | undefined
  await withCleanup(
    async () => {
      for (const [index, step] of steps.entries()) {
        const label = `step ${index}`
        // Before anything else, the step may roll back the open optimistic
        // rows, outside any hold, so their events precede this flush.
        if (step.settleLocal) driver.settleLocals()
        // A user transaction may first add an optimistic row to a shown facade.
        const localBucket =
          step.local === undefined ? undefined : BUCKETS[step.local]
        if (localBucket && published.has(localBucket)) {
          // The optimistic row may take a graph id the bucket does not hold
          // now, so a later graph row can share its key.
          // A rolled-back delete keeps its row shown, so skip ids shown now
          // as well as ids the pending operations leave.
          const shown = published.get(localBucket) ?? new Map()
          const after =
            applyOps(published, pending).get(localBucket) ?? new Map()
          const facade = driver.entry(localBucket)?.collection
          const taken = facade
            ? driver.local(facade)
            : new Map<number, boolean>()
          // Under an open hold the facade can still show a row the model has
          // already removed.
          const free = IDS.filter(
            (id) =>
              !shown.has(id) &&
              !after.has(id) &&
              !taken.has(id) &&
              !facade?.has(id),
          )
          const shownIds = [...shown.keys()]
          driver.addLocal(
            localBucket,
            step.shareId && free.length > 0
              ? free[index % free.length]
              : undefined,
            step.changeShown && shownIds.length > 0
              ? {
                  id: shownIds[index % shownIds.length]!,
                  type: step.changeShown,
                }
              : undefined,
          )
        }
        // A holder may try to clean up a shown facade. The call is refused,
        // and the facade keeps receiving the graph's writes.
        const cleanupBucket =
          step.cleanup === undefined ? undefined : BUCKETS[step.cleanup]
        if (cleanupBucket && published.has(cleanupBucket))
          await driver.attemptCleanup(cleanupBucket)
        // A persisting user transaction may hold one shown facade's sync
        // commits through this flush and up to two more. It settles before
        // the comparison of its last step.
        const holdBucket =
          step.hold === undefined ? undefined : BUCKETS[step.hold]
        if (!open && holdBucket && published.has(holdBucket)) {
          const settleHold = driver.hold(holdBucket)
          if (settleHold)
            open = {
              settle: settleHold,
              remaining: step.holdFor ?? 0,
              openedAt: index,
            }
        }
        const settle = open?.remaining === 0 ? open.settle : undefined
        // The events and layout of a step that releases a hold opened earlier
        // mix several flushes, so only its rows are compared.
        const spanning = settle !== undefined && open!.openedAt < index
        const ops = legalize(applyOps(published, pending), step.choices)
        driver.send(ops)
        pending = [...pending, ...ops]
        driver.instrument()
        const written = writtenBuckets(pending)
        // A contradictory retirement targets a shown, live facade that keeps
        // rows after the pending operations.
        const afterOps = applyOps(published, pending)
        const contradictTargets = BUCKETS.filter(
          (bucket) =>
            driver.entry(bucket) !== undefined &&
            (afterOps.get(bucket)?.size ?? 0) > 0,
        )
        const contradicted =
          step.outcome === `contradict` && contradictTargets.length > 0
            ? contradictTargets[step.throwPick % contradictTargets.length]!
            : undefined
        if (contradicted) {
          driver.retireWithoutRetractions(contradicted)
          // The retirement check reads that facade's rows.
          written.add(contradicted)
        }
        const before = driver.eventCounts()
        const layoutsBefore = driver.layoutCounts()
        const facadesBefore = new Map(
          BUCKETS.map((bucket) => [bucket, driver.entry(bucket)?.collection]),
        )

        // Throw from the commit of one facade the flush writes. A facade commits
        // only when it has a pending row operation, so choose among existing
        // facades with one. Retiring an empty facade writes nothing.
        // A key inserted and retracted again within the flush, absent before
        // and after, nets to nothing, so the flush writes nothing for it.
        const rowBuckets = new Set(
          pending
            .filter(
              (op) =>
                op.type !== `activate` &&
                op.type !== `retire` &&
                (published.get(op.bucket)?.has(op.id) === true ||
                  afterOps.get(op.bucket)?.has(op.id) === true),
            )
            .map((op) => op.bucket),
        )
        const throwTargets = [...rowBuckets].filter(
          (bucket) => driver.entry(bucket) !== undefined,
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
          (outcome === `throw` ||
            outcome === `throwWrite` ||
            outcome === `throwStaged`) &&
          throwTargets.length === 0
        )
          outcome = `publish`
        if (outcome === `throwNew` && newTargets.length === 0)
          outcome = `publish`
        if (outcome === `contradict` && !contradicted) outcome = `publish`
        if (
          outcome === `throw` ||
          outcome === `throwWrite` ||
          outcome === `throwStaged`
        ) {
          const target = driver.entry(
            throwTargets[step.throwPick % throwTargets.length]!,
          )!
          injectFailure(
            target.sync!,
            outcome === `throw`
              ? `commit`
              : outcome === `throwWrite`
                ? `write`
                : `staged`,
          )
        } else if (outcome === `throwNew`) {
          driver.failNewFacade(newTargets[step.throwPick % newTargets.length]!)
        }

        driver.takeReads()
        driver.takeChanges()
        const created = driver.recordCreated()
        if (outcome !== `publish` && outcome !== `rollback`) {
          expect(() => driver.adapter.flush(), label).toThrow(
            outcome === `contradict`
              ? `Bucket facade retired with rows the graph did not retract`
              : `injected facade write failure`,
          )
          if (contradicted) driver.cancelRetirement(contradicted)
        } else {
          const publication = driver.adapter.flush()
          if (outcome === `rollback`) {
            publication.prepare()
            publication.rollback()
          } else {
            publication.publish()
          }
        }
        driver.restoreGetEntry()

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

        if (open && open.remaining > 0) {
          open.remaining--
          // Laws that do not wait for held writes still hold: a failed flush
          // disposes of the facades it created, and the adapter holds exactly
          // the facades the model shows.
          if (outcome !== `publish`)
            for (const facade of created)
              expect(facade.status, `${label}: created facade disposed`).toBe(
                `cleaned-up`,
              )
          driver.checkHeld(
            outcome === `publish` ? applyOps(published, pending) : published,
            label,
          )
          driver.takeChanges()
          if (outcome === `publish`) {
            published = applyOps(published, pending)
            pending = []
          }
          continue
        }
        // The held commits land when the transaction settles. Every law below
        // is checked after that, so a write the flush held cannot hide.
        await settle?.()
        open = undefined

        const layoutsAfter = driver.layoutCounts()
        if (outcome === `publish` && spanning) {
          published = applyOps(published, pending)
          pending = []
          driver.takeChanges()
          driver.check(published, `${label} (hold released)`)
          continue
        }
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
            const expectation = shownLayoutExpectation(
              previous,
              following,
              driver.local(facade),
            )
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
          checkEvents(published, next, pending, facadesBefore, driver, label)
          published = next
          pending = []
          driver.check(published, label)
          continue
        }

        // A failed flush restores the published rows and publishes nothing,
        // neither row events nor a layout revision, and disposes of the
        // facades it created.
        for (const facade of created) {
          expect(facade.status, `${label}: created facade disposed`).toBe(
            `cleaned-up`,
          )
        }
        driver.check(published, `${label} (${outcome})`)
        if (spanning) {
          driver.takeChanges()
          continue
        }
        // Settling the hold publishes only its own row's events.
        // Under a hold, the
        // restoring writes land when the transaction settles, and a sync update
        // that restores the shown value can still publish. That repeats the
        // value the facade shows, a permitted false positive; any other event
        // is a change the failed flush must not publish.
        const shownRow = (facade: object, key: number) => {
          const bucket = BUCKETS.find(
            (candidate) => driver.entry(candidate)?.collection === facade,
          )
          return bucket === undefined
            ? undefined
            : published.get(bucket)?.get(key)
        }
        for (const [facade, messages] of driver.takeChanges()) {
          expect(
            messages
              .filter(
                (message) =>
                  !(
                    settle &&
                    message.type === `update` &&
                    JSON.stringify(stripVirtualProps(message.value)) ===
                      JSON.stringify(shownRow(facade, message.key)?.value)
                  ),
              )
              .map((message) => message.key)
              .filter((key) => !driver.heldIds.has(key)),
            `${label}: events after ${outcome}`,
          ).toEqual([])
        }
        const after = driver.eventCounts()
        for (const [facade, count] of before) {
          // The hold's own row adds events when the transaction settles.
          if (!settle)
            expect(after.get(facade), `${label}: events after ${outcome}`).toBe(
              count,
            )
          expect(
            layoutsAfter.get(facade),
            `${label}: layout revision after ${outcome}`,
          ).toBe(layoutsBefore.get(facade))
        }
      }
      // A hold still open at the end settles, and its writes must then match.
      if (open) {
        await open.settle()
        driver.check(published, `end (hold released)`)
      }
      // Open optimistic rows roll back, so keys they hid are compared too.
      driver.settleLocals()
      await Promise.resolve()
      driver.check(published, `end (optimistic rows settled)`)
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
    `throwStaged`,
    `throwNew`,
    `rollback`,
    `contradict`,
  ),
  throwPick: fc.nat(3),
  // About two steps in five add an optimistic row to a facade first.
  local: fc
    .integer({ min: -3, max: BUCKETS.length - 1 })
    .map((bucket) => (bucket < 0 ? undefined : bucket)),
  // About two steps in five hold a facade's sync commits behind a persisting
  // transaction during the flush.
  hold: fc
    .integer({ min: -3, max: BUCKETS.length - 1 })
    .map((bucket) => (bucket < 0 ? undefined : bucket)),
  // A hold stays open for this step and up to two more.
  holdFor: fc.integer({ min: 0, max: 2 }),
  // An optimistic row sometimes takes a graph id.
  shareId: fc.boolean(),
  // The optimistic change is sometimes a delete or an update of a shown
  // graph row. An update copies the stored row, so the copy must keep its key.
  changeShown: fc.constantFrom<`delete` | `update` | undefined>(
    undefined,
    undefined,
    `delete`,
    `update`,
  ),
  // About one step in eight cleans up a shown facade from outside.
  cleanup: fc
    .integer({ min: -28, max: BUCKETS.length - 1 })
    .map((bucket) => (bucket < 0 ? undefined : bucket)),
  // About one step in six first rolls back the open optimistic rows.
  settleLocal: fc.integer({ min: 0, max: 5 }).map((n) => n === 0),
})
const history = fc.array(step, { minLength: 1, maxLength: 8 })
// The parts this file declares. runHistory runs one generated or pinned
// history through the real adapter and compares it with the model after each
// flush; checkEvents is its exactly-once publication comparison. The model
// predicts the rows that each flush owes, which events it may name, and which
// layout revision it owes.
declareOracle({
  check: [runHistory, checkEvents],
  model: [applyOps, layoutExpectation, shownLayoutExpectation, touchedIds],
})

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

  // A retired facade can still show rows the graph never sent: an optimistic
  // row from a pending user transaction, or a held sync commit behind a
  // persisting one. Retiring the bucket must not fail the flush.
  it(`retires a bucket whose facade shows an optimistic row`, async () => {
    await runHistory([
      {
        choices: [
          { kind: 0, bucket: 0, id: 0, v: 1, rank: 1 },
          { kind: 0, bucket: 0, id: 0, v: 1, rank: 1 },
        ],
        outcome: `publish`,
        throwPick: 0,
      },
      {
        choices: [{ kind: 4, bucket: 0, id: 0, v: 0, rank: 0 }],
        outcome: `publish`,
        throwPick: 0,
        local: 0,
      },
    ])
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

  // Pinned replay of a generated failure: an update to a row that an earlier
  // flush wrote behind a still-persisting transaction keeps the row.
  it(`updates a row that a persisting transaction still holds`, async () => {
    await runHistory([
      {
        choices: [{ kind: 0, bucket: 0, id: 0, v: 0, rank: 0 }],
        outcome: `publish`,
        throwPick: 0,
      },
      {
        choices: [{ kind: 0, bucket: 0, id: 0, v: 1, rank: 0 }],
        outcome: `publish`,
        throwPick: 0,
        hold: 0,
        holdFor: 1,
      },
      {
        choices: [{ kind: 0, bucket: 0, id: 0, v: 2, rank: 0 }],
        outcome: `publish`,
        throwPick: 0,
      },
    ])
  })

  // Pinned replay of a CI failure: a rollback restores a row that an earlier
  // flush wrote behind a still-persisting transaction. The restore must write
  // it as an update, because the held insert lands first.
  it(`restores a held row after a rolled-back update`, async () => {
    await runHistory([
      {
        choices: [{ kind: 0, bucket: 3, id: 0, v: 0, rank: 0 }],
        outcome: `publish`,
        throwPick: 0,
      },
      {
        choices: [
          { kind: 0, bucket: 3, id: 5, v: 0, rank: 0 },
          { kind: 0, bucket: 0, id: 0, v: 0, rank: 0 },
        ],
        outcome: `publish`,
        throwPick: 0,
        hold: 3,
        holdFor: 1,
      },
      {
        choices: [{ kind: 0, bucket: 3, id: 5, v: 1, rank: 0 }],
        outcome: `rollback`,
        throwPick: 0,
      },
    ])
  })

  // Pinned replay of a generated failure: an optimistic row shares a graph
  // id, is rolled back, and then a flush fails while writing the facade. The
  // failed flush publishes nothing.
  it(`publishes nothing from a failed flush after a shared optimistic row leaves`, async () => {
    const plain = {
      throwPick: 0,
      local: 0,
      hold: 0,
      holdFor: 0,
      shareId: false,
      settleLocal: true,
    }
    await runHistory([
      {
        ...plain,
        cleanup: 0,
        choices: [{ kind: 0, bucket: 1, id: 0, v: 0, rank: 0 }],
        outcome: `publish`,
      },
      {
        ...plain,
        cleanup: 0,
        choices: [{ kind: 0, bucket: 0, id: 0, v: 0, rank: 0 }],
        outcome: `publish`,
      },
      {
        ...plain,
        shareId: true,
        choices: [
          { kind: 0, bucket: 0, id: 2, v: 0, rank: 0 },
          { kind: 0, bucket: 0, id: 0, v: 0, rank: 0 },
        ],
        outcome: `publish`,
      },
      {
        ...plain,
        cleanup: 1,
        choices: [{ kind: 0, bucket: 0, id: 0, v: 0, rank: 0 }],
        outcome: `throwWrite`,
      },
    ])
  })
})
