import { expectTypeOf, test } from 'vitest'
import { createElectronSQLitePersistence } from '../src'
import type { ElectronPersistenceInvoke } from '../src/protocol'

test(`renderer persistence requires invoke transport`, () => {
  const invoke: ElectronPersistenceInvoke = (_channel, request) => {
    switch (request.method) {
      case `loadSubset`:
        return Promise.resolve({
          v: 2,
          requestId: request.requestId,
          method: request.method,
          ok: true,
          result: [],
        })
      case `loadResumeSnapshot`:
        return Promise.resolve({
          v: 2,
          requestId: request.requestId,
          method: request.method,
          ok: true,
          result: {
            rows: [],
            keySet: { status: `consistent` },
            collectionMetadata: [],
            latestTerm: 0,
            latestSeq: 0,
            latestRowVersion: 0,
            resetEpoch: 0,
          },
        })
      case `pullSince`:
        return Promise.resolve({
          v: 2,
          requestId: request.requestId,
          method: request.method,
          ok: true,
          result: {
            latestRowVersion: 0,
            requiresFullReload: true,
          },
        })
      case `getStreamPosition`:
        return Promise.resolve({
          v: 2,
          requestId: request.requestId,
          method: request.method,
          ok: true,
          result: {
            latestTerm: 0,
            latestSeq: 0,
            latestRowVersion: 0,
          },
        })
      case `loadCollectionMetadata`:
        return Promise.resolve({
          v: 2,
          requestId: request.requestId,
          method: request.method,
          ok: true,
          result: [],
        })
      case `scanRows`:
        return Promise.resolve({
          v: 2,
          requestId: request.requestId,
          method: request.method,
          ok: true,
          result: [],
        })
      default:
        return Promise.resolve({
          v: 2,
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
  expectTypeOf(persistence.adapter).toHaveProperty(`loadResumeSnapshot`)

  createElectronSQLitePersistence({
    invoke,
    // @ts-expect-error renderer-side persistence must use invoke transport, not a direct driver
    driver: {},
  })
})
