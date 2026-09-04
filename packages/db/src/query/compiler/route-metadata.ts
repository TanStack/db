const ROUTED_SCALAR_VALUE = Symbol(`tanstack_db_routed_scalar_value`)
const ROUTE_METADATA = Symbol(`tanstack_db_route_metadata`)
export const INCLUDES_PUBLIC_KEY = Symbol(`includesPublicKey`)

type RoutedScalarResult = {
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

  if (value != null && typeof value === `object`) {
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
  } satisfies RoutedScalarResult
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

  const routed = value as RoutedScalarResult
  const route = routed[ROUTE_METADATA]
  return {
    value: routed[ROUTED_SCALAR_VALUE],
    correlationKey: route.correlationKey,
    parentContext: route.parentContext,
    publicKey: routed[INCLUDES_PUBLIC_KEY],
  }
}
