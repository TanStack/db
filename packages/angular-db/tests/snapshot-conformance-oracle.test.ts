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
import { describe, expect, vi } from 'vitest'
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
import { oracleProperty } from '../../db/tests/oracle-property'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { expectOrderedRows } from '../../db/tests/conformance/result-laws'
import { ScenarioLifetime } from '../../db/tests/conformance/scenario-lifetime'
import type { HealthNode, InitialQueryBuilder } from '@tanstack/db'
import type { Verdict } from '../../db/tests/oracle-property'

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
const examples: Array<History> = [
  `callback`,
  `params`,
  `config`,
  `collection`,
].flatMap((form) =>
  [false, true].flatMap((single) =>
    [false, true].map(
      (pool) =>
        ({
          form,
          single,
          pool,
          value: 1,
          selections: [0, 1, null, 2, 0],
        }) as History,
    ),
  ),
)

// Each required state has a construction that splices it into a generated
// history. Every builder returns a fresh object, so the framework associates
// each construction with its own state obligations. Configuration queries stay
// enabled, so the disable constructions use a form that can disable.
const nonCollection = (form: History[`form`]): History[`form`] =>
  form === `collection` ? `callback` : form
const disablingForm = (form: History[`form`]): History[`form`] =>
  form === `params` ? `params` : `callback`
const alwaysEntered = [
  `read before attach`,
  `source write before attach`,
  `settled source update`,
]

describe(`Angular current-query snapshot conformance`, () => {
  oracleProperty<History, Verdict>({
    id: `angular.current-snapshot`,
    law: {
      statement: `Before and after Angular's subscription effect runs, rows, keyed state, Collection, status, and health describe the current query. A replaced input may expose an empty loading result, but never the previous input's rows.`,
      authority: `The current-input refinement law in db/tests/conformance/contract.ts, extended to the synchronous pre-effect checkpoint by maintainer decision 2026-11-01.`,
      limits: `Synchronous eager sources in Angular's JIT TestBed. No browser rendering, SSR, asynchronous provider schedules, or another framework's synchronous-read policy.`,
    },
    owns: [`src/index.ts`],
    histories: {
      arbitrary: histories,
      runs: 20,
      fixedSeeds: [1101],
      states: [
        ...alwaysEntered,
        `direct Collection read before attach`,
        `findOne read before attach`,
        `pooled read before attach`,
        `enabled input replaced before effect`,
        `disabled before effect`,
        `enabled after disabled`,
      ],
      constructed: [
        {
          name: `direct Collection`,
          enters: [...alwaysEntered, `direct Collection read before attach`],
          build: (history) => ({ ...history, form: `collection` }),
        },
        {
          name: `findOne`,
          enters: [`findOne read before attach`],
          build: (history) => ({
            ...history,
            single: true,
            selections: [0, ...history.selections.slice(1)],
          }),
        },
        {
          name: `pooled params`,
          enters: [`pooled read before attach`],
          build: (history) => ({
            ...history,
            form: `params`,
            pool: true,
            single: false,
            selections: [0, ...history.selections.slice(1)],
          }),
        },
        {
          name: `input replacement`,
          enters: [`enabled input replaced before effect`],
          build: (history) => ({
            ...history,
            form: nonCollection(history.form),
            selections: [0, 1, ...history.selections.slice(2)],
          }),
        },
        {
          name: `disable`,
          enters: [`disabled before effect`],
          build: (history) => ({
            ...history,
            form: disablingForm(history.form),
            selections: [0, null, ...history.selections.slice(2)],
          }),
        },
        {
          name: `re-enable`,
          enters: [`enabled after disabled`],
          build: (history) => ({
            ...history,
            form: disablingForm(history.form),
            selections: [null, 0, ...history.selections.slice(2)],
          }),
        },
      ],
      fixed: examples.map((history) => ({
        name: `${history.form} ${history.single ? `findOne` : `list`}${history.pool ? ` pooled` : ``}`,
        history,
      })),
    },
    model: recordedAssertionJudgment,
    driver: (history, observe) => {
      const entered = new Set<string>()
      const enter = (state: string) => {
        if (entered.has(state)) return
        entered.add(state)
        observe(`reach`, state)
      }
      return recordAssertionJudgment(
        `Angular current-query snapshot`,
        history,
        observe,
        async () => {
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
            const read = (): Observation => {
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
              oracleAssertion(
                settled ? `settled read` : `read before effect`,
                () =>
                  expectSnapshot(
                    read(),
                    rows,
                    selectedGroup(),
                    history.single,
                    settled,
                  ),
              )
            const update = () => {
              rows[0] = { ...rows[0]!, value: rows[0]!.value + 1 }
              source.utils.begin()
              source.utils.write({ type: `update`, value: rows[0] })
              source.utils.commit()
            }
            check(false)
            enter(`read before attach`)
            if (history.form === `collection`)
              enter(`direct Collection read before attach`)
            // A disabled first selection builds no query, so neither the
            // findOne nor the pooled path has run.
            const initialEnabled = selectedGroup() !== null
            if (history.single && initialEnabled)
              enter(`findOne read before attach`)
            if (
              history.form === `params` &&
              history.pool &&
              !history.single &&
              initialEnabled
            )
              enter(`pooled read before attach`)
            update()
            enter(`source write before attach`)
            TestBed.tick()
            await vi.waitFor(() => check(true))
            for (const next of history.selections.slice(1)) {
              const previous = selectedGroup()
              current.set(next)
              check(false)
              if (selectedGroup() === null) enter(`disabled before effect`)
              else if (previous === null) enter(`enabled after disabled`)
              else if (previous !== selectedGroup())
                enter(`enabled input replaced before effect`)
              TestBed.tick()
              await vi.waitFor(() => check(true))
              update()
              check(true)
              enter(`settled source update`)
            }
          })
        },
      )
    },
    check: forwardAssertionJudgment,
    timeout: 60_000,
  })
})
