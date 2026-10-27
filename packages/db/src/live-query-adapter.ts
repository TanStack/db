import { SourceCollectionIdReuseError } from './errors.js'
import { isCollection } from './live-query-primitives.js'
import {
  getPreparedLiveQueryIdentity,
  getPreparedLiveQuerySources,
} from './live-query-options.js'
import type { DbClient } from './client.js'
import type { LiveQueryKey } from './live-query-options.js'

/**
 * The adapter layer: what the first-party framework adapters
 * (`@tanstack/react-db`, `@tanstack/preact-db`, `@tanstack/vue-db`,
 * `@tanstack/svelte-db`, `@tanstack/solid-db`, `@tanstack/angular-db`) build
 * their bindings from. It centralizes logic every adapter used to duplicate,
 * so they stay consistent across frameworks.
 *
 * Application code should use an adapter instead. Everything exported here is
 * unstable for external use and changes with the adapters that share it.
 */

export * from './live-query-primitives.js'
export * from './live-query-observer.js'
export * from './live-query-window-binding.js'
export {
  configPool,
  getLiveQueryHash,
  getPreparedLiveQueryIdentity,
  getPreparedLiveQuerySources,
  prepareLiveQueryValue,
  rejectLiveQueryInput,
  releaseDeferredOnReclaim,
  resolveLiveQueryValue,
  resumeDeferredLiveQueryCollections,
} from './live-query-options.js'
export type { DeferredLiveQueryCollections } from './live-query-options.js'
export {
  createLiveQueryWindowController,
  fetchNextLiveQueryWindowPage,
} from './live-query-window-controller.js'
export type {
  CreateLiveQueryWindowControllerOptions,
  LiveQueryWindowController,
  LiveQueryWindowSnapshot,
} from './live-query-window-controller.js'

/**
 * The `queryKey` of a config-object query input, if it supplies one. An empty
 * key is absent, as it is for `getLiveQueryHash`, so a hook and a `DbClient`
 * preload agree on the query's identity.
 */
export function getLiveQueryKey(input: unknown): LiveQueryKey | undefined {
  const queryKey =
    input && typeof input === `object` && !isCollection(input)
      ? (input as { queryKey?: unknown }).queryKey
      : undefined
  return Array.isArray(queryKey) && queryKey.length > 0 ? queryKey : undefined
}

/*
 * Query identity and source Collection ID claims.
 *
 * A binding that compares derived query identity decides from it whether to
 * compile again: React and Preact compare it on every render, and a `DbClient`
 * matches preloaded and hydrated queries by its hash. That identity names each
 * source by its Collection ID. While such a binding is mounted, an ID must
 * keep naming one source object in each client scope, or the binding could
 * reuse a live query that reads the old source. A binding that compiles again
 * whenever its reactive reads change compares no identity, so neither check
 * applies to it.
 */

const sourceObjectTokens = new WeakMap<object, number>()
let nextSourceObjectToken = 0

/** A process-unique number for a source object, without retaining it. */
export function getSourceObjectToken(source: object): number {
  let token = sourceObjectTokens.get(source)
  if (token === undefined) {
    token = ++nextSourceObjectToken
    sourceObjectTokens.set(source, token)
  }
  return token
}

// The client scope of a binding that reads no DbClient.
const unscopedClaims = {}

/**
 * The source object each Collection ID named while one binding is mounted,
 * per client scope.
 */
export type LiveQuerySourceIdClaims = WeakMap<object, Map<string, number>>

export function createLiveQuerySourceIdClaims(): LiveQuerySourceIdClaims {
  return new WeakMap()
}

/** Record a query's sources, or throw before recording any. */
export function claimLiveQuerySourceIds(
  claims: LiveQuerySourceIdClaims,
  sources: ReadonlyArray<{ id: string }>,
  client: DbClient | undefined,
  bindingName: string,
): void {
  const scope = client ?? unscopedClaims
  const prior = claims.get(scope)
  const seen = new Map<string, number>()
  for (const source of sources) {
    const token = getSourceObjectToken(source)
    const previous = seen.get(source.id) ?? prior?.get(source.id)
    if (previous !== undefined && previous !== token) {
      throw new SourceCollectionIdReuseError(bindingName, source.id)
    }
    seen.set(source.id, token)
  }
  const claimed = prior ?? new Map<string, number>()
  for (const [id, token] of seen) claimed.set(id, token)
  claims.set(scope, claimed)
}

/** Where a binding that compares query identity checks a prepared query. */
export interface LiveQueryIdentityScope {
  /** This binding's source Collection ID claims. */
  claims: LiveQuerySourceIdClaims
  client: DbClient | undefined
  bindingName: string
  /** Report a descriptor source that no client bound. */
  onUnboundDescriptor?: (alias: string) => never
}

/**
 * Identify a prepared query for a binding that compares query identity. The
 * identity throws `UnhashableQueryIRError` for IR without a stable identity,
 * then the query's sources claim their Collection IDs. The binding's render
 * boundary releases the sync starts a rejected render deferred; see
 * `rejectLiveQueryInput`.
 */
export function identifyLiveQuery<TIdentity = unknown>(
  preparedValue: unknown,
  scope: LiveQueryIdentityScope,
  identify: (
    preparedValue: unknown,
  ) => TIdentity = getPreparedLiveQueryIdentity as (
    preparedValue: unknown,
  ) => TIdentity,
): TIdentity {
  const identity = identify(preparedValue)
  claimLiveQuerySourceIds(
    scope.claims,
    getPreparedLiveQuerySources(preparedValue, scope.onUnboundDescriptor),
    scope.client,
    scope.bindingName,
  )
  return identity
}
