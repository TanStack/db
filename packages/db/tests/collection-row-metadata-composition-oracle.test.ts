import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { DbClient, collectionOptions } from '../src/client.js'
import type { SyncConfig } from '../src/types.js'

/**
 * # Which row metadata survives one sync transaction?
 *
 * A sync source writes row metadata inside one transaction in three ways:
 * through `metadata.row.set` and `metadata.row.delete`, through the `metadata`
 * field of a row message, and through `truncate`. Each write replaces the
 * current value, last write wins. `collection.test.ts` pins that rule for
 * writes that carry metadata. A maintainer decision on 2026-10-05 (recorded in
 * `docs/contributing/oracle-reviews/2026-10-05-state-mutation-round-3.md`)
 * fixes the writes that carry none:
 *
 * - An insert of an absent key names the row's whole metadata. Without
 *   `metadata`, it clears any earlier value.
 * - An insert equal to the held row is an idempotent re-insert. Without
 *   `metadata`, it keeps the current value, like an update.
 * - An update without `metadata` keeps the current value.
 * - A row delete clears the value, even when the message carries metadata.
 * - A truncate clears the value.
 * - `metadata.row.set` after a delete or a truncate keeps metadata for the
 *   absent row.
 *
 * This oracle covers one key, one transaction of up to three writes, and four
 * lanes: immediate, held, rebuilt, and nested. The nested lane applies a
 * nested transaction or a hydration seed before the open transaction. When a
 * rebuild changes an insert into an equal re-insert, or the reverse, the rule
 * follows the write that applies. The model judges the reclassified sequence. It does not judge collection metadata, metadata-only
 * publication batches, or other keys. The collection-metadata publication
 * oracle owns those.
 */

type Row = { id: number; v: number }
type SyncActions = Parameters<SyncConfig<Row, number>[`sync`]>[0]
type Write =
  | { kind: `set` }
  | { kind: `unset` }
  | { kind: `truncate` }
  | {
      kind: `insert` | `reinsert` | `update` | `delete`
      metadata: boolean
    }
type Start = `absent` | `present-with-metadata` | `present-without-metadata`
type Lane = `immediate` | `held` | `rebuilt`

const writes: ReadonlyArray<Write> = [
  { kind: `set` },
  { kind: `unset` },
  { kind: `truncate` },
  ...([`insert`, `reinsert`, `update`, `delete`] as const).flatMap((kind) =>
    [false, true].map((metadata) => ({ kind, metadata })),
  ),
]

const startMetadata = { m: `start` }
const writeMetadata = (step: number) => ({ m: `w${step}` })

/**
 * The model folds the writes in order over the starting value. It keeps no
 * staging state: each write replaces, keeps, or clears the one current value,
 * as the contract above states.
 */
function expectedMetadata(start: Start, sequence: ReadonlyArray<Write>) {
  return foldMetadata(
    start === `present-with-metadata` ? startMetadata : undefined,
    sequence,
  )
}

function foldMetadata(initial: unknown, sequence: ReadonlyArray<Write>) {
  let current = initial
  sequence.forEach((write, step) => {
    if (write.kind === `set`) current = writeMetadata(step)
    else if (
      write.kind === `unset` ||
      write.kind === `truncate` ||
      write.kind === `delete`
    )
      current = undefined
    else if (write.metadata) current = writeMetadata(step)
    else if (write.kind === `insert`) current = undefined
    // A re-insert or an update without metadata keeps the current value.
  })
  return current
}

/**
 * Legal histories follow the change-message protocol for the row: an insert
 * names an absent key, and an update or delete names a present one. A
 * truncate leaves the row absent. Metadata API calls are legal in any row
 * state.
 */
function isLegal(start: Start, sequence: ReadonlyArray<Write>): boolean {
  let present = start !== `absent`
  for (const write of sequence) {
    if (write.kind === `truncate`) present = false
    else if (write.kind === `insert`) {
      if (present) return false
      present = true
    } else if (
      write.kind === `reinsert` ||
      write.kind === `update` ||
      write.kind === `delete`
    ) {
      if (!present) return false
      present = write.kind !== `delete`
    }
  }
  return true
}

const starts: ReadonlyArray<Start> = [
  `absent`,
  `present-with-metadata`,
  `present-without-metadata`,
]
const histories = starts.flatMap((start) => {
  const legal: Array<{ start: Start; sequence: Array<Write> }> = []
  const extend = (sequence: Array<Write>) => {
    if (sequence.length > 0 && isLegal(start, sequence))
      legal.push({ start, sequence })
    if (sequence.length < 3)
      for (const write of writes) extend([...sequence, write])
  }
  extend([])
  return legal
})

/**
 * The rebuilt lane also varies the earlier held transaction. It either
 * updates key 2, or writes key 1 without metadata: an update or a delete when
 * key 1 is present, an insert when it is absent. A key-1 write changes the
 * projection that the open transaction rebuilds against, so its sequences are
 * legal after that write. Sequences stay at two writes to bound the lane.
 */
type EarlierWrite = { key: 1 | 2; kind: `insert` | `update` | `delete` }
const shortSequences = writes.flatMap((first) => [
  [first],
  ...writes.map((second) => [first, second]),
])
const asWrite = (earlier: EarlierWrite): Write => ({
  kind: earlier.kind,
  metadata: false,
})
const rebuiltHistories = starts.flatMap((start) => {
  const present = start !== `absent`
  const earlierWrites: Array<EarlierWrite> = [
    { key: 2, kind: `update` },
    ...(present
      ? ([
          { key: 1, kind: `update` },
          { key: 1, kind: `delete` },
        ] as const)
      : ([{ key: 1, kind: `insert` }] as const)),
  ]
  return earlierWrites.flatMap((earlier) =>
    earlier.key === 2
      ? histories
          .filter((history) => history.start === start)
          .map((history) => ({ ...history, earlier }))
      : shortSequences
          .filter((sequence) => isLegal(start, [asWrite(earlier), ...sequence]))
          .map((sequence) => ({ start, sequence, earlier })),
  )
})

/**
 * The nested lane opens a transaction, T1, and writes up to three writes to
 * key 1. Then a nested write applies before T1 commits:
 *
 * - `delete`: a transaction begun inside T1 deletes the present row.
 * - `insert`: a transaction begun inside T1 inserts the absent row with its
 *   own metadata.
 * - `seed`: a hydration seed inserts the absent row with its own metadata.
 *   The Collection places a seed ahead of the first open transaction.
 *
 * A nested transaction can also call `metadata.row.set` after its row write.
 *
 * T1 applies after the nested write, so the Collection reclassifies each of
 * T1's inserts against the rows that the nested write leaves. An insert of a
 * present key is an equal re-insert, and an insert of an absent key is an
 * insert. Every row write in this lane writes one value, so a reclassified
 * insert is never a duplicate.
 *
 * A history is legal when T1's writes are legal both where T1 writes them and
 * where they apply. An insert is legal in either place. An update or a delete
 * needs the row present in both. A truncate leaves the row absent in both.
 */
type NestedWrite = `delete` | `insert` | `seed`
type NestedHistory = {
  start: Start
  nested: NestedWrite
  nestedSet: boolean
  sequence: Array<Write>
}
const nestedMetadata = { m: `nested` }
const nestedSetMetadata = { m: `nested-set` }
// The model decides which inserts are re-inserts, so T1 writes only inserts.
const nestedCandidates = writes.filter((write) => write.kind !== `reinsert`)
function isNestedLegal(
  writePresent: boolean,
  applyPresent: boolean,
  sequence: ReadonlyArray<Write>,
): boolean {
  for (const write of sequence) {
    if (write.kind === `truncate`) writePresent = applyPresent = false
    else if (write.kind === `insert`) writePresent = applyPresent = true
    else if (write.kind === `update` || write.kind === `delete`) {
      if (!writePresent || !applyPresent) return false
      if (write.kind === `delete`) writePresent = applyPresent = false
    }
  }
  return true
}
const nestedVariants: ReadonlyArray<Omit<NestedHistory, `sequence`>> = [
  ...([`present-with-metadata`, `present-without-metadata`] as const).flatMap(
    (start) =>
      [false, true].map((nestedSet) => ({
        start,
        nested: `delete` as const,
        nestedSet,
      })),
  ),
  { start: `absent`, nested: `insert`, nestedSet: false },
  { start: `absent`, nested: `insert`, nestedSet: true },
  { start: `absent`, nested: `seed`, nestedSet: false },
]
const nestedHistories: Array<NestedHistory> = nestedVariants.flatMap(
  (variant) => {
    const writePresent = variant.start !== `absent`
    const applyPresent = variant.nested !== `delete`
    const sequences: Array<Array<Write>> = []
    const extend = (sequence: Array<Write>) => {
      if (
        sequence.length > 0 &&
        isNestedLegal(writePresent, applyPresent, sequence)
      )
        sequences.push(sequence)
      if (sequence.length < 3)
        for (const write of nestedCandidates) extend([...sequence, write])
    }
    extend([])
    return sequences.map((sequence) => ({ ...variant, sequence }))
  },
)
/**
 * An insert of the row is a re-insert exactly when the row is present. A
 * delete or a truncate leaves the row absent.
 */
const reclassify = (
  present: boolean,
  sequence: ReadonlyArray<Write>,
): Array<Write> =>
  sequence.map((write) => {
    if (write.kind === `delete` || write.kind === `truncate`) present = false
    if (write.kind !== `insert`) return write
    const kind = present ? `reinsert` : `insert`
    present = true
    return { kind, metadata: write.metadata }
  })
/** The model's expected value: T1's writes fold over the nested write's. */
function expectedNestedMetadata(history: NestedHistory): unknown {
  const metadata = history.nestedSet
    ? nestedSetMetadata
    : history.nested === `delete`
      ? undefined
      : nestedMetadata
  return foldMetadata(
    metadata,
    reclassify(history.nested !== `delete`, history.sequence),
  )
}
const describeNested = ({
  start,
  nested,
  nestedSet,
  sequence,
}: NestedHistory) =>
  `${start}, nested ${nested}${nestedSet ? `+set` : ``}: ${sequence.map(describeWrite).join(`, `)}`

const describeWrite = (write: Write) =>
  write.kind === `set` || write.kind === `unset` || write.kind === `truncate`
    ? write.kind
    : `${write.kind}${write.metadata ? `+metadata` : ``}`

/**
 * The driver writes the history through a real Collection's sync API and reads
 * the result through `metadata.row.get` after the transaction applies. Each
 * lane reaches a different production path for the same rule:
 *
 * - `immediate`: the transaction applies at commit.
 * - `held`: a persisting optimistic request holds the transaction until it
 *   settles. A transaction with a truncate applies at once instead.
 * - `rebuilt`: an earlier held transaction applies while this one is still
 *   open, so the Collection rebuilds this transaction's automatic metadata
 *   writes before it commits.
 */
async function observeMetadata(
  lane: Lane,
  start: Start,
  sequence: ReadonlyArray<Write>,
  id: string,
  earlier: EarlierWrite = { key: 2, kind: `update` },
): Promise<unknown> {
  let sync!: SyncActions
  let release!: () => void
  const collection = createCollection<Row, number>({
    id,
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: (actions) => {
        sync = actions
        actions.begin()
        actions.write({ type: `insert`, value: { id: 2, v: 0 } })
        if (start !== `absent`) {
          actions.write({
            type: `insert`,
            value: { id: 1, v: 0 },
            ...(start === `present-with-metadata`
              ? { metadata: startMetadata }
              : {}),
          })
        }
        actions.commit()
        actions.markReady()
      },
    },
    onUpdate: () => new Promise<void>((resolve) => (release = resolve)),
  })
  try {
    await collection.stateWhenReady()
    const blocker =
      lane === `immediate`
        ? undefined
        : collection.update(2, (draft) => {
            draft.v = 9
          })
    let earlierReceipt: true | Promise<void> = true
    if (lane === `rebuilt`) {
      sync.begin()
      if (earlier.kind === `delete`) sync.write({ type: `delete`, key: 1 })
      else
        sync.write({
          type: earlier.kind,
          value: { id: earlier.key, v: 100 },
        })
      earlierReceipt = sync.commit()
    }
    // A re-insert writes the row exactly as the source holds it.
    let held: number | undefined = start === `absent` ? undefined : 0
    if (lane === `rebuilt` && earlier.key === 1)
      held = earlier.kind === `delete` ? undefined : 100
    sync.begin()
    sequence.forEach((write, step) => {
      const metadata = writeMetadata(step)
      if (write.kind === `insert` || write.kind === `update`) held = step + 1
      else if (write.kind === `delete` || write.kind === `truncate`)
        held = undefined
      if (write.kind === `set`) sync.metadata!.row.set(1, metadata)
      else if (write.kind === `unset`) sync.metadata!.row.delete(1)
      else if (write.kind === `truncate`) sync.truncate()
      else if (write.kind === `delete`)
        sync.write({
          type: `delete`,
          key: 1,
          ...(write.metadata ? { metadata } : {}),
        })
      else if (write.kind === `reinsert`)
        sync.write({
          type: `insert`,
          value: { id: 1, v: held! },
          ...(write.metadata ? { metadata } : {}),
        })
      else
        sync.write({
          type: write.kind,
          value: { id: 1, v: step + 1 },
          ...(write.metadata ? { metadata } : {}),
        })
    })
    if (lane === `rebuilt`) {
      expect(earlierReceipt).not.toBe(true)
      release()
      await blocker!.isPersisted.promise
      await earlierReceipt
    }
    const receipt = sync.commit()
    if (lane === `immediate`) expect(receipt).toBe(true)
    if (lane === `held`) {
      // A truncate applies at once; the request holds every other transaction.
      if (sequence.some((write) => write.kind === `truncate`))
        expect(receipt).toBe(true)
      else expect(receipt).not.toBe(true)
      release()
      await blocker!.isPersisted.promise
    }
    await receipt
    return sync.metadata!.row.get(1)
  } finally {
    await collection.cleanup()
  }
}

/**
 * The nested driver writes T1 through a real Collection's sync API, then
 * applies the nested write and commits both. A seed goes through
 * `DbClient.hydrate`, so that history uses a Collection that a `DbClient`
 * owns. The driver reads `metadata.row.get` after T1 applies.
 */
async function observeNested(
  { start, nested, nestedSet, sequence }: NestedHistory,
  id: string,
): Promise<unknown> {
  let sync!: SyncActions
  const row = { id: 1, v: 0 }
  const config = {
    id,
    getKey: (value: Row) => value.id,
    sync: {
      sync: (actions: SyncActions) => {
        sync = actions
        actions.begin()
        if (start !== `absent`)
          actions.write({
            type: `insert`,
            value: row,
            ...(start === `present-with-metadata`
              ? { metadata: startMetadata }
              : {}),
          })
        actions.commit()
        actions.markReady()
      },
    },
  }
  const client = new DbClient()
  const collection =
    nested === `seed`
      ? client.collection(collectionOptions<Row, number>(config))
      : createCollection<Row, number>({ ...config, startSync: true })
  try {
    await collection.stateWhenReady()
    sync.begin()
    sequence.forEach((write, step) => {
      const metadata = writeMetadata(step)
      if (write.kind === `set`) sync.metadata!.row.set(1, metadata)
      else if (write.kind === `unset`) sync.metadata!.row.delete(1)
      else if (write.kind === `truncate`) sync.truncate()
      else if (write.kind === `delete`)
        sync.write({
          type: `delete`,
          key: 1,
          ...(write.metadata ? { metadata } : {}),
        })
      else
        sync.write({
          type: write.kind === `update` ? `update` : `insert`,
          value: row,
          ...(write.metadata ? { metadata } : {}),
        })
    })
    let nestedReceipt: true | Promise<void> = true
    if (nested === `seed`)
      client.hydrate({
        collections: [
          {
            collectionId: id,
            rows: [{ key: 1, value: row, metadata: nestedMetadata }],
          },
        ],
      })
    else {
      sync.begin()
      if (nested === `delete`) sync.write({ type: `delete`, key: 1 })
      else sync.write({ type: `insert`, value: row, metadata: nestedMetadata })
      if (nestedSet) sync.metadata!.row.set(1, nestedSetMetadata)
      nestedReceipt = sync.commit()
    }
    const receipt = sync.commit()
    await nestedReceipt
    await receipt
    return sync.metadata!.row.get(1)
  } finally {
    await collection.cleanup()
  }
}

describe(`row metadata composition oracle`, () => {
  it(`enumerates every legal one-key history of up to three writes`, () => {
    expect(histories).toHaveLength(1457)
    const labels = new Set(
      histories.map(
        ({ start, sequence }) =>
          `${start}: ${sequence.map(describeWrite).join(`, `)}`,
      ),
    )
    expect(labels.size).toBe(histories.length)
    // Named witnesses for each write rule must remain in the grammar.
    for (const witness of [
      `present-with-metadata: delete+metadata`,
      `absent: set, insert`,
      `absent: insert+metadata, set`,
      `present-with-metadata: update`,
      `present-without-metadata: delete, set`,
      `present-with-metadata: reinsert`,
      `absent: insert+metadata, reinsert`,
    ])
      expect(labels).toContain(witness)
    expect(labels).not.toContain(`absent: update`)
    expect(labels).not.toContain(`absent: reinsert`)
    expect(labels).not.toContain(`present-with-metadata: insert`)
  })

  it(`rejects named wrong answers in the model`, () => {
    // A delete that carried metadata keeps none.
    expect(
      expectedMetadata(`present-with-metadata`, [
        { kind: `delete`, metadata: true },
      ]),
    ).toBeUndefined()
    // A later insert without metadata clears an explicit set.
    expect(
      expectedMetadata(`absent`, [
        { kind: `set` },
        { kind: `insert`, metadata: false },
      ]),
    ).toBeUndefined()
    // An equal re-insert without metadata keeps the current value.
    expect(
      expectedMetadata(`present-with-metadata`, [
        { kind: `reinsert`, metadata: false },
      ]),
    ).toEqual(startMetadata)
    // An update without metadata keeps the current value.
    expect(
      expectedMetadata(`present-with-metadata`, [
        { kind: `update`, metadata: false },
      ]),
    ).toEqual(startMetadata)
  })

  it(`enumerates rebuilt histories against every earlier write`, () => {
    // 1457 after a key-2 update, plus 310 after a key-1 write.
    expect(rebuiltHistories).toHaveLength(1767)
    expect(
      rebuiltHistories.some(
        ({ earlier, sequence }) =>
          earlier.key === 1 &&
          earlier.kind === `delete` &&
          sequence[0]?.kind === `insert`,
      ),
    ).toBe(true)
  })

  it(`enumerates nested histories for every nested write`, () => {
    const labels = new Set(nestedHistories.map(describeNested))
    // 275 sequences for each of the seven nested variants.
    expect(nestedHistories).toHaveLength(1925)
    expect(labels.size).toBe(nestedHistories.length)
    // Each variant must keep the writes that reclassify or reorder positions.
    for (const witness of [
      `present-with-metadata, nested delete: set, insert`,
      `absent, nested insert: set, insert`,
      `absent, nested seed: set, insert`,
      `absent, nested insert+set: insert+metadata`,
      `present-without-metadata, nested delete: insert, set, delete`,
      `absent, nested insert: set, truncate, insert`,
      `absent, nested seed: insert, update, set`,
    ])
      expect(labels).toContain(witness)
    // An update needs the row present where T1 writes it and where it applies.
    expect(labels).not.toContain(`absent, nested insert: update`)
    expect(labels).not.toContain(`present-with-metadata, nested delete: update`)
    // A set, then an insert that is now an insert: the insert clears it.
    expect(
      expectedNestedMetadata({
        start: `present-with-metadata`,
        nested: `delete`,
        nestedSet: false,
        sequence: [{ kind: `set` }, { kind: `insert`, metadata: false }],
      }),
    ).toBeUndefined()
    // A set, then an insert that is now an equal re-insert: the set holds.
    expect(
      expectedNestedMetadata({
        start: `absent`,
        nested: `seed`,
        nestedSet: false,
        sequence: [{ kind: `set` }, { kind: `insert`, metadata: false }],
      }),
    ).toEqual(writeMetadata(0))
    // T1 applies after the nested set, so T1's later write wins.
    expect(
      expectedNestedMetadata({
        start: `absent`,
        nested: `insert`,
        nestedSet: true,
        sequence: [{ kind: `insert`, metadata: true }],
      }),
    ).toEqual(writeMetadata(0))
  })

  it(
    `matches last-write-wins metadata after a nested write`,
    { timeout: 120_000 },
    async () => {
      const mismatches: Array<string> = []
      for (const [index, history] of nestedHistories.entries()) {
        const label = describeNested(history)
        let actual: unknown
        try {
          actual = await observeNested(
            history,
            `row-metadata-composition-nested-${index}`,
          )
        } catch (error) {
          mismatches.push(`${label} threw ${String(error)}`)
          continue
        }
        const expected = expectedNestedMetadata(history)
        if (JSON.stringify(actual) !== JSON.stringify(expected))
          mismatches.push(
            `${label} read ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
          )
      }
      expect(mismatches).toEqual([])
    },
  )

  it.each([`immediate`, `held`, `rebuilt`] as const)(
    `matches last-write-wins metadata on the %s path`,
    { timeout: 120_000 },
    async (lane) => {
      const cases =
        lane === `rebuilt`
          ? rebuiltHistories
          : histories.map((history) => ({ ...history, earlier: undefined }))
      const mismatches: Array<string> = []
      for (const [index, { start, sequence, earlier }] of cases.entries()) {
        const label = `${start}${earlier ? ` after ${earlier.kind} ${earlier.key}` : ``}: ${sequence.map(describeWrite).join(`, `)}`
        let actual: unknown
        try {
          actual = await observeMetadata(
            lane,
            start,
            sequence,
            `row-metadata-composition-${lane}-${index}`,
            earlier,
          )
        } catch (error) {
          mismatches.push(`${label} threw ${String(error)}`)
          continue
        }
        const expected =
          earlier?.key === 1
            ? foldMetadata(
                expectedMetadata(start, [asWrite(earlier)]),
                sequence,
              )
            : expectedMetadata(start, sequence)
        if (JSON.stringify(actual) !== JSON.stringify(expected))
          mismatches.push(
            `${label} read ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
          )
      }
      expect(mismatches).toEqual([])
    },
  )
})
