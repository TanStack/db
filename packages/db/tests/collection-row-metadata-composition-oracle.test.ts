import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
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
 * production paths. When a rebuild changes an insert into an equal re-insert,
 * or the reverse, the rule follows the write that applies. The model judges the
 * reclassified sequence. It does not judge collection metadata, metadata-only
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
type Lane = `immediate` | `held` | `rebuilt` | `nested`

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
 * The nested lane opens a transaction, and a second transaction begun inside
 * it writes key 1 and commits first. The open transaction applies after that
 * write, so the Collection reclassifies each of its inserts of the row: an
 * insert of a present key is an equal re-insert, and a re-insert of an absent
 * key is an insert. Both directions occur:
 *
 * - From a present row, the nested transaction deletes it. The first
 *   re-insert becomes an insert.
 * - From an absent row, the nested transaction inserts the same row with its
 *   own metadata. The first insert becomes a re-insert.
 *
 * Every insert in this lane writes the same row value, so a reclassified
 * insert is never a duplicate. Writes stay among those that remain legal
 * after the nested write, up to three.
 */
const nestedMetadata = { m: `nested` }
const nestedHistories = starts.flatMap((start) => {
  const candidates: ReadonlyArray<Write> = [
    { kind: `set` },
    { kind: `unset` },
    ...(start === `absent`
      ? ([`insert`, `reinsert`] as const)
      : ([`reinsert`] as const)
    ).flatMap((kind) => [false, true].map((metadata) => ({ kind, metadata }))),
  ]
  const sequences: Array<Array<Write>> = []
  const extend = (sequence: Array<Write>) => {
    if (sequence.length > 0 && isLegal(start, sequence))
      sequences.push(sequence)
    if (sequence.length < 3)
      for (const write of candidates) extend([...sequence, write])
  }
  extend([])
  return sequences.map((sequence) => ({ start, sequence }))
})
/** An insert of the row is a re-insert exactly when the row is present. */
const reclassify = (
  present: boolean,
  sequence: ReadonlyArray<Write>,
): Array<Write> =>
  sequence.map((write) => {
    if (write.kind !== `insert` && write.kind !== `reinsert`) return write
    const kind = present ? `reinsert` : `insert`
    present = true
    return { kind, metadata: write.metadata }
  })
/** The value that the nested write leaves, and the row's presence after it. */
const afterNestedWrite = (start: Start) =>
  start === `absent`
    ? { present: true, metadata: nestedMetadata }
    : { present: false, metadata: undefined }

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
 * - `nested`: a later transaction begun inside this one deletes the row and
 *   applies first, so the Collection reclassifies this transaction's
 *   re-inserts and rebuilds its automatic metadata writes.
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
      lane === `immediate` || lane === `nested`
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
      // The nested lane inserts one row value, so an insert can become an
      // equal re-insert.
      const value = lane === `nested` ? 0 : step + 1
      if (write.kind === `insert` || write.kind === `update`) held = value
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
          value: { id: 1, v: value },
          ...(write.metadata ? { metadata } : {}),
        })
    })
    if (lane === `nested`) {
      sync.begin()
      if (start === `absent`)
        sync.write({
          type: `insert`,
          value: { id: 1, v: 0 },
          metadata: nestedMetadata,
        })
      else sync.write({ type: `delete`, key: 1 })
      earlierReceipt = sync.commit()
    }
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
    await earlierReceipt
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

  it(`enumerates nested histories in both reclassification directions`, () => {
    // 84 sequences from each start.
    expect(nestedHistories).toHaveLength(252)
    const after = (start: Start, sequence: ReadonlyArray<Write>) => {
      const { present, metadata } = afterNestedWrite(start)
      return foldMetadata(metadata, reclassify(present, sequence))
    }
    // A set, then a re-insert that becomes an insert: the insert clears it.
    expect(
      after(`present-with-metadata`, [
        { kind: `set` },
        { kind: `reinsert`, metadata: false },
      ]),
    ).toBeUndefined()
    // An insert that becomes a re-insert keeps the nested metadata.
    expect(after(`absent`, [{ kind: `insert`, metadata: false }])).toEqual(
      nestedMetadata,
    )
  })

  it(
    `matches last-write-wins metadata on the nested path`,
    { timeout: 120_000 },
    async () => {
      const mismatches: Array<string> = []
      for (const [index, { start, sequence }] of nestedHistories.entries()) {
        const label = `${start}: ${sequence.map(describeWrite).join(`, `)}`
        let actual: unknown
        try {
          actual = await observeMetadata(
            `nested`,
            start,
            sequence,
            `row-metadata-composition-nested-${index}`,
          )
        } catch (error) {
          mismatches.push(`${label} threw ${String(error)}`)
          continue
        }
        const { present, metadata } = afterNestedWrite(start)
        const expected = foldMetadata(metadata, reclassify(present, sequence))
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
