/**
 * Angular reads describe the current query before its subscription effect runs.
 *
 * Authority: the current-input refinement law in db/tests/conformance/contract.ts,
 * extended to this synchronous checkpoint by the maintainer on 2026-11-01.
 * Rows, keyed state, Collection, status, and health must describe one query.
 * Changing input may expose an empty loading result, but never the old input's
 * rows. A disabled query exposes empty containers, no Collection, and readiness.
 *
 * This receiving oracle extends the framework conformance owner at Angular's
 * previously unobserved pre-effect cut. Its model filters fixture rows without
 * query-engine helpers. The real Angular injector/effect scheduler supplies the
 * host boundary. It does not establish browser rendering, SSR, asynchronous
 * providers, or another framework's synchronous-read policy.
 */
import { fc } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import {
  EnvironmentInjector,
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
} from '@angular/core'
import { TestBed } from '@angular/core/testing'
import {
  BasicIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
  pooledLiveQueries,
} from '@tanstack/db'
import { injectLiveQuery } from '../src/index'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  oraclePropertyOptions,
  oracleReplayTest,
} from '../../db/tests/oracle-config'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { expectOrderedRows } from '../../db/tests/conformance/result-laws'
import { ScenarioLifetime } from '../../db/tests/conformance/scenario-lifetime'
import type { HealthNode, InitialQueryBuilder } from '@tanstack/db'

// Three groups include a legal empty result. Removing disabled, shape, pooling,
// or input-form variation loses a distinct representation or connection path.
// Only signal writes and source updates before owner destruction are legal.
const selection = fc.constantFrom(0, 1, 2, null)
const histories = fc.record({
  form: fc.constantFrom(`callback`, `params`, `config`, `collection`),
  single: fc.boolean(),
  pool: fc.boolean(),
  value: fc.integer({ min: -2, max: 2 }),
  selections: fc.array(selection, { minLength: 2, maxLength: 6 }),
})
type History = typeof histories extends fc.Arbitrary<infer T> ? T : never
type Row = { id: string; group: number; value: number }

// The source model is fixture data. Selection is ordinary equality; findOne
// takes the first ID. Neither rule reads the adapter or query compiler.
function modelRows(rows: ReadonlyArray<Row>, group: number | null): Array<Row> {
  return rows.filter((row) => row.group === group)
}

type Observation = {
  rows: Array<Row>
  arrayData: boolean
  keyedRows: Array<Row>
  keys: Array<string | number>
  collectionRows: Array<Row> | null
  status: string
  collectionStatus: string | null
  isReady: boolean
  health: HealthNode | undefined
  collectionHealth: HealthNode | undefined
}

// A pooled view and its lazily built public Collection have different IDs and
// health-node identities. The promise here is their health meaning, not those
// identities (getPublicCollection's documented view/materialization boundary).
function healthMeaning(node: HealthNode | undefined): unknown {
  if (!node) return undefined
  return {
    alias: node.alias,
    kind: node.kind,
    status: node.status,
    hasErrors: node.hasErrors,
    failureReason: node.failureReason,
    error: node.error,
    reloading: node.reloading,
    sources: node.sources.map(healthMeaning),
  }
}

function expectSnapshot(
  actual: Observation,
  rows: ReadonlyArray<Row>,
  group: number | null,
  single: boolean,
  settled: boolean,
): void {
  const selected = modelRows(rows, group)
  const expected = single ? selected.slice(0, 1) : selected
  expect(actual.arrayData).toBe(group === null || !single)
  expect(actual.keys).toEqual(actual.rows.map((row) => row.id))
  expectOrderedRows(actual.rows, actual.keyedRows)
  expectOrderedRows(actual.rows, actual.collectionRows ?? [])
  expect(actual.status).toBe(actual.collectionStatus ?? `disabled`)
  expect(healthMeaning(actual.health)).toEqual(
    healthMeaning(actual.collectionHealth),
  )
  expect(actual.isReady).toBe(
    actual.status === `ready` || actual.status === `disabled`,
  )
  if (group === null) {
    expect(actual.collectionRows).toBeNull()
    expectOrderedRows(actual.rows, [])
  } else {
    expect(actual.collectionRows).not.toBeNull()
    if (settled || actual.isReady) expectOrderedRows(actual.rows, expected)
    else {
      // A new query may still load. Every exposed row must nevertheless belong
      // to this input; accepting arbitrary rows here would conceal the defect.
      for (const row of actual.rows) expect(expected).toContainEqual(row)
    }
  }
}

// Each regression replays the same model and driver. The prefix reconstructs
// a nonempty swap, disable, re-enable to empty, and return to a prior input.
const examples: Array<[History]> = [
  `callback`,
  `params`,
  `config`,
  `collection`,
].flatMap((form) =>
  [false, true].flatMap((single) =>
    [false, true].map(
      (pool) =>
        [{ form, single, pool, value: 1, selections: [0, 1, null, 2, 0] }] as [
          History,
        ],
    ),
  ),
)

declareOracle({
  check: [expectSnapshot],
  model: [modelRows],
  grammar: [histories],
})

describe(`Angular current-query snapshot conformance`, () => {
  for (const campaign of [`fixed`, `random`] as const) {
    oracleReplayTest(
      it,
      ...(campaign === `fixed` ? [] : [`angular.current-snapshot`]),
    )(
      `keeps synchronous reads coherent (${campaign})`,
      async () => {
        const reach = createOracleReach(`angular.current-snapshot`, [
          `read before attach`,
          `direct Collection read before attach`,
          `findOne read before attach`,
          `pooled read before attach`,
          `source write before attach`,
          `enabled input replaced before effect`,
          `disabled before effect`,
          `enabled after disabled`,
          `settled source update`,
        ])
        await fc.assert(
          fc.asyncProperty(histories, async (history) => {
            reach.beginHistory()
            const lifetime = new ScenarioLifetime()
            await lifetime.run(async () => {
              const rows: Array<Row> = [
                { id: `a`, group: 0, value: history.value },
                { id: `b`, group: 0, value: history.value },
                { id: `c`, group: 1, value: history.value },
              ]
              const source = createCollection(
                mockSyncCollectionOptions<Row>({
                  id: `angular-snapshot-source`,
                  getKey: (row) => row.id,
                  initialData: rows,
                  gcTime: 0,
                }),
              )
              source.createIndex((row) => row.id, { indexType: BasicIndex })
              const owner = createEnvironmentInjector(
                [],
                TestBed.inject(EnvironmentInjector),
              )
              lifetime.defer(() => owner.destroy())
              lifetime.defer(() => source.cleanup({ dependents: true }))
              const current = signal<number | null>(history.selections[0]!)
              const build = (q: InitialQueryBuilder, group: number | null) => {
                if (group === null) return undefined
                const query = q
                  .from({ row: source })
                  .where(({ row }) => eq(row.group, group))
                  .orderBy(({ row }) => row.id)
                return history.single ? query.findOne() : query
              }
              const result = runInInjectionContext(owner, () => {
                if (history.form === `collection`) {
                  const precreated = createLiveQueryCollection({
                    query: (q) => build(q, 0)!,
                    gcTime: 0,
                  })
                  lifetime.defer(() => precreated.cleanup())
                  return injectLiveQuery(precreated)
                }
                if (history.form === `callback`)
                  return injectLiveQuery((q) => build(q, current()))
                if (history.form === `params`)
                  return injectLiveQuery({
                    params: current,
                    query: ({ params, q }) => build(q, params),
                    pool: history.pool ? pooledLiveQueries : undefined,
                  })
                // Config queries stay enabled; null selects a legal empty group.
                return injectLiveQuery({
                  query: (q) => build(q, current() ?? 2)!,
                })
              })
              const selectedGroup = () =>
                history.form === `collection`
                  ? 0
                  : history.form === `config`
                    ? (current() ?? 2)
                    : current()
              const observe = (): Observation => {
                const collection = result.collection()
                const data: unknown = result.data()
                return {
                  rows: (Array.isArray(data)
                    ? data
                    : data
                      ? [data]
                      : []) as Array<Row>,
                  arrayData: Array.isArray(data),
                  keyedRows: [...result.state().values()],
                  keys: [...result.state().keys()],
                  collectionRows: collection ? [...collection.values()] : null,
                  status: result.status(),
                  collectionStatus: collection?.status ?? null,
                  isReady: result.isReady(),
                  health: result.health(),
                  collectionHealth: collection?.health,
                }
              }
              const check = (settled: boolean) =>
                expectSnapshot(
                  observe(),
                  rows,
                  selectedGroup(),
                  history.single,
                  settled,
                )
              const update = () => {
                rows[0] = { ...rows[0]!, value: rows[0]!.value + 1 }
                source.utils.begin()
                source.utils.write({ type: `update`, value: rows[0] })
                source.utils.commit()
              }
              check(false)
              reach.reach(`read before attach`)
              if (history.form === `collection`)
                reach.reach(`direct Collection read before attach`)
              if (history.single) reach.reach(`findOne read before attach`)
              if (history.form === `params` && history.pool && !history.single)
                reach.reach(`pooled read before attach`)
              update()
              reach.reach(`source write before attach`)
              TestBed.tick()
              await vi.waitFor(() => check(true))
              for (const next of history.selections.slice(1)) {
                const previous = selectedGroup()
                current.set(next)
                check(false)
                if (selectedGroup() === null)
                  reach.reach(`disabled before effect`)
                else if (previous === null)
                  reach.reach(`enabled after disabled`)
                else if (previous !== selectedGroup())
                  reach.reach(`enabled input replaced before effect`)
                TestBed.tick()
                await vi.waitFor(() => check(true))
                update()
                check(true)
                reach.reach(`settled source update`)
              }
            })
          }),
          {
            ...oraclePropertyOptions(20, `angular.current-snapshot`, {
              examples,
            }),
            ...(campaign === `fixed` ? { seed: 1101 } : {}),
          },
        )
        reach.assertReached()
        process.stdout.write(
          `angular.current-snapshot ${campaign}: ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
        )
      },
      60_000,
    )
  }
})
