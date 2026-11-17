/**
 * The model and bounded grammar of the SQLite typed-value oracle in
 * sqlite-temporal-value-oracle.test.ts: the four value kinds, two fixture
 * ordinals, the literal type/text records that the model expects, the complete
 * public rows after each history, and the 16 kind, history, and index cells.
 * Owns nothing: the oracle test drives production with them, and
 * sqlite-temporal-value-calibration.test.ts calibrates the comparison.
 */
import { Temporal } from 'temporal-polyfill'

export type Kind = `Date` | `ISO string` | `Instant` | `PlainDate`
export type Ordinal = 0 | 1
export type History = `insert` | `update`
export const kinds: Array<Kind> = [`Date`, `ISO string`, `Instant`, `PlainDate`]
export const histories: Array<History> = [`insert`, `update`]
export const keys = [`z-early`, `a-late`] as const

export function textFor(kind: Kind, ordinal: Ordinal): string {
  const day = ordinal === 0 ? `2026-01-02` : `2026-01-03`
  return kind === `PlainDate`
    ? day
    : `${day}T00:00:00${kind === `Instant` ? `` : `.000`}Z`
}

export function inputValue(kind: Kind, ordinal: Ordinal): unknown {
  const text = textFor(kind, ordinal)
  switch (kind) {
    case `Date`:
      return new Date(text)
    case `ISO string`:
      return text
    case `Instant`:
      return Temporal.Instant.from(text)
    case `PlainDate`:
      return Temporal.PlainDate.from(text)
  }
}

export function expectedValue(kind: Kind, ordinal: Ordinal): unknown {
  const text = textFor(kind, ordinal)
  return kind === `ISO string` ? text : { kind, text }
}

export function payload(value: unknown): Record<string, unknown> {
  return { stamp: value, nested: { dates: [value] } }
}

// Recompute the complete public result from fixture ordinals. This model does
// not read the driver's transaction or persisted bytes to derive expectations.
export function expectedRows(kind: Kind, history: History) {
  return [
    {
      key: `metadata-only`,
      value: { id: `metadata-only` },
      metadata: payload(expectedValue(kind, 1)),
    },
    ...keys.map((key, index) => {
      const ordinal = (history === `insert` ? index : 1 - index) as Ordinal
      const value = payload(expectedValue(kind, ordinal))
      return { key, value: { id: key, ...value }, metadata: value }
    }),
  ].sort((a, b) => a.key.localeCompare(b.key))
}

export const cases = kinds.flatMap((kind) =>
  histories.flatMap((history) =>
    [false, true].map((indexed) => ({ kind, history, indexed })),
  ),
)
