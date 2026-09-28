import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import {
  BTreeIndex,
  BasicIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '../src/index'
import { localOnlyCollectionOptions } from '../src/local-only'
import { PropRef } from '../src/query/ir'
import { oraclePropertyOptions, oracleRuns } from './oracle-config'
import type { LocalOnlyCollectionUtils } from '../src/local-only'
import type { Collection } from '../src/index'
import type { BaseIndex } from '../src/indexes/base-index'
import type { ChangeMessage } from '../src/types'

/**
 * # Do settled change messages reconstruct the Collection's public rows?
 *
 * The public change-message contract and issue #1901 require a consumer that
 * applies every delivered insert, update, and delete to agree with the
 * Collection after the corresponding optimistic transactions persist.
 *
 * A plain Map is the independent reference model. The history grammar inserts
 * only while a key is absent and updates or deletes only while it is present.
 * Bounded enumeration covers one-key histories through length four from an
 * absent row and two-key histories through length three from every initial
 * presence state. Fixed-seed and seedless campaigns add histories of up to
 * twenty actions across four keys. The production driver applies each history
 * through a local-only Collection, either in one same-turn batch or
 * sequentially. After optimistic-transaction persistence, the public rows
 * and a change-message mirror must equal the reference rows. An eager-index
 * lane additionally builds an index before the history and compares both its
 * equality buckets after each settled prefix and fresh indexed live queries
 * at the final checkpoint against the same Map model. The indexed field stays
 * stable when a key is reused. Sequential histories check every settled prefix.
 * Every delivered batch records
 * the public rows visible during its callback and the mirror after applying
 * that batch.
 *
 * This partial oracle does not cover failed persistence, sync-transaction
 * cancellation, callback batch shape, callback-time index agreement, or
 * publications without change messages.
 * The collection-state retention oracle owns queued source admission and
 * cancellation histories.
 */

interface TestItem extends Record<string, unknown> {
  id: number
  name: string
  fileId: `f1` | `f2`
}

type OpKind = `insert` | `update` | `delete`
type Key = 1 | 2 | 3 | 4
type IndexType = typeof BasicIndex | typeof BTreeIndex

const fileIdForKey = (key: number): TestItem[`fileId`] =>
  key % 2 === 1 ? `f1` : `f2`

interface Op {
  kind: OpKind
  key: Key
  step: number
}

type GeneratedHistory = {
  initialKeys: ReadonlyArray<Key>
  sequence: ReadonlyArray<Op>
  mode: `batched` | `sequential`
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

/**
 * Every sequence the keyed-presence model permits up to `maxLength`.
 */
function generateSequences(
  maxLength: number,
  keys: ReadonlyArray<Key>,
  sequence: ReadonlyArray<Op> = [],
  present: ReadonlySet<Key> = new Set(),
): Array<Array<Op>> {
  return keys.flatMap((key) => {
    const kinds: ReadonlyArray<OpKind> = present.has(key)
      ? [`update`, `delete`]
      : [`insert`]
    return kinds.flatMap((kind) => {
      const next = [...sequence, { kind, key, step: sequence.length + 1 }]
      const nextPresent = new Set(present)
      if (kind === `delete`) nextPresent.delete(key)
      else nextPresent.add(key)
      const rest =
        next.length < maxLength
          ? generateSequences(maxLength, keys, next, nextPresent)
          : []
      return [next, ...rest]
    })
  })
}

const describeSequence = (sequence: ReadonlyArray<Op>): string =>
  sequence.map((op) => `${op.kind}(${op.key},${op.step})`).join(` -> `)

function expectedRowsAfter(
  initialKeys: ReadonlyArray<Key>,
  sequence: ReadonlyArray<Op>,
): Map<number, TestItem> {
  const rows = new Map<number, TestItem>(
    initialKeys.map((key) => [
      key,
      { id: key, name: `initial-${key}`, fileId: fileIdForKey(key) },
    ]),
  )
  for (const op of sequence) {
    if (op.kind === `delete`) rows.delete(op.key)
    else
      rows.set(op.key, {
        id: op.key,
        name: `v${op.step}`,
        fileId: fileIdForKey(op.key),
      })
  }
  return rows
}

function applyOp(
  collection: Collection<TestItem, number, LocalOnlyCollectionUtils>,
  op: Op,
): { isPersisted: { promise: Promise<unknown> } } {
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

const settle = (tx: { isPersisted: { promise: Promise<unknown> } }) =>
  tx.isPersisted.promise

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

function mirrorRows(
  mirror: ReadonlyMap<number, TestItem>,
): Array<readonly [number, TestItem]> {
  return [...mirror]
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
  expect(publicRows(collection)).toEqual(expectedRows)
  expect(mirrorRows(mirror)).toEqual(expectedRows)
}

function assertIndexAgreement(
  index: BaseIndex<number>,
  expected: ReadonlyMap<number, TestItem>,
): void {
  expect(index.keyCount).toBe(expected.size)
  for (const fileId of [`f1`, `f2`] as const) {
    const expectedKeys = new Set(
      [...expected]
        .filter(([, row]) => row.fileId === fileId)
        .map(([key]) => key),
    )
    expect(index.lookup(`eq`, fileId)).toEqual(expectedKeys)
  }
}

async function runWithQueryCleanup(
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
        `Query check and cleanup failed`,
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
      await runWithQueryCleanup(
        async () => {
          await query.preload()
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
          )
          expect(lookup).toHaveBeenCalledWith(`eq`, fileId)
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

  try {
    if (initialKeys.length > 0) {
      await collection.preload()
      expect(publicRows(collection)).toEqual(mirrorRows(mirror))
    }
    if (indexType) {
      const initialQuery = createLiveQueryCollection((q) =>
        q.from({ row: collection }).where(({ row }) => eq(row.fileId, `f1`)),
      )
      await runWithQueryCleanup(
        async () => {
          await initialQuery.preload()
        },
        () => initialQuery.cleanup(),
      )
      index = [...collection.indexes.values()].find(
        (candidate) => candidate.name === `auto:fileId`,
      )
      if (!index) throw new Error(`eager fileId index was not built`)
      expect(index).toBeInstanceOf(indexType)
      assertIndexAgreement(index, expectedRowsAfter(initialKeys, []))
    }
    const onChanges = (changes: Array<ChangeMessage<TestItem, number>>) => {
      for (const change of changes) {
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

    if (mode === `batched`) {
      await Promise.all(
        sequence.map((op) => applyOp(collection, op)).map(settle),
      )
      const expected = expectedRowsAfter(initialKeys, sequence)
      assertFinalAgreement(collection, mirror, expected)
      if (index) assertIndexAgreement(index, expected)
    } else {
      const settled: Array<Op> = []
      for (const op of sequence) {
        await settle(applyOp(collection, op))
        settled.push(op)
        const expected = expectedRowsAfter(initialKeys, settled)
        assertFinalAgreement(collection, mirror, expected)
        if (index) assertIndexAgreement(index, expected)
      }
    }
    if (index) {
      await assertIndexedQueryAgreement(
        collection,
        index,
        expectedRowsAfter(initialKeys, sequence),
      )
    }
    for (const publication of publications) {
      expect(publication.mirrorRows).toEqual(publication.publicRows)
    }
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
}: GeneratedHistory): Promise<void> {
  await runHistory(
    sequence,
    initialKeys,
    mode,
    `history-oracle-generated-${initialKeys.join(``)}-${mode}-${describeSequence(sequence)}`,
  )
}

describe(`change-event history oracle`, () => {
  const indexTypes: Array<readonly [string, IndexType]> = [
    [`BasicIndex`, BasicIndex],
    [`BTreeIndex`, BTreeIndex],
  ]
  const replacement: ReadonlyArray<Op> = [
    { kind: `delete`, key: 1, step: 1 },
    { kind: `delete`, key: 2, step: 2 },
    { kind: `insert`, key: 1, step: 3 },
    { kind: `insert`, key: 2, step: 4 },
  ]
  const oneKeyCases = generateSequences(4, [1]).flatMap((sequence, index) =>
    ([`batched`, `sequential`] as const).map((mode) => ({
      mode,
      sequence,
      initialKeys: [] as ReadonlyArray<Key>,
      label: describeSequence(sequence),
      id: `one-key-${mode}-${index}`,
    })),
  )
  const initialPresence: ReadonlyArray<ReadonlyArray<Key>> = [
    [],
    [1],
    [2],
    [1, 2],
  ]
  const twoKeyCases = initialPresence.flatMap((initialKeys, initialIndex) =>
    generateSequences(3, [1, 2], [], new Set(initialKeys)).flatMap(
      (sequence, index) =>
        ([`batched`, `sequential`] as const).map((mode) => ({
          mode,
          sequence,
          initialKeys,
          label: describeSequence(sequence),
          id: `two-key-${initialIndex}-${mode}-${index}`,
        })),
    ),
  )
  const cases = [...oneKeyCases, ...twoKeyCases]

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
    })
    .map(({ initialKeys, steps, mode }) => {
      const sequence = opsFromPresence(initialKeys, steps, 1)
      return { initialKeys, sequence, mode }
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

  it(`reaches reinsertion and rejects missing or extra mirrored rows`, () => {
    const witness: Array<Op> = [
      { kind: `insert`, key: 1, step: 1 },
      { kind: `delete`, key: 1, step: 2 },
      { kind: `insert`, key: 1, step: 3 },
    ]
    expect(generateSequences(4, [1])).toContainEqual(witness)
    expect(oneKeyCases).toHaveLength(22)
    expect(twoKeyCases).toHaveLength(344)
    expect(generateSequences(3, [1, 2], [], new Set<Key>([1]))).toContainEqual([
      { kind: `update`, key: 1, step: 1 },
      { kind: `insert`, key: 2, step: 2 },
      { kind: `delete`, key: 1, step: 3 },
    ])
    expect(
      generateSequences(3, [1, 2], [], new Set<Key>([1])),
    ).not.toContainEqual([{ kind: `insert`, key: 1, step: 1 }])
    expect(new Set(cases.map(({ id }) => id)).size).toBe(cases.length)
    const expected = [[1, { id: 1, name: `v3`, fileId: `f1` }]]
    expect(mirrorRows(new Map())).not.toEqual(expected)
    expect(
      mirrorRows(new Map([[1, { id: 1, name: `wrong`, fileId: `f1` }]])),
    ).not.toEqual(expected)
    expect(
      mirrorRows(
        new Map([
          [1, { id: 1, name: `v3`, fileId: `f1` }],
          [2, { id: 2, name: `ghost`, fileId: `f2` }],
        ]),
      ),
    ).not.toEqual(expected)
  })

  it(`rejects a missing live key in the index checker`, () => {
    expect(replacement.map(({ kind, key }) => [kind, key])).toEqual([
      [`delete`, 1],
      [`delete`, 2],
      [`insert`, 1],
      [`insert`, 2],
    ])
    const expected = expectedRowsAfter([1, 2], replacement)
    const index = new BasicIndex<number>(1, new PropRef([`fileId`]))
    index.build([...expected])
    assertIndexAgreement(index, expected)
    index.remove(1, expected.get(1))
    expect(() => assertIndexAgreement(index, expected)).toThrowError(/expected/)
  })

  for (const [name, IndexType] of indexTypes) {
    it.each([`batched`, `sequential`] as const)(
      `keeps ${name} and indexed queries aligned after %s replacement`,
      async (mode) => {
        await runHistory(
          replacement,
          [1, 2],
          mode,
          `indexed-${name}-${mode}`,
          IndexType,
        )
      },
    )
  }

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

  fcTest.prop([indexedHistory], { numRuns: oracleRuns(35), seed: 1_912 })(
    `keeps eager indexes and indexed queries aligned across fixed-seed histories`,
    verifyIndexedHistory,
  )
  fcTest.prop(
    [indexedHistory],
    oraclePropertyOptions(35, `collection-state.eager-index-history`),
  )(
    `keeps eager indexes and indexed queries aligned across random histories`,
    verifyIndexedHistory,
  )

  it.each(cases)(
    `$id: $label reconstructs every public row`,
    async ({ mode, sequence, initialKeys, id }) => {
      await runHistory(sequence, initialKeys, mode, `history-oracle-${id}`)
    },
  )

  fcTest.prop([generatedHistory], { numRuns: oracleRuns(100), seed: 1_902 })(
    `keeps change messages and public rows aligned with a fixed seed`,
    verifyGeneratedHistory,
  )

  fcTest.prop(
    [generatedHistory],
    oraclePropertyOptions(100, `collection-state.change-event-history`),
  )(
    `keeps change messages and public rows aligned with a random or replayed seed`,
    verifyGeneratedHistory,
  )
})
