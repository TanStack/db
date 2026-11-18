/**
 * A real ShapeStream gives up after a controlled HTTP 400. Each Collection
 * owns its ShapeStream, so the shared failed-subscription entry is absent.
 * The two sources cover app onError returning and throwing. Failure identity
 * comes from that actual callback, not an expected Collection verdict.
 */
import { electricCollectionOptions } from '../src/electric'
import { CrossAdapterElectricHTTP, untilElectric } from './cross-adapter-http'
import type {
  EagerGateAdapter,
  EagerReloadSDK,
} from '../../db-adapter-conformance/tests/eager-reload-driver'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'

export const crossElectricGateAdapter: EagerGateAdapter = {
  sources: [`return`, `throw`],
  open(source) {
    const service = new CrossAdapterElectricHTTP()
    let terminalEntries = 0
    let expectedEntries = 0
    let failure: unknown
    let suppliedMessage = ``
    const encode = (rows: Array<StartupRow>) =>
      rows.map(({ id, value }) => ({ id, value: String(value) }))
    return Promise.resolve({
      options: (id) =>
        // The factory's public key union narrows to the string-only grammar.
        electricCollectionOptions<StartupRow>({
          id,
          getKey: (row) => row.id,
          shapeOptions: {
            url: `http://electric/gate-${id}`,
            params: { table: `rows` },
            fetchClient: service.fetchClient,
            onError: (error) => {
              terminalEntries++
              failure = source === `throw` ? new Error(suppliedMessage) : error
              if (source === `throw`) throw failure
              return undefined
            },
          },
        }) as EagerReloadSDK[`options`],
      hold() {},
      async deliver(rows) {
        service.stage(encode(rows))
        await service.settle()
      },
      async reject(message) {
        suppliedMessage = message
        expectedEntries = terminalEntries + 1
        const request = await service.take()
        request.respond(new Response(message, { status: 400 }))
      },
      async propagate() {
        await untilElectric(
          () => terminalEntries >= expectedEntries,
          `terminal ShapeStream onError callback`,
        )
        await service.settle()
      },
      terminalEntries: () => terminalEntries,
      prepareRecovery(rows) {
        service.stage(encode(rows))
        return Promise.resolve()
      },
      matchesFailure: (error) => error === failure,
      dispose: () => service.settle(),
    })
  },
}
