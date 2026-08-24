const ROUTED_SCALAR_VALUE = Symbol(`tanstack_db_routed_scalar_value`)
export const INCLUDES_PUBLIC_KEY = Symbol(`includesPublicKey`)

type RoutedScalarResult = {
  [ROUTED_SCALAR_VALUE]: unknown
  __correlationKey: unknown
  __parentContext: unknown
  [INCLUDES_PUBLIC_KEY]: unknown
}

export type RoutedScalarMetadata = {
  value: unknown
  correlationKey: unknown
  parentContext: unknown
  publicKey: unknown
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
      __correlationKey: correlationKey,
      __parentContext: parentContext,
      [INCLUDES_PUBLIC_KEY]: publicKey,
    }
  }

  return {
    [ROUTED_SCALAR_VALUE]: value,
    __correlationKey: correlationKey,
    __parentContext: parentContext,
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
  return {
    value: routed[ROUTED_SCALAR_VALUE],
    correlationKey: routed.__correlationKey,
    parentContext: routed.__parentContext,
    publicKey: routed[INCLUDES_PUBLIC_KEY],
  }
}
