import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/index'
import { localOnlyCollectionOptions } from '../src/local-only'
import type { LocalOnlyCollectionUtils } from '../src/local-only'
import type { Collection } from '../src/index'

/**
 * # Do settled change messages reconstruct the Collection's public rows?
 *
 * The public change-message contract and issue #1901 require a consumer that
 * applies every delivered insert, update, and delete to agree with the
 * Collection after the corresponding optimistic transactions persist.
 *
 * A one-key optional value is the independent reference model. Its legal
 * history grammar inserts only while absent and updates or deletes only while
 * present. Bounded enumeration covers every such history of length one through
 * four from an absent row. The production driver applies each history through
 * a local-only Collection, either in one same-turn batch or sequentially. At
 * the applied-settlement checkpoint, both the public row and a change-message
 * mirror must equal the reference value.
 *
 * This partial oracle does not cover an initially present row, multiple keys,
 * failed persistence, sync-transaction cancellation, callback batch shape, or
 * intermediate publication. The collection-state retention oracle owns queued
 * source admission and cancellation histories.
 */

interface TestItem extends Record<string, unknown> {
  id: number
  name: string
}

type OpKind = `insert` | `update` | `delete`

interface Op {
  kind: OpKind
  step: number
}

const nextKinds = (present: boolean): Array<OpKind> =>
  present ? [`update`, `delete`] : [`insert`]

/**
 * Every sequence the one-key presence model permits up to `maxLength`:
 * insert only while absent, and update or delete only while present.
 */
function generateSequences(
  maxLength: number,
  sequence: Array<Op> = [],
  present = false,
): Array<Array<Op>> {
  return nextKinds(present).flatMap((kind) => {
    const next = [...sequence, { kind, step: sequence.length + 1 }]
    const rest =
      next.length < maxLength
        ? generateSequences(maxLength, next, kind !== `delete`)
        : []
    return [next, ...rest]
  })
}

const describeSequence = (sequence: Array<Op>): string =>
  sequence.map((op) => `${op.kind}(${op.step})`).join(` -> `)

const expectedNameAfter = (sequence: Array<Op>): string | undefined =>
  sequence.reduce<string | undefined>(
    (_name, op) => (op.kind === `delete` ? undefined : `v${op.step}`),
    undefined,
  )

function applyOp(
  collection: Collection<TestItem, number, LocalOnlyCollectionUtils>,
  op: Op,
): { isPersisted: { promise: Promise<unknown> } } {
  switch (op.kind) {
    case `insert`:
      return collection.insert({ id: 1, name: `v${op.step}` })
    case `update`:
      return collection.update(1, (draft) => {
        draft.name = `v${op.step}`
      })
    case `delete`:
      return collection.delete(1)
  }
}

const settle = (tx: { isPersisted: { promise: Promise<unknown> } }) =>
  tx.isPersisted.promise

function assertFinalAgreement(
  collectionValue: string | undefined,
  mirrorValue: string | undefined,
  expected: string | undefined,
): void {
  expect(collectionValue).toBe(expected)
  expect(mirrorValue).toBe(expected)
}

describe(`change-event history oracle`, () => {
  const cases = generateSequences(4).flatMap((sequence, index) =>
    ([`batched`, `sequential`] as const).map((mode) => ({
      mode,
      sequence,
      label: describeSequence(sequence),
      expected: expectedNameAfter(sequence),
      id: `history-oracle-${mode}-${index}`,
    })),
  )

  it(`reaches the delete-reinsert witness and rejects a dropped reinsertion`, () => {
    const witness: Array<Op> = [
      { kind: `insert`, step: 1 },
      { kind: `delete`, step: 2 },
      { kind: `insert`, step: 3 },
    ]
    expect(generateSequences(4)).toContainEqual(witness)
    expect(cases).toHaveLength(22)
    expect(() => assertFinalAgreement(`v3`, undefined, `v3`)).toThrow()
  })

  it.each(cases)(
    `$mode: change history matches final state for $label`,
    async ({ mode, sequence, expected, id }) => {
      const collection = createCollection<
        TestItem,
        number,
        LocalOnlyCollectionUtils
      >(
        localOnlyCollectionOptions({
          id,
          getKey: (item: TestItem) => item.id,
        }),
      )

      const mirror = new Map<number, string>()
      const subscription = collection.subscribeChanges((changes) => {
        for (const change of changes) {
          if (change.type === `delete`) mirror.delete(change.key)
          else mirror.set(change.key, change.value.name)
        }
      })

      try {
        if (mode === `batched`) {
          await Promise.all(
            sequence.map((op) => applyOp(collection, op)).map(settle),
          )
        } else {
          for (const op of sequence) await settle(applyOp(collection, op))
        }

        assertFinalAgreement(collection.get(1)?.name, mirror.get(1), expected)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )
})
