import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import type { SyncConfig } from '../src/types.js'

/**
 * # Which row metadata survives one sync transaction?
 *
 * A sync source writes row metadata two ways inside one transaction: through
 * `metadata.row.set` and `metadata.row.delete`, and through the `metadata`
 * field of a row message. The established contract is last write wins, as
 * `collection.test.ts` pins in "should use last-write-wins for row metadata in
 * sync transactions". A row message that omits `metadata` still writes:
 *
 * - an insert names the row's whole metadata, so it clears any earlier value;
 * - an update without metadata leaves the current value;
 * - a row delete removes the metadata, even when the message carries some.
 *
 * This oracle covers one key, one transaction of up to three writes, and three
 * production paths. It does not judge collection metadata, metadata-only
 * publication batches, or other keys. The collection-metadata publication
 * oracle owns those.
 */

type Row = { id: number; v: number }
type SyncActions = Parameters<SyncConfig<Row, number>[`sync`]>[0]
type Write =
  | { kind: `set` }
  | { kind: `unset` }
  | { kind: `insert` | `update` | `delete`; metadata: boolean }
type Start = `absent` | `present-with-metadata` | `present-without-metadata`
type Lane = `immediate` | `held` | `rebuilt`

const writes: ReadonlyArray<Write> = [
  { kind: `set` },
  { kind: `unset` },
  ...([`insert`, `update`, `delete`] as const).flatMap((kind) =>
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
  let current: unknown =
    start === `present-with-metadata` ? startMetadata : undefined
  sequence.forEach((write, step) => {
    if (write.kind === `set`) current = writeMetadata(step)
    else if (write.kind === `unset` || write.kind === `delete`)
      current = undefined
    else if (write.metadata) current = writeMetadata(step)
    else if (write.kind === `insert`) current = undefined
  })
  return current
}

/**
 * Legal histories follow the change-message protocol for the row: an insert
 * names an absent key, and an update or delete names a present one. Metadata
 * API calls are legal in any row state.
 */
function isLegal(start: Start, sequence: ReadonlyArray<Write>): boolean {
  let present = start !== `absent`
  for (const write of sequence) {
    if (write.kind === `insert`) {
      if (present) return false
      present = true
    } else if (write.kind === `update` || write.kind === `delete`) {
      if (!present) return false
      present = write.kind === `update`
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

const describeWrite = (write: Write) =>
  write.kind === `set` || write.kind === `unset`
    ? write.kind
    : `${write.kind}${write.metadata ? `+metadata` : ``}`

/**
 * The driver writes the history through a real Collection's sync API and reads
 * the result through `metadata.row.get` after the transaction applies. Each
 * lane reaches a different production path for the same rule:
 *
 * - `immediate`: the transaction applies at commit.
 * - `held`: a persisting optimistic request holds the transaction until it
 *   settles.
 * - `rebuilt`: an earlier held transaction applies while this one is still
 *   open, so the Collection rebuilds this transaction's automatic metadata
 *   writes before it commits.
 */
async function observeMetadata(
  lane: Lane,
  start: Start,
  sequence: ReadonlyArray<Write>,
  id: string,
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
    let earlier: true | Promise<void> = true
    if (lane === `rebuilt`) {
      sync.begin()
      sync.write({ type: `update`, value: { id: 2, v: 1 } })
      earlier = sync.commit()
    }
    sync.begin()
    sequence.forEach((write, step) => {
      const metadata = writeMetadata(step)
      if (write.kind === `set`) sync.metadata!.row.set(1, metadata)
      else if (write.kind === `unset`) sync.metadata!.row.delete(1)
      else if (write.kind === `delete`)
        sync.write({
          type: `delete`,
          key: 1,
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
      expect(earlier).not.toBe(true)
      release()
      await blocker!.isPersisted.promise
      await earlier
    }
    const receipt = sync.commit()
    if (lane === `held`) {
      expect(receipt).not.toBe(true)
      release()
      await blocker!.isPersisted.promise
    }
    await receipt
    return sync.metadata!.row.get(1)
  } finally {
    await collection.cleanup()
  }
}

describe(`row metadata composition oracle`, () => {
  it(`enumerates every legal one-key history of up to three writes`, () => {
    expect(histories).toHaveLength(540)
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
    ])
      expect(labels).toContain(witness)
    expect(labels).not.toContain(`absent: update`)
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
    // An update without metadata keeps the current value.
    expect(
      expectedMetadata(`present-with-metadata`, [
        { kind: `update`, metadata: false },
      ]),
    ).toEqual(startMetadata)
  })

  it.each([`immediate`, `held`, `rebuilt`] as const)(
    `matches last-write-wins metadata on the %s path`,
    async (lane) => {
      const mismatches: Array<string> = []
      for (const [index, { start, sequence }] of histories.entries()) {
        const actual = await observeMetadata(
          lane,
          start,
          sequence,
          `row-metadata-composition-${lane}-${index}`,
        )
        const expected = expectedMetadata(start, sequence)
        if (JSON.stringify(actual) !== JSON.stringify(expected))
          mismatches.push(
            `${start}: ${sequence.map(describeWrite).join(`, `)} read ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
          )
      }
      expect(mismatches).toEqual([])
    },
  )
})
