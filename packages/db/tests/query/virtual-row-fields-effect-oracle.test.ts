/**
 * # Do Effects deliver the source metadata a query explicitly selects?
 *
 * VirtualRowProps permits selecting source metadata. EffectConfig promises the
 * query's complete deltas through onBatch and once per row through the named
 * handlers; DeltaEvent gives updates the value before the batch. Authority:
 * virtual-props.ts, query/effect.ts public types, and live-queries.md's Effect
 * query-feature and delta sections. Optimistic-history-oracle supplies the
 * source visibility and VirtualOrigin settlement law.
 *
 * The model authors source rows, optimistic snapshots and applied origins. It
 * recomputes ordinary projected fields, then differences two result arrays.
 * The actual Effect callbacks supply two independent ledgers. Each ledger must
 * contain exactly that delta, including previous values and multiplicity.
 * Source metadata is copied into ordinary observed* fields: no output Collection
 * exists, so this oracle assigns no implicit Effect-root metadata or ID.
 *
 * The finite 200 histories cross structured/functional projection, one source,
 * a LEFT join with a matched row and unmatched anchor, and populated unions in
 * both branch orders. Each source has at most one persisting update. Outcomes,
 * queued confirmations and settlement orders vary independently. Later remote
 * writes and a peer's exit/reentry check next use and surviving-row isolation.
 * Removing a dimension loses that receiving path or settlement distinction.
 * Reject-before-update and update-of-absent-key histories are excluded.
 *
 * Sources are eager and preloaded. At each action cut a host turn drains queued
 * delivery, then the whole new prefix of each callback ledger is checked. The
 * recorder copies flat scalar fields when invoked, before another action can
 * replace them. Earlier ledgers are retained. Each cut collects its mismatches
 * without changing the authored next state; the history reports all failures.
 * Batch partition, including empty partitions, is unconstrained here; exact
 * event multiplicity remains observable in both callback channels.
 * A malformed startup delta therefore cannot prevent later comparisons. Reach
 * counts exercised cuts; separate counters report which comparisons passed.
 * A final drain after disposal checks for extra delta events. This bounded schedule
 * does not establish arbitrary provider delays, framework hooks, ordered
 * repairs, changing join keys, same-source overlap or subquery sanitization.
 *
 * Event keys are opaque. Both callback channels must agree; distinct live
 * occurrences need distinct keys, and a live occurrence keeps its key through
 * updates. An exit retires that correspondence. Reentry may use a fresh key.
 * Exact typed source identity is checked through ordinary observedKey instead.
 * The four unclaimed Effect-root virtual names are excluded from the ordinary
 * field projection, not interpreted as an output-row attribution policy.
 */
import { isDeepStrictEqual } from 'node:util'
import { afterAll, expect, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { Query, coalesce, eq } from '../../src/query/index.js'
import { createEffect } from '../../src/query/effect.js'
import { declareOracle } from '../oracle-declaration.js'
import { createOracleReach } from '../oracle-reach.js'
import { flushPromises, mockSyncCollectionOptions } from '../utils.js'
import { expectedSourceMetadata } from './virtual-row-fields-source-oracle.js'
import {
  checkWithCleanup,
  virtualFieldNames,
} from './virtual-row-fields-support.js'
import type { DeltaEvent } from '../../src/query/effect.js'
import type { Transaction } from '../../src/transactions.js'

type Key = string | number
type Side = `left` | `right`
type Origin = `local` | `remote`
type SourceRow = {
  id: Key
  parentId: string
  side: Side
  label: string
}
type SourceState = {
  id: string
  base: Array<SourceRow>
  origins: Map<Key, Origin>
  overlay?: SourceRow
  confirmation?: SourceRow
}
type Projection = `structured` | `functional`
type Kind = `single` | `join` | `union`
type History = {
  kind: Kind
  projection: Projection
  reverse: boolean
  confirm: ReadonlyArray<Side>
  reject: ReadonlyArray<Side>
  rightFirst: boolean
}
type ProjectedRow = Record<string, unknown> & { id: Key; side: Side }
type ModelEvent = {
  type: `enter` | `update` | `exit`
  value: ProjectedRow
  previousValue?: ProjectedRow
}
type RecordedEvent = {
  type: string
  key: Key
  value: unknown
  previousValue?: unknown
}
type NamedEvent = RecordedEvent & { route: ModelEvent[`type`] }
type Ledger = {
  batches: Array<Array<RecordedEvent>>
  named: Array<NamedEvent>
}
type KeyIntervals = Map<string, Key>

function visibleSource(source: SourceState) {
  return source.base.map((base) => {
    const pending = source.overlay?.id === base.id
    const row = pending ? source.overlay! : base
    return {
      ...row,
      ...expectedSourceMetadata(
        row.id,
        source.id,
        pending,
        source.origins.get(row.id) ?? `remote`,
      ),
    }
  })
}
type SourceValue = ReturnType<typeof visibleSource>[number]

// SELECT copies these source facts into ordinary fields. New output objects
// need no root metadata judgment to determine their explicitly selected values.
function projectedSource(row: SourceValue): ProjectedRow {
  return {
    id: row.id,
    side: row.side,
    label: row.label,
    observedKey: row.$key,
    observedCollectionId: row.$collectionId,
    observedOrigin: row.$origin,
    observedPending: row.$hasPendingWrites,
  }
}
function expectedEffectRows(
  kind: Kind,
  left: SourceState,
  right: SourceState,
): Array<ProjectedRow> {
  const a = visibleSource(left)
  const b = visibleSource(right)
  if (kind === `single`) return a.map(projectedSource)
  if (kind === `union`) return [...a, ...b].map(projectedSource)
  return a.map((row) => {
    const joined = b.find((candidate) => candidate.parentId === row.id)
    return {
      ...projectedSource(row),
      rightLabel: joined?.label,
      rightKey: joined?.$key,
      rightCollectionId: joined?.$collectionId,
      rightOrigin: joined?.$origin,
      rightPending: joined?.$hasPendingWrites,
    }
  })
}
function occurrence(value: unknown): string {
  if (!value || typeof value !== `object`) return `invalid:${String(value)}`
  const row = value as Record<string, unknown>
  return `${String(row.side)}:${typeof row.id}:${String(row.id)}`
}
// Independent before/after differencing retains every occurrence. Equality
// distinguishes a missing own field from a field whose value is undefined.
function expectedEffectDelta(
  before: ReadonlyArray<ProjectedRow>,
  after: ReadonlyArray<ProjectedRow>,
): Array<ModelEvent> {
  const delta: Array<ModelEvent> = []
  for (const old of before) {
    if (!after.some((row) => occurrence(row) === occurrence(old)))
      delta.push({ type: `exit`, value: old })
  }
  for (const row of after) {
    const old = before.find((prior) => occurrence(prior) === occurrence(row))
    if (!old) delta.push({ type: `enter`, value: row })
    else if (!isDeepStrictEqual(old, row))
      delta.push({ type: `update`, value: row, previousValue: old })
  }
  return delta
}
function eventOrder(a: { value: unknown }, b: { value: unknown }): number {
  return occurrence(a.value).localeCompare(occurrence(b.value))
}
function eventValue(event: RecordedEvent) {
  const { key: _key, ...selected } = event
  return selected
}
// Named delivery and batch delivery each refine the independent full delta.
// Cross-channel agreement alone would allow both channels to share a defect.
function checkEffectDelta(
  ledger: Ledger,
  expected: ReadonlyArray<ModelEvent>,
  active: KeyIntervals,
): void {
  const batches = ledger.batches.flat()
  const failures: Array<Error> = []
  const judge = (law: string, compare: () => void) => {
    try {
      compare()
    } catch (error) {
      failures.push(new Error(law, { cause: error }))
    }
  }
  judge(`batch delta and previous values`, () => {
    expect(batches.map(eventValue).sort(eventOrder)).toStrictEqual(
      [...expected].sort(eventOrder),
    )
  })
  judge(`named delta, route and previous values`, () => {
    expect(ledger.named.map(eventValue).sort(eventOrder)).toStrictEqual(
      expected
        .map((event) => ({ ...event, route: event.type }))
        .sort(eventOrder),
    )
  })
  judge(`named and batch event keys agree`, () => {
    expect(
      ledger.named.map(({ route: _route, ...event }) => event).sort(eventOrder),
    ).toStrictEqual([...batches].sort(eventOrder))
  })

  // Report an invalid event without adopting it as a live occurrence. Later
  // lawful enters in the same batch can still establish their own intervals.
  for (const event of batches) {
    const id = occurrence(event.value)
    judge(`opaque key interval for ${event.type} ${id}`, () => {
      expect([`string`, `number`]).toContain(typeof event.key)
      if (event.type === `enter`) {
        expect(active.has(id), `enter starts an absent occurrence`).toBe(false)
        expect(
          [...active.values()],
          `live occurrence keys are distinct`,
        ).not.toContain(event.key)
        active.set(id, event.key)
      } else {
        expect(active.has(id), `update/exit names a live occurrence`).toBe(true)
        expect(event.key, `key remains stable within its active interval`).toBe(
          active.get(id),
        )
        if (event.type === `exit`) active.delete(id)
      }
    })
  }
  if (failures.length)
    throw new AggregateError(failures, `Effect delta law failed`, {
      cause: failures[0],
    })
}

// One source has two outcomes and two confirmation states. Two sources have
// four independent outcomes, four confirmation masks and two settlement orders.
// Only unions vary branch order: it has observable source-selection machinery.
const effectMetadataHistories: Array<History> = (
  [`structured`, `functional`] as const
).flatMap((projection) =>
  ([`single`, `join`, `union`] as const).flatMap((kind) =>
    (kind === `union` ? [false, true] : [false]).flatMap((reverse) =>
      (kind === `single`
        ? [[], [`left`]]
        : [[], [`left`], [`right`], [`left`, `right`]]
      ).flatMap((confirm) =>
        (kind === `single`
          ? [[], [`left`]]
          : [[], [`left`], [`right`], [`left`, `right`]]
        ).flatMap((reject) =>
          (kind === `single` ? [false] : [false, true]).map((rightFirst) => ({
            kind,
            projection,
            reverse,
            confirm: confirm as Array<Side>,
            reject: reject as Array<Side>,
            rightFirst,
          })),
        ),
      ),
    ),
  ),
)
function pathOf(history: Pick<History, `kind` | `projection` | `reverse`>) {
  return `${history.kind}${history.kind === `union` ? (history.reverse ? `-right-first` : `-left-first`) : ``}/${history.projection}`
}
function sidesOf(history: History): Array<Side> {
  return history.kind === `single` ? [`left`] : [`left`, `right`]
}
function historyId(history: History): string {
  return `${pathOf(history)}/confirm-${history.confirm.join(`+`) || `none`}/reject-${history.reject.join(`+`) || `none`}/settle-${history.rightFirst ? `right` : `left`}-first`
}
// Declare each finite lane's owed comparisons independently. Aggregate path
// totals would let one omitted right-source action borrow another lane's reach.
// Outcome and confirmation premises determine which cuts are legal in a lane.
function requiredEffectCuts(history: History): Array<string> {
  const sides = sidesOf(history)
  return [
    `initial`,
    ...sides.map((side) => `${side}-pending`),
    ...(sides.length === 2 ? [`two-pending`] : []),
    ...history.confirm.map((side) => `${side}-accepted-held`),
    ...sides.map(
      (side) =>
        `${side}-${history.reject.includes(side) ? `rejected` : `fulfilled`}`,
    ),
    ...(sides.length === 2
      ? [`one-pending-${history.rightFirst ? `left` : `right`}`]
      : []),
    ...sides.map((side) => `${side}-remote-followup`),
    `peer-exit`,
    `peer-reentry`,
    `survivor-next-use`,
    `final-drain`,
  ]
}
const effectMetadataReach = createOracleReach(
  `effect explicit source metadata`,
  effectMetadataHistories.flatMap((history) =>
    [`batch`, `named`].flatMap((channel) =>
      requiredEffectCuts(history).map(
        (cut) => `${historyId(history)}/${channel}/${cut}`,
      ),
    ),
  ),
  // This exhaustive grammar has no seed/path replay. An unrelated replay
  // environment must not exempt its required finite lanes from reach.
  { replaying: false },
)
const effectPassedCuts = new Map<string, number>()
let enteredEffectHistories = 0
afterAll(() => {
  // A checker-only selector enters no production history. Once any native
  // history runs, every finite lane still owes its complete declared reach.
  if (enteredEffectHistories > 0) effectMetadataReach.assertReached()
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
    console.info(
      `effect metadata reach`,
      Object.fromEntries(effectMetadataReach.counts()),
      `passed comparisons`,
      Object.fromEntries(effectPassedCuts),
    )
})
declareOracle({
  model: [visibleSource, expectedEffectRows, expectedEffectDelta],
  check: [checkEffectDelta],
  grammar: [effectMetadataHistories],
})

function gate() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  void promise.catch(() => {})
  return { promise, resolve, reject, calls: 0 }
}
function createSource(state: SourceState, hold: ReturnType<typeof gate>) {
  return createCollection({
    ...mockSyncCollectionOptions<SourceRow>({
      id: state.id,
      getKey: (row) => row.id,
      initialData: state.base.map((row) => ({ ...row })),
    }),
    onUpdate: async () => {
      hold.calls++
      return hold.promise
    },
  })
}
type Source = ReturnType<typeof createSource>
function captureSelected(value: unknown): unknown {
  if (!value || typeof value !== `object`) return value
  return Object.fromEntries(
    Object.entries(value).filter(
      ([name]) => !virtualFieldNames.some((field) => field === name),
    ),
  )
}
function captureEvent(event: DeltaEvent): RecordedEvent {
  return {
    type: event.type,
    key: event.key,
    value: captureSelected(event.value),
    ...(`previousValue` in event
      ? { previousValue: captureSelected(event.previousValue) }
      : {}),
  }
}
// Driver projection: runtime source objects, not model source snapshots.
function selectSource(row: SourceValue) {
  return {
    id: row.id,
    side: row.side,
    label: row.label,
    observedKey: row.$key,
    observedCollectionId: row.$collectionId,
    observedOrigin: row.$origin,
    observedPending: row.$hasPendingWrites,
  }
}
function startEffect(
  history: History,
  left: Source,
  right: Source,
  ledger: Ledger,
  errors: Array<unknown>,
) {
  return createEffect({
    query: () => {
      if (history.kind === `union`) {
        const query = new Query().unionAll(
          history.reverse ? { b: right, a: left } : { a: left, b: right },
        )
        return history.projection === `functional`
          ? query.fn.select(({ a, b }) => {
              const row = a ?? b
              if (!row) throw new Error(`union has no active source`)
              return selectSource(row)
            })
          : query.select(({ a, b }) => ({
              id: coalesce(a.id, b.id),
              side: coalesce(a.side, b.side),
              label: coalesce(a.label, b.label),
              observedKey: coalesce(a.$key, b.$key),
              observedCollectionId: coalesce(a.$collectionId, b.$collectionId),
              observedOrigin: coalesce(a.$origin, b.$origin),
              observedPending: coalesce(
                a.$hasPendingWrites,
                b.$hasPendingWrites,
              ),
            }))
      }
      const base = new Query().from({ a: left })
      if (history.kind === `join`) {
        const query = base.leftJoin({ b: right }, ({ a, b }) =>
          eq(a.id, b.parentId),
        )
        return history.projection === `functional`
          ? query.fn.select(({ a, b }) => ({
              ...selectSource(a),
              rightLabel: b?.label,
              rightKey: b?.$key,
              rightCollectionId: b?.$collectionId,
              rightOrigin: b?.$origin,
              rightPending: b?.$hasPendingWrites,
            }))
          : query.select(({ a, b }) => ({
              id: a.id,
              side: a.side,
              label: a.label,
              observedKey: a.$key,
              observedCollectionId: a.$collectionId,
              observedOrigin: a.$origin,
              observedPending: a.$hasPendingWrites,
              rightLabel: b.label,
              rightKey: b.$key,
              rightCollectionId: b.$collectionId,
              rightOrigin: b.$origin,
              rightPending: b.$hasPendingWrites,
            }))
      }
      return history.projection === `functional`
        ? base.fn.select(({ a }) => selectSource(a))
        : base.select(({ a }) => ({
            id: a.id,
            side: a.side,
            label: a.label,
            observedKey: a.$key,
            observedCollectionId: a.$collectionId,
            observedOrigin: a.$origin,
            observedPending: a.$hasPendingWrites,
          }))
    },
    onBatch: (events) => {
      ledger.batches.push(events.map(captureEvent))
    },
    onEnter: (event) => {
      ledger.named.push({ route: `enter`, ...captureEvent(event) })
    },
    onUpdate: (event) => {
      ledger.named.push({ route: `update`, ...captureEvent(event) })
    },
    onExit: (event) => {
      ledger.named.push({ route: `exit`, ...captureEvent(event) })
    },
    onError: (error) => errors.push(error),
    onSourceError: (error) => errors.push(error),
  })
}

test.each(effectMetadataHistories)(
  `delivers explicitly selected source metadata through Effects: %j`,
  async (history) => {
    enteredEffectHistories++
    effectMetadataReach.beginHistory()
    const path = pathOf(history)
    const id = historyId(history)
    const reach = (cut: string) => {
      effectMetadataReach.reach(`${id}/batch/${cut}`)
      effectMetadataReach.reach(`${id}/named/${cut}`)
    }
    const leftMain: SourceRow = {
      id: history.kind === `union` ? 1 : `a`,
      parentId: `unused`,
      side: `left`,
      label: `left-base`,
    }
    const peer: SourceRow = {
      id: `anchor`,
      parentId: `unused`,
      side: `left`,
      label: `peer`,
    }
    const rightMain: SourceRow = {
      id: history.kind === `union` ? `1` : `r`,
      parentId: `a`,
      side: `right`,
      label: `right-base`,
    }
    const states: Record<Side, SourceState> = {
      left: {
        id: `effect-left`,
        base: [{ ...leftMain }, { ...peer }],
        origins: new Map(),
      },
      right: {
        id: `effect-right`,
        base: [{ ...rightMain }],
        origins: new Map(),
      },
    }
    const holds = { left: gate(), right: gate() }
    let left: Source | undefined
    let right: Source | undefined
    let effect: ReturnType<typeof createEffect> | undefined
    const settlements: Partial<Record<Side, Promise<unknown>>> = {}
    const transactions = new Map<Side, Transaction>()
    const failures = {
      left: new Error(`left rejection`),
      right: new Error(`right rejection`),
    }
    const ledger: Ledger = { batches: [], named: [] }
    const errors: Array<unknown> = []
    const mismatches: Array<Error> = []
    const active: KeyIntervals = new Map()
    let checkedBatches = 0
    let checkedNamed = 0
    let previous: Array<ProjectedRow> = []
    const modelRows = () =>
      expectedEffectRows(history.kind, states.left, states.right)
    const cut = async (name: string, premise?: () => void) => {
      await flushPromises()
      const next = modelRows()
      let premiseReached = true
      try {
        premise?.()
      } catch (error) {
        premiseReached = false
        mismatches.push(
          new Error(`Effect metadata premise ${name}`, { cause: error }),
        )
      }
      try {
        checkEffectDelta(
          {
            batches: ledger.batches.slice(checkedBatches),
            named: ledger.named.slice(checkedNamed),
          },
          expectedEffectDelta(previous, next),
          active,
        )
        expect(errors).toStrictEqual([])
        const key = `${path}/${name}`
        effectPassedCuts.set(key, (effectPassedCuts.get(key) ?? 0) + 1)
      } catch (error) {
        mismatches.push(
          new Error(`Effect metadata cut ${name}`, { cause: error }),
        )
      }
      checkedBatches = ledger.batches.length
      checkedNamed = ledger.named.length
      previous = next
      if (premiseReached) reach(name)
    }
    const write = (
      side: Side,
      type: `insert` | `update` | `delete`,
      row: SourceRow,
    ) => {
      const source = side === `left` ? left! : right!
      source.utils.begin()
      source.utils.write({ type, value: { ...row } })
      return source.utils.commit()
    }
    const requirePersisting = (side: Side) => {
      expect(holds[side].calls, `${side} handler entered once`).toBe(1)
      expect(
        transactions.get(side)?.state,
        `${side} transaction persists`,
      ).toBe(`persisting`)
    }
    const drive = async () => {
      left = createSource(states.left, holds.left)
      right = createSource(states.right, holds.right)
      await Promise.all([left.preload(), right.preload()])
      effect = startEffect(history, left, right, ledger, errors)
      await cut(`initial`)
      const sides = sidesOf(history)
      for (const side of sides) {
        const source = side === `left` ? left : right
        const row = states[side].base[0]!
        states[side].overlay = { ...row, label: `${side}-pending` }
        const transaction = source.update(row.id, (draft) => {
          draft.label = `${side}-pending`
        })
        transactions.set(side, transaction)
        settlements[side] = transaction.when(`settled`).then(
          () => undefined,
          (error: unknown) => error,
        )
        await cut(`${side}-pending`, () => requirePersisting(side))
      }
      if (sides.length === 2)
        await cut(`two-pending`, () => {
          requirePersisting(`left`)
          requirePersisting(`right`)
        })
      for (const side of history.confirm) {
        const row = { ...states[side].base[0]!, label: `${side}-server` }
        states[side].confirmation = row
        // Commit accepts this row; the persisting overlay still owns visibility.
        write(side, `update`, row)
        await cut(`${side}-accepted-held`, () => requirePersisting(side))
      }
      const order: Array<Side> =
        history.kind === `single`
          ? [`left`]
          : history.rightFirst
            ? [`right`, `left`]
            : [`left`, `right`]
      for (const [index, side] of order.entries()) {
        const state = states[side]
        const reject = history.reject.includes(side)
        state.overlay = undefined
        if (state.confirmation) {
          const confirmation = state.confirmation
          state.base = state.base.map((row) =>
            row.id === confirmation.id ? { ...confirmation } : row,
          )
          state.origins.set(confirmation.id, reject ? `remote` : `local`)
          state.confirmation = undefined
        }
        if (reject) holds[side].reject(failures[side])
        else holds[side].resolve()
        expect(await settlements[side]).toBe(
          reject ? failures[side] : undefined,
        )
        await cut(`${side}-${reject ? `rejected` : `fulfilled`}`, () => {
          expect(holds[side].calls, `${side} handler entered once`).toBe(1)
          expect(
            transactions.get(side)?.state,
            `${side} transaction settled`,
          ).toBe(reject ? `failed` : `completed`)
        })
        if (sides.length === 2 && index === 0) {
          const stillPending = order[1]!
          await cut(`one-pending-${stillPending}`, () => {
            requirePersisting(stillPending)
            expect(transactions.get(side)?.state).toBe(
              reject ? `failed` : `completed`,
            )
          })
        }
      }
      for (const side of sides) {
        const state = states[side]
        const row = { ...state.base[0]!, label: `${side}-later` }
        state.base[0] = row
        state.origins.set(row.id, `remote`)
        write(side, `update`, row)
        await cut(`${side}-remote-followup`)
      }
      states.left.base = states.left.base.filter((row) => row.id !== peer.id)
      write(`left`, `delete`, peer)
      await cut(`peer-exit`)
      states.left.base.push({ ...peer })
      write(`left`, `insert`, peer)
      await cut(`peer-reentry`)
      const survivor = { ...states.left.base[0]!, label: `survivor-next-use` }
      states.left.base[0] = survivor
      write(`left`, `update`, survivor)
      await cut(`survivor-next-use`)
      await effect.dispose()
      await cut(`final-drain`)
    }
    await checkWithCleanup(async () => {
      try {
        await drive()
      } catch (error) {
        mismatches.push(
          new Error(`Effect metadata driver ${id}`, { cause: error }),
        )
      }
      if (mismatches.length)
        throw new AggregateError(mismatches, `Effect metadata history failed`, {
          cause: mismatches[0],
        })
    }, [
      async () => {
        holds.left.resolve()
        holds.right.resolve()
        await Promise.all(Object.values(settlements))
      },
      async () => {
        await effect?.dispose()
      },
      async () => {
        await right?.cleanup()
      },
      async () => {
        await left?.cleanup()
      },
    ])
  },
)

// The same delta judgment must reject wrong callback histories even when their
// final row is right. Controls seed active key intervals through initial enter
// delivery, so failures reach the update comparison rather than setup.
const effectFaults = [
  `omitted-peer`,
  `duplicate-message`,
  `duplicate-batch`,
  `stale-pending`,
  `wrong-source`,
  `new-previous-value`,
  `extra-undefined`,
  `wrong-route`,
  `missing-named`,
  `delayed-extra`,
  `key-collision`,
  `key-change`,
] as const
declareOracle({ grammar: [effectFaults] })
test.each(effectFaults)(
  `rejects a hostile Effect metadata ledger: %s`,
  (fault) => {
    const row = (id: Key, pending: boolean): ProjectedRow => ({
      id,
      side: `left`,
      label: pending ? `pending` : `base`,
      observedKey: id,
      observedCollectionId: `source`,
      observedOrigin: pending ? `local` : `remote`,
      observedPending: pending,
    })
    const before = [row(1, false), row(`1`, false)]
    const after = [row(1, true), row(`1`, true)]
    const events = (expected: Array<ModelEvent>, prefix: string): Ledger => {
      const batch = expected.map((event) => ({
        ...structuredClone(event),
        key: `${prefix}/${occurrence(event.value)}`,
      }))
      return {
        batches: [batch],
        named: batch.map((event) => ({
          ...structuredClone(event),
          route: event.type,
        })),
      }
    }
    const active: KeyIntervals = new Map()
    checkEffectDelta(
      events(expectedEffectDelta([], before), `opaque`),
      expectedEffectDelta([], before),
      active,
    )
    const expected = expectedEffectDelta(before, after)
    const allowed = events(expected, `opaque`)
    checkEffectDelta(structuredClone(allowed), expected, new Map(active))
    const hostile = structuredClone(allowed)
    const first = hostile.batches[0]![0]!
    const second = hostile.batches[0]![1]!
    if (fault === `omitted-peer`) hostile.batches[0]!.pop()
    if (fault === `duplicate-message`)
      hostile.batches[0]!.push(structuredClone(first))
    if (fault === `duplicate-batch`)
      hostile.batches.push(structuredClone(hostile.batches[0]!))
    if (fault === `stale-pending`)
      (first.value as Record<string, unknown>).observedPending = false
    if (fault === `wrong-source`)
      (first.value as Record<string, unknown>).observedCollectionId =
        `other-source`
    if (fault === `new-previous-value`)
      first.previousValue = structuredClone(first.value)
    if (fault === `extra-undefined`)
      (first.value as Record<string, unknown>).extra = undefined
    if (fault === `wrong-route`) hostile.named[0]!.route = `enter`
    if (fault === `missing-named`) hostile.named.pop()
    if (fault === `delayed-extra`)
      hostile.batches.push([structuredClone(first)])
    if (fault === `key-collision`) second.key = first.key
    if (fault === `key-change`) first.key = `different-opaque-key`
    expect(() => checkEffectDelta(hostile, expected, new Map(active))).toThrow()
  },
)

// Allowed controls preserve implementation freedom: row order and opaque key
// representation do not define metadata, and an exited interval owns no key.
function calibrationRows(pending: boolean): Array<ProjectedRow> {
  const base: Array<SourceRow> = [
    { id: 1, side: `left`, parentId: `unused`, label: `base` },
    { id: `1`, side: `left`, parentId: `unused`, label: `peer` },
  ]
  return expectedEffectRows(
    `single`,
    {
      id: `source`,
      base,
      origins: new Map(),
      ...(pending ? { overlay: { ...base[0]!, label: `pending` } } : {}),
    },
    { id: `unused`, base: [], origins: new Map() },
  )
}
function calibrationLedger(
  delta: ReadonlyArray<ModelEvent>,
  keyFor: (value: ProjectedRow) => Key,
): Ledger {
  const batch = delta.map((event) => ({
    ...structuredClone(event),
    key: keyFor(event.value),
  }))
  return {
    batches: batch.length ? [batch.reverse()] : [],
    named: batch.map((event) => ({
      ...structuredClone(event),
      route: event.type,
    })),
  }
}
test(`permits reordered delivery and fresh opaque keys after an exit`, () => {
  const before = calibrationRows(false)
  const after = calibrationRows(true)
  const active: KeyIntervals = new Map()
  const oldKey = (row: ProjectedRow) => `arbitrary/${occurrence(row)}`
  const initial = expectedEffectDelta([], before)
  checkEffectDelta(calibrationLedger(initial, oldKey), initial, active)
  const update = expectedEffectDelta(before, after)
  checkEffectDelta(calibrationLedger(update, oldKey), update, active)
  const remaining = [after[0]!]
  const exit = expectedEffectDelta(after, remaining)
  checkEffectDelta(calibrationLedger(exit, oldKey), exit, active)
  const reentry = expectedEffectDelta(remaining, after)
  checkEffectDelta(
    calibrationLedger(reentry, (row) => `fresh/${occurrence(row)}`),
    reentry,
    active,
  )
  const next = [before[0]!, after[1]!]
  const survivor = expectedEffectDelta(after, next)
  checkEffectDelta(calibrationLedger(survivor, oldKey), survivor, active)
})
test(`permits empty callback partitions while preserving exact delta events`, () => {
  const before = calibrationRows(false)
  const after = calibrationRows(true)
  const active: KeyIntervals = new Map()
  const keyFor = (row: ProjectedRow) => occurrence(row)
  for (const delta of [
    expectedEffectDelta([], before),
    expectedEffectDelta(before, after),
    expectedEffectDelta(after, after),
  ]) {
    const ledger = calibrationLedger(delta, keyFor)
    ledger.batches.unshift([])
    ledger.batches.push([])
    checkEffectDelta(ledger, delta, active)
  }
})
test(`records scalar callback values before later object mutation`, () => {
  const before = calibrationRows(false)
  const after = calibrationRows(true)
  const keyFor = (row: ProjectedRow) => occurrence(row)
  const active: KeyIntervals = new Map()
  const initial = expectedEffectDelta([], before)
  checkEffectDelta(calibrationLedger(initial, keyFor), initial, active)
  const expected = expectedEffectDelta(before, after)
  const row = structuredClone(expected[0]!.value)
  const previousValue = structuredClone(expected[0]!.previousValue!)
  const event: DeltaEvent = {
    type: `update`,
    key: keyFor(row),
    value: row,
    previousValue,
  }
  const ledger: Ledger = {
    batches: [[captureEvent(event)]],
    named: [{ route: `update`, ...captureEvent(event) }],
  }
  row.observedPending = false
  previousValue.label = `mutated after delivery`
  checkEffectDelta(ledger, expected, active)
})
test(`preserves later interval judgments after an invalid unknown update`, () => {
  const before = calibrationRows(false)
  const after = calibrationRows(true)
  const keyFor = (row: ProjectedRow) => occurrence(row)
  const active: KeyIntervals = new Map()
  const initial = expectedEffectDelta([], before)
  const ledger = calibrationLedger(initial, keyFor)
  const invalid = {
    type: `update`,
    key: `never-entered`,
    value: structuredClone(before[0]!),
    previousValue: structuredClone(before[0]!),
  }
  ledger.batches[0]!.unshift(invalid)
  ledger.named.unshift({ ...structuredClone(invalid), route: `update` })
  expect(() => checkEffectDelta(ledger, initial, active)).toThrow()
  const update = expectedEffectDelta(before, after)
  checkEffectDelta(calibrationLedger(update, keyFor), update, active)
})
