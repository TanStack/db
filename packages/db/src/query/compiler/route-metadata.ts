import { isPlainObject } from '../../utils/type-guards.js'
import { getParentContextValue } from '../equality-value-identity.js'
import type { NamespacedRow } from '../../types.js'

const ROUTED_SCALAR_VALUE = Symbol(`tanstack_db_routed_scalar_value`)
export const CALLBACK_INPUT = Symbol(`tanstack_db_callback_input`)
export const CALLBACK_SELECTED = Symbol(`tanstack_db_callback_selected`)
const ROUTE_METADATA = Symbol(`tanstack_db_route_metadata`)
export const INCLUDES_PUBLIC_KEY = Symbol(`includesPublicKey`)
export const INCLUDES_ROUTING = Symbol(`includesRouting`)
const INTERNAL_ROUTE_KEYS = new Set<PropertyKey>([
  ROUTE_METADATA,
  INCLUDES_PUBLIC_KEY,
  CALLBACK_INPUT,
  CALLBACK_SELECTED,
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
  callbackValue?: unknown,
): NamespacedRow {
  const scalar = getRoutedScalarMetadata(row)
  const route = scalar ?? getRouteMetadata(row)
  const namespaced = {
    ...getParentContextValue(route?.parentContext),
    [alias]: scalar
      ? scalar.value
      : route
        ? stripRouteMetadata(row as Record<PropertyKey, unknown>)
        : row,
  } as NamespacedRow
  if (route)
    attachRouteMetadata(namespaced, route.correlationKey, route.parentContext)
  if (scalar)
    Object.assign(namespaced, { [INCLUDES_PUBLIC_KEY]: scalar.publicKey })
  if (callbackValue !== undefined && callbackValue !== row)
    Object.assign(namespaced, { [CALLBACK_INPUT]: { [alias]: callbackValue } })
  return namespaced
}

/** A namespace keeps authored values beside its callback source overrides.
 * A one-element tuple denotes a flat union view: absent fields must disappear,
 * whereas named overrides replace only their own source aliases.
 */
export function getCallbackInput<T extends object>(row: T): T {
  const view = (row as Record<PropertyKey, unknown>)[CALLBACK_INPUT]
  if (Array.isArray(view)) {
    const result = { ...view[0] }
    if (`$selected` in row) result.$selected = row.$selected
    return result as T
  }
  return view && typeof view === `object` ? { ...row, ...view } : row
}

/** Copy public containers while removing private route state at every depth. */
export function stripInternalRouteMetadata(value: unknown): unknown {
  return transformPublicContainers(value, (leaf) => leaf, INTERNAL_ROUTE_KEYS)
}

/** Remove every compiler-owned key before invoking user code. */
export function stripInternalCallbackMetadata(value: unknown): unknown {
  return transformPublicContainers(
    value,
    (leaf) => leaf,
    INTERNAL_CALLBACK_KEYS,
  )
}

/** Copy only paths changed by a leaf transform or an omitted private key. */
export function transformPublicContainers(
  value: unknown,
  transformLeaf: (value: unknown) => unknown,
  omittedKeys: ReadonlySet<PropertyKey>,
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
      else if (isPublicContainer(child)) {
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
