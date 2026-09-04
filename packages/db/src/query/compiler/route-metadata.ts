const ROUTED_SCALAR_VALUE = Symbol(`tanstack_db_routed_scalar_value`)
const ROUTE_METADATA = Symbol(`tanstack_db_route_metadata`)
export const INCLUDES_PUBLIC_KEY = Symbol(`includesPublicKey`)
const INTERNAL_ROUTE_KEYS = new Set<PropertyKey>([
  ROUTE_METADATA,
  INCLUDES_PUBLIC_KEY,
])

type RoutedResult = {
  [ROUTED_SCALAR_VALUE]: unknown
  [ROUTE_METADATA]: RouteMetadata
  [INCLUDES_PUBLIC_KEY]: unknown
}

export type RouteMetadata = {
  correlationKey: unknown
  parentContext: unknown
}

export type RoutedScalarMetadata = {
  value: unknown
  correlationKey: unknown
  parentContext: unknown
  publicKey: unknown
}

export function attachRouteMetadata<T extends object>(
  value: T,
  correlationKey: unknown,
  parentContext: unknown,
): T {
  return Object.assign(value, {
    [ROUTE_METADATA]: { correlationKey, parentContext } satisfies RouteMetadata,
  })
}

export function getRouteMetadata(value: unknown): RouteMetadata | undefined {
  if (
    value == null ||
    typeof value !== `object` ||
    !(ROUTE_METADATA in value)
  ) {
    return undefined
  }
  return (value as { [ROUTE_METADATA]: RouteMetadata })[ROUTE_METADATA]
}

export function getNamespacedRouteMetadata(
  row: unknown,
  source: string,
): RouteMetadata | undefined {
  return (
    getRouteMetadata(row) ??
    (row != null && typeof row === `object`
      ? getRouteMetadata((row as Record<string, unknown>)[source])
      : undefined)
  )
}

export function stripRouteMetadata<T extends object>(value: T): T {
  const result = { ...value } as T & Record<PropertyKey, unknown>
  delete result[ROUTE_METADATA]
  return result
}

export function attachRouteMetadataToResult(
  value: unknown,
  correlationKey: unknown,
  parentContext: unknown,
  publicKey: unknown,
): unknown {
  if (
    correlationKey === undefined &&
    parentContext === undefined &&
    publicKey === undefined
  ) {
    return value
  }

  if (isPlainObject(value)) {
    return {
      ...value,
      [ROUTE_METADATA]: { correlationKey, parentContext },
      [INCLUDES_PUBLIC_KEY]: publicKey,
    }
  }

  return {
    [ROUTED_SCALAR_VALUE]: value,
    [ROUTE_METADATA]: { correlationKey, parentContext },
    [INCLUDES_PUBLIC_KEY]: publicKey,
  } satisfies RoutedResult
}

export function getRoutedScalarMetadata(
  value: unknown,
): RoutedScalarMetadata | undefined {
  if (
    value == null ||
    typeof value !== `object` ||
    !(ROUTED_SCALAR_VALUE in value)
  ) {
    return undefined
  }

  const routed = value as RoutedResult
  const route = routed[ROUTE_METADATA]
  return {
    value: routed[ROUTED_SCALAR_VALUE],
    correlationKey: route.correlationKey,
    parentContext: route.parentContext,
    publicKey: routed[INCLUDES_PUBLIC_KEY],
  }
}

/** Copy public containers while removing private route state at every depth. */
export function stripInternalRouteMetadata(value: unknown): unknown {
  return transformPublicContainers(value, (leaf) => leaf, INTERNAL_ROUTE_KEYS)
}

/** Copy only paths changed by a leaf transform or an omitted private key. */
export function transformPublicContainers(
  value: unknown,
  transformLeaf: (value: unknown) => unknown,
  omittedKeys: ReadonlySet<PropertyKey>,
): unknown {
  const rootReplacement = transformLeaf(value)
  if (rootReplacement !== value) return rootReplacement
  if (!isPublicContainer(value)) return value

  const parents = new WeakMap<object, Set<object>>()
  const properties = new WeakMap<
    object,
    Map<PropertyKey, { value: unknown; replacement: unknown }>
  >()
  const visited = new WeakSet<object>()
  const dirty = new Set<object>()
  const visit = (current: object): void => {
    if (visited.has(current)) return
    visited.add(current)
    const currentProperties = new Map<
      PropertyKey,
      { value: unknown; replacement: unknown }
    >()
    properties.set(current, currentProperties)
    for (const key of Reflect.ownKeys(current)) {
      if (omittedKeys.has(key)) {
        dirty.add(current)
        continue
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key)
      if (!descriptor?.enumerable) continue
      const child = (current as Record<PropertyKey, unknown>)[key]
      const replacement = transformLeaf(child)
      currentProperties.set(key, { value: child, replacement })
      if (replacement !== child) {
        dirty.add(current)
        continue
      }
      if (!isPublicContainer(child)) continue
      const childParents = parents.get(child) ?? new Set<object>()
      childParents.add(current)
      parents.set(child, childParents)
      visit(child)
    }
  }
  visit(value)

  const queue = [...dirty]
  for (const current of queue) {
    for (const parent of parents.get(current) ?? []) {
      if (dirty.has(parent)) continue
      dirty.add(parent)
      queue.push(parent)
    }
  }
  if (!dirty.has(value)) return value

  const copies = new WeakMap<object, object>()
  const copy = (current: object): object => {
    if (!dirty.has(current)) return current
    const existing = copies.get(current)
    if (existing) return existing

    const result = Array.isArray(current)
      ? []
      : Object.create(Object.getPrototypeOf(current))
    copies.set(current, result)
    for (const [key, property] of properties.get(current) ?? []) {
      Object.defineProperty(result, key, {
        value:
          property.replacement !== property.value
            ? property.replacement
            : isPublicContainer(property.value)
              ? copy(property.value)
              : property.value,
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return result
  }

  return copy(value)
}

export function isPlainObject(
  value: unknown,
): value is Record<PropertyKey, unknown> {
  if (value == null || typeof value !== `object`) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isPublicContainer(value: unknown): value is object {
  return Array.isArray(value) || isPlainObject(value)
}
