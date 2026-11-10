/**
 * For each live-query Collection `subscribeChanges` callback, applying its
 * change messages to the previous public rows must produce the rows visible
 * in that callback. Unsubscribing stops delivery. The Collection
 * change-message contract supplies this law. Its independent Map checker is in
 * `packages/db-collection-e2e/src/utils/notification-laws-oracle.ts`.
 *
 * The production history has one keyed row, an optional initial row, and a
 * sequence of synchronous source insert, update, delete, or empty transactions.
 * An update may write the same value as before.
 * After preload, the driver subscribes with initial state and checks the
 * callback trace after each source transaction, then checks silence after
 * unsubscribe. Synthetic multi-key histories and corruptions calibrate the
 * checker; they do not add production-path coverage. Row order, multi-key
 * production batches, and asynchronous providers are outside this owner.
 * `change-event-history-oracle.test.ts` owns direct source Collection events.
 */
import { expect, it } from 'vitest'
import fc from 'fast-check'
import { createCollection, createLiveQueryCollection } from '../src'
import {
  expectNotificationHistory,
  expectNotificationsStopped,
} from '../../db-collection-e2e/src/utils/notification-laws-oracle'
import { ScenarioLifetime } from './conformance/scenario-lifetime'
import { oracleProperty, oracleRoute, pass, violation } from './oracle-config'
import { declareOracle } from './oracle-declaration'
import type { Notification } from '../../db-collection-e2e/src/utils/notification-laws-oracle'
import type { Verdict } from './oracle-config'

type Row = { id: string; count: number }

// What this oracle owns: the gap report judges every function in the
// Collection change-message path (subscribeChanges) by this file's generated
// publication histories and the calibration of its Map checker.
declareOracle({
  owns: [`src/collection/changes.ts#CollectionChangesManager.subscribeChanges`],
})

type QueryHistory = [number | null, Array<number | null>]

// The authored single-row worlds are the expected public rows at each cut.
function queryModel([initialCount, counts]: QueryHistory): Array<Array<Row>> {
  return [initialCount, ...counts].map((count) =>
    count === null ? [] : [{ id: `owned`, count }],
  )
}

async function driveQueryHistory(
  [initialCount, counts]: QueryHistory,
  observe: (checkpoint: string, value: unknown) => void,
) {
  let publish!: (next: Row | undefined) => void
  let previous: Row | undefined
  const source = createCollection<Row>({
    getKey: (row) => row.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        publish = (next) => {
          begin()
          if (next) write({ type: previous ? 'update' : 'insert', value: next })
          else if (previous) write({ type: 'delete', value: previous })
          commit()
          previous = next
        }
        markReady()
      },
    },
  })
  const query = createLiveQueryCollection((q) => q.from({ row: source }))
  const callbacks: Array<Notification<Row>> = []
  const capture = (row: Row): Row => ({ id: row.id, count: row.count })
  let unsubscribe = () => {}
  const lifetime = new ScenarioLifetime()
  lifetime.defer(() => unsubscribe())
  lifetime.defer(() => query.cleanup())
  lifetime.defer(() => source.cleanup())
  await lifetime.run(async () => {
    await query.preload()
    if (initialCount !== null) publish({ id: 'owned', count: initialCount })
    const subscription = query.subscribeChanges(
      (changes) =>
        callbacks.push({
          events: changes.map(({ type, key, value, previousValue }) => ({
            type,
            key,
            value: capture(value),
            previousValue:
              previousValue === undefined ? undefined : capture(previousValue),
          })),
          rows: Array.from(query.values(), capture),
        }),
      { includeInitialState: true },
    )
    unsubscribe = () => subscription.unsubscribe()
    observe(`initial publication`, structuredClone(callbacks))
    for (const count of counts) {
      const expected = count === null ? [] : [{ id: 'owned', count }]
      publish(expected[0])
      observe(`source publication`, structuredClone(callbacks))
    }
    const archive = structuredClone(callbacks)
    unsubscribe()
    publish({ id: 'owned', count: 123 })
    observe(`unsubscribe`, { callbacks, archive })
  })
}

// Assertion forwarding is restricted to this existing checker. The original
// assertion remains its cause; runtime and cleanup errors stay driver errors.
function assertionVerdict(checkpoint: string, compare: () => void): Verdict {
  try {
    compare()
    return pass
  } catch (error) {
    if (!(error instanceof Error) || error.name !== `AssertionError`)
      throw error
    return {
      kind: `violation`,
      checkpoint,
      difference: error.message,
      law: `coherent publication`,
      cause: error,
    }
  }
}

oracleProperty({
  id: `notification-laws.query-publications`,
  law: {
    statement: `Applying each callback's changes to the previous public rows reconstructs the rows visible in that callback, and unsubscribe stops delivery.`,
    authority: `Collection change-message and subscribeChanges contracts`,
    limits: `One production row, synchronous source transactions and settled preload; no multi-key production batches, ordering or asynchronous provider claim.`,
    owner: `docs/contributing/oracle-coverage.md`,
  },
  histories: {
    arbitrary: fc.tuple(
      fc.option(fc.integer(), { nil: null }),
      fc.array(fc.option(fc.integer(), { nil: null }), {
        minLength: 1,
        maxLength: 12,
      }),
    ),
    runs: 30,
    fixedSeeds: [20260913],
    fixed: [
      { name: `update then delete`, history: [1, [2, null]] },
      { name: `delete initial row`, history: [1, [null]] },
    ],
  },
  model: queryModel,
  driver: driveQueryHistory,
  check: (_history, observations, expected) => {
    for (const [index, { checkpoint, value }] of observations.entries()) {
      const verdict = assertionVerdict(checkpoint, () => {
        if (checkpoint === `unsubscribe`) {
          const { callbacks, archive } = value as {
            callbacks: Array<Notification<Row>>
            archive: Array<Notification<Row>>
          }
          expectNotificationsStopped(callbacks, archive)
        } else
          expectNotificationHistory(
            [],
            value as Array<Notification<Row>>,
            expected[index]!,
          )
      })
      if (verdict.kind === `violation`) return verdict
    }
    return observations.length === expected.length + 1
      ? pass
      : violation(
          `complete history`,
          `the publication history stopped before unsubscribe`,
        )
  },
})

type World = Record<string, number>

// Synthetic histories calibrate the shared Map checker independently of the
// production driver. The final authored world supplies its expected rows.
function syntheticModel(worlds: Array<World>): Array<Row> {
  return Object.entries(worlds.at(-1)!).map(([id, count]) => ({ id, count }))
}

function driveSyntheticHistory(
  worlds: Array<World>,
  observe: (checkpoint: string, value: unknown) => void,
) {
  let before: Array<Row> = []
  const callbacks: Array<Notification<Row>> = []
  for (const world of worlds) {
    const after = Object.entries(world).map(([id, count]) => ({
      id,
      count,
    }))
    const events: Notification<Row>['events'] = [
      ...before
        .filter((row) => !(row.id in world))
        .map((value) => ({ type: 'delete', key: value.id, value })),
      ...after
        .filter(
          (row) =>
            !before.some((old) => old.id === row.id && old.count === row.count),
        )
        .map((value) => ({
          type: before.some((old) => old.id === value.id) ? 'update' : 'insert',
          key: value.id,
          value,
          previousValue: before.find((old) => old.id === value.id),
        })),
    ]
    callbacks.push({ events, rows: after })
    before = after
  }

  observe(`synthetic publications`, callbacks)
}

oracleProperty({
  id: `notification-laws.publication-histories`,
  law: {
    statement: `The shared publication checker reconstructs generated keyed worlds and rejects later delivery or an unpublished row.`,
    authority: `Collection change-message contract`,
    limits: `Synthetic multi-key checker calibration; this property does not add production-path coverage.`,
    owner: `docs/contributing/oracle-coverage.md`,
  },
  histories: {
    arbitrary: fc.array(
      fc.dictionary(fc.constantFrom('a', 'b', 'c'), fc.integer()),
      { minLength: 1, maxLength: 8 },
    ),
    runs: 100,
    fixedSeeds: [20260913],
  },
  model: syntheticModel,
  driver: driveSyntheticHistory,
  check: (_worlds, observations, before) => {
    for (const { checkpoint, value } of observations) {
      const verdict = assertionVerdict(checkpoint, () => {
        const callbacks = value as Array<Notification<Row>>
        expectNotificationHistory([], callbacks, before)
        const archive = structuredClone(callbacks)
        expectNotificationsStopped(callbacks, archive)
        expect(() =>
          expectNotificationsStopped(
            [...callbacks, { events: [], rows: before }],
            archive,
          ),
        ).toThrow()
        const corrupted = structuredClone(callbacks)
        corrupted[0]!.rows.push({ id: 'unpublished', count: 1 })
        expect(() => expectNotificationHistory([], corrupted, before)).toThrow()
      })
      if (verdict.kind === `violation`) return verdict
    }
    return observations.length === 1
      ? pass
      : violation(`complete history`, `the synthetic history was not recorded`)
  },
})

it.each([
  'duplicate',
  'spurious-delete',
  'wrong-key',
  'wrong-payload',
  'missing-event',
  'absent-update',
  'absent-delete',
  'unknown-type',
])(`rejects the %s publication mutant`, (fault) => {
  oracleRoute(`calibration`)
  const peer = { id: 'peer', count: 2 }
  const row = { id: 'owned', count: 1 }
  const insert = { type: 'insert', key: row.id, value: row }
  const healthy: Array<Notification<Row>> = [
    { events: [], rows: [peer] },
    { events: [insert], rows: [peer, row] },
  ]
  expectNotificationHistory([peer], healthy, [peer, row])
  const callbacks = structuredClone(healthy)
  const batch = callbacks[1]!
  if (fault === 'duplicate') callbacks.push(structuredClone(batch))
  if (fault === 'spurious-delete')
    batch.events.push({ ...insert, type: 'delete' })
  if (fault === 'wrong-key') batch.events[0]!.key = 'wrong'
  if (fault === 'wrong-payload') batch.events[0]!.value.count++
  if (fault === 'missing-event') batch.events = []
  if (fault === 'absent-update') batch.events[0]!.type = 'update'
  if (fault === 'absent-delete') batch.events[0]!.type = 'delete'
  if (fault === 'unknown-type') batch.events[0]!.type = 'upsert'
  expect(() =>
    expectNotificationHistory([peer], callbacks, [peer, row]),
  ).toThrow()
})

oracleProperty({
  id: `notification-laws.corrupt-prior-values`,
  law: {
    statement: `The shared checker rejects an absent or wrong prior update value and a repeated update.`,
    authority: `Collection change-message previousValue and publication contracts`,
    limits: `Synthetic single-row update checker calibration with counts from -1000 through 1000.`,
    owner: `docs/contributing/oracle-coverage.md`,
  },
  histories: {
    arbitrary: fc.integer({ min: -1000, max: 1000 }),
    runs: 50,
    fixedSeeds: [20260913],
  },
  model: (count) => ({
    old: { id: `owned`, count },
    next: { id: `owned`, count: count + 1 },
  }),
  driver: (count, observe) => {
    const old = { id: 'owned', count }
    const next = { id: 'owned', count: count + 1 }
    const callbacks: Array<Notification<Row>> = [
      {
        events: [{ type: 'insert', key: old.id, value: old }],
        rows: [old],
      },
      {
        events: [
          { type: 'update', key: next.id, value: next, previousValue: old },
        ],
        rows: [next],
      },
    ]

    observe(`prior-value calibration`, callbacks)
  },
  check: (_count, observations, { old, next }) => {
    for (const { checkpoint, value } of observations) {
      const verdict = assertionVerdict(checkpoint, () => {
        const callbacks = value as Array<Notification<Row>>
        expectNotificationHistory([], callbacks, [next])
        for (const previousValue of [
          undefined,
          { ...old, id: 'wrong' },
          next,
        ]) {
          const corrupted = structuredClone(callbacks)
          corrupted[1]!.events[0]!.previousValue = previousValue
          expect(() =>
            expectNotificationHistory([], corrupted, [next]),
          ).toThrow()
        }
        expect(() =>
          expectNotificationHistory([], [...callbacks, callbacks[1]!], [next]),
        ).toThrow()
      })
      if (verdict.kind === `violation`) return verdict
    }
    return observations.length === 1
      ? pass
      : violation(
          `complete history`,
          `the prior-value history was not recorded`,
        )
  },
})
