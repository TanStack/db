/**
 * Real SDK receivers for complete eager reload and terminal initial gates.
 * Service membership changes while no retired stream can deliver events.
 * The shared model judges retained rows, readiness and optimistic settlement.
 */
import { trailBaseCollectionOptions } from '../src/trailbase'
import { TrailBaseSdkService, untilSdk } from './sdk-service'
import type {
  EagerGateAdapter,
  EagerReloadAdapter,
} from '../../db-adapter-conformance/tests/eager-reload-driver'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'

export const trailBaseSdkReloadAdapter: EagerReloadAdapter = {
  open(initial, id) {
    const service = new TrailBaseSdkService<StartupRow>()
    service.rows = initial
    let completeList = Promise.resolve()
    let finishList = () => {}
    let rejectList = (_error: unknown) => {}
    const list = service.api.list.bind(service.api)
    service.api.list = (...args) => {
      const delivered = list(...args)
      // This is the real RecordApi list Promise, after HTTP JSON decoding.
      // The source can request it only after consuming its actual SDK stream.
      // Three-key histories fit one page, including the empty complete page.
      void delivered.then(finishList, rejectList)
      return delivered
    }
    const options = trailBaseCollectionOptions({
      id,
      recordApi: service.api,
      getKey: (row: StartupRow) => row.id,
      parse: {},
      serialize: {},
    })
    const source = options.sync.sync
    options.sync.sync = (params) => {
      completeList = new Promise<void>((resolve, reject) => {
        finishList = resolve
        rejectList = reject
      })
      void completeList.catch(() => {})
      return source(params)
    }
    return Promise.resolve({
      options,
      replace(rows) {
        service.rows = rows
        return Promise.resolve()
      },
      propagate: async () => {
        await completeList
        // Delivery above establishes the premise. Drain only finite load/start
        // continuations here, independently of commit, markReady or visibility.
        await service.propagate()
      },
      dispose: () => Promise.resolve(service.dispose()),
    })
  },
}

export const trailBaseSdkGateAdapter: EagerGateAdapter = {
  sources: [`list`, `subscription`],
  open(source) {
    const service = new TrailBaseSdkService<StartupRow>()
    service.holdLists = true
    let answered = 0
    return Promise.resolve({
      options: (id) =>
        trailBaseCollectionOptions({
          id,
          recordApi: service.api,
          getKey: (row: StartupRow) => row.id,
          parse: {},
          serialize: {},
        }),
      hold: () => {
        service.holdLists = true
      },
      deliver: async (rows) => {
        await untilSdk(() => service.lists.length > answered, `held eager list`)
        service.rows = rows
        service.lists[answered++]!.resolve(rows)
        await service.propagate()
      },
      reject: async (message, reconnect) => {
        const error = new Error(message)
        if (source === `list`) {
          service.listFailure = error
          if (service.lists.length > answered)
            service.lists[answered++]!.reject(error)
          else if (reconnect) service.fail(error)
        } else {
          service.subscriptionFailure = error
          await untilSdk(
            () => service.streams.length > 0,
            `wildcard HTTP stream acquired`,
          )
          service.fail(error)
        }
        await service.propagate()
      },
      propagate: () => service.propagate(),
      terminalEntries: () => service.terminalEntries,
      prepareRecovery: (rows) => {
        service.rows = rows
        service.holdLists = false
        service.listFailure = undefined
        service.subscriptionFailure = undefined
        return Promise.resolve()
      },
      matchesFailure: (error, message) =>
        error instanceof Error && error.message === message,
      dispose: () => Promise.resolve(service.dispose()),
    })
  },
}
