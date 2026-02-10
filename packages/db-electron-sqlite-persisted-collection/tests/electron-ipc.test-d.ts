import { expectTypeOf, test } from 'vitest'
import { createElectronRendererPersistenceAdapter } from '../src'
import type { ElectronPersistenceInvoke } from '../src'

test(`renderer adapter requires ipc invoke transport`, () => {
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

  const adapter = createElectronRendererPersistenceAdapter({
    invoke,
  })

  expectTypeOf(adapter).toHaveProperty(`loadSubset`)

  // @ts-expect-error renderer-side persistence must use invoke transport, not a direct driver
  createElectronRendererPersistenceAdapter({
    invoke,
    driver: {},
  })
})
