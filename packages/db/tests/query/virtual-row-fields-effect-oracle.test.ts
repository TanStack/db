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
 *
 * The callback-profile companion below also checks equal-projection graph
 * updates under the maintainer's preservation decision. The original metadata
 * histories change selected source facts and retain their array-difference
 * judgment; they do not specify every unordered graph notification.
 */
import { afterAll, expect } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { Query, coalesce, eq } from '../../src/query/index.js'
import { createEffect } from '../../src/query/effect.js'
import { createTransaction } from '../../src/transactions.js'
import { flushPromises, mockSyncCollectionOptions } from '../utils.js'
import { oracleProperty } from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import { checkWithCleanup } from './virtual-row-fields-support.js'
import {
  callbackHistories,
  callbackReach,
  runCallbackHistory,
} from './effect-callback-oracle.js'
import {
  captureEvent,
  captureSelected,
  checkEffectDelta,
  expectedEffectDelta,
  expectedEffectRows,
} from './virtual-row-fields-effect-model-oracle.js'
import type {
  History,
  KeyIntervals,
  Ledger,
  ProjectedRow,
  RecordedEvent,
  Side,
  SourceRow,
  SourceState,
  SourceValue,
} from './virtual-row-fields-effect-model-oracle.js'
import type { DeltaEvent, EffectConfig } from '../../src/query/effect.js'
import type { Transaction } from '../../src/transactions.js'
import type { CallbackOutput, CallbackRow } from './effect-callback-oracle.js'

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

// Handler profiles and readable opaque values share their model/comparison
// with the real React receiver. This driver supplies only the core boundary.
const deliveryReach = callbackReach(`core`)
let ranDelivery = false
afterAll(() => {
  if (ranDelivery) deliveryReach.assertReached()
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
    console.info(
      `Effect core callback reach`,
      Object.fromEntries(deliveryReach.counts()),
    )
})
// The former case body, unchanged.
async function judgeCallbackDelivery(
  history: (typeof callbackHistories)[number],
): Promise<void> {
  ranDelivery = true
  await runCallbackHistory(
    history,
    {
      mount: async ({ skipInitial, ordered, project, handlers }) => {
        const source = createCollection(
          mockSyncCollectionOptions<CallbackRow>({
            id: `callback-core`,
            getKey: (row) => row.id,
            initialData: [{ id: 1, version: 0 }],
          }),
        )
        await source.preload()
        const config: EffectConfig<CallbackOutput> = {
          query: () => {
            const rows = new Query().from({ row: source })
            return (
              ordered ? rows.orderBy(({ row }) => row.id).limit(10) : rows
            ).fn.select(({ row }) => project(row))
          },
          skipInitial,
          ...handlers,
        }
        const effect = createEffect(config)
        await flushPromises()
        return {
          write: async (type, version) => {
            source.utils.begin()
            source.utils.write({ type, value: { id: 1, version } })
            source.utils.commit()
            await flushPromises()
          },
          replaceHandlers: async (replacement) => {
            Object.assign(config, replacement)
            await flushPromises()
          },
          dispose: () => effect.dispose(),
          cleanup: () =>
            checkWithCleanup(async () => {
              await effect.dispose()
            }, [
              async () => {
                await source.cleanup()
              },
            ]),
        }
      },
    },
    deliveryReach,
  )
}

const callbackDeliveryLaw = `Effect callbacks deliver current values across handler profiles at the core boundary.`

oracleProperty({
  id: `virtual-row-fields-effect.callback-delivery`,
  law: {
    statement: callbackDeliveryLaw,
    authority: `The Collection virtual-field boundary and boundary-only metadata decision (2026-11-05) in packages/db/src/query/live/ARCHITECTURE.md, and the Effect publication rules, stated at the start of this owner.`,
    limits: `The enumerated callback representation and handler-profile histories at the core Effect boundary.`,
  },
  owns: [
    `src/collection/index.ts#createCollection`,
    `src/query/effect.ts#createEffect`,
    `src/transactions.ts#createTransaction`,
  ],
  histories: callbackHistories,
  label: (history) =>
    `delivers current values across callback profiles: ${JSON.stringify(history)}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(callbackDeliveryLaw, plan, observe, () =>
      judgeCallbackDelivery(plan.history),
    ),
  check: forwardAssertionJudgment,
})
function pathOf(history: Pick<History, `kind` | `projection` | `reverse`>) {
  return `${history.kind}${history.kind === `union` ? (history.reverse ? `-right-first` : `-left-first`) : ``}/${history.projection}`
}
function sidesOf(history: History): Array<Side> {
  return history.kind === `single` ? [`left`] : [`left`, `right`]
}
function historyId(history: History): string {
  return `${pathOf(history)}/confirm-${history.confirm.join(`+`) || `none`}/reject-${history.reject.join(`+`) || `none`}/settle-${history.rightFirst ? `right` : `left`}-first`
}
// Declare each finite campaign's owed comparisons independently. Aggregate path
// totals would let one omitted right-source action borrow another campaign's reach.
// Outcome and confirmation premises determine which cuts are legal in a campaign.
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
// Each finite history has one numeric token. A state keeps that token once,
// so repeated observations preserve the original per-history checkpoint count.
const effectMetadataHistoriesByState = new Map<string, Set<number>>(
  effectMetadataHistories
    .flatMap((history) =>
      [`batch`, `named`].flatMap((channel) =>
        requiredEffectCuts(history).map(
          (cut) => `${historyId(history)}/${channel}/${cut}`,
        ),
      ),
    )
    .map((state) => [state, new Set<number>()]),
)
let effectMetadataHistory = 0
const effectPassedCuts = new Map<string, number>()
let enteredEffectHistories = 0
afterAll(() => {
  // A checker-only selector enters no production history. Once any native
  // history runs, every finite campaign still owes its complete declared reach.
  if (enteredEffectHistories > 0)
    expect(
      [...effectMetadataHistoriesByState].filter(
        ([, histories]) => histories.size < 1,
      ),
      `effect explicit source metadata`,
    ).toEqual([])
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
    console.info(
      `effect metadata reach`,
      Object.fromEntries(
        [...effectMetadataHistoriesByState].map(([state, histories]) => [
          state,
          histories.size,
        ]),
      ),
      `passed comparisons`,
      Object.fromEntries(effectPassedCuts),
    )
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

// The former case body, unchanged.
async function judgeEffectMetadataHistory(history: History): Promise<void> {
  enteredEffectHistories++
  effectMetadataHistory++
  const path = pathOf(history)
  const id = historyId(history)
  const reach = (cut: string) => {
    effectMetadataHistoriesByState
      .get(`${id}/batch/${cut}`)!
      .add(effectMetadataHistory)
    effectMetadataHistoriesByState
      .get(`${id}/named/${cut}`)!
      .add(effectMetadataHistory)
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
    expect(transactions.get(side)?.state, `${side} transaction persists`).toBe(
      `persisting`,
    )
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
      expect(await settlements[side]).toBe(reject ? failures[side] : undefined)
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
}

const explicitMetadataLaw = `Effects deliver explicitly selected source metadata, matching the visible source rows, at every batch and named callback cut.`

oracleProperty({
  id: `virtual-row-fields-effect.explicit-metadata`,
  law: {
    statement: explicitMetadataLaw,
    authority: `The Collection virtual-field boundary and boundary-only metadata decision (2026-11-05) in packages/db/src/query/live/ARCHITECTURE.md, and the Effect publication rules, stated at the start of this owner.`,
    limits: `The enumerated single, join, and union metadata histories over controlled sources and optimistic transactions.`,
  },
  owns: [
    `src/collection/index.ts#createCollection`,
    `src/query/effect.ts#createEffect`,
    `src/transactions.ts#createTransaction`,
  ],
  histories: effectMetadataHistories,
  label: (history) =>
    `delivers explicitly selected source metadata through Effects: ${JSON.stringify(history)}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(explicitMetadataLaw, plan, observe, () =>
      judgeEffectMetadataHistory(plan.history),
    ),
  check: forwardAssertionJudgment,
})

// The hostile-ledger and allowed-ledger checker calibrations of
// checkEffectDelta are ordinary tests in virtual-row-fields-effect.test.ts.

/**
 * Membership is independent of the selected value's comparison domain. A fresh
 * callable or opaque instance may compare unequal when the graph retracts a
 * transient join contribution, but an absent occurrence still cannot update.
 * These histories also coalesce legal source transactions inside a real
 * optimistic-transaction scheduler scope. Their before/after source snapshots
 * determine membership independently of output multiplicities.
 *
 * The rich-value observation records its kind and callable/readable result.
 * It does not claim exact instance identity for a re-evaluated projection.
 * Nondeterministic projections are not needed to expose this membership law.
 */
type BoundaryRepresentation = `scalar` | `function` | `private`
class BoundaryValue {
  #label: string
  constructor(label: string) {
    this.#label = label
  }
  read() {
    return this.#label
  }
}
const boundaryHistories = ([`scalar`, `function`, `private`] as const).flatMap(
  (representation) =>
    ([`single`, `join`] as const).flatMap((kind) =>
      [false, true].flatMap((present) =>
        [false, true].map((grouped) => ({
          representation,
          kind,
          present,
          grouped,
        })),
      ),
    ),
)
function boundaryId(history: (typeof boundaryHistories)[number]) {
  return `${history.representation}/${history.kind}/${history.present}/${history.grouped}`
}
const boundaryCuts = [`initial`, `sequence`, `absent`, `reentry`, `next-use`]
const boundaryHistoriesByState = new Map<string, Set<number>>(
  boundaryHistories
    .flatMap((history) =>
      boundaryCuts.map((cut) => `${boundaryId(history)}/${cut}`),
    )
    .map((state) => [state, new Set<number>()]),
)
let boundaryHistory = 0
let enteredBoundary = false
afterAll(() => {
  if (enteredBoundary)
    expect(
      [...boundaryHistoriesByState].filter(
        ([, histories]) => histories.size < 1,
      ),
      `Effect membership independent of projection equality`,
    ).toEqual([])
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
    console.info(
      `Effect membership reach`,
      Object.fromEntries(
        [...boundaryHistoriesByState].map(([state, histories]) => [
          state,
          histories.size,
        ]),
      ),
    )
})
function boundaryModelRows(
  kind: `single` | `join`,
  representation: BoundaryRepresentation,
  left: SourceState,
  right: SourceState,
): Array<ProjectedRow> {
  return expectedEffectRows(kind, left, right).map((row) => ({
    ...row,
    payloadKind: representation,
    payload: row.label,
  }))
}
function captureBoundaryEvent(event: DeltaEvent): RecordedEvent {
  const capture = (value: unknown) => {
    const row = captureSelected(value) as Record<string, unknown>
    const payload = row.payload
    return {
      ...row,
      payloadKind:
        typeof payload === `function`
          ? `function`
          : payload instanceof BoundaryValue
            ? `private`
            : `scalar`,
      payload:
        typeof payload === `function`
          ? payload()
          : payload instanceof BoundaryValue
            ? payload.read()
            : payload,
    }
  }
  return {
    type: event.type,
    key: event.key,
    value: capture(event.value),
    ...(`previousValue` in event
      ? { previousValue: capture(event.previousValue) }
      : {}),
  }
}
// The former case body, unchanged.
async function judgeBoundaryMembership(
  history: (typeof boundaryHistories)[number],
): Promise<void> {
  enteredBoundary = true
  boundaryHistory++
  const main: SourceRow = {
    id: `a`,
    parentId: `unused`,
    side: `left`,
    label: `v0`,
  }
  const anchor: SourceRow = {
    id: `anchor`,
    parentId: `unused`,
    side: `left`,
    label: `anchor`,
  }
  const joined: SourceRow = {
    id: `r`,
    parentId: `a`,
    side: `right`,
    label: `right`,
  }
  const state: SourceState = {
    id: `boundary-left`,
    base: history.present ? [main, anchor] : [anchor],
    origins: new Map(),
  }
  const rightState: SourceState = {
    id: `boundary-right`,
    base: [joined],
    origins: new Map(),
  }
  const left = createSource(state, gate())
  const right = createSource(rightState, gate())
  const ledger: Ledger = { batches: [], named: [] }
  const active: KeyIntervals = new Map()
  const failures: Array<unknown> = []
  const callbackErrors: Array<unknown> = []
  let effect: ReturnType<typeof createEffect> | undefined
  let before: Array<ProjectedRow> = []
  let checkedBatch = 0
  let checkedNamed = 0
  const cut = async (name?: string) => {
    await flushPromises()
    const after = boundaryModelRows(
      history.kind,
      history.representation,
      state,
      rightState,
    )
    try {
      checkEffectDelta(
        {
          batches: ledger.batches.slice(checkedBatch),
          named: ledger.named.slice(checkedNamed),
        },
        expectedEffectDelta(before, after),
        active,
      )
      expect(callbackErrors).toStrictEqual([])
    } catch (error) {
      failures.push(
        new Error(`membership cut ${name ?? `individual action`}`, {
          cause: error,
        }),
      )
    }
    before = after
    checkedBatch = ledger.batches.length
    checkedNamed = ledger.named.length
    if (name)
      boundaryHistoriesByState
        .get(`${boundaryId(history)}/${name}`)!
        .add(boundaryHistory)
  }
  // The model applies the authored source operation directly. Production
  // receives the same operation through public sync writes and scheduling.
  const apply = (type: `insert` | `delete` | `update`, label: string) => {
    const row = { ...main, label }
    state.base =
      type === `delete`
        ? state.base.filter((value) => value.id !== main.id)
        : type === `insert`
          ? [...state.base, row]
          : state.base.map((value) => (value.id === main.id ? row : value))
    left.utils.begin()
    left.utils.write({ type, value: row })
    left.utils.commit()
  }
  await checkWithCleanup(async () => {
    await Promise.all([left.preload(), right.preload()])
    effect = createEffect({
      query: () => {
        const base = new Query().from({ a: left })
        const project = (a: SourceValue, b?: SourceValue) => {
          const label = a.label
          const payload =
            history.representation === `function`
              ? () => label
              : history.representation === `private`
                ? new BoundaryValue(label)
                : label
          return {
            ...selectSource(a),
            ...(history.kind === `join`
              ? {
                  rightLabel: b?.label,
                  rightKey: b?.$key,
                  rightCollectionId: b?.$collectionId,
                  rightOrigin: b?.$origin,
                  rightPending: b?.$hasPendingWrites,
                }
              : {}),
            payload,
          }
        }
        return history.kind === `join`
          ? base
              .leftJoin({ b: right }, ({ a, b }) => eq(a.id, b.parentId))
              .fn.select(({ a, b }) => project(a, b))
          : base.fn.select(({ a }) => project(a))
      },
      onBatch: (events) => {
        ledger.batches.push(events.map(captureBoundaryEvent))
      },
      onEnter: (event) => {
        ledger.named.push({ route: `enter`, ...captureBoundaryEvent(event) })
      },
      onUpdate: (event) => {
        ledger.named.push({ route: `update`, ...captureBoundaryEvent(event) })
      },
      onExit: (event) => {
        ledger.named.push({ route: `exit`, ...captureBoundaryEvent(event) })
      },
      onError: (error) => callbackErrors.push(error),
      onSourceError: (error) => callbackErrors.push(error),
    })
    await cut(`initial`)
    const commands: Array<readonly [`insert` | `delete`, string]> =
      history.present
        ? [
            [`delete`, `v0`],
            [`insert`, `v1`],
            [`delete`, `v1`],
          ]
        : [
            [`insert`, `v0`],
            [`delete`, `v0`],
            [`insert`, `v1`],
          ]
    if (history.grouped) {
      createTransaction({ mutationFn: async () => {} }).mutate(() => {
        for (const [type, label] of commands) apply(type, label)
      })
    } else {
      for (const [type, label] of commands) {
        apply(type, label)
        await cut()
      }
    }
    await cut(`sequence`)
    if (!history.present) apply(`delete`, `v1`)
    await cut(`absent`)
    apply(`insert`, `v2`)
    await cut(`reentry`)
    apply(`update`, `v3`)
    await cut(`next-use`)
    if (failures.length)
      throw new AggregateError(failures, `Effect membership history failed`, {
        cause: failures[0],
      })
  }, [
    async () => {
      await effect?.dispose()
    },
    async () => {
      await right.cleanup()
    },
    async () => {
      await left.cleanup()
    },
  ])
}

const boundaryMembershipLaw = `Effect callback membership follows the source snapshots, independent of the selected value's comparison domain: an absent occurrence cannot update.`

oracleProperty({
  id: `virtual-row-fields-effect.boundary-membership`,
  law: {
    statement: boundaryMembershipLaw,
    authority: `The Collection virtual-field boundary and boundary-only metadata decision (2026-11-05) in packages/db/src/query/live/ARCHITECTURE.md, and the Effect publication rules, stated at the start of this owner.`,
    limits: `The enumerated scalar, callable, and private-value histories; no exact instance identity for a re-evaluated projection.`,
  },
  owns: [
    `src/collection/index.ts#createCollection`,
    `src/query/effect.ts#createEffect`,
    `src/transactions.ts#createTransaction`,
  ],
  histories: boundaryHistories,
  label: (history) =>
    `classifies callback-visible membership across coalesced source histories: ${JSON.stringify(history)}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(boundaryMembershipLaw, plan, observe, () =>
      judgeBoundaryMembership(plan.history),
    ),
  check: forwardAssertionJudgment,
})
