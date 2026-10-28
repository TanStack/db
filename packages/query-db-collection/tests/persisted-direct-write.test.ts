// Ordinary unit tests for direct writes that interleave with refetches, and for
// the oracle harness's failure reporting. Their expected rows are pinned by
// hand from the precedence rules in each test's comments. The matrix and ordering
// laws are owned by persisted-direct-write-window.oracle.test.ts.
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { queryCollectionOptions } from '../src/query'
import {
  checked,
  createAdapter,
  deferred,
  flush,
  heldQueryFn,
  newQueryClient,
  outcomeOf,
  sortRows,
} from './persisted-direct-write-support'
import type { QueryCollectionUtils } from '../src/query'
import type { Row } from './persisted-direct-write-support'

describe(`the oracle harness keeps the primary failure`, () => {
  it(`reports the driver's failure when cleanup also fails`, async () => {
    const report = await checked(() => {
      expect(1, `the driver's assertion`).toBe(2)
      return Promise.resolve()
    }, [
      () => {
        throw new Error(`cleanup failed on purpose`)
      },
    ]).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(report).toBeInstanceOf(AggregateError)
    const aggregate = report as AggregateError
    expect((aggregate.cause as Error).message).toContain(
      `the driver's assertion`,
    )
    expect(aggregate.message).toContain(`the driver's assertion`)
    expect(aggregate.errors).toHaveLength(2)
    expect(aggregate.errors[0]).toBe(aggregate.cause)
    expect((aggregate.errors[1] as Error).message).toBe(
      `cleanup failed on purpose`,
    )
  })
})

/**
 * ## Direct writes interleaved with refetches: the precedence model
 *
 * The rows above come from a reference collection. That reference runs the
 * same direct-write code, so it cannot judge a fault in the code both paths
 * share. The laws below take their expected rows from this model instead:
 *
 * 1. A direct write takes its position in the order of operations when it is
 *    called. A fetch that starts later reflects the server after the write.
 * 2. Only an accepted write gains precedence over a fetch that started before
 *    it. A rejected write changes no rows and gains no precedence.
 * 3. For each key, the newest of these wins: the latest accepted write, or a
 *    fetch that started after it.
 * 4. `await refetch()` settles after its result's rows apply, even when that
 *    result had to wait for a direct write.
 * 5. A write whose sync run cleanup retired while it waited rejects, and it
 *    stores nothing.
 *
 * Each case below states its expected rows from these rules. The histories
 * are finite and pinned. Rule 4 is observed inside the refetch's fulfillment
 * callback, not after a later flush, because a later flush hides a refetch
 * that settles early.
 */

type FailedWrite = `insert` | `update` | `delete` | `batch`

function failingWrite(
  utils: QueryCollectionUtils<Row>,
  failed: FailedWrite,
): unknown {
  switch (failed) {
    case `insert`:
      // `k` exists in the applied rows, so this insert is a duplicate.
      return utils.writeInsert({ id: `k`, value: 9 })
    case `update`:
      // `k` is not in the applied rows.
      return utils.writeUpdate({ id: `k`, value: 9 })
    case `delete`:
      return utils.writeDelete(`k`)
    case `batch`:
      return utils.writeBatch(() => {
        utils.writeInsert({ id: `k`, value: 9 })
        utils.writeInsert({ id: `k`, value: 10 })
      })
  }
}

/** A persisted collection whose next durable write can be held. */
function heldPersistedCollection(
  id: string,
  storage: ReturnType<typeof createAdapter>,
  queryFn: () => Promise<Array<Row>>,
) {
  // Each hold catches the next durable write that changes rows.
  let held:
    | {
        entered: ReturnType<typeof deferred<void>>
        gate: ReturnType<typeof deferred<void>>
      }
    | undefined
  let first: typeof held
  const original = storage.applyCommittedTx
  storage.applyCommittedTx = async (...args) => {
    const current = held
    if (current && args[1].mutations.length) {
      held = undefined
      current.entered.resolve()
      await current.gate.promise
    }
    return original(...args)
  }
  const queryClient = newQueryClient()
  const queryKey = [id]
  const collection = createCollection(
    persistedCollectionOptions<
      Row,
      string | number,
      never,
      QueryCollectionUtils<Row>
    >({
      ...queryCollectionOptions<Row>({
        id,
        queryKey,
        queryClient,
        queryFn,
        getKey: (row) => row.id,
        startSync: true,
      }),
      persistence: { adapter: storage },
    }),
  )
  return {
    collection,
    queryClient,
    queryKey,
    hold: () => {
      held = { entered: deferred(), gate: deferred() }
      first ??= held
      return {
        entered: held.entered.promise,
        release: held.gate.resolve,
      }
    },
    get entered() {
      return first!.entered.promise
    },
    release: () => first?.gate.resolve(),
  }
}

describe(`direct writes interleaved with refetches follow the precedence model`, () => {
  for (const persistence of [false, true]) {
    for (const failed of [`insert`, `update`, `delete`, `batch`] as const) {
      it(`a rejected ${failed} leaves an in-flight refetch authoritative (persisted=${persistence})`, async () => {
        // Rule 2: the rejected write gains no precedence, so the refetch's
        // row for `k` (value 2) is the expected row.
        const base = failed === `insert` ? [{ id: `k`, value: 1 }] : []
        const held = heldQueryFn(() => base)
        const id = `rejected-${failed}-${persistence}`
        const queryClient = newQueryClient()
        const options = queryCollectionOptions<Row>({
          id,
          queryKey: [id],
          queryClient,
          queryFn: held.queryFn,
          getKey: (row) => row.id,
          startSync: true,
        })
        const collection = persistence
          ? createCollection(
              persistedCollectionOptions<
                Row,
                string | number,
                never,
                QueryCollectionUtils<Row>
              >({ ...options, persistence: { adapter: createAdapter(base) } }),
            )
          : createCollection(options)
        await checked(async () => {
          await collection.preload()
          held.arm()
          const refetch = collection.utils.refetch()
          await vi.waitFor(() => expect(held.calls.length).toBe(1))
          const result = await outcomeOf(() =>
            failingWrite(collection.utils, failed),
          )
          expect(result).toMatchObject({ timing: `async` })
          expect(result.outcome).not.toBe(`ok`)
          held.disarm()
          held.calls[0]!.resolve([{ id: `k`, value: 2 }])
          const rowsAtSettlement = await refetch.then(() =>
            sortRows(collection.values()),
          )
          expect(rowsAtSettlement).toEqual([{ id: `k`, value: 2 }])
          expect(
            sortRows(queryClient.getQueryData<Array<Row>>([id]) ?? []),
          ).toEqual([{ id: `k`, value: 2 }])
        }, [() => collection.cleanup()])
      })
    }
  }

  it(`a queued write sees an earlier queued write`, async () => {
    // Rule 3: the insert of k=3 is accepted first, so the update to k=4 is
    // valid and wins.
    let server = [{ id: `a`, value: 1 }]
    const storage = createAdapter(server)
    const fixture = heldPersistedCollection(`two-queued-writes`, storage, () =>
      Promise.resolve(server.map((row) => ({ ...row }))),
    )
    const { collection } = fixture
    await checked(async () => {
      await collection.preload()
      fixture.hold()
      server = [{ id: `a`, value: 2 }]
      const refetch = collection.utils.refetch()
      await fixture.entered
      const first = outcomeOf(() =>
        collection.utils.writeInsert({ id: `k`, value: 3 }),
      )
      const second = outcomeOf(() =>
        collection.utils.writeUpdate({ id: `k`, value: 4 }),
      )
      fixture.release()
      expect((await first).outcome).toBe(`ok`)
      expect((await second).outcome).toBe(`ok`)
      await refetch
      expect(sortRows(collection.values())).toEqual([
        { id: `a`, value: 2 },
        { id: `k`, value: 4 },
      ])
    }, [() => fixture.release(), () => collection.cleanup()])
  })

  it(`a refetch that waited for a direct write settles after its rows apply`, async () => {
    // Rule 4. The later refetch starts after the write, so its row wins
    // (rule 1). Its fulfillment must already see that row.
    let server = [{ id: `k`, value: 1 }]
    const storage = createAdapter(server)
    const held = heldQueryFn(() => server)
    const fixture = heldPersistedCollection(
      `settles-after-apply`,
      storage,
      held.queryFn,
    )
    const { collection } = fixture
    await checked(async () => {
      await collection.preload()
      fixture.hold()
      server = [{ id: `k`, value: 2 }]
      const firstRefetch = collection.utils.refetch()
      await fixture.entered
      const directWrite = outcomeOf(() =>
        collection.utils.writeUpdate({ id: `k`, value: 9 }),
      )
      held.arm()
      let settled = false
      const later = collection.utils.refetch().then(() => {
        settled = true
        return sortRows(collection.values())
      })
      await vi.waitFor(() => expect(held.calls.length).toBe(1))
      held.disarm()
      held.calls[0]!.resolve([{ id: `k`, value: 6 }])
      await flush()
      await flush()
      expect({ settled, rows: sortRows(collection.values()) }).toEqual({
        settled: false,
        rows: [{ id: `k`, value: 2 }],
      })
      fixture.release()
      expect(await later).toEqual([{ id: `k`, value: 6 }])
      await Promise.all([firstRefetch, directWrite])
    }, [() => fixture.release(), () => collection.cleanup()])
  })

  it(`a refetch that waited for a direct write settles only after its held merge applies`, async () => {
    // Rule 4 when the merged rows' own durable write is held: the refetch
    // must keep waiting until that write releases and the rows apply.
    let server = [{ id: `k`, value: 1 }]
    const storage = createAdapter(server)
    const held = heldQueryFn(() => server)
    const fixture = heldPersistedCollection(
      `settles-after-held-merge`,
      storage,
      held.queryFn,
    )
    const { collection } = fixture
    let mergeHold: ReturnType<typeof fixture.hold> | undefined
    await checked(async () => {
      await collection.preload()
      fixture.hold()
      server = [{ id: `k`, value: 2 }]
      const firstRefetch = collection.utils.refetch()
      await fixture.entered
      const directWrite = outcomeOf(() =>
        collection.utils.writeUpdate({ id: `k`, value: 9 }),
      )
      held.arm()
      let settled = false
      const later = collection.utils.refetch().then(() => {
        settled = true
        return sortRows(collection.values())
      })
      await vi.waitFor(() => expect(held.calls.length).toBe(1))
      held.disarm()
      held.calls[0]!.resolve([{ id: `k`, value: 6 }])
      await flush()
      // Release the first hold, but catch the next row write: the direct
      // write's, then the merged result's.
      mergeHold = fixture.hold()
      fixture.release()
      await mergeHold.entered
      const writeHold = mergeHold
      mergeHold = fixture.hold()
      writeHold.release()
      await mergeHold.entered
      await flush()
      expect(settled).toBe(false)
      mergeHold.release()
      expect(await later).toEqual([{ id: `k`, value: 6 }])
      await Promise.all([directWrite, firstRefetch])
    }, [
      () => fixture.release(),
      () => mergeHold?.release(),
      () => collection.cleanup(),
    ])
  })

  for (const sibling of [false, true]) {
    it(`a write after a deferred result arrives keeps precedence (${sibling ? `sibling key` : `same key`})`, async () => {
      // W1 writes k=9. R3 starts after W1 and returns k=6, so R3 wins on k
      // (rule 1). W2 is called after R3 started, so W2 wins on its key
      // (rule 3): k=10 for the same key, or j=10 beside k=6.
      let server = [{ id: `k`, value: 1 }]
      const storage = createAdapter(server)
      const held = heldQueryFn(() => server)
      const id = `second-write-${sibling ? `sibling` : `same`}`
      const fixture = heldPersistedCollection(id, storage, held.queryFn)
      const { collection, queryClient, queryKey } = fixture
      await checked(async () => {
        await collection.preload()
        fixture.hold()
        server = [{ id: `k`, value: 5 }]
        const first = collection.utils.refetch()
        await fixture.entered
        const w1 = outcomeOf(() =>
          collection.utils.writeUpdate({ id: `k`, value: 9 }),
        )
        held.arm()
        const r3 = collection.utils.refetch()
        await vi.waitFor(() => expect(held.calls.length).toBe(1))
        held.disarm()
        held.calls[0]!.resolve(
          sibling
            ? [
                { id: `j`, value: 1 },
                { id: `k`, value: 6 },
              ]
            : [{ id: `k`, value: 6 }],
        )
        await flush()
        const w2 = outcomeOf(() =>
          sibling
            ? collection.utils.writeUpsert({ id: `j`, value: 10 })
            : collection.utils.writeUpdate({ id: `k`, value: 10 }),
        )
        fixture.release()
        expect((await w1).outcome).toBe(`ok`)
        expect((await w2).outcome).toBe(`ok`)
        await Promise.all([first, r3])
        await flush()
        const expected = sibling
          ? [
              { id: `j`, value: 10 },
              { id: `k`, value: 6 },
            ]
          : [{ id: `k`, value: 10 }]
        expect({
          rows: sortRows(collection.values()),
          cache: sortRows(queryClient.getQueryData<Array<Row>>(queryKey) ?? []),
          stored: sortRows(storage.rows.values()),
        }).toEqual({ rows: expected, cache: expected, stored: expected })
      }, [() => fixture.release(), () => collection.cleanup()])
    })
  }

  for (const op of [`insert`, `upsert`, `batch`] as const) {
    it(`a ${op} whose sync run cleanup retired while it waited rejects and stores nothing`, async () => {
      // Rule 5. The write waits behind a held durable write, then cleanup
      // starts before the lock is released.
      let server = [{ id: `a`, value: 1 }]
      const storage = createAdapter(server)
      const fixture = heldPersistedCollection(`cleanup-${op}`, storage, () =>
        Promise.resolve(server.map((row) => ({ ...row }))),
      )
      const { collection } = fixture
      await checked(async () => {
        await collection.preload()
        fixture.hold()
        server = [{ id: `a`, value: 2 }]
        const refetch = collection.utils.refetch().catch(() => undefined)
        await fixture.entered
        const pending = outcomeOf(() =>
          op === `insert`
            ? collection.utils.writeInsert({ id: `z`, value: 9 })
            : op === `upsert`
              ? collection.utils.writeUpsert({ id: `z`, value: 9 })
              : collection.utils.writeBatch(() => {
                  collection.utils.writeInsert({ id: `z`, value: 9 })
                }),
        )
        const cleanup = collection.cleanup()
        fixture.release()
        await cleanup
        const result = await pending
        await refetch
        expect(result.outcome).not.toBe(`ok`)
        expect(storage.rows.has(`z`)).toBe(false)
        // A restart over the same storage publishes no `z`.
        const restarted = createCollection(
          persistedCollectionOptions<
            Row,
            string | number,
            never,
            QueryCollectionUtils<Row>
          >({
            ...queryCollectionOptions<Row>({
              id: `cleanup-${op}`,
              queryKey: [`cleanup-${op}-restart`],
              queryClient: newQueryClient(),
              queryFn: () => Promise.resolve(server.map((row) => ({ ...row }))),
              getKey: (row) => row.id,
              startSync: true,
            }),
            persistence: { adapter: storage },
          }),
        )
        try {
          await restarted.preload()
          expect(restarted.has(`z`)).toBe(false)
        } finally {
          await restarted.cleanup()
        }
      }, [() => fixture.release(), () => collection.cleanup()])
    })
  }
})
