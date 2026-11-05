import { VIRTUAL_PROP_NAMES } from '../../virtual-props.js'
import { isPlainObject } from '../../utils/type-guards.js'
import { getParentContextValue } from '../equality-value-identity.js'
import type { NamespacedRow } from '../../types.js'

const ROUTED_SCALAR_VALUE = Symbol(`tanstack_db_routed_scalar_value`)
const ROUTE_METADATA = Symbol(`tanstack_db_route_metadata`)
export const INCLUDES_PUBLIC_KEY = Symbol(`includesPublicKey`)
export const SOURCE_METADATA = Symbol(`sourceMetadata`)
const SOURCE_ROUTING = Symbol(`sourceRouting`)
export const ROW_METADATA = Symbol(`rowMetadata`)
export type RowMetadata = Partial<
  Record<(typeof VIRTUAL_PROP_NAMES)[number], unknown>
>

export const INCLUDES_ROUTING = Symbol(`includesRouting`)
const INTERNAL_ROUTE_KEYS = new Set<PropertyKey>([
  ROUTE_METADATA,
  INCLUDES_PUBLIC_KEY,
  SOURCE_METADATA,
  ROW_METADATA,
  SOURCE_ROUTING,
])
const INTERNAL_CALLBACK_KEYS = new Set<PropertyKey>([
  ...INTERNAL_ROUTE_KEYS,
  INCLUDES_ROUTING,
])

type RoutedResult = {
  [ROUTED_SCALAR_VALUE]: unknown
  [ROUTE_METADATA]: RouteMetadata
  [INCLUDES_PUBLIC_KEY]: unknown
}

type PublicContainer = {
  value: object
  properties: Record<
    PropertyKey,
    PropertyDescriptor & { child?: PublicContainer }
  >
  parents: Array<PublicContainer>
  dirty?: true
  copy?: object
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

  return Object.assign(
    isPlainObject(value) ? { ...value } : { [ROUTED_SCALAR_VALUE]: value },
    {
      [ROUTE_METADATA]: { correlationKey, parentContext },
      [INCLUDES_PUBLIC_KEY]: publicKey,
    },
  )
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
  return {
    value: routed[ROUTED_SCALAR_VALUE],
    ...routed[ROUTE_METADATA],
    publicKey: routed[INCLUDES_PUBLIC_KEY],
  }
}

/** Give FROM and JOIN rows the same route and callback namespace. */
export function wrapInputRow(
  alias: string,
  row: unknown,
  metadata?: RowMetadata | null,
): NamespacedRow {
  const scalar = getRoutedScalarMetadata(row)
  const route = scalar ?? getRouteMetadata(row)
  const namespaced = {
    ...getParentContextValue(route?.parentContext),
    [alias]: scalar ? scalar.value : stripInternalCallbackMetadata(row, false),
  } as NamespacedRow
  if (route)
    attachRouteMetadata(namespaced, route.correlationKey, route.parentContext)
  if (route)
    Object.assign(namespaced, {
      [INCLUDES_PUBLIC_KEY]:
        scalar?.publicKey ??
        (row as Record<PropertyKey, unknown>)[INCLUDES_PUBLIC_KEY],
    })
  if (metadata !== undefined)
    Object.assign(namespaced, { [SOURCE_METADATA]: { [alias]: metadata } })
  if (row !== null && typeof row === `object` && INCLUDES_ROUTING in row)
    Object.assign(namespaced, {
      [SOURCE_ROUTING]: {
        [alias]: (row as Record<PropertyKey, unknown>)[INCLUDES_ROUTING],
      },
    })
  return namespaced
}

/** Attribution and include routing belong to the namespace, never source data. */
export function getSourceMetadata(
  row: Record<PropertyKey, unknown>,
  alias: string,
): RowMetadata | null {
  const metadata = row[SOURCE_METADATA] as
    Record<string, RowMetadata | null> | undefined
  if (metadata && Object.hasOwn(metadata, alias)) return metadata[alias]!
  const source = row[alias]
  if (source == null || typeof source !== `object`) return null
  const result: RowMetadata = {}
  for (const name of VIRTUAL_PROP_NAMES)
    if (name in source) result[name] = (source as Record<string, unknown>)[name]
  return result
}

export function getSourceRouting(
  row: Record<PropertyKey, unknown>,
  alias: string,
): unknown {
  return (row[SOURCE_ROUTING] as Record<string, unknown> | undefined)?.[alias]
}

export function mergeSourceContext(
  target: Record<PropertyKey, unknown>,
  left: Record<PropertyKey, unknown> | undefined,
  right: Record<PropertyKey, unknown> | undefined,
): void {
  for (const field of [SOURCE_METADATA, SOURCE_ROUTING])
    if (left?.[field] || right?.[field])
      target[field] = {
        ...(left?.[field] as object | undefined),
        ...(right?.[field] as object | undefined),
      }
}

/** Remove private route state, descending only when the compilation can nest it. */
export function stripInternalRouteMetadata(
  value: unknown,
  recursive = true,
): unknown {
  return stripInternalMetadata(value, INTERNAL_ROUTE_KEYS, recursive)
}

/** Remove compiler-owned keys before invoking user code, at the known scope. */
export function stripInternalCallbackMetadata(
  value: unknown,
  recursive = true,
): unknown {
  return stripInternalMetadata(value, INTERNAL_CALLBACK_KEYS, recursive)
}

function stripInternalMetadata(
  value: unknown,
  keys: ReadonlySet<PropertyKey>,
  recursive: boolean,
): unknown {
  if (!recursive) {
    if (!isPublicContainer(value)) return value
    let hasMetadata = false
    for (const key of keys) hasMetadata ||= Object.hasOwn(value, key)
    if (!hasMetadata) return value
  }
  return transformPublicContainers(value, (leaf) => leaf, keys, recursive)
}

/** Copy only paths changed by a leaf transform or an omitted private key. */
export function transformPublicContainers(
  value: unknown,
  transformLeaf: (value: unknown) => unknown,
  omittedKeys: ReadonlySet<PropertyKey>,
  recursive = true,
): unknown {
  const rootReplacement = transformLeaf(value)
  if (!Object.is(rootReplacement, value)) return rootReplacement
  if (!isPublicContainer(value)) return value

  const containers = new Map<object, PublicContainer>()
  const queue: Array<PublicContainer> = []
  const markDirty = (container: PublicContainer) => {
    if (container.dirty) return
    container.dirty = true
    queue.push(container)
  }
  const visit = (current: object): PublicContainer => {
    const existing = containers.get(current)
    if (existing) return existing
    const container: PublicContainer = {
      value: current,
      properties: Object.getOwnPropertyDescriptors(current),
      parents: [],
    }
    containers.set(current, container)
    for (const key of Reflect.ownKeys(container.properties)) {
      if (omittedKeys.has(key)) {
        delete container.properties[key]
        markDirty(container)
        continue
      }
      const descriptor = container.properties[key]!
      if (!descriptor.enumerable || !(`value` in descriptor)) continue
      const child = descriptor.value
      descriptor.value = transformLeaf(child)
      if (!Object.is(descriptor.value, child)) markDirty(container)
      else if (recursive && isPublicContainer(child)) {
        descriptor.child = visit(child)
        descriptor.child.parents.push(container)
      }
    }
    return container
  }
  const root = visit(value)
  for (const container of queue) {
    for (const parent of container.parents) markDirty(parent)
  }
  const copy = (container: PublicContainer): object => {
    if (!container.dirty) return container.value
    if (container.copy) return container.copy
    const result = Array.isArray(container.value)
      ? []
      : Object.create(Object.getPrototypeOf(container.value))
    container.copy = result
    for (const key of Reflect.ownKeys(container.properties)) {
      const descriptor = container.properties[key]!
      if (descriptor.child) descriptor.value = copy(descriptor.child)
    }
    return Object.defineProperties(result, container.properties)
  }
  return copy(root)
}

export function isPublicContainer(value: unknown): value is object {
  return Array.isArray(value) || isPlainObject(value)
}
