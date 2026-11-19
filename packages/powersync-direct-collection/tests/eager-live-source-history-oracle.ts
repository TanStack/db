/**
 * Direct PowerSync constructions reach every state its declarations allow:
 * a failed initial gate and restart, then two sync runs whose complete
 * deliveries and live batches together carry all seven JSON value kinds on
 * both paths. A held row loses its note in the first batch. Two outages
 * follow live batches in a later run; the first has a repeated attempt, and
 * a batch ends each one. Generated coordinates choose keys, titles and
 * values, and a random generated suffix follows. The shared model owns
 * expected row truth. Every invocation returns fresh rows and arrays.
 */
import { describeValue, jsonValueKinds } from '../../db-adapter-conformance/src'
import type {
  ConformanceRow,
  EagerLiveSourceHistory,
} from '../../db-adapter-conformance/src'

// One list of examples per entry of `jsonValueKinds`, in its order; each is
// one of the grammar's own examples for that kind.
const examples = [
  [``, `plain`, `two\nlines`, `ünïcødé ✓`],
  [0, -7, 2 ** 31],
  [0.5, -1.25, 1e-7],
  [true, false],
  [null],
  [[], [0, `a`, null], [[1], [true]]],
  [{}, { a: 0, b: `x` }, { nested: { deep: [1, { k: null }] } }],
] as const

export function constructDirectEagerHistory(
  generated: EagerLiveSourceHistory,
  salt: number,
): EagerLiveSourceHistory {
  let hash = salt + 1
  for (const char of describeValue(generated))
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
  const kinds = jsonValueKinds.map(
    (_, index) => (index + salt) % jsonValueKinds.length,
  )
  // Indexes below five give distinct keys within one delivery or batch.
  const row = (kind: number, index: number, note: boolean): ConformanceRow => ({
    id: ((hash + index) % 5) + 1,
    title: ([`a`, `b`, `c`] as const)[(hash + index) % 3]!,
    ...(note ? { note: hash % 2 ? `x` : `y` } : {}),
    value: structuredClone(
      examples[kind]![(hash + index) % examples[kind]!.length],
    ),
  })
  const upserts = (from: number, to: number, note: boolean) =>
    kinds.slice(from, to).map((kind, index) => ({
      type: `upsert` as const,
      row: row(kind, index, note),
    }))
  // Eight grammar elements; the recurring outage (two attempts, a batch, one
  // attempt) is one. A suffix of at most four steps keeps the history within
  // the grammar's twelve elements.
  return [
    { kind: `fail` },
    { kind: `restart` },
    {
      kind: `snapshot`,
      rows: kinds.slice(0, 4).map((kind, index) => row(kind, index, true)),
    },
    // Row 0 is held with a note; this batch removes it.
    { kind: `changes`, changes: upserts(0, 3, false) },
    { kind: `transient-failure`, variant: 0 },
    { kind: `transient-failure`, variant: 0 },
    { kind: `changes`, changes: upserts(3, 6, true) },
    { kind: `transient-failure`, variant: 0 },
    { kind: `changes`, changes: upserts(6, 7, true) },
    { kind: `restart` },
    {
      kind: `snapshot`,
      rows: kinds.slice(4).map((kind, index) => row(kind, index, true)),
    },
    ...structuredClone(generated.slice(0, 4)),
  ]
}
