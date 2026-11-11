/**
 * RxDB constructions retain its three startup batches plus twelve-step
 * grammar. Three updates to one key straddle read point two: one read batch
 * supersedes the first, and a later batch removes the optional field. Two
 * loads and three live batches cover all seven JSON value kinds. The shared
 * model still judges every original checkpoint; this code constructs inputs.
 */
import { describeValue, jsonValueKinds } from '../../db-adapter-conformance/src'
import type {
  ConformanceRow,
  EagerLiveSourceHistory,
} from '../../db-adapter-conformance/src'

const examples = [
  [``, `plain`, `two\nlines`, `ünïcødé ✓`],
  [0, -7, 2 ** 31, Number.MAX_SAFE_INTEGER],
  [0.5, -1.25, 1e-7],
  [true, false],
  [null],
  [[], [0, `a`, null], [[1], [true]]],
  [{}, { a: 0, b: `x` }, { nested: { deep: [1, { k: null }] } }, { '': false }],
] as const
export function constructRxdbEagerHistory(
  generated: EagerLiveSourceHistory,
  salt: number,
): EagerLiveSourceHistory {
  let hash = salt + 1
  for (const char of describeValue(generated))
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
  const kinds = jsonValueKinds.map(
    (_, index) => (index + salt) % jsonValueKinds.length,
  )
  const row = (kind: number, index: number, note: boolean): ConformanceRow => ({
    id: ((hash + index) % 5) + 1,
    title: ([`a`, `b`, `c`] as const)[(hash + index) % 3]!,
    ...(note ? { note: hash % 2 ? `x` : `y` } : {}),
    value: structuredClone(
      examples[kind]![(hash + index) % examples[kind]!.length],
    ),
  })
  const first = row(kinds[0]!, 0, true)
  const firstUpdate = {
    ...first,
    title: ([`a`, `b`, `c`] as const)[(hash + 1) % 3]!,
  }
  const secondUpdate = {
    ...first,
    title: ([`a`, `b`, `c`] as const)[(hash + 2) % 3]!,
  }
  const thirdUpdate = { ...row(kinds[0]!, 0, false) }
  const changes = kinds.map((kind, index) => ({
    type: `upsert` as const,
    row: row(kind, index, false),
  }))
  return [
    { kind: `changes`, changes: [{ type: `upsert`, row: firstUpdate }] },
    { kind: `changes`, changes: [{ type: `upsert`, row: secondUpdate }] },
    { kind: `changes`, changes: [{ type: `upsert`, row: thirdUpdate }] },
    {
      kind: `snapshot`,
      rows: kinds.slice(0, 4).map((kind, index) => row(kind, index, true)),
      seen: 2,
    },
    { kind: `fail` },
    { kind: `restart` },
    { kind: `fail` },
    { kind: `restart` },
    {
      kind: `snapshot`,
      rows: kinds.slice(4).map((kind, index) => row(kind, index, true)),
      seen: 0,
    },
    { kind: `changes`, changes: changes.slice(0, 3) },
    { kind: `changes`, changes: changes.slice(3, 6) },
    { kind: `changes`, changes: changes.slice(6) },
    ...structuredClone(generated.slice(0, 3)),
  ]
}
