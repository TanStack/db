import { convexToJson, jsonToConvex } from 'convex/values'
import { NonRetriableError } from '@tanstack/offline-transactions'
import type { JSONValue, Value } from 'convex/values'
import type {
  MutationValueCodec,
  OfflineConfig,
} from '@tanstack/offline-transactions'
import type { ConvexClient } from 'convex/browser'
import type { ConvexReactClient } from 'convex/react'
import type { FunctionArgs, FunctionReference } from 'convex/server'
import type { ConvexCollectionUtils } from './options'

type OfflineMutation = OfflineConfig[`mutationFns`][string]
type OfflineParams = Parameters<OfflineMutation>[0]

/**
 * Use as a named mutationFn in startOfflineExecutor. The existing outbox owns
 * durability, restoration, leadership and retries. The server mutation must
 * atomically deduplicate idempotencyKey with its writes.
 */
export function convexOfflineMutation<
  TMutation extends FunctionReference<`mutation`>,
>(
  config: {
    client: Pick<ConvexClient, `mutation`> | Pick<ConvexReactClient, `mutation`>
    mutation: TMutation
    getArgs: (
      params: OfflineParams,
    ) => Omit<FunctionArgs<TMutation>, `idempotencyKey`>
    collections: ReadonlyArray<{
      utils: Pick<ConvexCollectionUtils, `awaitSync`>
    }>
  } & (FunctionArgs<TMutation> extends { idempotencyKey: string }
    ? unknown
    : never),
): OfflineMutation {
  return async (params) => {
    try {
      const args = {
        ...config.getArgs(params),
        idempotencyKey: params.idempotencyKey,
      } as FunctionArgs<TMutation>
      await config.client.mutation(config.mutation, args)
    } catch (cause) {
      // The WebSocket clients retry transport interruptions themselves. A
      // rejected mutation has a server/function or client configuration error.
      const error = new NonRetriableError(
        cause instanceof Error ? cause.message : String(cause),
      )
      throw error
    }
    await Promise.all(
      config.collections.map((collection) => collection.utils.awaitSync()),
    )
  }
}

/** Lossless, opt-in outbox encoding for Convex values and removed fields. */
export const convexMutationCodec: MutationValueCodec = {
  id: `tanstack-convex-values/1`,
  encode: (value) => JSON.stringify(encodeValue(value)),
  decode: (value) => decodeValue(JSON.parse(value)),
}

function encodeValue(value: unknown): unknown {
  if (value === undefined) return [`undefined`]
  if (Array.isArray(value)) return [`array`, value.map(encodeValue)]
  if (
    value !== null &&
    typeof value === `object` &&
    !(value instanceof ArrayBuffer)
  ) {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError(
        `Convex mutation codecs support plain objects and Convex scalar values`,
      )
    return [
      `object`,
      Object.entries(value).map(([key, field]) => [key, encodeValue(field)]),
    ]
  }
  return [`scalar`, convexToJson(value as Value)]
}

function decodeValue(value: unknown): unknown {
  if (!Array.isArray(value))
    throw new TypeError(`Invalid Convex mutation codec record`)
  if (value[0] === `undefined` && value.length === 1) return undefined
  if (value.length !== 2)
    throw new TypeError(`Invalid Convex mutation codec record`)
  if (value[0] === `scalar`) return jsonToConvex(value[1] as JSONValue)
  if (!Array.isArray(value[1]))
    throw new TypeError(`Invalid Convex mutation codec container`)
  if (value[0] === `array`) return value[1].map(decodeValue)
  if (value[0] === `object`)
    return Object.fromEntries(
      value[1].map((entry: unknown) => {
        if (
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          typeof entry[0] !== `string`
        )
          throw new TypeError(`Invalid Convex mutation codec field`)
        return [entry[0], decodeValue(entry[1])]
      }),
    )
  throw new TypeError(`Invalid Convex mutation codec tag`)
}
