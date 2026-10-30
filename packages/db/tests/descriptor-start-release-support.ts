// Shared production fixture only. The independently derived expected result
// remains in descriptor-start-release-oracle.ts; native hosts own failed mounts.
import { DbClient, Query, collectionOptions } from '@tanstack/db'
import type { DescriptorStartHistory } from './descriptor-start-release-oracle'

type Row = { id: string; value: string }
let sequence = 0
export function descriptorStartFixture(
  history: DescriptorStartHistory,
  host: string,
) {
  const client = new DbClient()
  const id = `descriptor-start-${host}-${sequence++}`
  const factories = Array.from({ length: history.acquired + 1 }, () => 0)
  const starts = Array.from({ length: history.acquired }, () => 0)
  const cleanups = Array.from({ length: history.acquired }, () => 0)
  const startErrors = starts.map((_, index) => new Error(`start ${index}`))
  const failure = new Error(`factory failed ${id}`)
  let failures = 0
  const descriptors = starts.map((_, index) =>
    collectionOptions(`${id}-${index}`, () => {
      factories[index] = factories[index]! + 1
      return {
        id: `${id}-${index}`,
        getKey: (row: Row) => row.id,
        startSync: Boolean(history.eagerStarts & (1 << index)),
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            starts[index] = starts[index]! + 1
            if (history.failedStarts & (1 << index)) throw startErrors[index]
            begin()
            write({
              type: `insert`,
              value: { id: `row-${index}`, value: `value-${index}` },
            })
            commit()
            markReady()
            return () => {
              cleanups[index] = cleanups[index]! + 1
            }
          },
        },
      }
    }),
  )
  const rejected = collectionOptions(`${id}-failure`, () => {
    failures++
    throw failure
  })
  const tail = collectionOptions(`${id}-tail`, () => {
    factories[history.acquired] = factories[history.acquired]! + 1
    return {
      getKey: (row: Row) => row.id,
      sync: { sync: () => {} },
    }
  })
  // Union arms preserve authored binding order without requiring any source
  // rows or graph execution. The rejected factory prevents the tail's binding.
  const arms = [...descriptors, rejected, tail].map((row) =>
    new Query().from({ row }).select(({ row: value }) => ({
      id: value.id,
      value: value.value,
    })),
  )
  const query = new Query().unionAll(arms[0]!, arms[1]!, ...arms.slice(2))
  const collections = () => descriptors.map((row) => client.collection(row))
  let retained: ReturnType<typeof collections> = []
  const observe = () => ({
    factories: [...factories],
    starts: [...starts],
    cleanups: [...cleanups],
    statuses: retained.map((row) => row.status),
    rows: retained.map((row) =>
      row.toArray.map(({ id: key, value }) => ({ id: key, value })),
    ),
  })
  return {
    client,
    query,
    id,
    failure,
    startErrors,
    factories,
    failures: () => failures,
    retain: () => {
      retained = collections()
    },
    collections: () => retained,
    observe,
  }
}
