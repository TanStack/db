import { plain, snapshot } from './cross-tab-oracle'
import type { Collection } from '../../src'
import type { OracleRow, Publication } from './cross-tab-oracle'

type EventPayload =
  | { type: 'publication'; publication: Publication }
  | { type: 'status'; status: string }
export type RecordedEvent = {
  sequence: number
  collection: string
  syncRun: number
} & EventPayload

/** Capture outputs losslessly before reduction or page destruction. */
export function recordCollection(
  collection: Pick<
    Collection<OracleRow>,
    'subscribeChanges' | 'on' | 'values' | 'status'
  >,
  id: string,
  sink: (event: RecordedEvent) => void = () => {},
  includeInitialState = false,
) {
  const publications: Array<Publication> = []
  const statuses = [collection.status as string]
  const events: Array<RecordedEvent> = []
  let syncRun = 0
  function append(event: EventPayload) {
    const record = structuredClone({
      ...event,
      sequence: events.length,
      collection: id,
      syncRun,
    }) as RecordedEvent
    events.push(record)
    sink(record)
  }
  const stopStatus = collection.on('status:change', ({ status }) => {
    if (status === 'loading') syncRun++
    statuses.push(status)
    append({ type: 'status', status })
  })
  const subscription = collection.subscribeChanges(
    (changes) => {
      const publication: Publication = {
        changes: changes.map((change) => ({
          key: change.key,
          type: change.type,
          value: structuredClone(plain(change.value)),
          ...(change.type === 'update'
            ? {
                previousValue:
                  change.previousValue === undefined
                    ? undefined
                    : structuredClone(plain(change.previousValue)),
              }
            : {}),
        })),
        rows: snapshot(collection.values()),
      }
      publications.push(publication)
      append({ type: 'publication', publication })
    },
    { includeInitialState },
  )
  return {
    publications,
    statuses,
    events,
    stop: () => {
      stopStatus()
      subscription.unsubscribe()
    },
  }
}
