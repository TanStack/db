// @ts-nocheck
import { DurableObject } from 'cloudflare:workers'
import {
  createCloudflareDOCollectionRegistry,
  initializeCloudflareDOCollections,
} from '../../dist/esm/index.js'

const DEFAULT_COLLECTION_ID = `todos`

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
    this.registry = createCloudflareDOCollectionRegistry({
      storage: this.ctx.storage,
      collections: [
        {
          collectionId: DEFAULT_COLLECTION_ID,
          mode: `local`,
          adapterOptions: {
            schemaVersion: 1,
          },
        },
      ],
    })
    this.ready = initializeCloudflareDOCollections(this.registry)
  }

  getAdapter(collectionId) {
    const adapter = this.registry.getAdapter(collectionId)
    if (!adapter) {
      throw createUnknownCollectionError(collectionId)
    }
    return adapter
  }

  async fetch(request) {
    await this.ready
    const url = new URL(request.url)

    try {
      if (request.method === `GET` && url.pathname === `/health`) {
        return jsonResponse(200, {
          ok: true,
        })
      }

      const requestBody = await request.json()
      const collectionId = requestBody.collectionId ?? DEFAULT_COLLECTION_ID

      if (request.method === `POST` && url.pathname === `/write-todo`) {
        const adapter = this.getAdapter(collectionId)
        await adapter.applyCommittedTx(collectionId, {
          txId: requestBody.txId,
          term: 1,
          seq: requestBody.seq,
          rowVersion: requestBody.rowVersion,
          mutations: [
            {
              type: `insert`,
              key: requestBody.todo.id,
              value: requestBody.todo,
            },
          ],
        })

        return jsonResponse(200, {
          ok: true,
        })
      }

      if (request.method === `POST` && url.pathname === `/load-todos`) {
        const adapter = this.getAdapter(collectionId)
        const rows = await adapter.loadSubset(collectionId, {})
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
