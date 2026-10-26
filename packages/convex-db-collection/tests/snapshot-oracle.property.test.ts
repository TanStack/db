/**
 * A Collection mirrors the complete keyed rows of its latest valid Convex
 * query result, as promised by docs/collections/convex-collection.md. Missing
 * keys delete rows, missing fields disappear, and duplicate keys reject the
 * whole result while preserving the last valid snapshot. Keys retain their
 * string or finite-number identity: numeric 1 and string '1' are distinct.
 *
 * The independent reference is the last valid selected input array. Pairwise
 * key equality judges duplicates without the adapter's map or sync operations.
 * Every generated history covers valid and duplicate starts, then constructs
 * omission, field removal, empty results,
 * reintroduction, duplicates and recovery, then appends arbitrary snapshots.
 * String, numeric and mixed key lanes share that history. The mixed lane
 * includes 1/'1'; finite numeric parameters include fractions and negatives.
 * Raw and selected runs compare the same law. Selection changes key shape and
 * uppercases text; the reference states that transformation independently.
 *
 * The real Collection receives controlled Convex callbacks. After each
 * synchronous delivery, typed public entries and the error flag are compared.
 * Reach counts only histories that pass those checks. This owner does not
 * establish provider ordering, intermediate publication, SDK transport,
 * mutation timing or cleanup scheduling; receiving tests own those boundaries.
 */
import { isDeepStrictEqual } from 'node:util'
import { createCollection } from '@tanstack/db'
import { fc } from '@fast-check/vitest'
import { makeFunctionReference } from 'convex/server'
import { expect, it } from 'vitest'
import { runOracleCampaign } from '../../db/tests/oracle-campaign'
import { convexCollectionOptions } from '../src/index'
import { controlledClient, withTestCleanup } from './helpers'
import type { Row } from './helpers'

type KeyedRow = Row & { key: string | number }
const query = makeFunctionReference<
  `query`,
  { owner: string },
  Array<KeyedRow>
>(`tasks:keyed`)

const row = fc.record({
  slot: fc.integer({ min: 0, max: 2 }),
  text: fc.string({ maxLength: 12 }),
  optional: fc.option(fc.string({ maxLength: 6 }), { nil: undefined }),
})
const states = [
  `string-keys`,
  `numeric-keys`,
  `mixed-key-types`,
  `equal-looking-typed-keys`,
  `selected-key-representation`,
  `omitted-key`,
  `omitted-field`,
  `empty-result`,
  `reintroduced-key`,
  `duplicate-rejected`,
  `valid-after-error`,
  `initial-valid`,
  `initial-duplicate-rejected`,
] as const

it(`refines complete snapshots throughout generated histories`, async () => {
  await runOracleCampaign(
    `CONVEX_SNAPSHOT_ORACLE`,
    states,
    async (reach, parameters) => {
      const property = fc.asyncProperty(
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.string({ maxLength: 12 }),
        fc.array(fc.array(row, { maxLength: 5 }), {
          minLength: 1,
          maxLength: 30,
        }),
        async (numberKey, text, suffix) => {
          reach.beginHistory()
          const lanes = [
            { name: `string-keys`, keys: [`a`, `b`, `c`] },
            { name: `numeric-keys`, keys: [numberKey, numberKey + 0.5, 1] },
            { name: `mixed-key-types`, keys: [1, `1`, numberKey] },
          ] as const
          for (const lane of lanes) {
            const first: KeyedRow = {
              _id: `first`,
              key: lane.keys[0],
              text: `lower:${text}`,
              optional: `remove`,
            }
            const second: KeyedRow = {
              _id: `second`,
              key: lane.keys[1],
              text,
            }
            // The first two lane keys are always distinct. This constructive
            // prefix forces adjacent laws even when the random suffix is empty.
            const history: Array<Array<KeyedRow>> = [
              [first, second],
              [{ _id: first._id, key: first.key, text: `updated:${text}` }],
              [],
              [first, second],
              [second, first],
              [first, { ...first, text: `duplicate:${text}` }],
              [{ ...second, text: `recovered:${text}` }],
              ...suffix.map((snapshot) =>
                snapshot.map((value): KeyedRow => ({
                  _id: `source:${value.slot}`,
                  key: lane.keys[value.slot]!,
                  text: value.text,
                  ...(value.optional === undefined
                    ? {}
                    : { optional: value.optional }),
                })),
              ),
            ]
            for (const [projected, initiallyInvalid] of [
              [false, false],
              [false, true],
              [true, false],
              [true, true],
            ] as const) {
              const transport = controlledClient()
              const collection = createCollection(
                convexCollectionOptions({
                  client: transport.client,
                  query,
                  queryArgs: { owner: `alice` },
                  getKey: (value) => value.key,
                  ...(projected
                    ? {
                        select: (rows: Array<KeyedRow>): Array<KeyedRow> =>
                          rows.map((value) => ({
                            ...value,
                            key:
                              typeof value.key === `number`
                                ? String(value.key)
                                : `selected:${value.key}`,
                            text: value.text.toUpperCase(),
                          })),
                      }
                    : {}),
                  gcTime: 0,
                }),
              )
              collection.startSyncImmediate()
              let expected: Array<KeyedRow> = []
              const seen: Array<string | number> = []
              let previousInvalid = false
              await withTestCleanup(
                () => {
                  // Both startup forms remain reachable: prepending a
                  // duplicate must reject without publishing even one row.
                  const deliveries = initiallyInvalid
                    ? [[first, { ...first }], ...history]
                    : history
                  for (const [
                    deliveryIndex,
                    snapshot,
                  ] of deliveries.entries()) {
                    // The public projection contract supplies these expected
                    // values; no adapter helper or key map computes them.
                    const selected = snapshot.map((value): KeyedRow => ({
                      ...value,
                      key: projected
                        ? typeof value.key === `number`
                          ? `${value.key}`
                          : `selected:${value.key}`
                        : value.key,
                      text: projected ? value.text.toUpperCase() : value.text,
                    }))
                    const valid = selected.every((value, index) =>
                      selected
                        .slice(index + 1)
                        .every((other) => other.key !== value.key),
                    )
                    const prior = expected
                    if (valid) expected = selected
                    transport.emit(snapshot)
                    expect(collection.utils.getSyncError() !== undefined).toBe(
                      !valid,
                    )
                    // Keep public key types and cardinality. String sorting or
                    // a string-keyed object would erase the 1/'1' distinction.
                    const actual = [...collection.entries()].map(
                      ([key, value]) => {
                        const observed: KeyedRow = {
                          _id: value._id,
                          key: value.key,
                          text: value.text,
                        }
                        if (Object.hasOwn(value, `optional`))
                          observed.optional = value.optional
                        return { key, row: observed }
                      },
                    )
                    expect(actual).toHaveLength(expected.length)
                    for (const wanted of expected) {
                      const entry = actual.find(({ key }) => key === wanted.key)
                      expect(isDeepStrictEqual(entry?.row, wanted)).toBe(true)
                    }
                    if (deliveryIndex === 0)
                      reach.reach(
                        valid ? `initial-valid` : `initial-duplicate-rejected`,
                      )
                    if (!valid) reach.reach(`duplicate-rejected`)
                    else {
                      if (projected && selected.length > 0)
                        reach.reach(`selected-key-representation`)
                      if (!projected && selected.length > 0)
                        reach.reach(lane.name)
                      if (
                        selected.some((value) => value.key === 1) &&
                        selected.some((value) => value.key === `1`)
                      )
                        reach.reach(`equal-looking-typed-keys`)
                      if (expected.length === 0) reach.reach(`empty-result`)
                      if (previousInvalid) reach.reach(`valid-after-error`)
                      if (
                        prior.some(
                          (old) =>
                            !selected.some((value) => value.key === old.key),
                        )
                      )
                        reach.reach(`omitted-key`)
                      if (
                        selected.some((value) =>
                          prior.some(
                            (old) =>
                              old.key === value.key &&
                              Object.hasOwn(old, `optional`) &&
                              !Object.hasOwn(value, `optional`),
                          ),
                        )
                      )
                        reach.reach(`omitted-field`)
                      if (
                        selected.some(
                          (value) =>
                            seen.includes(value.key) &&
                            !prior.some((old) => old.key === value.key),
                        )
                      )
                        reach.reach(`reintroduced-key`)
                      for (const value of selected) {
                        if (!seen.includes(value.key)) seen.push(value.key)
                      }
                    }
                    previousInvalid = !valid
                  }
                },
                () => collection.cleanup(),
              )
            }
          }
        },
      )
      await fc.assert(property, { numRuns: 150, ...parameters })
    },
    { fixedSeed: 20261022 },
  )
})
