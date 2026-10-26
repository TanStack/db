import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { DbClient, collectionOptions } from '../src/client.js'
import { createCollection } from '../src/collection/index.js'
import {
  DeleteKeyNotFoundError,
  DuplicateKeyError,
  InvalidKeyError,
  MissingDeleteHandlerError,
  MissingInsertHandlerError,
  MissingUpdateHandlerError,
  NoKeysPassedToDeleteError,
  NoKeysPassedToUpdateError,
  SchemaValidationError,
  UndefinedKeyError,
  UpdateKeyNotFoundError,
} from '../src/errors.js'
import type { Collection } from '../src/collection/index.js'
import type { SyncConfig } from '../src/types.js'

/**
 * # What may an idle Collection mutation start?
 *
 * A Collection with `startSync: false` delays its source until a public
 * mutation passes local preflight and needs it. Local preflight rejection must
 * happen before startup and before a handler runs. Once startup synchronously
 * hydrates rows, update and delete check target existence; insert checks for
 * duplicates. Only admitted mutations apply optimistic state.
 *
 * This is a finite admission model rather than a second Collection. Each case
 * belongs to one of five cells: reject before startup, hydrate then reject,
 * hydrate then accept, reuse an existing start, or surface startup failure
 * unchanged. The production driver observes starts, handler calls, status,
 * rows, mutation type and key, and persistence through the public API. The
 * immediate return is the checkpoint for successful hydrated state lookup.
 *
 * Deferred providers, ambient transactions, reconciliation, publication, and
 * settlement belong to the subscription and optimistic-history oracles.
 */
type Row = { id: string; value: string }
type IdleCollection = Collection<Row, string>
type RejectionFixture = {
  collection: IdleCollection
  mutate: () => unknown
  handlerCalls: () => number
  assertError: (error: unknown) => void
}
type RejectionCase = {
  name: string
  create: (sync: SyncConfig<Row, string>) => RejectionFixture
}

const noop = () => Promise.resolve()

function idleConfig(sync: SyncConfig<Row, string>) {
  return {
    getKey: (row: Row) => row.id,
    startSync: false,
    sync,
  }
}

const rejectionCases: Array<RejectionCase> = [
  {
    name: `insert without a handler`,
    create: (sync) => {
      const collection = createCollection<Row, string>(idleConfig(sync))
      return {
        collection,
        mutate: () => collection.insert({ id: `target`, value: `local` }),
        handlerCalls: () => 0,
        assertError: (error) =>
          expect(error).toBeInstanceOf(MissingInsertHandlerError),
      }
    },
  },
  {
    name: `insert rejected by its schema`,
    create: (sync) => {
      const onInsert = vi.fn(noop)
      const collection = createCollection({
        ...idleConfig(sync),
        schema: z.object({ id: z.string(), value: z.string().min(1) }),
        onInsert,
      })
      return {
        collection,
        mutate: () => collection.insert({ id: `target`, value: `` }),
        handlerCalls: () => onInsert.mock.calls.length,
        assertError: (error) =>
          expect(error).toBeInstanceOf(SchemaValidationError),
      }
    },
  },
  {
    name: `insert with a non-key value`,
    create: (sync) => {
      const onInsert = vi.fn(noop)
      const collection = createCollection<Row, string>({
        ...idleConfig(sync),
        getKey: () => true as never,
        onInsert,
      })
      return {
        collection,
        mutate: () => collection.insert({ id: `target`, value: `local` }),
        handlerCalls: () => onInsert.mock.calls.length,
        assertError: (error) => expect(error).toBeInstanceOf(InvalidKeyError),
      }
    },
  },
  {
    name: `insert with an undefined key`,
    create: (sync) => {
      const onInsert = vi.fn(noop)
      const collection = createCollection<Row, string>({
        ...idleConfig(sync),
        getKey: () => undefined as never,
        onInsert,
      })
      return {
        collection,
        mutate: () => collection.insert({ id: `target`, value: `local` }),
        handlerCalls: () => onInsert.mock.calls.length,
        assertError: (error) => expect(error).toBeInstanceOf(UndefinedKeyError),
      }
    },
  },
  {
    name: `insert batch with duplicate keys`,
    create: (sync) => {
      const onInsert = vi.fn(noop)
      const collection = createCollection<Row, string>({
        ...idleConfig(sync),
        onInsert,
      })
      return {
        collection,
        mutate: () =>
          collection.insert([
            { id: `target`, value: `first` },
            { id: `target`, value: `second` },
          ]),
        handlerCalls: () => onInsert.mock.calls.length,
        assertError: (error) => expect(error).toBeInstanceOf(DuplicateKeyError),
      }
    },
  },
  {
    name: `update without a handler`,
    create: (sync) => {
      const collection = createCollection<Row, string>(idleConfig(sync))
      return {
        collection,
        mutate: () => collection.update(`target`, () => {}),
        handlerCalls: () => 0,
        assertError: (error) =>
          expect(error).toBeInstanceOf(MissingUpdateHandlerError),
      }
    },
  },
  {
    name: `update without keys`,
    create: (sync) => {
      const onUpdate = vi.fn(noop)
      const collection = createCollection<Row, string>({
        ...idleConfig(sync),
        onUpdate,
      })
      return {
        collection,
        mutate: () => collection.update([], () => {}),
        handlerCalls: () => onUpdate.mock.calls.length,
        assertError: (error) =>
          expect(error).toBeInstanceOf(NoKeysPassedToUpdateError),
      }
    },
  },
  {
    name: `update without a callback`,
    create: (sync) => {
      const onUpdate = vi.fn(noop)
      const collection = createCollection<Row, string>({
        ...idleConfig(sync),
        onUpdate,
      })
      return {
        collection,
        mutate: () =>
          (collection.update as (key: string, config: object) => unknown)(
            `target`,
            {},
          ),
        handlerCalls: () => onUpdate.mock.calls.length,
        assertError: (error) => expect(error).toBeInstanceOf(TypeError),
      }
    },
  },
  {
    name: `delete without a handler`,
    create: (sync) => {
      const collection = createCollection<Row, string>(idleConfig(sync))
      return {
        collection,
        mutate: () => collection.delete(`target`),
        handlerCalls: () => 0,
        assertError: (error) =>
          expect(error).toBeInstanceOf(MissingDeleteHandlerError),
      }
    },
  },
  {
    name: `delete without keys`,
    create: (sync) => {
      const onDelete = vi.fn(noop)
      const collection = createCollection<Row, string>({
        ...idleConfig(sync),
        onDelete,
      })
      return {
        collection,
        mutate: () => collection.delete([]),
        handlerCalls: () => onDelete.mock.calls.length,
        assertError: (error) =>
          expect(error).toBeInstanceOf(NoKeysPassedToDeleteError),
      }
    },
  },
]

function captureError(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error(`expected mutation to reject synchronously`)
}

describe(`Collection mutation startup oracle`, () => {
  it.each(rejectionCases)(
    `keeps local rejection inert before startup: $name`,
    async ({ create }) => {
      let readyStarts = 0
      let throwingStarts = 0
      const startupError = new Error(`startup must remain unreachable`)
      const fixtures = [
        create({
          sync: ({ markReady }) => {
            readyStarts++
            markReady()
          },
        }),
        create({
          sync: () => {
            throwingStarts++
            throw startupError
          },
        }),
      ]

      try {
        const errors = fixtures.map(({ mutate }) => captureError(mutate))
        errors.forEach(fixtures[0]!.assertError)
        expect([readyStarts, throwingStarts]).toEqual([0, 0])
        for (const fixture of fixtures) {
          expect(fixture.collection.status).toBe(`idle`)
          expect(fixture.collection.toArray).toEqual([])
          expect(fixture.handlerCalls()).toBe(0)
        }
      } finally {
        await Promise.all(
          fixtures.map(({ collection }) => collection.cleanup()),
        )
      }
    },
  )

  it.each([`update`, `delete`] as const)(
    `hydrates an idle target before valid %s state lookup`,
    async (operation) => {
      const target = { id: `target`, value: `original` }
      let syncStarts = 0
      const onUpdate = vi.fn(noop)
      const onDelete = vi.fn(noop)
      const collection = createCollection<Row, string>({
        getKey: (row) => row.id,
        startSync: false,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            syncStarts++
            begin()
            write({ type: `insert`, value: target })
            commit()
            markReady()
          },
        },
        onUpdate,
        onDelete,
      })

      try {
        expect(syncStarts).toBe(0)
        expect(collection.status).toBe(`idle`)
        const transaction =
          operation === `update`
            ? collection.update(`target`, (draft) => {
                draft.value = `updated`
              })
            : collection.delete(`target`)
        expect(syncStarts).toBe(1)
        expect(collection.status).toBe(`ready`)
        expect(transaction.mutations).toMatchObject([
          { key: `target`, type: operation, original: target },
        ])
        expect(
          collection.toArray.map(({ id, value }) => ({ id, value })),
        ).toEqual(
          operation === `update` ? [{ id: `target`, value: `updated` }] : [],
        )
        await transaction.isPersisted.promise
        expect(onUpdate).toHaveBeenCalledTimes(operation === `update` ? 1 : 0)
        expect(onDelete).toHaveBeenCalledTimes(operation === `delete` ? 1 : 0)
      } finally {
        await collection.cleanup()
      }
    },
  )

  it.each([`update`, `delete`] as const)(
    `starts before rejecting %s of a missing target`,
    async (operation) => {
      let syncStarts = 0
      let callbackCalls = 0
      const onUpdate = vi.fn(noop)
      const onDelete = vi.fn(noop)
      const collection = createCollection<Row, string>({
        ...idleConfig({
          sync: ({ markReady }) => {
            syncStarts++
            markReady()
          },
        }),
        onUpdate,
        onDelete,
      })

      try {
        expect(syncStarts).toBe(0)
        expect(collection.status).toBe(`idle`)
        const error = captureError(() =>
          operation === `update`
            ? collection.update(`missing`, () => {
                callbackCalls++
              })
            : collection.delete(`missing`),
        )
        expect(error).toBeInstanceOf(
          operation === `update`
            ? UpdateKeyNotFoundError
            : DeleteKeyNotFoundError,
        )
        expect(syncStarts).toBe(1)
        expect(collection.status).toBe(`ready`)
        expect(collection.toArray).toEqual([])
        expect(callbackCalls).toBe(0)
        expect(onUpdate).not.toHaveBeenCalled()
        expect(onDelete).not.toHaveBeenCalled()
      } finally {
        await collection.cleanup()
      }
    },
  )

  it(`rejects a duplicate visible before startup`, async () => {
    const initial = { id: `initial`, value: `initial` }
    let initialStarts = 0
    const collection = new DbClient().collection(
      collectionOptions({
        id: `mutation-startup-oracle-initial-data`,
        getKey: (row: Row) => row.id,
        startSync: false,
        sync: {
          sync: () => {
            initialStarts++
            throw new Error(`initial duplicate must reject before startup`)
          },
        },
        onInsert: noop,
      }),
      { initialData: [initial] },
    )

    try {
      expect(() => collection.insert({ ...initial })).toThrow(DuplicateKeyError)
      expect(initialStarts).toBe(0)
      expect(collection.status).toBe(`idle`)
      expect(
        collection.toArray.map(({ id, value }) => ({ id, value })),
      ).toEqual([initial])
    } finally {
      await collection.cleanup()
    }
  })

  it(`rejects a duplicate revealed during startup`, async () => {
    const hydrated = { id: `hydrated`, value: `remote` }
    const onInsert = vi.fn(noop)
    let syncStarts = 0
    const collection = createCollection<Row, string>({
      getKey: (row) => row.id,
      startSync: false,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          syncStarts++
          begin()
          write({ type: `insert`, value: hydrated })
          commit()
          markReady()
        },
      },
      onInsert,
    })

    try {
      expect(() =>
        collection.insert({ id: hydrated.id, value: `local` }),
      ).toThrow(DuplicateKeyError)
      expect(syncStarts).toBe(1)
      expect(collection.status).toBe(`ready`)
      expect(
        collection.toArray.map(({ id, value }) => ({ id, value })),
      ).toEqual([hydrated])
      expect(onInsert).not.toHaveBeenCalled()
    } finally {
      await collection.cleanup()
    }
  })

  it(`admits a distinct insert after startup hydrates another key`, async () => {
    const remote = { id: `remote`, value: `remote` }
    const local = { id: `local`, value: `local` }
    let confirm: (rows: Array<Row>) => void = () => {}
    // The handler confirms its insert, so the row stays once it settles.
    const onInsert = vi.fn(
      ({
        transaction,
      }: {
        transaction: { mutations: Array<{ modified: Row }> }
      }) => {
        confirm(transaction.mutations.map((mutation) => mutation.modified))
        return Promise.resolve()
      },
    )
    let syncStarts = 0
    const collection = createCollection<Row, string>({
      getKey: (row) => row.id,
      startSync: false,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          syncStarts++
          begin()
          write({ type: `insert`, value: remote })
          commit()
          markReady()
          confirm = (rows) => {
            begin()
            for (const value of rows) write({ type: `insert`, value })
            commit()
          }
        },
      },
      onInsert,
    })

    try {
      const transaction = collection.insert(local)
      await transaction.isPersisted.promise
      expect(syncStarts).toBe(1)
      expect(onInsert).toHaveBeenCalledTimes(1)
      expect(
        collection.toArray
          .map(({ id, value }) => ({ id, value }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      ).toEqual([local, remote])
    } finally {
      await collection.cleanup()
    }
  })

  it(`starts once across accepted idle inserts and persists both`, async () => {
    let confirm: (rows: Array<Row>) => void = () => {}
    let syncStarts = 0
    let handlerCalls = 0
    const collection = createCollection<Row, string>({
      getKey: (row) => row.id,
      startSync: false,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          syncStarts++
          markReady()
          confirm = (rows) => {
            begin()
            for (const value of rows) write({ type: `insert`, value })
            commit()
          }
        },
      },
      // The handler confirms its insert, so the row stays once it settles.
      onInsert: ({ transaction }) => {
        handlerCalls++
        confirm(transaction.mutations.map((mutation) => mutation.modified))
        return Promise.resolve()
      },
    })

    try {
      expect(syncStarts).toBe(0)
      expect(collection.status).toBe(`idle`)
      const first = collection.insert({ id: `first`, value: `first` })
      expect(syncStarts).toBe(1)
      expect(collection.status).toBe(`ready`)
      const second = collection.insert({ id: `second`, value: `second` })
      await Promise.all([first.isPersisted.promise, second.isPersisted.promise])
      expect(syncStarts).toBe(1)
      expect(collection.status).toBe(`ready`)
      expect(handlerCalls).toBe(2)
      expect(collection.toArray.map(({ id }) => id).sort()).toEqual([
        `first`,
        `second`,
      ])
    } finally {
      await collection.cleanup()
    }
  })

  it.each([`insert`, `update`, `delete`] as const)(
    `propagates %s startup failure before mutation application`,
    async (operation) => {
      const startupError = new Error(`${operation} startup failed`)
      const target = { id: `target`, value: `original` }
      const initialData = operation === `insert` ? [] : [target]
      let syncStarts = 0
      const onInsert = vi.fn(noop)
      const onUpdate = vi.fn(noop)
      const onDelete = vi.fn(noop)
      const collection = new DbClient().collection(
        collectionOptions({
          id: `mutation-startup-oracle-failure-${operation}`,
          getKey: (row: Row) => row.id,
          startSync: false,
          sync: {
            sync: () => {
              syncStarts++
              throw startupError
            },
          },
          onInsert,
          onUpdate,
          onDelete,
        }),
        { initialData },
      )

      try {
        const mutate = () => {
          if (operation === `insert`)
            return collection.insert({ id: `target`, value: `local` })
          if (operation === `update`)
            return collection.update(`target`, (draft) => {
              draft.value = `updated`
            })
          return collection.delete(`target`)
        }
        expect(captureError(mutate)).toBe(startupError)
        expect(syncStarts).toBe(1)
        expect(collection.status).toBe(`error`)
        expect(
          collection.toArray.map(({ id, value }) => ({ id, value })),
        ).toEqual(initialData)
        expect(onInsert).not.toHaveBeenCalled()
        expect(onUpdate).not.toHaveBeenCalled()
        expect(onDelete).not.toHaveBeenCalled()
      } finally {
        await collection.cleanup()
      }
    },
  )
})

/**
 * # When does a Collection become ready during a pending mutation?
 *
 * Readiness counts accepted rows. Once the source marks ready, `preload`,
 * `stateWhenReady`, and `toArrayWhenReady` resolve even if a persisting
 * mutation holds the startup rows; those rows still publish with the drop of
 * that mutation's optimistic state. So a mutation handler that awaits its own
 * Collection's readiness during startup settles. The reference expects every
 * handler to return and the Collection to end `ready` with the startup and
 * confirmed rows. The bounded grammar crosses the three readiness waits, a
 * source that confirms and marks ready inside the handler or outside it while
 * the mutation persists, and optimistic or non-optimistic inserts. The
 * review-probe sequences are cases of this grammar.
 */
describe(`Collection readiness during a pending mutation`, () => {
  type ReadyHistory = {
    wait: `preload` | `stateWhenReady` | `toArrayWhenReady`
    source: `inside-handler` | `outside-handler`
    optimistic: boolean
  }
  const histories: Array<ReadyHistory> = (
    [`preload`, `stateWhenReady`, `toArrayWhenReady`] as const
  ).flatMap((wait) =>
    ([`inside-handler`, `outside-handler`] as const).flatMap((source) =>
      [false, true].map((optimistic) => ({ wait, source, optimistic })),
    ),
  )
  const waitFor = (
    collection: Collection<Row, string>,
    wait: ReadyHistory[`wait`],
  ): Promise<unknown> =>
    wait === `preload`
      ? collection.preload()
      : wait === `stateWhenReady`
        ? collection.stateWhenReady()
        : collection.toArrayWhenReady()

  it.each(histories)(
    `settles a handler awaiting $wait with the source marking ready $source, optimistic=$optimistic`,
    async ({ wait, source, optimistic }) => {
      let sync!: Parameters<SyncConfig<Row, string>[`sync`]>[0]
      let entered!: () => void
      const handlerEntered = new Promise<void>((resolve) => {
        entered = resolve
      })
      const startup = () => {
        sync.begin()
        sync.write({ type: `insert`, value: { id: `server`, value: `server` } })
        sync.write({ type: `insert`, value: { id: `local`, value: `local` } })
        sync.commit()
        sync.markReady()
      }
      const collection = createCollection<Row, string>({
        id: `ready-during-mutation-${wait}-${source}-${optimistic}`,
        getKey: (row) => row.id,
        startSync: true,
        sync: {
          sync: (params) => {
            sync = params
          },
        },
        onInsert: async () => {
          entered()
          if (source === `inside-handler`) startup()
          await waitFor(collection, wait)
        },
      })
      try {
        const insert = collection.insert(
          { id: `local`, value: `local` },
          { optimistic },
        )
        await handlerEntered
        if (source === `outside-handler`) startup()
        const settled = await Promise.race([
          insert.isPersisted.promise.then(() => `settled` as const),
          new Promise<`pending`>((resolve) =>
            setTimeout(() => resolve(`pending`), 200),
          ),
        ])
        expect(settled).toBe(`settled`)
        expect(collection.status).toBe(`ready`)
        expect(
          collection.toArray
            .map(({ id, value }) => ({ id, value }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        ).toEqual([
          { id: `local`, value: `local` },
          { id: `server`, value: `server` },
        ])
      } finally {
        await collection.cleanup()
      }
    },
  )
})
