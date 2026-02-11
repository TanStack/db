// @ts-nocheck
import { DurableObject } from 'cloudflare:workers'
import { createCollection } from '../../../db/dist/esm/index.js'
import {
  createCloudflareDOCollectionRegistry,
  initializeCloudflareDOCollections,
  persistedCollectionOptions,
} from '../../dist/esm/index.js'

const DEFAULT_COLLECTION_ID = `todos`
const DEFAULT_MODE = `local`
const DEFAULT_SCHEMA_VERSION = 1

function parsePersistenceMode(rawMode) {
  const mode = rawMode ?? DEFAULT_MODE
  if (mode === `local` || mode === `sync`) {
    return mode
  }
  throw new Error(`Invalid PERSISTENCE_MODE "${String(mode)}"`)
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
    this.mode = parsePersistenceMode(env.PERSISTENCE_MODE)
    this.schemaVersion = parseSchemaVersion(env.PERSISTENCE_SCHEMA_VERSION)

    this.registry = createCloudflareDOCollectionRegistry({
      storage: this.ctx.storage,
      collections: [
        {
          collectionId: this.collectionId,
          mode: this.mode,
          adapterOptions: {
            schemaVersion: this.schemaVersion,
          },
        },
      ],
    })
    this.ready = initializeCloudflareDOCollections(this.registry)
    this.persistence = this.registry.getPersistence(this.collectionId)
    if (!this.persistence) {
      throw createUnknownCollectionError(this.collectionId)
    }
    this.collection = createCollection(
      persistedCollectionOptions({
        id: this.collectionId,
        getKey: (todo) => todo.id,
        persistence: this.persistence,
      }),
    )
    this.collectionReady = this.collection.stateWhenReady()
  }

  async fetch(request) {
    const url = new URL(request.url)

    try {
      await this.ready

      if (request.method === `GET` && url.pathname === `/health`) {
        return jsonResponse(200, {
          ok: true,
        })
      }

      if (request.method === `GET` && url.pathname === `/runtime-config`) {
        return jsonResponse(200, {
          ok: true,
          collectionId: this.collectionId,
          mode: this.mode,
          schemaVersion: this.schemaVersion,
        })
      }

      const requestBody = await request.json()
      const collectionId = requestBody.collectionId ?? this.collectionId

      if (request.method === `POST` && url.pathname === `/write-todo`) {
        if (collectionId !== this.collectionId) {
          throw createUnknownCollectionError(collectionId)
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
        const adapter = this.registry.getAdapter(unknownCollectionId)
        if (!adapter) {
          throw createUnknownCollectionError(unknownCollectionId)
        }
        const rows = await adapter.loadSubset(unknownCollectionId, {})
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
