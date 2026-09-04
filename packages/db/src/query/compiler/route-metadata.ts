const ROUTED_SCALAR_VALUE = Symbol(`tanstack_db_routed_scalar_value`)
const ROUTE_METADATA = Symbol(`tanstack_db_route_metadata`)
export const INCLUDES_PUBLIC_KEY = Symbol(`includesPublicKey`)

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
  const copies = new WeakMap<object, object>()

  const visit = (current: unknown): unknown => {
    if (current == null || typeof current !== `object`) return current
    const existing = copies.get(current)
    if (existing) return existing
    if (!Array.isArray(current) && !isPlainObject(current)) return current

    const copy: Record<PropertyKey, unknown> | Array<unknown> = Array.isArray(
      current,
    )
      ? []
      : {}
    const output = copy as unknown as Record<PropertyKey, unknown>
    copies.set(current, copy)
    for (const key of Reflect.ownKeys(current)) {
      if (key === ROUTE_METADATA || key === INCLUDES_PUBLIC_KEY) continue
      const descriptor = Object.getOwnPropertyDescriptor(current, key)
      if (!descriptor?.enumerable) continue
      output[key] = visit((current as Record<PropertyKey, unknown>)[key])
    }
    return copy
  }

  return visit(value)
}

export function isPlainObject(
  value: unknown,
): value is Record<PropertyKey, unknown> {
  if (value == null || typeof value !== `object`) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
