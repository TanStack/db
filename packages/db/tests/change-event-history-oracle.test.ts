import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/index'
import { localOnlyCollectionOptions } from '../src/local-only'
import type { LocalOnlyCollectionUtils } from '../src/local-only'
import type { Collection } from '../src/index'

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
 * Every sequence of insert/update/delete on a single key that the collection
 * actually permits, up to `maxLength` operations - the cartesian product of
 * {insert, update, delete}^maxLength filtered to valid paths through the
 * collection's own state machine (insert only while absent; update/delete
 * only while present).
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

describe(`change-event history oracle`, () => {
  // Cartesian product of every generated sequence with each execution mode:
  // "batched" issues every op in the same tick (where same-tick delete/
  // re-insert races can desync change events from state); "sequential"
  // awaits each op before the next, as a control that should always agree.
  const cases = generateSequences(4).flatMap((sequence, index) =>
    ([`batched`, `sequential`] as const).map((mode) => ({
      mode,
      sequence,
      label: describeSequence(sequence),
      expected: expectedNameAfter(sequence),
      id: `history-oracle-${mode}-${index}`,
    })),
  )

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

      // Rebuilds collection state purely from emitted change events, the
      // same way a derived cache or index would.
      const mirror = new Map<number, string>()
      const subscription = collection.subscribeChanges((changes) => {
        for (const change of changes) {
          if (change.type === `delete`) mirror.delete(change.key)
          else mirror.set(change.key, change.value.name)
        }
      })

      if (mode === `batched`) {
        await Promise.all(
          sequence.map((op) => applyOp(collection, op)).map(settle),
        )
      } else {
        for (const op of sequence) await settle(applyOp(collection, op))
      }

      expect(collection.get(1)?.name).toBe(expected)
      expect(mirror.get(1)).toBe(expected)

      subscription.unsubscribe()
    },
  )
})
