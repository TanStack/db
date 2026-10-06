import { expect } from 'vitest'
import { Channel, readStore, seed, withHarness } from './harness'
import { holdStore, observeTransactions } from './idb-driver'
import {
  CrossTabModel,
  assertPublicationHistory,
  assertSnapshot,
  assertStatuses,
  readEffect,
  snapshot,
} from './cross-tab-oracle'
import { recordCollection } from './recorder'
import type { Change, OracleRow } from './cross-tab-oracle'

export type TransportStep = {
  kind: 'write' | 'delete' | 'clear' | 'import' | 'deliver' | 'restart' | 'omit'
  tab: number
  key: number
  value: number
  optional: boolean
}
const keys = [0, '0', 1, '1'] as const
const names = ['items', 'other']

/** Production driver: descriptors, message tasks and native locks, never truth.
 * Every emitted message is associated with its independently authored operation
 * after the operation settles. Expected effects use that operation, not the
 * emitted changedKeys/type/row values. Missing messages fail final convergence.
 * Foreign-store messages must have no effect. Duplicate messages may be no-ops.
 */
export async function runTransportHistory(
  steps: Array<TransportStep>,
  stores = [0, 0, 1],
  reach = new Set<string>(),
) {
  await withHarness(async (h) => {
    const initial = [[{ id: 0, name: 'initial', optional: 7 }], []]
    await seed(h.db, 'items', initial[0]!)
    const model = new CrossTabModel(stores, initial)
    const subjects: Array<ReturnType<typeof h.make>> = []
    const channels: Array<Channel> = []
    const records: Array<ReturnType<typeof recordCollection>> = []
    for (const [tab, store] of stores.entries()) {
      const collection = await h.open(names[store], {
        db: await h.connect(),
        id: `tab-${tab}`,
      })
      subjects.push(collection)
      channels.push([...Channel.peers].at(-1)!)
      const record = recordCollection(collection, `tab-${tab}`)
      records.push(record)
      h.disposers.push(record.stop)
    }
    expect(new Set(h.descriptors.map((descriptor) => descriptor.db)).size).toBe(
      stores.length + 1,
    )
    const causes = new Map<
      (typeof Channel.pending)[number],
      { change: Change; store: number }
    >()
    function checkpoint(label: string) {
      for (const [tab, subject] of subjects.entries()) {
        assertSnapshot(
          subject.values(),
          model.publicSnapshots[tab]!,
          `${label} tab ${tab}`,
        )
        assertStatuses(
          records[tab]!.statuses,
          ['ready', 'cleaned-up', 'loading'],
          `${label} tab ${tab}`,
        )
      }
    }
    async function mutate(
      tab: number,
      change: Change,
      operation: 'write' | 'delete' | 'clear' | 'import',
    ) {
      const subject = subjects[tab]!
      const before = snapshot(model.publicSnapshots[tab]!)
      const offset = records[tab]!.publications.length
      const existing = new Set(Channel.pending)
      if (operation === 'clear') await subject.utils.clearObjectStore()
      else if (operation === 'import')
        await subject.utils.importData(structuredClone(change.rows))
      else if (operation === 'delete')
        await subject.delete(change.deletes[0]!).isPersisted.promise
      else {
        const row = change.rows[0]!
        if (before.some((item) => item.id === row.id))
          await subject.update(row.id, (draft) => {
            draft.name = row.name
            if (row.optional === undefined) delete draft.optional
            else draft.optional = row.optional
          }).isPersisted.promise
        else await subject.insert(structuredClone(row)).isPersisted.promise
      }
      model.accept(tab, change)
      for (const message of Channel.pending)
        if (!existing.has(message))
          causes.set(message, { change, store: stores[tab]! })
      assertPublicationHistory(
        before,
        records[tab]!.publications.slice(offset),
        [change],
        `author ${operation}`,
      )
      checkpoint(`accepted ${operation}`)
      assertSnapshot(
        (await readStore<OracleRow>(h.db, names[stores[tab]!]!)).rows,
        model.durable[stores[tab]!]!,
        `durable ${operation}`,
      )
    }
    async function deliver(tabs: Array<number>) {
      const before = model.publicSnapshots.map(snapshot)
      const offsets = records.map((record) => record.publications.length)
      const effects = stores.map(() => [] as Array<Change>)
      const gate = holdStore(h.db.db, ['items', 'other', '_versions'])
      h.disposers.push(gate.release)
      await gate.started
      const observations = h.descriptors
        .slice(1)
        .map((descriptor) => observeTransactions(descriptor.db))
      for (const observation of observations)
        h.disposers.push(observation.restore)
      const deliveries = []
      try {
        for (const tab of tabs) {
          let index: number
          while (
            (index = Channel.pending.findIndex(
              (message) => message.peer === channels[tab],
            )) !== -1
          ) {
            const message = Channel.pending[index]!
            const cause = causes.get(message)
            if (!cause) throw new Error('Unattributed notification')
            if (cause.store === stores[tab])
              effects[tab]!.push(
                readEffect(model.durable[cause.store]!, cause.change),
              )
            const receipt = Channel.dispatch(index)
            if (receipt) deliveries.push(receipt)
          }
        }
        const reads = observations
          .flatMap((observation) => observation.entries)
          .filter((entry) => entry.mode === 'readonly')
        if (reads.length >= 2) reach.add('overlapping receivers')
        // A native read cannot have completed while the conflicting transaction
        // is held; this checks fixture reach independently of final row equality.
        expect(
          deliveries.every((delivery) => delivery.status === 'pending'),
        ).toBe(true)
        expect(reads.every((entry) => entry.status === 'pending')).toBe(true)
      } finally {
        await gate.release()
      }
      await Promise.all(deliveries.map((delivery) => delivery.completion))
      for (const observation of observations) observation.restore()
      for (const tab of tabs) {
        model.receive(tab, effects[tab]!)
        assertPublicationHistory(
          before[tab]!,
          records[tab]!.publications.slice(offsets[tab]),
          effects[tab]!,
          `receiver tab ${tab}`,
        )
      }
      checkpoint('delivered read window')
    }
    for (const [index, step] of steps.entries()) {
      const tab = step.tab % stores.length
      const id = keys[step.key % keys.length]!
      const row = {
        id,
        name: `value-${index}-${step.value}`,
        ...(step.optional ? { optional: step.value } : {}),
      }
      reach.add(step.kind)
      if (step.kind === 'deliver') await deliver([tab])
      else if (step.kind === 'restart') {
        await subjects[tab]!.cleanup()
        await subjects[tab]!.preload()
        channels[tab] = [...Channel.peers].at(-1)!
        model.restore(tab)
        checkpoint('restart')
      } else if (step.kind === 'omit') {
        if (model.publicSnapshots[tab]!.some((item) => item.id === id))
          await mutate(
            tab,
            { rows: [], deletes: [id], replace: false },
            'delete',
          )
        await mutate(
          tab,
          { rows: [{ id, name: row.name }], deletes: [], replace: false },
          'write',
        )
      } else if (step.kind === 'delete') {
        if (!model.publicSnapshots[tab]!.some((item) => item.id === id))
          await mutate(
            tab,
            { rows: [row], deletes: [], replace: false },
            'write',
          )
        await mutate(tab, { rows: [], deletes: [id], replace: false }, 'delete')
      } else {
        const rows = step.kind === 'clear' ? [] : [row]
        await mutate(
          tab,
          {
            rows,
            deletes: [],
            replace: step.kind === 'clear' || step.kind === 'import',
          },
          step.kind,
        )
      }
    }
    await deliver(stores.map((_, tab) => tab))
    for (const [tab, subject] of subjects.entries())
      assertSnapshot(
        subject.values(),
        model.durable[stores[tab]!]!,
        `existing peer convergence ${tab}`,
      )
    // An ordinary suffix precedes fresh restore; replacement cannot erase a leak.
    const suffix = { id: 'successful suffix', name: 'ordinary write' }
    await mutate(0, { rows: [suffix], deletes: [], replace: false }, 'write')
    await deliver(stores.map((_, tab) => tab))
    for (const [store, expected] of model.durable.entries()) {
      assertSnapshot(
        (await readStore<OracleRow>(h.db, names[store]!)).rows,
        expected,
        'final durable',
      )
      assertSnapshot(
        (await h.open(names[store], { db: await h.connect() })).values(),
        expected,
        'fresh restore',
      )
    }
    expect(Channel.inFlight.size, 'all receiver work completed').toBe(0)
  })
  return reach
}
