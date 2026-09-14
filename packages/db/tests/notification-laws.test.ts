import { expect, it } from 'vitest'
import fc from 'fast-check'
import { createCollection, createLiveQueryCollection } from '../src'
import {
  expectNotificationHistory,
  expectNotificationsStopped,
} from '../../db-collection-e2e/src/utils/notification-laws'
import { ScenarioLifetime } from './conformance/scenario-lifetime'
import type { Notification } from '../../db-collection-e2e/src/utils/notification-laws'

type Row = { id: string; count: number }

it.each([20260913, undefined])(
  `checks real query publications against generated worlds seed=%s`,
  async (seed) => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.integer(), { nil: null }),
        fc.array(fc.option(fc.integer(), { nil: null }), {
          minLength: 1,
          maxLength: 12,
        }),
        async (initialCount, counts) => {
          let publish!: (next: Row | undefined) => void
          let previous: Row | undefined
          const source = createCollection<Row>({
            getKey: (row) => row.id,
            sync: {
              sync: ({ begin, write, commit, markReady }) => {
                publish = (next) => {
                  begin()
                  if (next)
                    write({ type: previous ? 'update' : 'insert', value: next })
                  else if (previous) write({ type: 'delete', value: previous })
                  commit()
                  previous = next
                }
                markReady()
              },
            },
          })
          const query = createLiveQueryCollection((q) =>
            q.from({ row: source }),
          )
          const callbacks: Array<Notification<Row>> = []
          const capture = (row: Row): Row => ({ id: row.id, count: row.count })
          let unsubscribe = () => {}
          const lifetime = new ScenarioLifetime()
          lifetime.defer(() => unsubscribe())
          lifetime.defer(() => query.cleanup())
          lifetime.defer(() => source.cleanup())
          await lifetime.run(async () => {
            await query.preload()
            if (initialCount !== null)
              publish({ id: 'owned', count: initialCount })
            const subscription = query.subscribeChanges(
              (changes) =>
                callbacks.push({
                  events: changes.map(
                    ({ type, key, value, previousValue }) => ({
                      type,
                      key,
                      value: capture(value),
                      previousValue:
                        previousValue === undefined
                          ? undefined
                          : capture(previousValue),
                    }),
                  ),
                  rows: Array.from(query.values(), capture),
                }),
              { includeInitialState: true },
            )
            unsubscribe = () => subscription.unsubscribe()
            expectNotificationHistory(
              [],
              callbacks,
              initialCount === null
                ? []
                : [{ id: 'owned', count: initialCount }],
            )
            for (const count of counts) {
              const expected = count === null ? [] : [{ id: 'owned', count }]
              publish(expected[0])
              expectNotificationHistory([], callbacks, expected)
            }
            const archive = structuredClone(callbacks)
            unsubscribe()
            publish({ id: 'owned', count: 123 })
            expectNotificationsStopped(callbacks, archive)
          })
        },
      ),
      {
        seed,
        numRuns: 30,
        examples: [
          [1, [2, null]],
          [1, [null]],
        ],
      },
    )
  },
)

it.each([20260913, undefined])(
  `reconstructs generated publication histories seed=%s`,
  (seed) => {
    fc.assert(
      fc.property(
        fc.array(fc.dictionary(fc.constantFrom('a', 'b', 'c'), fc.integer()), {
          minLength: 1,
          maxLength: 8,
        }),
        (worlds) => {
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
                    !before.some(
                      (old) => old.id === row.id && old.count === row.count,
                    ),
                )
                .map((value) => ({
                  type: before.some((old) => old.id === value.id)
                    ? 'update'
                    : 'insert',
                  key: value.id,
                  value,
                  previousValue: before.find((old) => old.id === value.id),
                })),
            ]
            callbacks.push({ events, rows: after })
            before = after
          }
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
          expect(() =>
            expectNotificationHistory([], corrupted, before),
          ).toThrow()
        },
      ),
      { seed, numRuns: 100 },
    )
  },
)

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

it.each([20260913, undefined])(
  `rejects corrupt prior values and repeated updates seed=%s`,
  (seed) => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (count) => {
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
      }),
      { seed, numRuns: 50 },
    )
  },
)
