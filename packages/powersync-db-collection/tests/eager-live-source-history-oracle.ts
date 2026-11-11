/**
 * PowerSync constructions preserve its twelve-step grammar and all original
 * fields. A failed initial gate and restart precede typed initial/live rows.
 * Generated coordinates and suffixes remain random; the shared model owns
 * expected row truth. Every invocation returns fresh rows and arrays.
 */
import { describeValue } from '../../db-adapter-conformance/src'
import type {
  ConformanceRow,
  EagerLiveSourceHistory,
} from '../../db-adapter-conformance/src'

export function constructPowerSyncEagerHistory(
  generated: EagerLiveSourceHistory,
  salt: number,
): EagerLiveSourceHistory {
  let hash = salt + 1
  for (const char of describeValue(generated))
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
  const row = (index: number, note: boolean): ConformanceRow => ({
    id: ((hash + index) % 5) + 1,
    title: ([`a`, `b`, `c`] as const)[(hash + index) % 3]!,
    ...(note ? { note: hash % 2 ? `x` : `y` } : {}),
    typed: {
      string: [``, `plain`, `two\nlines`, `ünïcødé ✓`][(hash + index) % 4]!,
      integer: [0, -7, 2 ** 31][(hash + index) % 3]!,
      float: [0.5, -1.25, 1e-7][(hash + index) % 3]!,
      boolean: (hash + index) % 2 === 0,
      date: new Date(
        [0, Date.UTC(2026, 9, 29, 12, 34, 56, 789), -86400000][
          (hash + index) % 3
        ]!,
      ),
    },
  })
  return [
    { kind: `fail` },
    { kind: `restart` },
    { kind: `snapshot`, rows: [row(0, true)] },
    {
      kind: `changes`,
      changes: [
        { type: `upsert`, row: row(0, false) },
        { type: `upsert`, row: row(1, false) },
      ],
    },
    ...structuredClone(generated.slice(0, 8)),
  ]
}
