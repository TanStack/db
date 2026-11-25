/**
 * Electric receives the shared complete-result reload law through the real
 * ShapeStream and HTTP protocol. Only source membership is staged. The shared
 * driver holds actual adapter entry, observes acceptance/fulfillment and judges
 * retained rows, omissions and an unsettled optimistic transaction.
 */
import { ShapeStream } from '@electric-sql/client'
import { electricCollectionOptions } from '../src/electric'
import { CrossAdapterElectricHTTP, untilElectric } from './cross-adapter-http'
import type {
  EagerReloadAdapter,
  EagerReloadSDK,
} from '../../db-adapter-conformance/tests/eager-reload-driver'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'

export const crossElectricReloadAdapter: EagerReloadAdapter = {
  open(initial, id) {
    const service = new CrossAdapterElectricHTTP()
    const encode = (rows: Array<StartupRow>) =>
      rows.map(({ id: key, value }) => ({ id: key, value: String(value) }))
    service.stage(encode(initial))
    const options = electricCollectionOptions<StartupRow>({
      id,
      getKey: (row) => row.id,
      shapeOptions: {
        url: `http://electric/cross-${id}`,
        params: { table: `rows` },
        fetchClient: service.fetchClient,
        onError: () => undefined,
      },
    })
    let deliveries = 0
    let expectedDelivery = 0
    const subscribe = ShapeStream.prototype.subscribe
    // The real complete-result callback supplies the observation premise.
    // Empty answers and a missing markReady must still reach comparison.
    // A must-refetch-only callback does not complete the replacement.
    ShapeStream.prototype.subscribe = function (callback, onError) {
      return subscribe.call(
        this,
        (messages) => {
          const complete = messages.some(
            (message) => message.headers.control === `up-to-date`,
          )
          const result = callback(messages)
          void Promise.resolve(result).then(
            () => {
              if (complete) deliveries++
            },
            () => {
              if (complete) deliveries++
            },
          )
          return result
        },
        onError,
      )
    }
    return Promise.resolve({
      // The factory allows both key kinds; every authored row and key in this
      // receiving grammar is a string, including sync metadata operations.
      options: options as EagerReloadSDK[`options`],
      replace: async (rows) => {
        // The prior run has ended and the new source has not entered yet.
        // Drain the prior subscriber's completion before naming the next one.
        await service.settle()
        expectedDelivery = deliveries + 1
        service.stage(encode(rows))
      },
      propagate: async () => {
        await untilElectric(
          () => deliveries >= expectedDelivery,
          `complete-result ShapeStream subscriber delivery completed`,
        )
        await service.settle()
      },
      dispose: async () => {
        try {
          await service.settle()
        } finally {
          ShapeStream.prototype.subscribe = subscribe
        }
      },
    })
  },
}
