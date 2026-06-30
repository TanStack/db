import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import type { ChangeMessage } from '../src/types'
import type { OutputWithVirtual } from './utils'

const waitForChanges = () => new Promise((resolve) => setTimeout(resolve, 10))

type Row = { id: string; value: string }
type Change = ChangeMessage<OutputWithVirtual<Row, string>>

function createGate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe(`Transaction.acknowledge() — the ack layer`, () => {
  it(`flips $acknowledged and resolves isAcknowledged while still persisting, without settling`, async () => {
    const changes: Array<Change> = []
    const ackGate = createGate()
    const settleGate = createGate()

    const collection = createCollection<Row, string>({
      id: `ack-flip`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => markReady(),
      },
      onInsert: async ({ transaction }) => {
        // Wait until the test lets the "server" ack, then mark acknowledged but
        // keep the handler open (settle hasn't happened yet).
        await ackGate.promise
        transaction.acknowledge()
        await settleGate.promise
      },
    })

    const subscription = collection.subscribeChanges(
      (events) => changes.push(...events),
      { includeInitialState: false },
    )

    const tx = collection.insert({ id: `r1`, value: `v` })
    await waitForChanges()

    // Optimistic insert: not acknowledged, not synced.
    const optimistic = changes.find(
      (c) => c.type === `insert` && c.key === `r1`,
    )
    expect(optimistic).toBeDefined()
    expect(optimistic!.value.$acknowledged).toBe(false)
    expect(optimistic!.value.$synced).toBe(false)
    expect(tx.acknowledged).toBe(false)

    // Release the ack.
    changes.length = 0
    ackGate.release()
    await tx.isAcknowledged.promise
    await waitForChanges()

    // Transaction is acknowledged but still persisting (handler hasn't returned).
    expect(tx.acknowledged).toBe(true)
    expect(tx.state).toBe(`persisting`)
    expect(tx.isPersisted.isPending()).toBe(true)

    // A virtual-prop-only update was emitted: $acknowledged false -> true,
    // value unchanged, $synced still false.
    const flip = changes.find((c) => c.type === `update` && c.key === `r1`)
    expect(flip).toBeDefined()
    expect(flip!.value.$acknowledged).toBe(true)
    expect(flip!.previousValue?.$acknowledged).toBe(false)
    expect(flip!.value.$synced).toBe(false)

    // Reading the row directly reflects the acknowledged-but-not-synced state.
    const row = collection.state.get(`r1`)
    expect(row?.$acknowledged).toBe(true)
    expect(row?.$synced).toBe(false)

    // Now let the handler return (settle).
    settleGate.release()
    await tx.isPersisted.promise
    expect(tx.state).toBe(`completed`)

    subscription.unsubscribe()
  })

  it(`resolves isAcknowledged together with isPersisted when the collection never calls acknowledge()`, async () => {
    const collection = createCollection<Row, string>({
      id: `ack-coincide`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => markReady(),
      },
      onInsert: async () => {
        // No acknowledge() — a backend without a separate ack signal.
      },
    })

    const tx = collection.insert({ id: `r1`, value: `v` })

    // isAcknowledged is still safe to await and resolves no later than isPersisted.
    await expect(tx.isAcknowledged.promise).resolves.toBe(tx)
    await expect(tx.isPersisted.promise).resolves.toBe(tx)
    expect(tx.acknowledged).toBe(true)
  })

  it(`rejects isAcknowledged when the transaction fails before acknowledgement`, async () => {
    const collection = createCollection<Row, string>({
      id: `ack-fail`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => markReady(),
      },
      onInsert: async () => {
        throw new Error(`server rejected`)
      },
    })

    const tx = collection.insert({ id: `r1`, value: `v` })

    await expect(tx.isAcknowledged.promise).rejects.toThrow(`server rejected`)
    await expect(tx.isPersisted.promise).rejects.toThrow(`server rejected`)
    expect(tx.acknowledged).toBe(false)
  })

  it(`keeps an already-acknowledged ack when a later settle fails`, async () => {
    const settleGate = createGate()
    const collection = createCollection<Row, string>({
      id: `ack-then-fail`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => markReady(),
      },
      onInsert: async ({ transaction }) => {
        transaction.acknowledge()
        await settleGate.promise
        throw new Error(`settle failed`)
      },
    })

    const tx = collection.insert({ id: `r1`, value: `v` })
    await tx.isAcknowledged.promise
    expect(tx.acknowledged).toBe(true)

    settleGate.release()
    await expect(tx.isPersisted.promise).rejects.toThrow(`settle failed`)
    // The ack already resolved; it is not retroactively rejected.
    await expect(tx.isAcknowledged.promise).resolves.toBe(tx)
  })

  it(`treats synced rows as acknowledged`, async () => {
    const collection = createCollection<Row, string>({
      id: `ack-synced`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: `r1`, value: `v` } })
          commit()
          markReady()
        },
      },
    })

    // Subscribing starts sync for this lazily-synced collection.
    const subscription = collection.subscribeChanges(() => {})
    await waitForChanges()
    const row = collection.state.get(`r1`)
    expect(row?.$synced).toBe(true)
    expect(row?.$acknowledged).toBe(true)
    subscription.unsubscribe()
  })

  it(`acknowledge() is idempotent and a no-op after completion`, async () => {
    const collection = createCollection<Row, string>({
      id: `ack-idempotent`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => markReady(),
      },
      onInsert: async ({ transaction }) => {
        transaction.acknowledge()
        transaction.acknowledge() // second call is a no-op
      },
    })

    const tx = collection.insert({ id: `r1`, value: `v` })
    await tx.isPersisted.promise

    // No-op after completion, returns the transaction for chaining.
    expect(tx.acknowledge()).toBe(tx)
    expect(tx.acknowledged).toBe(true)
  })
})
