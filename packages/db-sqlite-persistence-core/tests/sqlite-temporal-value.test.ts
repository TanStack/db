// @vitest-environment node
/**
 * Scenario checks for native Temporal values in the SQLite core adapter: IN
 * membership against lookalike string keys, and the native literal encoding
 * budget. `sqlite-temporal-value-oracle.test.ts` owns the typed-value law and its
 * grammar; these tests pin single cases with hand-written expectations.
 */
import { IR } from '@tanstack/db'
import { Temporal } from 'temporal-polyfill'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { collectionId, scope } from './sqlite-temporal-value-support'

beforeEach(() => vi.stubGlobal(`Temporal`, Temporal))
afterEach(() => vi.unstubAllGlobals())
afterEach(scope.cleanup)

// Equality is a pair relation: separate IN sets for order and identity can
// accidentally combine matches from different ordinary string literals.
it(`keeps native IN membership distinct from lookalike string keys`, async () => {
  const { adapter } = scope.create().open()
  const orderText = `10000000000000000000000`
  const identityText = `Temporal.Instant:1970-01-01T00:00:00Z`
  const values = [
    Temporal.Instant.from(`1970-01-01T00:00:00Z`),
    orderText,
    identityText,
  ]
  await adapter.applyCommittedTx(
    { kind: `eager`, collectionId: collectionId },
    {
      txId: `mixed`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: values.map((stamp, i) => ({
        type: `insert`,
        key: `row-${i}`,
        value: { stamp },
      })),
    },
  )
  const predicate = new IR.Func<boolean>(`in`, [
    new IR.PropRef([`stamp`]),
    new IR.Value([orderText, identityText]),
  ])
  expect(
    (
      await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        { where: predicate },
      )
    )
      .map((row) => row.key)
      .sort(),
  ).toEqual([`row-1`, `row-2`])
  expect(
    (
      await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {
          where: new IR.Func(`not`, [predicate]),
        },
      )
    ).map((row) => row.key),
  ).toEqual([`row-0`])
})

// Native literals need at most one brand-validated encoding per occurrence. The number
// of occurrences supplies the work budget; no codec helper computes it. Empty
// tables isolate compilation from revival. Positive counts also calibrate the
// sensor. The existing rank/text and index owners check resulting query semantics.
it.sequential.each([`Instant`, `PlainDate`] as const)(
  `encodes each native query literal at most once / %s`,
  async (kind) => {
    const { adapter } = scope.create().open()
    const constructor = Temporal[kind]
    const value =
      kind === `Instant`
        ? Temporal.Instant.from(`2026-01-02T00:00:00Z`)
        : Temporal.PlainDate.from(`2026-01-02[u-ca=japanese]`)
    const parse = vi.spyOn(constructor, `from`)
    try {
      for (const size of [1, 3, 1_025]) {
        for (const operation of size === 1 ? [`eq`, `in`] : [`in`]) {
          parse.mockClear()
          const rows = await adapter.loadSubset(
            { kind: `eager`, collectionId: `literal-work` },
            {
              where: new IR.Func(operation, [
                new IR.PropRef([`stamp`]),
                new IR.Value(
                  operation === `eq`
                    ? value
                    : Array.from({ length: size }, () => value),
                ),
              ]),
            },
          )
          expect(rows).toEqual([])
          expect(parse.mock.calls.length).toBeGreaterThan(0)
          expect(parse.mock.calls.length).toBeLessThanOrEqual(size)
        }
      }
    } finally {
      parse.mockRestore()
    }
  },
)
