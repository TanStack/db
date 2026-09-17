import { isDeepStrictEqual } from 'node:util'
import { expect } from 'vitest'
import { z } from 'zod'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { createLiveQueryCollection } from '../src/query/index.js'
import type { CollectionConfig, SyncConfig } from '../src/types.js'

export type HistoryRow = { id: number; a: number; b: number; c: number }
type Fields = Partial<Omit<HistoryRow, `id`>>
export type OptimisticStep =
  | { type: `edit`; key: number; fields: Fields; optimistic: boolean }
  | { type: `delete`; key: number; optimistic: boolean }
  | {
      type: `settle`
      slot: number
      success: boolean
      cascade: boolean
      failure?: `rollback` | `reject`
    }
  | {
      type: `sync`
      rows: Array<HistoryRow>
      truncate: boolean
      immediate: boolean
      copies: number
    }

type Intent = {
  key: number
  kind: `insert` | `update` | `delete`
  snapshot: HistoryRow
  optimistic: boolean
  dependency?: number
  state: `active` | `accepted` | `failed`
  settled: number
  retired: boolean
  acknowledged: boolean
  originPending: boolean
}
type ObservedRow = HistoryRow & {
  $origin: `local` | `remote`
  $synced: boolean
}

/** Specification state is an event history, never a copy of production caches.
 * Mutations own whole-row snapshots, never patches over changing synced rows.
 * Accepted snapshots precede active snapshots. An insert supplies row existence;
 * accepted updates dependent on it survive its success, but not its failed birth.
 */
class HistoryModel {
  base = new Map<number, HistoryRow>()
  origins = new Map<number, `local` | `remote`>()
  intents: Array<Intent> = []
  queue: Array<Extract<OptimisticStep, { type: `sync` }>> = []
  clock = 0

  constructor(
    rows: Array<HistoryRow>,
    private insertDefault = 0,
  ) {
    for (const row of rows) {
      this.base.set(row.id, row)
      this.origins.set(row.id, `remote`)
    }
  }

  private retained(intent: Intent) {
    return (
      intent.state === `accepted` &&
      !intent.retired &&
      intent.optimistic &&
      (intent.dependency === undefined ||
        this.intents[intent.dependency]!.state !== `failed` ||
        this.intents[intent.dependency]!.acknowledged)
    )
  }

  visible(): Map<number, ObservedRow> {
    const result = new Map<number, ObservedRow>(
      [...this.base].map(([key, row]) => [
        key,
        { ...row, $origin: this.origins.get(key)!, $synced: true },
      ]),
    )
    const accepted = this.intents
      .filter((intent) => this.retained(intent))
      .sort((a, b) => a.settled - b.settled)
    const active = this.intents.filter(
      (intent) => intent.state === `active` && intent.optimistic,
    )
    const apply = (intent: Intent) => {
      if (intent.kind === `delete`) {
        result.delete(intent.key)
        return
      }
      result.set(intent.key, {
        ...intent.snapshot,
        $origin: `local`,
        $synced: false,
      })
      if (intent.kind === `insert` && !intent.acknowledged) {
        // An accepted dependent snapshot belongs after its creating insert even
        // when transport completion occurs in the opposite order.
        for (const child of accepted) {
          if (child.dependency === this.intents.indexOf(intent)) {
            result.set(intent.key, {
              ...child.snapshot,
              $origin: `local`,
              $synced: false,
            })
          }
        }
      }
    }
    for (const intent of [...accepted, ...active]) apply(intent)
    return result
  }

  author(
    step: Extract<OptimisticStep, { type: `edit` | `delete` }>,
  ): number | undefined {
    const row = this.visible().get(step.key)
    if (step.type === `delete` && !row) return
    if (
      step.type === `edit` &&
      row &&
      Object.entries(step.fields).every(
        ([key, value]) => row[key as keyof Fields] === value,
      )
    )
      return
    const kind = step.type === `delete` ? `delete` : row ? `update` : `insert`
    const snapshot = {
      ...(row ?? { id: step.key, a: 0, b: 0, c: this.insertDefault }),
      ...(step.type === `edit` ? step.fields : {}),
    }
    const dependency = this.intents.reduce(
      (previous, intent, index) =>
        kind === `update` &&
        intent.key === step.key &&
        intent.kind === `insert` &&
        intent.optimistic &&
        intent.state === `active` &&
        !intent.acknowledged
          ? index
          : previous,
      -1,
    )
    this.intents.push({
      key: step.key,
      kind,
      snapshot,
      optimistic: step.optimistic,
      dependency: dependency < 0 ? undefined : dependency,
      state: `active`,
      settled: 0,
      retired: false,
      acknowledged: false,
      originPending: false,
    })
    return this.intents.length - 1
  }

  settle(index: number, success: boolean) {
    const intent = this.intents[index]!
    // A separately submitted update may succeed after the insert has already
    // failed. That later server acceptance is not undone by an earlier failure.
    if (
      success &&
      intent.dependency !== undefined &&
      this.intents[intent.dependency]!.state === `failed`
    )
      intent.dependency = undefined
    intent.state = success ? `accepted` : `failed`
    if (intent.kind === `insert` && intent.acknowledged) intent.retired = true
    intent.settled = ++this.clock
    // A synced insert has already spent its acknowledgement. Completing its
    // transport cannot turn the next unrelated remote write into a local one.
    if (success && !(intent.kind === `insert` && intent.acknowledged))
      intent.originPending = true
    // This grammar submits direct operations immediately. Rollback cascades
    // affect pending (not already persisting) peer transactions, so none of
    // these independently submitted requests is canceled by a sibling failure.
    const beforeDrain = this.visible()
    if (!this.intents.some((entry) => entry.state === `active`)) this.drain()
    return beforeDrain
  }

  sync(step: Extract<OptimisticStep, { type: `sync` }>) {
    this.queue.push(step)
    if (
      step.immediate ||
      step.truncate ||
      !this.intents.some((entry) => entry.state === `active`)
    )
      this.drain()
  }

  private drain() {
    if (!this.queue.length) return
    const localKeys = new Set(
      this.intents
        .filter((intent) => intent.state === `active`)
        .map((intent) => intent.key),
    )
    const replaced = this.queue.some((batch) => batch.truncate)
    const written = new Set(
      this.queue.flatMap((batch) => batch.rows.map((row) => row.id)),
    )
    const retainedKeys = new Set(
      this.intents
        .filter((intent) => this.retained(intent))
        .map((intent) => intent.key),
    )
    for (const batch of this.queue) {
      if (batch.truncate) {
        this.base.clear()
        this.origins.clear()
        // Origin is row-level attribution, not per-mutation acknowledgement.
        // A truncate replacement of a retained optimistic row is remote unless
        // a still-active request also owns that key. Do not invent finer
        // acknowledgement matching between completed same-key requests.
        for (const intent of this.intents)
          if (intent.state === `accepted` && retainedKeys.has(intent.key))
            intent.originPending = false
      }
      for (const row of batch.rows) {
        const local =
          this.intents.some(
            (intent) => intent.key === row.id && intent.originPending,
          ) || localKeys.has(row.id)
        this.base.set(row.id, row)
        this.origins.set(row.id, local ? `local` : `remote`)
        localKeys.delete(row.id)
        for (const intent of this.intents) {
          if (intent.key === row.id) intent.originPending = false
          if (
            intent.key === row.id &&
            intent.kind === `insert` &&
            intent.state === `active`
          )
            intent.acknowledged = true
        }
      }
      // Truncate retains attribution only for rows in its own replacement,
      // not for an unrelated future write after the old source was cleared.
      if (batch.truncate)
        for (const intent of this.intents) intent.originPending = false
    }
    // Ordinary source publication retires completed direct snapshots, including
    // temporary keys. Truncate preserves snapshots omitted from its replacement.
    for (const intent of this.intents)
      if (intent.state === `accepted`) {
        intent.retired ||= !replaced || written.has(intent.key)
        if (retainedKeys.has(intent.key)) intent.originPending = false
      }
    this.queue = []
  }
}

const plain = ({ id, a, b, c }: HistoryRow): HistoryRow => ({ id, a, b, c })
const observed = (
  row: HistoryRow & { $origin: `local` | `remote`; $synced: boolean },
): ObservedRow => ({
  ...Object.fromEntries(
    Object.entries(row).filter(
      ([key]) => key !== `$key` && key !== `$collectionId`,
    ),
  ),
  id: row.id,
  a: row.a,
  b: row.b,
  c: row.c,
  $origin: row.$origin,
  $synced: row.$synced,
})
const sorted = <T extends HistoryRow>(rows: Iterable<T>) =>
  [...rows].sort((a, b) => a.id - b.id)

/** Validate native deltas before their kind/old value are lost to Map.set. */
export function expectHistoryEventSemantics<T>(
  before: ReadonlyMap<unknown, T>,
  changes: ReadonlyArray<{
    key: unknown
    type: string
    value: T
    previousValue?: T
  }>,
  label: string,
): void {
  const rows = new Map(before)
  for (const change of changes) {
    const message = `${label}: event semantics ${change.type} ${String(change.key)}`
    if (change.type === `insert`) {
      expect(rows.has(change.key), `${message}: absent old membership`).toBe(
        false,
      )
      rows.set(change.key, change.value)
    } else {
      expect(rows.has(change.key), `${message}: present old membership`).toBe(
        true,
      )
      const previous = rows.get(change.key)
      if (change.type === `update`) {
        expect(
          change.previousValue,
          `${message}: previous visible row`,
        ).toStrictEqual(previous)
        rows.set(change.key, change.value)
      } else {
        expect(change.type, message).toBe(`delete`)
        expect(change.value, `${message}: removed visible row`).toStrictEqual(
          previous,
        )
        rows.delete(change.key)
      }
    }
  }
}

export type HistoryOutcome<T> =
  | { status: `pending` }
  | { status: `fulfilled`; value: T }
  | { status: `rejected`; reason?: unknown }

export function observeHistoryPromise<T>(promise: Promise<T>) {
  let current: HistoryOutcome<T> = { status: `pending` }
  // Attach both handlers now, not during eventual teardown.
  const settled = promise.then(
    (value) => {
      current = { status: `fulfilled`, value }
    },
    (reason: unknown) => {
      current = { status: `rejected`, reason }
    },
  )
  return { read: () => current, settled }
}

export function expectHistoryOutcome<T>(
  actual: HistoryOutcome<T>,
  expected: HistoryOutcome<T>,
  label: string,
) {
  expect(actual.status, label).toBe(expected.status)
  if (actual.status === `fulfilled` && expected.status === `fulfilled`)
    expect(actual.value, label).toBe(expected.value)
  if (
    actual.status === `rejected` &&
    expected.status === `rejected` &&
    `reason` in expected
  )
    expect(actual.reason, label).toBe(expected.reason)
}

export async function withHistoryCleanup<T>(
  work: () => Promise<T>,
  cleanups: () => Array<() => unknown | Promise<unknown>>,
): Promise<T> {
  let result: T | undefined
  let failed = false
  let primary: unknown
  const errors: Array<unknown> = []
  try {
    result = await work()
  } catch (error) {
    failed = true
    primary = error
  }
  for (const cleanup of cleanups()) {
    try {
      await cleanup()
    } catch (error) {
      errors.push(error)
    }
  }
  if (failed && !errors.length) throw primary
  if (failed)
    throw new AggregateError(
      [primary, ...errors],
      `History and cleanup failed`,
      {
        cause: primary,
      },
    )
  if (errors.length === 1) throw errors[0]
  if (errors.length) throw new AggregateError(errors, `History cleanup failed`)
  return result as T
}

export async function runOptimisticHistory(
  initial: Array<HistoryRow>,
  steps: ReadonlyArray<OptimisticStep>,
  fault?:
    | `wrong-key`
    | `transient-field`
    | `partial-batch`
    | `backwards-cuts`
    | `previous-value`
    | `update-as-insert`
    | `retained-default`,
  options: { insertDefault?: number } = {},
) {
  const model = new HistoryModel(initial, options.insertDefault)
  let sync!: Parameters<SyncConfig<HistoryRow>[`sync`]>[0]
  let starting: ReturnType<typeof createDeferred<void>> | undefined
  const handler = () => starting!.promise
  const config: CollectionConfig<HistoryRow> = {
    getKey: (row) => row.id,
    onInsert: handler,
    onUpdate: handler,
    onDelete: handler,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        actions.begin()
        for (const row of initial)
          actions.write({ type: `insert`, value: { ...row } })
        actions.commit()
        actions.markReady()
      },
    },
  }
  const schemaCollection =
    options.insertDefault === undefined
      ? undefined
      : createCollection({
          ...config,
          schema: z.object({
            id: z.number(),
            a: z.number(),
            b: z.number(),
            c: z.number().default(options.insertDefault),
          }),
        })
  const collection = schemaCollection ?? createCollection<HistoryRow>(config)
  const downstream = createLiveQueryCollection({
    query: (q) => q.from({ row: collection }),
  })
  let sub: ReturnType<typeof collection.subscribeChanges> | undefined
  const operations: Array<{
    tx:
      | ReturnType<typeof collection.update>
      | ReturnType<typeof collection.insert>
    done: ReturnType<typeof createDeferred<void>>
    outcome: ReturnType<typeof observeHistoryPromise<unknown>>
    expected: HistoryOutcome<unknown>
    changes: object
  }> = []
  const receipts: Array<ReturnType<typeof observeHistoryPromise<void>>> = []
  const counts = {
    edits: 0,
    deletes: 0,
    settlements: 0,
    replacements: 0,
    queued: 0,
    dependencies: 0,
    failures: 0,
    snapshotOverrides: 0,
  }
  return withHistoryCleanup(
    async () => {
      await downstream.preload()
      // includeInitialState supplies inserts; the listener's prior state is empty.
      const replica = new Map<number, ObservedRow>()
      let deliveries = 0
      type Publication = {
        before: Map<number, ObservedRow>
        batch: Array<{
          key: unknown
          type: string
          value: ObservedRow
          previousValue?: ObservedRow
        }>
        replica: Array<ObservedRow>
        source: Array<ObservedRow>
      }
      let publications: Array<Publication> = []
      let cuts = [sorted(model.visible().values())]
      let injected = false
      let initialPublication = true
      let settling = false
      sub = collection.subscribeChanges(
        (batch) => {
          deliveries += batch.length
          const captured = batch.map((change) => ({
            ...change,
            value: observed(change.value),
            ...(`previousValue` in change
              ? {
                  previousValue:
                    change.previousValue === undefined
                      ? undefined
                      : observed(change.previousValue),
                }
              : {}),
          }))
          const record = (entries: typeof captured) => {
            const before = new Map(replica)
            for (const change of entries) {
              if (change.type === `delete`) replica.delete(change.key as number)
              else replica.set(change.key as number, change.value)
            }
            publications.push({
              before,
              batch: entries,
              replica: sorted(replica.values()),
              source: sorted([...collection.values()].map(observed)),
            })
          }
          // Faults act on a copy of a real callback, never on production state.
          if (initialPublication) {
            record(captured)
            return
          }
          if (!injected && fault === `wrong-key` && captured.length) {
            injected = true
            record(
              captured.map((change) => ({
                ...change,
                key: String(change.key),
              })),
            )
          } else if (
            !injected &&
            fault === `transient-field` &&
            captured.length
          ) {
            injected = true
            record(
              captured.map((change) => ({
                ...change,
                value: { ...change.value, c: change.value.c + 100 },
              })),
            )
            record(captured)
          } else if (
            !injected &&
            fault === `partial-batch` &&
            captured.length > 1
          ) {
            injected = true
            record(captured.slice(0, 1))
            record(captured)
          } else if (
            !injected &&
            (fault === `previous-value` || fault === `update-as-insert`) &&
            captured.some((change) => change.type === `update`)
          ) {
            injected = true
            record(
              captured.map((change) =>
                change.type !== `update`
                  ? change
                  : fault === `previous-value`
                    ? {
                        ...change,
                        previousValue: { ...change.previousValue!, c: 999999 },
                      }
                    : { ...change, type: `insert` as const },
              ),
            )
          } else record(captured)
        },
        { includeInitialState: true },
      )
      const check = (label: string) => {
        if (
          !injected &&
          fault === `backwards-cuts` &&
          settling &&
          initialFrame &&
          publications.length > 0 &&
          !isDeepStrictEqual(initialFrame.replica, publications.at(-1)!.replica)
        ) {
          // Replay an earlier real complete callback after the later source cut.
          // The healthy runtime may coalesce the intermediate settlement cut.
          publications.push(initialFrame)
          injected = true
        }
        let cutIndex = 0
        for (const publication of publications) {
          expectHistoryEventSemantics(
            publication.before,
            publication.batch,
            label,
          )
          for (const change of publication.batch) {
            expect(typeof change.key, `${label}: native callback key`).toBe(
              `number`,
            )
            expect(change.key, `${label}: callback key/value identity`).toBe(
              change.value.id,
            )
          }
          const next = cuts.findIndex(
            (cut, index) =>
              index >= cutIndex && isDeepStrictEqual(cut, publication.replica),
          )
          expect(
            next,
            `${label}: whole forward publication ${JSON.stringify(publication.replica)}; allowed ${JSON.stringify(cuts)}`,
          ).toBeGreaterThanOrEqual(0)
          expect(
            publication.source,
            `${label}: callback-time complete source`,
          ).toStrictEqual(cuts[next])
          cutIndex = next
        }
        publications = []
        for (const [index, operation] of operations.entries()) {
          expectHistoryOutcome(
            operation.outcome.read(),
            operation.expected,
            `${label}: request outcome ${index}`,
          )
          expect(
            operation.expected.status,
            `${label}: model outcome ${index}`,
          ).toBe(
            model.intents[index]!.state === `active`
              ? `pending`
              : model.intents[index]!.state === `accepted`
                ? `fulfilled`
                : `rejected`,
          )
          expect(
            operation.tx.mutations[0]!.modified,
            `${label}: immutable request ${index}`,
          ).toMatchObject(plain(model.intents[index]!.snapshot))
          expect(
            operation.tx.mutations[0]!.changes,
            `${label}: authored request ${index}`,
          ).toStrictEqual(operation.changes)
        }
        const expected = sorted(model.visible().values())
        const actual = sorted([...collection.values()].map(observed))
        if (
          fault === `retained-default` &&
          settling &&
          !injected &&
          actual.length
        ) {
          actual[0]!.c = -999999
          injected = true
        }
        expect(
          actual,
          `${label}: reads ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`,
        ).toEqual(expected)
        expect(sorted(replica.values()), `${label}: event replica`).toEqual(
          expected,
        )
        expect(
          sorted([...downstream.values()].map(plain)),
          `${label}: downstream`,
        ).toEqual(expected.map(plain))
      }
      const initialFrame = publications.at(-1)
      check(`initial`)
      initialPublication = false
      for (const [position, step] of steps.entries()) {
        settling = step.type === `settle`
        const before = sorted(model.visible().values())
        const deliveredBefore = deliveries
        if (step.type === `edit` || step.type === `delete`) {
          const index = model.author(step)
          if (index === undefined) continue
          const intent = model.intents[index]!
          cuts = [sorted(model.visible().values())]
          const done = createDeferred<void>()
          starting = done
          const tx =
            step.type === `delete`
              ? collection.delete(step.key, { optimistic: step.optimistic })
              : intent.kind === `insert`
                ? schemaCollection && step.fields.c === undefined
                  ? schemaCollection.insert(
                      {
                        id: intent.key,
                        a: intent.snapshot.a,
                        b: intent.snapshot.b,
                      },
                      { optimistic: step.optimistic },
                    )
                  : collection.insert(plain(intent.snapshot), {
                      optimistic: step.optimistic,
                    })
                : collection.update(
                    step.key,
                    { optimistic: step.optimistic },
                    (draft) => Object.assign(draft, step.fields),
                  )
          operations.push({
            tx,
            done,
            outcome: observeHistoryPromise<unknown>(tx.isPersisted.promise),
            expected: { status: `pending` },
            changes:
              step.type === `delete`
                ? plain(intent.snapshot)
                : intent.kind === `insert`
                  ? schemaCollection && step.fields.c === undefined
                    ? {
                        id: intent.key,
                        a: intent.snapshot.a,
                        b: intent.snapshot.b,
                      }
                    : plain(intent.snapshot)
                  : Object.fromEntries(
                      Object.entries(step.fields).filter(
                        ([key, value]) =>
                          before.find((row) => row.id === intent.key)?.[
                            key as keyof Fields
                          ] !== value,
                      ),
                    ),
          })
          expect(
            tx.mutations[0]!.modified,
            `captured request snapshot`,
          ).toMatchObject(plain(intent.snapshot))
          counts.edits++
          if (step.type === `delete`) counts.deletes++
          if (intent.dependency !== undefined) counts.dependencies++
        } else if (step.type === `settle`) {
          const active = model.intents.flatMap((intent, index) =>
            intent.state === `active` ? [index] : [],
          )
          if (!active.length) continue
          const index = active[step.slot % active.length]!
          const op = operations[index]!
          const beforeDrain = model.settle(index, step.success)
          cuts = [
            sorted(beforeDrain.values()),
            sorted(model.visible().values()),
          ]
          if (step.success) {
            op.expected = { status: `fulfilled`, value: op.tx }
            op.done.resolve()
          } else if (step.failure === `reject`) {
            const error = new Error(`Mutation rejected at step ${position}`)
            op.expected = { status: `rejected`, reason: error }
            op.done.reject(error)
          } else {
            // Manual rollback promises rejection, not a particular reason value.
            op.expected = { status: `rejected` }
            op.tx.rollback({ isSecondaryRollback: !step.cascade })
            op.done.resolve()
          }
          await op.outcome.settled
          await Promise.resolve()
          counts.settlements++
          if (!step.success) counts.failures++
        } else {
          model.sync(step)
          cuts = [sorted(model.visible().values())]
          sync.begin({ immediate: step.immediate })
          if (step.truncate) {
            sync.truncate()
            counts.replacements++
          }
          for (let copy = 0; copy < step.copies; copy++) {
            for (const row of step.rows)
              sync.write({ type: `update`, value: { ...row } })
          }
          const receipt = sync.commit()
          if (receipt !== true) {
            receipts.push(observeHistoryPromise(receipt))
            counts.queued++
          }
          if (
            (step.immediate || step.truncate) &&
            model.intents.some((intent) => intent.state === `active`)
          )
            counts.snapshotOverrides++
        }
        check(`${position}: ${JSON.stringify(step)}`)
        // Count events as well as final values; value-only oracles miss redundant
        // publications when a mutation moves into completed retention.
        if (
          step.type === `settle` &&
          JSON.stringify(before) ===
            JSON.stringify(sorted(model.visible().values()))
        ) {
          expect(deliveries, `unchanged settlement ${position}`).toBe(
            deliveredBefore,
          )
        }
      }
      if (fault)
        expect(injected, `fault reached an actual publication`).toBe(true)
      return counts
    },
    () => [
      ...operations.flatMap((op, index) => [
        () => {
          if (op.expected.status === `pending`) {
            op.expected = { status: `rejected` }
            op.tx.rollback({ isSecondaryRollback: true })
          }
        },
        () => op.done.resolve(),
        async () => {
          await op.outcome.settled
          expectHistoryOutcome(
            op.outcome.read(),
            op.expected,
            `cleanup request ${index}`,
          )
        },
      ]),
      () => sub?.unsubscribe(),
      () => downstream.cleanup(),
      () => collection.cleanup(),
      ...receipts.map((receipt, index) => async () => {
        await receipt.settled
        expectHistoryOutcome(
          receipt.read(),
          { status: `fulfilled`, value: undefined },
          `applied sync receipt ${index}`,
        )
      }),
    ],
  )
}
