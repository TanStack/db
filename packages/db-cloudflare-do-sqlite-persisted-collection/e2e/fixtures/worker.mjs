// @ts-nocheck
import { DurableObject } from 'cloudflare:workers'
import { createCollection } from '../../../db/dist/esm/index.js'
import {
  createCloudflareDOSQLitePersistence,
  persistedCollectionOptions,
} from '../../dist/esm/index.js'

const DEFAULT_COLLECTION_ID = `todos`
const DEFAULT_SCHEMA_VERSION = 1

function resolveCollectionPersistence({
  persistence,
  collectionId,
  syncEnabled,
  schemaVersion,
}) {
  const mode = syncEnabled ? `sync-present` : `sync-absent`
  return (
    persistence.resolvePersistenceForCollection?.({
      collectionId,
      mode,
      schemaVersion,
    }) ??
    persistence.resolvePersistenceForMode?.(mode) ??
    persistence
  )
}

function parseSyncEnabled(rawValue) {
  if (rawValue == null) {
    return false
  }

  const normalized = String(rawValue).toLowerCase()
  if (normalized === `1` || normalized === `true`) {
    return true
  }
  if (normalized === `0` || normalized === `false`) {
    return false
  }

  throw new Error(`Invalid PERSISTENCE_WITH_SYNC "${String(rawValue)}"`)
}

function parseSchemaVersion(rawSchemaVersion) {
  if (rawSchemaVersion == null) {
    return DEFAULT_SCHEMA_VERSION
  }
  const parsed = Number(rawSchemaVersion)
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed
  }
  throw new Error(
    `Invalid PERSISTENCE_SCHEMA_VERSION "${String(rawSchemaVersion)}"`,
  )
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function serializeError(error) {
  if (error && typeof error === `object`) {
    const maybeCode = error.code
    return {
      name: typeof error.name === `string` ? error.name : `Error`,
      message:
        typeof error.message === `string`
          ? error.message
          : `Unknown Cloudflare DO runtime error`,
      code: typeof maybeCode === `string` ? maybeCode : undefined,
    }
  }

  return {
    name: `Error`,
    message: `Unknown Cloudflare DO runtime error`,
    code: undefined,
  }
}

function createUnknownCollectionError(collectionId) {
  const error = new Error(
    `Unknown cloudflare durable object persistence collection "${collectionId}"`,
  )
  error.name = `UnknownCloudflareDOPersistenceCollectionError`
  error.code = `UNKNOWN_COLLECTION`
  return error
}

export class PersistenceObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.collectionId = env.PERSISTENCE_COLLECTION_ID ?? DEFAULT_COLLECTION_ID
    this.syncEnabled = parseSyncEnabled(env.PERSISTENCE_WITH_SYNC)
    this.schemaVersion = parseSchemaVersion(env.PERSISTENCE_SCHEMA_VERSION)
    this.persistence = createCloudflareDOSQLitePersistence({
      storage: this.ctx.storage,
    })
    this.collectionPersistence = resolveCollectionPersistence({
      persistence: this.persistence,
      collectionId: this.collectionId,
      syncEnabled: this.syncEnabled,
      schemaVersion: this.schemaVersion,
    })
    this.ready = this.collectionPersistence.adapter.loadSubset(
      this.collectionId,
      {
        limit: 0,
      },
    )

    const baseCollectionOptions = {
      id: this.collectionId,
      schemaVersion: this.schemaVersion,
      getKey: (todo) => todo.id,
      persistence: this.persistence,
    }
    this.collection = createCollection(
      this.syncEnabled
        ? persistedCollectionOptions({
            ...baseCollectionOptions,
            sync: {
              sync: ({ markReady }) => {
                markReady()
              },
            },
          })
        : persistedCollectionOptions(baseCollectionOptions),
    )
    this.collectionReady = this.collection.stateWhenReady()
  }

  async fetch(request) {
    const url = new URL(request.url)

    try {
      if (request.method === `GET` && url.pathname === `/health`) {
        return jsonResponse(200, {
          ok: true,
        })
      }

      await this.ready

      if (request.method === `GET` && url.pathname === `/runtime-config`) {
        return jsonResponse(200, {
          ok: true,
          collectionId: this.collectionId,
          mode: this.syncEnabled ? `sync` : `local`,
          syncEnabled: this.syncEnabled,
          schemaVersion: this.schemaVersion,
        })
      }

      const requestBody = await request.json()
      const collectionId = requestBody.collectionId ?? this.collectionId

      if (request.method === `POST` && url.pathname === `/write-todo`) {
        if (collectionId !== this.collectionId) {
          throw createUnknownCollectionError(collectionId)
        }
        if (this.syncEnabled) {
          const txId =
            typeof requestBody.txId === `string`
              ? requestBody.txId
              : crypto.randomUUID()
          const seq =
            typeof requestBody.seq === `number` ? requestBody.seq : Date.now()
          const rowVersion =
            typeof requestBody.rowVersion === `number`
              ? requestBody.rowVersion
              : seq
          await this.collectionPersistence.adapter.applyCommittedTx(
            collectionId,
            {
              txId,
              term: 1,
              seq,
              rowVersion,
              mutations: [
                {
                  type: `insert`,
                  key: requestBody.todo.id,
                  value: requestBody.todo,
                },
              ],
            },
          )

          return jsonResponse(200, {
            ok: true,
          })
        }
        await this.collectionReady
        const tx = this.collection.insert(requestBody.todo)
        await tx.isPersisted.promise

        return jsonResponse(200, {
          ok: true,
        })
      }

      if (request.method === `POST` && url.pathname === `/load-todos`) {
        if (collectionId !== this.collectionId) {
          throw createUnknownCollectionError(collectionId)
        }
        if (this.syncEnabled) {
          const rows = await this.collectionPersistence.adapter.loadSubset(
            collectionId,
            {},
          )
          return jsonResponse(200, {
            ok: true,
            rows: rows.map((row) => ({
              key: row.key,
              value: row.value,
            })),
          })
        }
        await this.collectionReady
        const rows = this.collection.toArray.map((todo) => ({
          key: todo.id,
          value: todo,
        }))
        return jsonResponse(200, {
          ok: true,
          rows,
        })
      }

      if (
        request.method === `POST` &&
        url.pathname === `/load-unknown-collection-error`
      ) {
        const unknownCollectionId = requestBody.collectionId ?? `missing`
        if (unknownCollectionId !== this.collectionId) {
          throw createUnknownCollectionError(unknownCollectionId)
        }
        const rows = await this.persistence.adapter.loadSubset(
          unknownCollectionId,
          {},
        )
        return jsonResponse(200, {
          ok: true,
          rows,
        })
      }

      return jsonResponse(404, {
        ok: false,
        error: {
          name: `NotFound`,
          message: `Unknown durable object endpoint "${url.pathname}"`,
          code: `NOT_FOUND`,
        },
      })
    } catch (error) {
      return jsonResponse(500, {
        ok: false,
        error: serializeError(error),
      })
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === `/health`) {
      return jsonResponse(200, {
        ok: true,
      })
    }

    const id = env.PERSISTENCE.idFromName(`default`)
    const stub = env.PERSISTENCE.get(id)
    return stub.fetch(request)
  },
}
