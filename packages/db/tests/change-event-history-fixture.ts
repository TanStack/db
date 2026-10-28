// Shared history grammar for the change-event history oracle and its
// ordinary grammar-coverage test. The oracle owns the mirror law; this module
// only enumerates the legal histories that the law runs.

export interface TestItem extends Record<string, unknown> {
  id: number
  name: string
  fileId: `f1` | `f2`
}

export type OpKind = `insert` | `update` | `delete`

export type Key = 1 | 2 | 3 | 4

export const fileIdForKey = (key: number): TestItem[`fileId`] =>
  key % 2 === 1 ? `f1` : `f2`

export interface Op {
  kind: OpKind
  key: Key
  step: number
}

/**
 * Every sequence the keyed-presence model permits up to `maxLength`.
 */
export function generateSequences(
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

export const describeSequence = (sequence: ReadonlyArray<Op>): string =>
  sequence.map((op) => `${op.kind}(${op.key},${op.step})`).join(` -> `)
export function mirrorRows(
  mirror: ReadonlyMap<number, TestItem>,
): Array<readonly [number, TestItem]> {
  return [...mirror]
    .map(
      ([key, row]) =>
        [key, { id: row.id, name: row.name, fileId: row.fileId }] as const,
    )
    .sort(([left], [right]) => left - right)
}

export const replacement: ReadonlyArray<Op> = [
  { kind: `delete`, key: 1, step: 1 },
  { kind: `delete`, key: 2, step: 2 },
  { kind: `insert`, key: 1, step: 3 },
  { kind: `insert`, key: 2, step: 4 },
]
export const oneKeyCases = generateSequences(4, [1]).flatMap(
  (sequence, index) =>
    ([`batched`, `sequential`] as const).map((mode) => ({
      mode,
      sequence,
      initialKeys: [] as ReadonlyArray<Key>,
      label: describeSequence(sequence),
      id: `one-key-${mode}-${index}`,
    })),
)
export const initialPresence: ReadonlyArray<ReadonlyArray<Key>> = [
  [],
  [1],
  [2],
  [1, 2],
]
export const twoKeyCases = initialPresence.flatMap(
  (initialKeys, initialIndex) =>
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
export const cases = [...oneKeyCases, ...twoKeyCases]
