import { expectTypeOf, test } from 'vitest'
import { createElectronSQLitePersistence } from '../src'
import type { ElectronPersistenceInvoke } from '../src/protocol'

test(`renderer persistence requires invoke transport`, () => {
  const invoke: ElectronPersistenceInvoke = (_channel, request) => {
    switch (request.method) {
      case `loadSubset`:
        return Promise.resolve({
          v: 1,
          requestId: request.requestId,
          method: request.method,
          ok: true,
          result: [],
        })
      case `pullSince`:
        return Promise.resolve({
          v: 1,
          requestId: request.requestId,
          method: request.method,
          ok: true,
          result: {
            latestRowVersion: 0,
            requiresFullReload: true,
          },
        })
      default:
        return Promise.resolve({
          v: 1,
          requestId: request.requestId,
          method: request.method,
          ok: true,
          result: null,
        })
    }
  }

  const persistence = createElectronSQLitePersistence({
    invoke,
  })

  expectTypeOf(persistence.adapter).toHaveProperty(`loadSubset`)

  createElectronSQLitePersistence({
    invoke,
    // @ts-expect-error renderer-side persistence must use invoke transport, not a direct driver
    driver: {},
  })
})
