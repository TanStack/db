import { fc } from '@fast-check/vitest'
import { Temporal } from 'temporal-polyfill'
import { describe, expect, vi } from 'vitest'
import {
  BTreeIndex,
  BasicIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '../src/index'
import { localOnlyCollectionOptions } from '../src/local-only'
import { oracleProperty } from './oracle-config'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from './oracle-assertion-adapter'
import { captureCreatedTransactions } from './utils'
import {
  cases,
  describeSequence,
  fileIdForKey,
  mirrorRows,
  replacement,
} from './change-event-history-fixture.js'
import {
  assertIndexAgreement,
  expectedEventTrace,
  expectedRowsAfter,
  perKeyEventTrace,
} from './change-event-history-model-oracle.js'
import type {
  Key,
  Op,
  OpKind,
  TestItem,
} from './change-event-history-fixture.js'
import type { LocalOnlyCollectionUtils } from '../src/local-only'
import type { Collection } from '../src/index'
import type { BaseIndex } from '../src/indexes/base-index'
import type { ChangeMessage, SyncConfig } from '../src/types'

/**
 * # Do settled change messages reconstruct the Collection's public rows?
 *
 * The public change-message contract and issue #1901 require a consumer that
 * applies every delivered insert, update, and delete to agree with the
 * Collection after the corresponding write settles. Each message must also be
 * valid for that consumer's state: an insert names an absent key, and an
 * update or delete names a present one.
 *
 * A plain Map is the independent reference model. The history grammar inserts
 * only while a key is absent and updates or deletes only while it is present.
 * Bounded enumeration covers one-key histories through length four from an
 * absent row and two-key histories through length three from every initial
 * presence state. Fixed-seed and seedless campaigns add histories of up to
 * twenty actions across four keys. The production driver applies each history
 * through a local-only Collection, either in one same-turn batch or
 * sequentially. After all batched writes settle, or after each sequential
 * write settles, public rows and a change-message mirror must equal the
 * reference rows. An eager-index grammar also builds an index before the history
 * and compares both equality buckets after each settled prefix in sequential
 * histories. In batched histories it compares them after each synchronous
 * operation before settlement, then once after all writes settle. At the
 * final checkpoint, fresh indexed live queries are compared with the same Map
 * model. The indexed field stays stable when a key is reused. Every delivered
 * batch records the public rows visible during its callback and the mirror
 * after applying it.
 * A maintainer decision permits either order for different keys in one
 * callback. Changes to the same key retain their causal order. A deferred
 * sync history checks this by comparing one ordered trace per key, including
 * repeated changes and complete row values, while leaving cross-key
 * interleaving unconstrained.
 *
 * About one generated history in four meets a second subscriber, registered
 * after the mirror, that throws while one operation publishes. A local-only
 * direct write stores its rows as it publishes, so the call rethrows, its
 * transaction is already completed, and the rows and mirror still follow the
 * model. Whether a throwing subscriber may stop a later subscriber of the same
 * publication is not decided here; the throwing subscriber is always last.
 *
 * A reload may end a history. A local-only Collection has no backend: its
 * rows are the only copy of the user's writes, so a reload keeps them
 * (maintainer decision; `initialData` loads only into a Collection that
 * starts empty, at creation or after cleanup). `reload()` resolves, the
 * Collection stays `ready`, the public rows equal the model's fold, the
 * mirror of every delivered message, each valid for its state, equals them,
 * and a later write through the reloaded run reaches both. The error-handling
 * guide's adapter obligations also apply: an adapter never inserts a key the
 * Collection holds.
 *
 * This partial oracle does not cover failed persistence, sync-transaction
 * cancellation, general callback batch shape, callback-time index agreement, or
 * publications without change messages.
 * The collection-state retention oracle owns queued source admission and
 * cancellation histories.
 */

type IndexType = typeof BasicIndex | typeof BTreeIndex
type SyncActions = Parameters<SyncConfig<TestItem, number>[`sync`]>[0]

type GeneratedHistory = {
  initialKeys: ReadonlyArray<Key>
  sequence: ReadonlyArray<Op>
  mode: `batched` | `sequential`
  /** The operation whose publication meets a throwing subscriber. */
  throwOn?: number
  /** The history ends with a reload. */
  reload?: boolean
}

type GeneratedStep = { key: Key; deleteWhenPresent: boolean }

function opsFromPresence(
  initialKeys: ReadonlyArray<Key>,
  steps: ReadonlyArray<GeneratedStep>,
  firstStep: number,
): Array<Op> {
  const present = new Set(initialKeys)
  return steps.map(({ key, deleteWhenPresent }, index): Op => {
    const kind: OpKind = present.has(key)
      ? deleteWhenPresent
        ? `delete`
        : `update`
      : `insert`
    if (kind === `delete`) present.delete(key)
    else present.add(key)
    return { kind, key, step: firstStep + index }
  })
}

function applyOp(
  collection: Collection<TestItem, number, LocalOnlyCollectionUtils>,
  op: Op,
): { when: (state: 'settled') => Promise<unknown> } {
  switch (op.kind) {
    case `insert`:
      return collection.insert({
        id: op.key,
        name: `v${op.step}`,
        fileId: fileIdForKey(op.key),
      })
    case `update`:
      return collection.update(op.key, (draft) => {
        draft.name = `v${op.step}`
      })
    case `delete`:
      return collection.delete(op.key)
  }
}

const settle = (tx: { when: (state: 'settled') => Promise<unknown> }) =>
  tx.when(`settled`)

function publicRows(
  collection: Collection<TestItem, number, LocalOnlyCollectionUtils>,
): Array<readonly [number, TestItem]> {
  return [...collection.state]
    .map(
      ([key, row]) =>
        [key, { id: row.id, name: row.name, fileId: row.fileId }] as const,
    )
    .sort(([left], [right]) => left - right)
}

function assertFinalAgreement(
  collection: Collection<TestItem, number, LocalOnlyCollectionUtils>,
  mirror: ReadonlyMap<number, TestItem>,
  expected: ReadonlyMap<number, TestItem>,
): void {
  const expectedRows = mirrorRows(expected)
  oracleAssertion('assertFinalAgreement', () =>
    expect(publicRows(collection)).toEqual(expectedRows),
  )
  oracleAssertion('assertFinalAgreement', () =>
    expect(mirrorRows(mirror)).toEqual(expectedRows),
  )
}

async function runWithCleanup(
  check: () => Promise<void>,
  cleanup: () => Promise<unknown>,
): Promise<void> {
  let primaryFailure: unknown
  let hasPrimaryFailure = false
  try {
    await check()
  } catch (error) {
    primaryFailure = error
    hasPrimaryFailure = true
  }
  try {
    await cleanup()
  } catch (error) {
    if (hasPrimaryFailure) {
      throw new AggregateError(
        [primaryFailure, error],
        `Check and cleanup failed`,
        {
          cause: primaryFailure,
        },
      )
    }
    throw error
  }
  if (hasPrimaryFailure) throw primaryFailure
}

async function assertIndexedQueryAgreement(
  collection: Collection<TestItem, number, LocalOnlyCollectionUtils>,
  index: BaseIndex<number>,
  expected: ReadonlyMap<number, TestItem>,
): Promise<void> {
  const lookup = vi.spyOn(index, `lookup`)
  try {
    for (const fileId of [`f1`, `f2`] as const) {
      lookup.mockClear()
      const query = createLiveQueryCollection((q) =>
        q.from({ row: collection }).where(({ row }) => eq(row.fileId, fileId)),
      )
      await runWithCleanup(
        async () => {
          await query.preload()
          oracleAssertion('assertIndexedQueryAgreement', () =>
            expect(
              query.toArray
                .map((row) => ({
                  id: row.id,
                  name: row.name,
                  fileId: row.fileId,
                }))
                .sort((left, right) => left.id - right.id),
            ).toEqual(
              [...expected.values()]
                .filter((row) => row.fileId === fileId)
                .sort((left, right) => left.id - right.id),
            ),
          )
          oracleAssertion('assertIndexedQueryAgreement', () =>
            expect(lookup).toHaveBeenCalledWith(`eq`, fileId),
          )
        },
        () => query.cleanup(),
      )
    }
  } finally {
    lookup.mockRestore()
  }
}

async function runHistory(
  sequence: ReadonlyArray<Op>,
  initialKeys: ReadonlyArray<Key>,
  mode: `batched` | `sequential`,
  id: string,
  indexType?: IndexType,
  throwOn?: number,
  reload = false,
): Promise<void> {
  const initialRows = [...expectedRowsAfter(initialKeys, [])].map(
    ([, row]) => row,
  )
  const collection = createCollection<
    TestItem,
    number,
    LocalOnlyCollectionUtils
  >(
    localOnlyCollectionOptions<TestItem, number>({
      id,
      getKey: (item: TestItem) => item.id,
      ...(initialRows.length > 0 ? { initialData: initialRows } : {}),
      ...(indexType
        ? { autoIndex: `eager` as const, defaultIndexType: indexType }
        : {}),
    }),
  )
  const mirror = expectedRowsAfter(initialKeys, [])
  const publications: Array<{
    publicRows: Array<readonly [number, TestItem]>
    mirrorRows: Array<readonly [number, TestItem]>
  }> = []
  let subscription: ReturnType<typeof collection.subscribeChanges> | undefined
  let index: BaseIndex<number> | undefined
  let primaryFailure: unknown
  let hasPrimaryFailure = false
  // A subscriber callback cannot fail the test by throwing, so record each
  // message that is invalid for the mirror and assert at the checkpoint.
  const protocolViolations: Array<string> = []

  try {
    if (initialKeys.length > 0) {
      await collection.preload()
      oracleAssertion('runHistory', () =>
        expect(publicRows(collection)).toEqual(mirrorRows(mirror)),
      )
    }
    if (indexType) {
      const initialQuery = createLiveQueryCollection((q) =>
        q.from({ row: collection }).where(({ row }) => eq(row.fileId, `f1`)),
      )
      await runWithCleanup(
        async () => {
          await initialQuery.preload()
        },
        () => initialQuery.cleanup(),
      )
      index = [...collection.indexes.values()].find(
        (candidate) => candidate.name === `auto:fileId`,
      )
      if (!index) throw new Error(`eager fileId index was not built`)
      oracleAssertion('runHistory', () =>
        expect(index).toBeInstanceOf(indexType),
      )
      assertIndexAgreement(index, expectedRowsAfter(initialKeys, []))
    }
    const onChanges = (changes: Array<ChangeMessage<TestItem, number>>) => {
      for (const change of changes) {
        if (mirror.has(change.key) === (change.type === `insert`))
          protocolViolations.push(
            `${change.type} for key ${change.key} while ${mirror.has(change.key) ? `present` : `absent`}`,
          )
        if (change.type === `delete`) mirror.delete(change.key)
        else
          mirror.set(change.key, {
            id: change.value.id,
            name: change.value.name,
            fileId: change.value.fileId,
          })
      }
      publications.push({
        publicRows: publicRows(collection),
        mirrorRows: mirrorRows(mirror),
      })
    }
    subscription =
      initialKeys.length > 0
        ? collection.subscribeChanges(onChanges, { includeInitialState: false })
        : collection.subscribeChanges(onChanges)

    // A second subscriber, after the mirror, throws while one operation
    // publishes. A local-only direct write stores its rows as it publishes
    // them, so the throw cannot undo the write: the call rethrows, and its
    // transaction still settles. The rows and the mirror follow the model.
    const injected = new Error(`subscriber failed`)
    let armed = false
    const throwing =
      throwOn === undefined
        ? undefined
        : collection.subscribeChanges(
            () => {
              if (armed) throw injected
            },
            { includeInitialState: true },
          )
    const { created, restore: restoreCreate } =
      captureCreatedTransactions(collection)
    const applyAt = (op: Op, operationIndex: number) => {
      if (operationIndex !== throwOn) return applyOp(collection, op)
      armed = true
      const before = created.length
      try {
        applyOp(collection, op)
      } catch (error) {
        oracleAssertion(`operation ${operationIndex} rethrows`, () =>
          expect(error, `operation ${operationIndex} rethrows`).toBe(injected),
        )
        oracleAssertion(`one transaction`, () =>
          expect(created.length, `one transaction`).toBe(before + 1),
        )
        oracleAssertion(`operation ${operationIndex} settles`, () =>
          expect(
            created[before]!.state,
            `operation ${operationIndex} settles`,
          ).toBe(`completed`),
        )
        return created[before]!
      } finally {
        armed = false
      }
      throw new Error(`operation ${operationIndex} did not meet the throw`)
    }

    if (mode === `batched`) {
      const transactions = sequence.map((op, operationIndex) => {
        const transaction = applyAt(op, operationIndex)
        if (index) {
          const expected = expectedRowsAfter(
            initialKeys,
            sequence.slice(0, operationIndex + 1),
          )
          oracleAssertion('runHistory', () =>
            expect(publicRows(collection)).toEqual(mirrorRows(expected)),
          )
          assertIndexAgreement(index, expected)
        }
        return transaction
      })
      await Promise.all(transactions.map(settle))
      const expected = expectedRowsAfter(initialKeys, sequence)
      assertFinalAgreement(collection, mirror, expected)
      if (index) assertIndexAgreement(index, expected)
    } else {
      const settled: Array<Op> = []
      for (const [operationIndex, op] of sequence.entries()) {
        await settle(applyAt(op, operationIndex))
        settled.push(op)
        const expected = expectedRowsAfter(initialKeys, settled)
        assertFinalAgreement(collection, mirror, expected)
        if (index) assertIndexAgreement(index, expected)
      }
    }
    if (reload) {
      const kept = mirrorRows(expectedRowsAfter(initialKeys, sequence))
      await collection.reload()
      oracleAssertion(`status after reload`, () =>
        expect(collection.status, `status after reload`).toBe(`ready`),
      )
      oracleAssertion(`a reload keeps the rows`, () =>
        expect(publicRows(collection), `a reload keeps the rows`).toEqual(kept),
      )
      oracleAssertion(`mirror after reload`, () =>
        expect(mirrorRows(mirror), `mirror after reload`).toEqual(kept),
      )
      // The histories use keys 1 to 4, so key 5 is absent.
      const later = { id: 5, name: `after-reload`, fileId: fileIdForKey(5) }
      await settle(collection.insert(later))
      const expected = [...kept, [5, later] as const]
      oracleAssertion(`write after reload`, () =>
        expect(publicRows(collection), `write after reload`).toEqual(expected),
      )
      oracleAssertion(`mirror after write`, () =>
        expect(mirrorRows(mirror), `mirror after write`).toEqual(expected),
      )
    }
    if (index) {
      await assertIndexedQueryAgreement(
        collection,
        index,
        expectedRowsAfter(initialKeys, sequence),
      )
    }
    for (const publication of publications) {
      oracleAssertion('runHistory', () =>
        expect(publication.mirrorRows).toEqual(publication.publicRows),
      )
    }
    throwing?.unsubscribe()
    restoreCreate()
    oracleAssertion(`change-message protocol`, () =>
      expect(protocolViolations, `change-message protocol`).toEqual([]),
    )
  } catch (error) {
    primaryFailure = error
    hasPrimaryFailure = true
  }

  const cleanupFailures: Array<unknown> = []
  try {
    subscription?.unsubscribe()
  } catch (error) {
    cleanupFailures.push(error)
  }
  try {
    await collection.cleanup()
  } catch (error) {
    cleanupFailures.push(error)
  }
  if (hasPrimaryFailure && cleanupFailures.length > 0) {
    throw new AggregateError(
      [primaryFailure, ...cleanupFailures],
      `Mirror agreement and cleanup both failed`,
      { cause: primaryFailure },
    )
  }
  if (hasPrimaryFailure) throw primaryFailure
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, `Mirror oracle cleanup failed`, {
      cause: cleanupFailures[0],
    })
  }
}

async function verifyGeneratedHistory({
  initialKeys,
  sequence,
  mode,
  throwOn,
  reload,
}: GeneratedHistory): Promise<void> {
  await runHistory(
    sequence,
    initialKeys,
    mode,
    `history-oracle-generated-${initialKeys.join(``)}-${mode}-${describeSequence(sequence)}`,
    undefined,
    throwOn === undefined ? undefined : throwOn % sequence.length,
    reload,
  )
}

interface DurationRow extends Record<string, unknown> {
  id: number
  duration: Temporal.Duration
}

// The model's expected field values, and the public observations that must
// agree with them. Two Durations with the same display text but different
// intrinsic fields must reach the row, the change message, and the mirror.
function expectDurationFieldPublication(
  expected: ReadonlyMap<number, DurationRow>,
  state: ReadonlyMap<number, DurationRow>,
  received: ReadonlyArray<ChangeMessage<DurationRow, number>>,
  mirror: ReadonlyMap<number, DurationRow>,
): void {
  const expectedFields = [0, 1000]
  const fields = (row: DurationRow | undefined) => [
    row?.duration.seconds,
    row?.duration.milliseconds,
  ]
  expect(fields(expected.get(1))).toEqual(expectedFields)
  expect(fields(state.get(1))).toEqual(expectedFields)
  expect(received.map((message) => message.type)).toEqual([`update`])
  expect(fields(received[0]?.previousValue)).toEqual([1, 0])
  expect(fields(received[0]?.value)).toEqual(expectedFields)
  expect(fields(mirror.get(1))).toEqual(expectedFields)
}

async function runDurationFieldChangeHistory(): Promise<void> {
  let sync!: Parameters<SyncConfig<DurationRow, number>[`sync`]>[0]
  const collection = createCollection<DurationRow, number>({
    id: `duration-field-change-history`,
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: (actions) => {
        sync = actions
        actions.markReady()
      },
    },
  })

  await runWithCleanup(
    async () => {
      await collection.stateWhenReady()
      const first = {
        id: 1,
        duration: Temporal.Duration.from({ seconds: 1 }),
      }
      const second = {
        id: 1,
        duration: Temporal.Duration.from({ milliseconds: 1000 }),
      }
      expect(first.duration.toString()).toBe(second.duration.toString())
      sync.begin()
      sync.write({ type: `insert`, value: first })
      expect(sync.commit()).toBe(true)

      // The model applies each valid source write to a plain keyed Map.
      // A subscriber maintains an independent mirror from public messages.
      const expected = new Map<number, DurationRow>([[1, first]])
      const mirror = new Map(expected)
      const received: Array<ChangeMessage<DurationRow, number>> = []
      const subscription = collection.subscribeChanges(
        (changes) => {
          received.push(...changes)
          for (const change of changes) {
            if (change.type === `delete`) mirror.delete(change.key)
            else mirror.set(change.key, change.value)
          }
        },
        { includeInitialState: false },
      )
      try {
        expected.set(1, second)
        sync.begin()
        sync.write({ type: `update`, value: second })
        expect(sync.commit()).toBe(true)

        expectDurationFieldPublication(
          expected,
          collection.state,
          received,
          mirror,
        )
      } finally {
        subscription.unsubscribe()
      }
    },
    () => collection.cleanup(),
  )
}

async function runDeferredCausalHistory(
  rounds: ReadonlyArray<ReadonlyArray<Op>>,
): Promise<void> {
  const sequence = rounds.flat()
  let sync!: SyncActions
  const collection = createCollection<TestItem, number>({
    id: `deferred-causal-change-history`,
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: (actions) => {
        sync = actions
        actions.markReady()
      },
    },
  })
  const callbacks: Array<Array<ChangeMessage<TestItem, number>>> = []
  const subscription = collection.subscribeChanges(
    (changes) => callbacks.push(changes),
    { includeInitialState: false },
  )
  const publication = collection._deferPublication()
  await runWithCleanup(
    async () => {
      await collection.stateWhenReady()
      for (const round of rounds) {
        sync.begin()
        for (const op of round) {
          if (op.kind === `delete`) {
            sync.write({ type: `delete`, key: op.key })
          } else {
            sync.write({
              type: op.kind,
              value: {
                id: op.key,
                name: `v${op.step}`,
                fileId: fileIdForKey(op.key),
              },
            })
          }
        }
        expect(sync.commit()).toBe(true)
      }
      expect(callbacks).toEqual([])
      publication.publish()
      expect(callbacks).toHaveLength(1)
      expect(perKeyEventTrace(callbacks[0]!)).toEqual(
        expectedEventTrace(sequence),
      )
      expect(
        [...collection.state].map(([key, row]) => [key, row.name]),
      ).toEqual([[2, `v6`]])
    },
    async () => {
      const cleanupFailures: Array<unknown> = []
      for (const release of [
        () => publication.discard(),
        () => subscription.unsubscribe(),
        () => collection.cleanup(),
      ]) {
        try {
          await release()
        } catch (error) {
          cleanupFailures.push(error)
        }
      }
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          cleanupFailures,
          `Causal oracle cleanup failed`,
          {
            cause: cleanupFailures[0],
          },
        )
      }
    },
  )
}

describe(`change-event history oracle`, () => {
  // Published #1519 keeps equivalent Duration forms distinct for query `eq`.
  // Under #1901's change-message reconstruction law, a source replacement
  // that changes the Duration's intrinsic fields must reach the consumer's
  // mirror as well as the public row. This two-step history inserts one second,
  // then replaces it with 1000 milliseconds. The reference Map applies that
  // valid write despite the shared display text; at the update commit, both
  // public observations must reflect the second value.
  // This witness covers ordinary same-realm Durations, not altered objects or
  // a requirement to suppress events for a separately allocated equal copy.
  const durationHistories = [
    {
      name: `publishes a Duration field change to the Collection and change-message consumer`,
    },
  ]
  oracleProperty({
    id: `collection-state.duration-field-change`,
    law: {
      statement: `A source replacement that changes a Duration's intrinsic fields reaches the public row and the change-message mirror, as the reference Map predicts.`,
      authority: `Collection change-message contract (#1901) and the published Duration equality of #1519, stated above`,
      limits: `One two-step same-realm Duration history; no altered objects and no suppression of events for an equal copy.`,
    },
    owns: [`src/collection/changes.ts`, `src/local-only.ts`],
    histories: durationHistories,
    label: ({ name }) => name,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`duration field change`, plan, observe, () =>
        runDurationFieldChangeHistory(),
      ),
    check: forwardAssertionJudgment,
  })

  const deferredCausalHistories: Array<{
    name: string
    rounds: ReadonlyArray<ReadonlyArray<Op>>
  }> = [
    {
      name: `preserves each key's causal messages within a deferred callback`,
      rounds: [
        [
          { kind: `insert`, key: 1, step: 1 },
          { kind: `insert`, key: 2, step: 2 },
        ],
        [
          { kind: `update`, key: 1, step: 3 },
          { kind: `update`, key: 2, step: 4 },
        ],
        [
          { kind: `delete`, key: 1, step: 5 },
          { kind: `update`, key: 2, step: 6 },
        ],
      ],
    },
  ]
  oracleProperty({
    id: `collection-state.deferred-causal-messages`,
    law: {
      statement: `A deferred publication delivers each key's messages in causal order with complete row values, matching the model's per-key event trace; cross-key interleaving is unconstrained.`,
      authority: `Collection change-message contract and the maintainer cross-key ordering decision stated above`,
      limits: `One deferred sync history of three rounds over two keys.`,
    },
    owns: [`src/collection/changes.ts`, `src/local-only.ts`],
    histories: deferredCausalHistories,
    label: ({ name }) => name,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`deferred causal messages`, plan, observe, () =>
        runDeferredCausalHistory(plan.history.rounds),
      ),
    check: forwardAssertionJudgment,
  })

  const indexTypes: Array<readonly [string, IndexType]> = [
    [`BasicIndex`, BasicIndex],
    [`BTreeIndex`, BTreeIndex],
  ]

  const generatedHistory = fc
    .record({
      initialKeys: fc.subarray([1, 2, 3, 4] as Array<Key>),
      steps: fc.array(
        fc.record({
          key: fc.constantFrom<Key>(1, 2, 3, 4),
          deleteWhenPresent: fc.boolean(),
        }),
        { minLength: 1, maxLength: 20 },
      ),
      mode: fc.constantFrom(`batched` as const, `sequential` as const),
      // About two histories in three arm a throwing subscriber; about one in
      // four reaches the operation it throws on.
      throwOn: fc.option(fc.nat(19), { nil: undefined, freq: 2 }),
      reload: fc.boolean(),
    })
    .map(({ initialKeys, steps, mode, throwOn, reload }) => {
      const sequence = opsFromPresence(initialKeys, steps, 1)
      return { initialKeys, sequence, mode, throwOn, reload }
    })

  // The fixed prefix forces reused keys through an already-built index.
  // The tail varies legal follow-up edits on two existing and two new keys.
  const indexedHistory: fc.Arbitrary<GeneratedHistory> = fc
    .record({
      steps: fc.array(
        fc.record({
          key: fc.constantFrom<Key>(1, 2, 3, 4),
          deleteWhenPresent: fc.boolean(),
        }),
        { maxLength: 12 },
      ),
      mode: fc.constantFrom(`batched` as const, `sequential` as const),
    })
    .map(({ steps, mode }) => {
      const tail = opsFromPresence([1, 2], steps, replacement.length + 1)
      return { initialKeys: [1, 2], sequence: [...replacement, ...tail], mode }
    })

  const indexReplacementHistories = indexTypes.flatMap(([index]) =>
    ([`batched`, `sequential`] as const).map((mode) => ({ index, mode })),
  )
  const indexTypesByName = new Map(indexTypes)
  oracleProperty({
    id: `collection-state.eager-index-replacement`,
    law: {
      statement: `Eager index buckets and indexed query rows agree with the independent authored Map at every settled prefix and final query checkpoint.`,
      authority: `Collection change-message and eager-index contracts stated above`,
      limits: `The fixed replacement history (delete then reinsert keys 1 and 2) for BasicIndex and BTreeIndex in batched and sequential modes; the generated indexed grammar cannot take it back.`,
    },
    owns: [`src/collection/changes.ts`, `src/local-only.ts`],
    histories: indexReplacementHistories,
    label: ({ index, mode }) =>
      `keeps ${index} and indexed queries aligned after ${mode} replacement`,
    resolve: (history) => ({
      history,
      IndexType: indexTypesByName.get(history.index)!,
    }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`eager index replacement`, plan, observe, () =>
        runHistory(
          replacement,
          [1, 2],
          plan.history.mode,
          `indexed-${plan.history.index}-${plan.history.mode}`,
          plan.IndexType,
        ),
      ),
    check: forwardAssertionJudgment,
  })

  const verifyIndexedHistory = async ({
    initialKeys,
    sequence,
    mode,
  }: GeneratedHistory): Promise<void> => {
    for (const [name, IndexType] of indexTypes) {
      await runHistory(
        sequence,
        initialKeys,
        mode,
        `indexed-history-${name}-${mode}-${describeSequence(sequence)}`,
        IndexType,
      )
    }
  }

  oracleProperty({
    id: `collection-state.eager-index-history`,
    law: {
      statement: `Eager index buckets and indexed query rows agree with the independent authored Map at every settled prefix and final query checkpoint.`,
      authority: `Collection change-message and eager-index contracts stated above`,
      limits: `BasicIndex and BTreeIndex with the existing bounded key/operation grammar and stable indexed fields across key reuse; no callback-time index agreement.`,
    },
    // What this oracle owns: the gap report judges the change-message publication
    // in collection/changes.ts, and the direct writes of a local-only Collection in
    // local-only.ts, by this file's tests.
    owns: [`src/collection/changes.ts`, `src/local-only.ts`],
    histories: { arbitrary: indexedHistory, runs: 35, fixedSeeds: [1912] },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`eager index history`, plan, observe, () =>
        verifyIndexedHistory(plan.history),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `collection-state.change-event-cases`,
    law: {
      statement: `Each settled change-message history reconstructs the Collection's public rows through valid per-key messages.`,
      authority: `Collection change-message contract stated above`,
      limits: `The bounded enumeration: one-key histories through length four from an absent row and two-key histories through length three from every initial presence state, batched and sequential.`,
    },
    owns: [`src/collection/changes.ts`, `src/local-only.ts`],
    histories: cases,
    label: ({ id, label }) => `${id}: ${label} reconstructs every public row`,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`change-event case`, plan, observe, () =>
        runHistory(
          plan.history.sequence,
          plan.history.initialKeys,
          plan.history.mode,
          `history-oracle-${plan.history.id}`,
        ),
      ),
    check: forwardAssertionJudgment,
  })

  // Every bounded history again, ending with a reload. It includes the
  // reported trace: initialData [1], update 1, reload.
  oracleProperty({
    id: `collection-state.change-event-reload-cases`,
    law: {
      statement: `Each settled change-message history that ends with a reload keeps the local-only rows, and a later write reaches the rows and the mirror.`,
      authority: `Collection change-message contract and the maintainer reload decision stated above`,
      limits: `The same bounded enumeration as collection-state.change-event-cases, each history ending with a reload.`,
    },
    owns: [`src/collection/changes.ts`, `src/local-only.ts`],
    histories: cases,
    label: ({ id, label }) =>
      `${id}: ${label} then reload reconstructs every public row`,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`change-event reload case`, plan, observe, () =>
        runHistory(
          plan.history.sequence,
          plan.history.initialKeys,
          plan.history.mode,
          `history-oracle-reload-${plan.history.id}`,
          undefined,
          undefined,
          true,
        ),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `collection-state.change-event-history`,
    law: {
      statement: `Each settled change-message history reconstructs the Collection's public rows through valid per-key messages, including throwing subscribers and reload suffixes.`,
      authority: `Collection change-message contract and the maintainer reload and cross-key ordering decisions stated above`,
      limits: `Existing local-only bounded grammar in batched and sequential modes; no failed persistence, cancellation, general batch shape or publications without messages.`,
    },
    owns: [`src/collection/changes.ts`, `src/local-only.ts`],
    histories: { arbitrary: generatedHistory, runs: 100, fixedSeeds: [1902] },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`change-event history`, plan, observe, () =>
        verifyGeneratedHistory(plan.history),
      ),
    check: forwardAssertionJudgment,
  })
})
