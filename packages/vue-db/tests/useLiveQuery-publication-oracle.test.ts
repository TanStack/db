/**
 * Vue public-result publication law.
 *
 * Contract: One applied source change must not expose a torn `data` snapshot
 * to a synchronous Vue watcher. The source Collection has published a coherent
 * snapshot by the time its change reaches this hook. This adapter must expose
 * either the preceding result or that new result, never a transient clear.
 * For these one-message transactions, it must notify the watcher once with
 * the final result.
 * Authority: `packages/db/tests/conformance/contract.ts` defines `data` as
 * the rows exposed by the live-query Collection. The project glossary defines
 * publication as coherent visibility. This oracle checks that binding at
 * Vue's synchronous watcher cut.
 *
 * Model: For these identity queries, copy source rows into a plain array after
 * each sync transaction. The model uses no Vue refs or hook array mechanics.
 *
 * History grammar: start with two or three distinct rows; mount a supplied
 * Collection or an identity live query; then perform one insert, update, or
 * nonterminal delete. The empty final result, multiple source changes in one
 * transaction, and query recompilation are not covered.
 *
 * Driver and checkpoint: use the real Vue hook with a source Collection, then
 * apply one sync transaction. A `flush: 'sync'` Vue watcher records every
 * public `data` value during that transaction, before a Vue scheduler tick.
 * The refinement check rejects every value other than the old or final rows
 * and requires the final rows to appear. A clear-then-publish adapter would
 * expose `[]` between two nonempty results and fail at the watcher checkpoint.
 */
import { createCollection } from '@tanstack/db'
import { effectScope, watch } from 'vue'
import { expect, vi } from 'vitest'
import { oracleProperty } from '../../db/tests/oracle-property'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { useLiveQuery } from '../src/useLiveQuery'

type Row = { id: string; value: number }
type Snapshot = Array<[string, number]>

const histories: ReadonlyArray<{
  name: string
  initial: Array<Row>
  change: { type: `insert` | `update` | `delete`; value: Row }
}> = [
  {
    name: `insert`,
    initial: [
      { id: `1`, value: 1 },
      { id: `2`, value: 2 },
    ],
    change: { type: `insert`, value: { id: `3`, value: 3 } },
  },
  {
    name: `update`,
    initial: [
      { id: `1`, value: 1 },
      { id: `2`, value: 2 },
    ],
    change: { type: `update`, value: { id: `1`, value: 4 } },
  },
  {
    name: `delete`,
    initial: [
      { id: `1`, value: 1 },
      { id: `2`, value: 2 },
      { id: `3`, value: 3 },
    ],
    change: { type: `delete`, value: { id: `2`, value: 2 } },
  },
]

const cases = histories.flatMap((history) =>
  ([`collection`, `query`] as const).map((input) => ({ ...history, input })),
)

function snapshot(rows: Iterable<Row>): Snapshot {
  return [...rows].map(({ id, value }) => [id, value])
}

/**
 * The refinement check at the synchronous watcher cut: every public value the
 * watcher saw is the preceding or the final snapshot, the source already held
 * the final rows at each callback, the watcher fired once, and the final
 * public result equals the final snapshot.
 */
function expectCoherentPublication(
  expected: { before: Snapshot; after: Snapshot },
  observed: ReadonlyArray<{ publicData: Snapshot; sourceAtCallback: Snapshot }>,
  finalData: Snapshot,
): void {
  for (const { publicData, sourceAtCallback } of observed) {
    expect(sourceAtCallback).toEqual(expected.after)
    expect([expected.before, expected.after]).toContainEqual(publicData)
  }
  expect(observed).toHaveLength(1)
  expect(finalData).toEqual(expected.after)
  expect(observed.at(-1)?.publicData).toEqual(expected.after)
}

// The former test body, unchanged: mount the real hook, apply one sync
// transaction, and judge the watcher's observations with
// expectCoherentPublication. Cleanup failures keep their original precedence.
async function runPublicationCase({
  name,
  initial,
  change,
  input,
}: (typeof cases)[number]): Promise<void> {
  const source = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `vue-publication-${name}-${input}`,
      getKey: (row) => row.id,
      initialData: initial,
    }),
  )
  const scope = effectScope()
  const expectedBefore = snapshot(initial)
  let resultCollection: { value: unknown } | undefined
  let primaryFailure: unknown
  try {
    const result = scope.run(() =>
      input === `collection`
        ? useLiveQuery(source)
        : useLiveQuery((q) =>
            q.from({ items: source }).select(({ items }) => ({
              id: items.id,
              value: items.value,
            })),
          ),
    )!
    resultCollection = result.collection
    await vi.waitFor(() =>
      expect(snapshot(result.data.value)).toEqual(expectedBefore),
    )

    const observed: Array<{
      publicData: Snapshot
      sourceAtCallback: Snapshot
    }> = []
    scope.run(() =>
      watch(
        () => snapshot(result.data.value),
        (publicData) => {
          observed.push({
            publicData,
            sourceAtCallback: snapshot(source.values()),
          })
        },
        { flush: `sync` },
      ),
    )

    source.utils.begin()
    source.utils.write(change)
    source.utils.commit()

    const expectedAfter = snapshot(source.values())
    expect(expectedAfter).not.toEqual(expectedBefore)
    expectCoherentPublication(
      { before: expectedBefore, after: expectedAfter },
      observed,
      snapshot(result.data.value),
    )
  } catch (error) {
    primaryFailure = error
  }
  const cleanupErrors: Array<unknown> = []
  let liveQueryCollection: typeof source | null = null
  if (resultCollection) {
    try {
      liveQueryCollection = resultCollection.value as typeof source | null
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  try {
    scope.stop()
  } catch (error) {
    cleanupErrors.push(error)
  }
  if (liveQueryCollection && liveQueryCollection !== source) {
    try {
      await liveQueryCollection.cleanup()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  try {
    await source.cleanup()
  } catch (error) {
    cleanupErrors.push(error)
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      primaryFailure === undefined
        ? cleanupErrors
        : [primaryFailure, ...cleanupErrors],
      `Vue publication oracle cleanup failed`,
      { cause: primaryFailure },
    )
  }
  if (primaryFailure !== undefined) throw primaryFailure
}

const PUBLICATION_LAW = `One applied source change exposes only the preceding or the final data snapshot to a synchronous Vue watcher, which fires once with the final result.`

oracleProperty({
  id: `vue.use-live-query-publication`,
  law: {
    statement: PUBLICATION_LAW,
    authority: `packages/db/tests/conformance/contract.ts data; the project glossary's publication; this file's contract above.`,
    limits: `Two or three initial rows, a supplied Collection or an identity live query, and one insert, update, or nonterminal delete; empty results, multi-change transactions, and recompilation are not covered.`,
  },
  owns: [`src/useLiveQuery.ts#useLiveQuery`],
  histories: cases,
  label: ({ name, input }) =>
    `publishes one coherent Vue data snapshot for a source ${name} through ${input}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(PUBLICATION_LAW, plan, observe, () =>
      runPublicationCase(plan.history),
    ),
  check: forwardAssertionJudgment,
})
