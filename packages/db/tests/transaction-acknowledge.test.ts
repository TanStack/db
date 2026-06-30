import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import type { ChangeMessage, SyncConfig } from '../src/types'
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

  // The emission contract: a single state transition that flips both
  // $acknowledged and $synced is delivered as ONE update event carrying both;
  // two flips at two different times produce two events.
  it(`emits a single combined update when ack and settle coincide (pending -> synced)`, async () => {
    const changes: Array<Change> = []
    const settleGate = createGate()
    let syncOps: Parameters<SyncConfig<Row, string>[`sync`]>[0] | undefined

    const collection = createCollection<Row, string>({
      id: `ack-emit-coincide`,
      getKey: (item) => item.id,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.markReady()
        },
      },
      onInsert: async ({ transaction }) => {
        // No acknowledge(): the ack coincides with settle. When released, echo
        // the write back through sync so the overlay drops and $synced flips.
        await settleGate.promise
        syncOps!.begin()
        for (const mutation of transaction.mutations) {
          syncOps!.write({ type: `insert`, value: mutation.modified })
        }
        syncOps!.commit()
      },
    })

    const subscription = collection.subscribeChanges(
      (events) => changes.push(...events),
      { includeInitialState: false },
    )

    const tx = collection.insert({ id: `r1`, value: `v` })
    await waitForChanges()

    // Optimistic insert: neither acknowledged nor synced.
    expect(changes.length).toBe(1)
    expect(changes[0]!.type).toBe(`insert`)
    expect(changes[0]!.value.$acknowledged).toBe(false)
    expect(changes[0]!.value.$synced).toBe(false)

    // Settle: $acknowledged and $synced flip together in ONE update — not two.
    settleGate.release()
    await tx.isPersisted.promise
    await waitForChanges()

    const updates = changes.filter((c) => c.type === `update`)
    expect(updates.length).toBe(1)
    expect(updates[0]!.value.$acknowledged).toBe(true)
    expect(updates[0]!.value.$synced).toBe(true)
    expect(changes.length).toBe(2)
    // previousValue is coherent with what was actually emitted before: the row
    // was never acknowledged separately, so its previous $acknowledged is false.
    expect(updates[0]!.previousValue?.$acknowledged).toBe(false)
    expect(updates[0]!.previousValue?.$synced).toBe(false)

    subscription.unsubscribe()
  })

  it(`emits two distinct updates when ack precedes settle (pending -> acked -> synced)`, async () => {
    const changes: Array<Change> = []
    const ackGate = createGate()
    const settleGate = createGate()
    let syncOps: Parameters<SyncConfig<Row, string>[`sync`]>[0] | undefined

    const collection = createCollection<Row, string>({
      id: `ack-emit-separate`,
      getKey: (item) => item.id,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.markReady()
        },
      },
      onInsert: async ({ transaction }) => {
        await ackGate.promise
        transaction.acknowledge()
        await settleGate.promise
        syncOps!.begin()
        for (const mutation of transaction.mutations) {
          syncOps!.write({ type: `insert`, value: mutation.modified })
        }
        syncOps!.commit()
      },
    })

    const subscription = collection.subscribeChanges(
      (events) => changes.push(...events),
      { includeInitialState: false },
    )

    const tx = collection.insert({ id: `r1`, value: `v` })
    await waitForChanges()

    // 1) Optimistic insert.
    expect(changes.length).toBe(1)
    expect(changes[0]!.type).toBe(`insert`)
    expect(changes[0]!.value.$acknowledged).toBe(false)
    expect(changes[0]!.value.$synced).toBe(false)

    // 2) Ack: a virtual-prop-only update — $acknowledged flips, $synced does not.
    ackGate.release()
    await tx.isAcknowledged.promise
    await waitForChanges()

    expect(changes.length).toBe(2)
    const ackUpdate = changes[1]!
    expect(ackUpdate.type).toBe(`update`)
    expect(ackUpdate.value.$acknowledged).toBe(true)
    expect(ackUpdate.value.$synced).toBe(false)
    expect(ackUpdate.previousValue?.$acknowledged).toBe(false)

    // 3) Settle: a second, separate update — now $synced flips too.
    settleGate.release()
    await tx.isPersisted.promise
    await waitForChanges()

    expect(changes.length).toBe(3)
    const settleUpdate = changes[2]!
    expect(settleUpdate.type).toBe(`update`)
    expect(settleUpdate.value.$acknowledged).toBe(true)
    expect(settleUpdate.value.$synced).toBe(true)
    // The row was acknowledged before it settled, so previousValue reflects
    // that: $acknowledged was already true, only $synced flips here.
    expect(settleUpdate.previousValue?.$acknowledged).toBe(true)
    expect(settleUpdate.previousValue?.$synced).toBe(false)

    subscription.unsubscribe()
  })
})
