import { IR } from '@tanstack/db'
import type { LoadSubsetOptions } from '@tanstack/db'

export type RemoteSubsetWirePrimitive =
  | undefined
  | null
  | boolean
  | string
  | number
  | bigint

export type RemoteSubsetWireTypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array

export type RemoteSubsetWireRecord = {
  [key: string]: RemoteSubsetWireValue
}

/** Values whose complete semantics survive a coordinator transport boundary. */
export type RemoteSubsetWireValue =
  | RemoteSubsetWirePrimitive
  | Date
  | RegExp
  | ArrayBuffer
  | DataView
  | RemoteSubsetWireTypedArray
  | Array<RemoteSubsetWireValue>
  | Map<RemoteSubsetWireValue, RemoteSubsetWireValue>
  | Set<RemoteSubsetWireValue>
  | RemoteSubsetWireRecord

export type RemoteSubsetWireExpression =
  | { type: `ref`; path: Array<string> }
  | { type: `val`; value: RemoteSubsetWireValue }
  | {
      type: `func`
      name: string
      args: Array<RemoteSubsetWireExpression>
    }

export type RemoteSubsetWireCompareOptions = {
  direction: `asc` | `desc`
  nulls: `first` | `last`
} & (
  | { stringSort?: `lexical` }
  | {
      stringSort?: `locale`
      locale?: string
      localeOptions?: RemoteSubsetWireRecord
    }
)

export type RemoteSubsetWireOrderByClause = {
  expression: RemoteSubsetWireExpression
  compareOptions: RemoteSubsetWireCompareOptions
}

export type RemoteSubsetWireCursor = {
  whereFrom: RemoteSubsetWireExpression
  whereCurrent: RemoteSubsetWireExpression
  lastKey?: string | number
}

/** The complete data portion transported by a remote-subset request. */
export type TransportedLoadSubsetOptions = {
  where?: RemoteSubsetWireExpression
  orderBy?: Array<RemoteSubsetWireOrderByClause>
  limit?: number
  cursor?: RemoteSubsetWireCursor
  offset?: number
}

export class RemoteSubsetWireValueError extends TypeError {
  override readonly name = `RemoteSubsetWireValueError`

  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`Unsupported remote subset wire value at ${path}: ${reason}`)
  }
}

type ProjectionState = {
  expressions: WeakMap<object, RemoteSubsetWireExpression>
  expressionArrays: WeakMap<object, Array<RemoteSubsetWireExpression>>
  stringArrays: WeakMap<object, Array<string>>
  orderByArrays: WeakMap<object, Array<RemoteSubsetWireOrderByClause>>
  orderByClauses: WeakMap<object, RemoteSubsetWireOrderByClause>
  compareOptions: WeakMap<object, RemoteSubsetWireCompareOptions>
  cursors: WeakMap<object, RemoteSubsetWireCursor>
  wireValues: WeakMap<object, RemoteSubsetWireValue>
}

type DataProperty = {
  present: boolean
  value?: unknown
}

type TypedArrayConstructor = {
  readonly prototype: RemoteSubsetWireTypedArray
  new (
    buffer: ArrayBuffer,
    byteOffset?: number,
    length?: number,
  ): RemoteSubsetWireTypedArray
}

const typedArrayConstructors: ReadonlyArray<TypedArrayConstructor> = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
]

const NativeDate = Date
const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Projects one live subset request into the exact coordinator wire domain.
 * Validation happens before callers choose a local-leader or transported path.
 */
export function toTransportedLoadSubsetOptions(
  options: LoadSubsetOptions,
): TransportedLoadSubsetOptions {
  assertPlainContainer(options, `options`)
  assertAllowedProperties(options, `options`, [
    `where`,
    `orderBy`,
    `limit`,
    `cursor`,
    `offset`,
    `signal`,
    `subscription`,
  ])

  const state: ProjectionState = {
    expressions: new WeakMap(),
    expressionArrays: new WeakMap(),
    stringArrays: new WeakMap(),
    orderByArrays: new WeakMap(),
    orderByClauses: new WeakMap(),
    compareOptions: new WeakMap(),
    cursors: new WeakMap(),
    wireValues: new WeakMap(),
  }
  const projected: TransportedLoadSubsetOptions = {}
  const where = readDataProperty(options, `where`, `options.where`)
  const orderBy = readDataProperty(options, `orderBy`, `options.orderBy`)
  const limit = readDataProperty(options, `limit`, `options.limit`)
  const cursor = readDataProperty(options, `cursor`, `options.cursor`)
  const offset = readDataProperty(options, `offset`, `options.offset`)

  if (where.present && where.value !== undefined) {
    projected.where = projectExpression(where.value, `options.where`, state)
  }
  if (orderBy.present && orderBy.value !== undefined) {
    projected.orderBy = projectOrderBy(orderBy.value, `options.orderBy`, state)
  }
  if (limit.present && limit.value !== undefined) {
    projected.limit = projectNumber(limit.value, `options.limit`)
  }
  if (cursor.present && cursor.value !== undefined) {
    projected.cursor = projectCursor(cursor.value, `options.cursor`, state)
  }
  if (offset.present && offset.value !== undefined) {
    projected.offset = projectNumber(offset.value, `options.offset`)
  }

  return projected
}

/** Adds live lifecycle references only to an already validated local request. */
export function toProcessLocalLoadSubsetOptions(
  options: LoadSubsetOptions,
  transported = toTransportedLoadSubsetOptions(options),
): TransportedLoadSubsetOptions &
  Pick<LoadSubsetOptions, `signal` | `subscription`> {
  const projected = {
    ...transported,
  } as TransportedLoadSubsetOptions &
    Pick<LoadSubsetOptions, `signal` | `subscription`>
  const signal = readDataProperty(options, `signal`, `options.signal`)
  const subscription = readDataProperty(
    options,
    `subscription`,
    `options.subscription`,
  )

  if (signal.present) {
    projected.signal = signal.value as LoadSubsetOptions[`signal`]
  }
  if (subscription.present) {
    projected.subscription =
      subscription.value as LoadSubsetOptions[`subscription`]
  }

  return projected
}

function projectExpression(
  value: unknown,
  path: string,
  state: ProjectionState,
): RemoteSubsetWireExpression {
  const object = requireObject(value, path)
  const existing = state.expressions.get(object)
  if (existing) return existing

  const type = readDataProperty(object, `type`, `${path}.type`)
  if (!type.present || typeof type.value !== `string`) {
    throw new RemoteSubsetWireValueError(`${path}.type`, describe(type.value))
  }

  switch (type.value) {
    case `ref`: {
      assertExpressionPrototype(object, path, IR.PropRef.prototype)
      assertAllowedProperties(object, path, [`type`, `path`])
      const projected = {
        type: `ref`,
        path: [] as Array<string>,
      } satisfies RemoteSubsetWireExpression
      state.expressions.set(object, projected)
      const sourcePath = readRequiredDataProperty(
        object,
        `path`,
        `${path}.path`,
      )
      projected.path = projectStringArray(sourcePath, `${path}.path`, state)
      return projected
    }
    case `val`: {
      assertExpressionPrototype(object, path, IR.Value.prototype)
      assertAllowedProperties(object, path, [`type`, `value`])
      const projected: Extract<RemoteSubsetWireExpression, { type: `val` }> = {
        type: `val`,
        value: undefined,
      }
      state.expressions.set(object, projected)
      const sourceValue = readRequiredDataProperty(
        object,
        `value`,
        `${path}.value`,
      )
      projected.value = projectWireValue(sourceValue, `${path}.value`, state)
      return projected
    }
    case `func`: {
      assertExpressionPrototype(object, path, IR.Func.prototype)
      assertAllowedProperties(object, path, [`type`, `name`, `args`])
      const projected = {
        type: `func`,
        name: ``,
        args: [] as Array<RemoteSubsetWireExpression>,
      } satisfies RemoteSubsetWireExpression
      state.expressions.set(object, projected)
      const name = readRequiredDataProperty(object, `name`, `${path}.name`)
      if (typeof name !== `string`) {
        throw new RemoteSubsetWireValueError(`${path}.name`, describe(name))
      }
      projected.name = name
      const args = readRequiredDataProperty(object, `args`, `${path}.args`)
      projected.args = projectExpressionArray(args, `${path}.args`, state)
      return projected
    }
    default:
      throw new RemoteSubsetWireValueError(`${path}.type`, String(type.value))
  }
}

function projectExpressionArray(
  value: unknown,
  path: string,
  state: ProjectionState,
): Array<RemoteSubsetWireExpression> {
  const array = requireArray(value, path)
  const existing = state.expressionArrays.get(array)
  if (existing) return existing
  assertArrayShape(array, path)
  const projected = new Array<RemoteSubsetWireExpression>(array.length)
  state.expressionArrays.set(array, projected)
  for (let index = 0; index < array.length; index++) {
    if (!(index in array)) {
      throw new RemoteSubsetWireValueError(
        `${path}[${index}]`,
        `missing expression`,
      )
    }
    projected[index] = projectExpression(
      array[index],
      `${path}[${index}]`,
      state,
    )
  }
  return projected
}

function projectStringArray(
  value: unknown,
  path: string,
  state: ProjectionState,
): Array<string> {
  const array = requireArray(value, path)
  const existing = state.stringArrays.get(array)
  if (existing) return existing
  assertArrayShape(array, path)
  const projected = new Array<string>(array.length)
  state.stringArrays.set(array, projected)
  for (let index = 0; index < array.length; index++) {
    const entry = array[index]
    if (!(index in array) || typeof entry !== `string`) {
      throw new RemoteSubsetWireValueError(`${path}[${index}]`, describe(entry))
    }
    projected[index] = entry
  }
  return projected
}

function projectOrderBy(
  value: unknown,
  path: string,
  state: ProjectionState,
): Array<RemoteSubsetWireOrderByClause> {
  const array = requireArray(value, path)
  const existing = state.orderByArrays.get(array)
  if (existing) return existing
  assertArrayShape(array, path)
  const projected = new Array<RemoteSubsetWireOrderByClause>(array.length)
  state.orderByArrays.set(array, projected)

  for (let index = 0; index < array.length; index++) {
    const clausePath = `${path}[${index}]`
    const clause = requirePlainRecord(array[index], clausePath)
    const existingClause = state.orderByClauses.get(clause)
    if (existingClause) {
      projected[index] = existingClause
      continue
    }
    assertAllowedProperties(clause, clausePath, [
      `expression`,
      `compareOptions`,
    ])
    const projectedClause = {
      expression: undefined as unknown as RemoteSubsetWireExpression,
      compareOptions: undefined as unknown as RemoteSubsetWireCompareOptions,
    }
    projected[index] = projectedClause
    state.orderByClauses.set(clause, projectedClause)
    projectedClause.expression = projectExpression(
      readRequiredDataProperty(
        clause,
        `expression`,
        `${clausePath}.expression`,
      ),
      `${clausePath}.expression`,
      state,
    )
    projectedClause.compareOptions = projectCompareOptions(
      readRequiredDataProperty(
        clause,
        `compareOptions`,
        `${clausePath}.compareOptions`,
      ),
      `${clausePath}.compareOptions`,
      state,
    )
  }
  return projected
}

function projectCompareOptions(
  value: unknown,
  path: string,
  state: ProjectionState,
): RemoteSubsetWireCompareOptions {
  const source = requirePlainRecord(value, path)
  const existing = state.compareOptions.get(source)
  if (existing) return existing
  assertAllowedProperties(source, path, [
    `direction`,
    `nulls`,
    `stringSort`,
    `locale`,
    `localeOptions`,
  ])
  const projected: {
    direction?: `asc` | `desc`
    nulls?: `first` | `last`
    stringSort?: `lexical` | `locale`
    locale?: string
    localeOptions?: RemoteSubsetWireRecord
  } = {}

  const direction = readRequiredDataProperty(
    source,
    `direction`,
    `${path}.direction`,
  )
  if (direction !== `asc` && direction !== `desc`) {
    throw new RemoteSubsetWireValueError(
      `${path}.direction`,
      describe(direction),
    )
  }
  projected.direction = direction

  const nulls = readRequiredDataProperty(source, `nulls`, `${path}.nulls`)
  if (nulls !== `first` && nulls !== `last`) {
    throw new RemoteSubsetWireValueError(`${path}.nulls`, describe(nulls))
  }
  projected.nulls = nulls

  const stringSort = readDataProperty(
    source,
    `stringSort`,
    `${path}.stringSort`,
  )
  if (stringSort.present && stringSort.value !== undefined) {
    if (stringSort.value !== `lexical` && stringSort.value !== `locale`) {
      throw new RemoteSubsetWireValueError(
        `${path}.stringSort`,
        describe(stringSort.value),
      )
    }
    projected.stringSort = stringSort.value
  }
  if (projected.stringSort !== `lexical`) {
    const locale = readDataProperty(source, `locale`, `${path}.locale`)
    if (locale.present && locale.value !== undefined) {
      if (typeof locale.value !== `string`) {
        throw new RemoteSubsetWireValueError(
          `${path}.locale`,
          describe(locale.value),
        )
      }
      projected.locale = locale.value
    }
    const localeOptions = readDataProperty(
      source,
      `localeOptions`,
      `${path}.localeOptions`,
    )
    if (localeOptions.present && localeOptions.value !== undefined) {
      projected.localeOptions = projectWireRecord(
        localeOptions.value,
        `${path}.localeOptions`,
        state,
      )
    }
  }
  const result = projected as RemoteSubsetWireCompareOptions
  state.compareOptions.set(source, result)
  return result
}

function projectCursor(
  value: unknown,
  path: string,
  state: ProjectionState,
): RemoteSubsetWireCursor {
  const source = requirePlainRecord(value, path)
  const existing = state.cursors.get(source)
  if (existing) return existing
  assertAllowedProperties(source, path, [
    `whereFrom`,
    `whereCurrent`,
    `lastKey`,
  ])
  const projected: RemoteSubsetWireCursor = {
    whereFrom: undefined as unknown as RemoteSubsetWireExpression,
    whereCurrent: undefined as unknown as RemoteSubsetWireExpression,
  }
  state.cursors.set(source, projected)
  projected.whereFrom = projectExpression(
    readRequiredDataProperty(source, `whereFrom`, `${path}.whereFrom`),
    `${path}.whereFrom`,
    state,
  )
  projected.whereCurrent = projectExpression(
    readRequiredDataProperty(source, `whereCurrent`, `${path}.whereCurrent`),
    `${path}.whereCurrent`,
    state,
  )
  const lastKey = readDataProperty(source, `lastKey`, `${path}.lastKey`)
  if (lastKey.present && lastKey.value !== undefined) {
    if (
      typeof lastKey.value !== `string` &&
      typeof lastKey.value !== `number`
    ) {
      throw new RemoteSubsetWireValueError(
        `${path}.lastKey`,
        describe(lastKey.value),
      )
    }
    projected.lastKey = lastKey.value
  }
  return projected
}

function projectWireValue(
  value: unknown,
  path: string,
  state: ProjectionState,
): RemoteSubsetWireValue {
  if (
    value === undefined ||
    value === null ||
    typeof value === `boolean` ||
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `bigint`
  ) {
    return value
  }
  if (typeof value !== `object`) {
    throw new RemoteSubsetWireValueError(path, describe(value))
  }

  const existing = state.wireValues.get(value)
  if (existing) return existing

  if (
    typeof SharedArrayBuffer !== `undefined` &&
    value instanceof SharedArrayBuffer
  ) {
    throw new RemoteSubsetWireValueError(path, `SharedArrayBuffer`)
  }
  if (value instanceof NativeDate) {
    assertExactPrototype(value, NativeDate.prototype, path)
    assertNoOwnProperties(value, path)
    const projected = new NativeDate(value.getTime())
    state.wireValues.set(value, projected)
    return projected
  }
  if (value instanceof RegExp) {
    assertExactPrototype(value, RegExp.prototype, path)
    assertRegExpShape(value, path)
    const projected = new RegExp(value.source, value.flags)
    state.wireValues.set(value, projected)
    return projected
  }
  if (value instanceof ArrayBuffer) {
    assertExactPrototype(value, ArrayBuffer.prototype, path)
    assertNoOwnProperties(value, path)
    assertFixedArrayBuffer(value, path)
    let projected: ArrayBuffer
    try {
      projected = value.slice(0)
    } catch {
      throw new RemoteSubsetWireValueError(path, `detached ArrayBuffer`)
    }
    state.wireValues.set(value, projected)
    return projected
  }
  if (value instanceof DataView) {
    assertExactPrototype(value, DataView.prototype, path)
    assertNoOwnProperties(value, path)
    let byteOffset: number
    let byteLength: number
    let buffer: ArrayBufferLike
    try {
      byteOffset = value.byteOffset
      byteLength = value.byteLength
      buffer = value.buffer
    } catch {
      throw new RemoteSubsetWireValueError(path, `detached DataView`)
    }
    const projectedBuffer = projectWireValue(buffer, path, state)
    if (!(projectedBuffer instanceof ArrayBuffer)) {
      throw new RemoteSubsetWireValueError(path, `shared DataView buffer`)
    }
    const projected = new DataView(projectedBuffer, byteOffset, byteLength)
    state.wireValues.set(value, projected)
    return projected
  }

  const typedArrayConstructor = getTypedArrayConstructor(value)
  if (typedArrayConstructor) {
    const typedArray = value as RemoteSubsetWireTypedArray
    assertTypedArrayShape(typedArray, path)
    let byteOffset: number
    let length: number
    let buffer: ArrayBufferLike
    try {
      byteOffset = typedArray.byteOffset
      length = typedArray.length
      buffer = typedArray.buffer
    } catch {
      throw new RemoteSubsetWireValueError(path, `detached typed array`)
    }
    if (!(buffer instanceof ArrayBuffer)) {
      throw new RemoteSubsetWireValueError(path, `shared typed-array buffer`)
    }
    const projectedBuffer = projectWireValue(buffer, path, state)
    if (!(projectedBuffer instanceof ArrayBuffer)) {
      throw new RemoteSubsetWireValueError(path, `shared typed-array buffer`)
    }
    let projected: RemoteSubsetWireTypedArray
    try {
      projected = new typedArrayConstructor(projectedBuffer, byteOffset, length)
    } catch {
      throw new RemoteSubsetWireValueError(path, `detached typed array`)
    }
    state.wireValues.set(value, projected)
    return projected
  }
  if (ArrayBuffer.isView(value)) {
    throw new RemoteSubsetWireValueError(path, describe(value))
  }
  if (Array.isArray(value)) return projectWireArray(value, path, state)
  if (value instanceof Map) return projectWireMap(value, path, state)
  if (value instanceof Set) return projectWireSet(value, path, state)
  return projectWireRecord(value, path, state)
}

function projectWireArray(
  value: Array<unknown>,
  path: string,
  state: ProjectionState,
): Array<RemoteSubsetWireValue> {
  assertArrayShape(value, path)
  const projected = new Array<RemoteSubsetWireValue>(value.length)
  state.wireValues.set(value, projected)
  for (let index = 0; index < value.length; index++) {
    if (index in value) {
      projected[index] = projectWireValue(
        value[index],
        `${path}[${index}]`,
        state,
      )
    }
  }
  return projected
}

function projectWireMap(
  value: Map<unknown, unknown>,
  path: string,
  state: ProjectionState,
): Map<RemoteSubsetWireValue, RemoteSubsetWireValue> {
  assertExactPrototype(value, Map.prototype, path)
  assertNoOwnProperties(value, path)
  const projected = new Map<RemoteSubsetWireValue, RemoteSubsetWireValue>()
  state.wireValues.set(value, projected)
  let index = 0
  for (const [key, entry] of value) {
    projected.set(
      projectWireValue(key, `${path}.entries[${index}].key`, state),
      projectWireValue(entry, `${path}.entries[${index}].value`, state),
    )
    index++
  }
  return projected
}

function projectWireSet(
  value: Set<unknown>,
  path: string,
  state: ProjectionState,
): Set<RemoteSubsetWireValue> {
  assertExactPrototype(value, Set.prototype, path)
  assertNoOwnProperties(value, path)
  const projected = new Set<RemoteSubsetWireValue>()
  state.wireValues.set(value, projected)
  let index = 0
  for (const entry of value) {
    projected.add(projectWireValue(entry, `${path}.values[${index}]`, state))
    index++
  }
  return projected
}

function projectWireRecord(
  value: unknown,
  path: string,
  state: ProjectionState,
): RemoteSubsetWireRecord {
  const source = requirePlainRecord(value, path)
  const existing = state.wireValues.get(source)
  if (existing) return existing as RemoteSubsetWireRecord
  const projected: RemoteSubsetWireRecord = {}
  state.wireValues.set(source, projected)

  for (const key of ownKeys(source, path)) {
    const childPath = propertyPath(path, key)
    if (typeof key === `symbol`) {
      throw new RemoteSubsetWireValueError(childPath, `symbol property key`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (!descriptor || !descriptor.enumerable || !(`value` in descriptor)) {
      throw new RemoteSubsetWireValueError(childPath, `non-data property`)
    }
    Object.defineProperty(projected, key, {
      value: projectWireValue(descriptor.value, childPath, state),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return projected
}

function projectNumber(value: unknown, path: string): number {
  if (typeof value !== `number` || !Number.isSafeInteger(value) || value < 0) {
    throw new RemoteSubsetWireValueError(path, `non-negative safe integer`)
  }
  return value
}

function readRequiredDataProperty(
  value: object,
  key: string,
  path: string,
): unknown {
  const property = readDataProperty(value, key, path)
  if (!property.present) {
    throw new RemoteSubsetWireValueError(path, `missing property`)
  }
  return property.value
}

function readDataProperty(
  value: object,
  key: string,
  path: string,
): DataProperty {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    throw new RemoteSubsetWireValueError(path, `unreadable property`)
  }
  if (!descriptor) return { present: false }
  if (!descriptor.enumerable || !(`value` in descriptor)) {
    throw new RemoteSubsetWireValueError(path, `non-data property`)
  }
  return { present: true, value: descriptor.value }
}

function assertAllowedProperties(
  value: object,
  path: string,
  allowed: ReadonlyArray<string>,
): void {
  const allowedSet = new Set(allowed)
  for (const key of ownKeys(value, path)) {
    if (typeof key === `symbol` || !allowedSet.has(key)) {
      throw new RemoteSubsetWireValueError(propertyPath(path, key), `property`)
    }
    readDataProperty(value, key, propertyPath(path, key))
  }
}

function assertPlainContainer(value: object, path: string): void {
  assertExactPrototype(value, Object.prototype, path)
}

function assertExpressionPrototype(
  value: object,
  path: string,
  expressionPrototype: object,
): void {
  let prototype: object | null
  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    throw new RemoteSubsetWireValueError(path, `unreadable prototype`)
  }
  if (prototype !== Object.prototype && prototype !== expressionPrototype) {
    throw new RemoteSubsetWireValueError(path, describe(value))
  }
}

function assertExactPrototype(
  value: object,
  expected: object,
  path: string,
): void {
  let prototype: object | null
  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    throw new RemoteSubsetWireValueError(path, `unreadable prototype`)
  }
  if (prototype !== expected) {
    throw new RemoteSubsetWireValueError(path, describe(value))
  }
}

function assertNoOwnProperties(value: object, path: string): void {
  const keys = ownKeys(value, path)
  if (keys.length > 0) {
    throw new RemoteSubsetWireValueError(
      propertyPath(path, keys[0]!),
      `property`,
    )
  }
}

function assertFixedArrayBuffer(value: ArrayBuffer, path: string): void {
  if ((value as ArrayBuffer & { readonly resizable?: boolean }).resizable) {
    throw new RemoteSubsetWireValueError(path, `resizable ArrayBuffer`)
  }
}

function assertRegExpShape(value: RegExp, path: string): void {
  const keys = ownKeys(value, path)
  for (const key of keys) {
    if (key !== `lastIndex`) {
      throw new RemoteSubsetWireValueError(propertyPath(path, key), `property`)
    }
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, `lastIndex`)
  if (!descriptor || !(`value` in descriptor) || descriptor.value !== 0) {
    throw new RemoteSubsetWireValueError(
      `${path}.lastIndex`,
      `RegExp lastIndex must be 0`,
    )
  }
}

function assertTypedArrayShape(
  value: RemoteSubsetWireTypedArray,
  path: string,
): void {
  const keys = ownKeys(value, path)
  for (const key of keys) {
    if (typeof key !== `string` || !isCanonicalArrayIndex(key, value.length)) {
      throw new RemoteSubsetWireValueError(propertyPath(path, key), `property`)
    }
  }
}

function assertArrayShape(value: Array<unknown>, path: string): void {
  assertExactPrototype(value, Array.prototype, path)
  const keys = ownKeys(value, path)
  for (const key of keys) {
    if (
      key !== `length` &&
      (typeof key !== `string` || !isCanonicalArrayIndex(key, value.length))
    ) {
      throw new RemoteSubsetWireValueError(propertyPath(path, key), `property`)
    }
    if (key !== `length`) {
      readDataProperty(value, key, propertyPath(path, key))
    }
  }
}

function isCanonicalArrayIndex(key: string, length: number): boolean {
  if (!/^(0|[1-9][0-9]*)$/.test(key)) return false
  const index = Number(key)
  return Number.isSafeInteger(index) && index >= 0 && index < length
}

function getTypedArrayConstructor(
  value: object,
): TypedArrayConstructor | undefined {
  let prototype: object | null
  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    return undefined
  }
  return typedArrayConstructors.find(
    (constructor) => prototype === constructor.prototype,
  )
}

function requireArray(value: unknown, path: string): Array<unknown> {
  if (!Array.isArray(value)) {
    throw new RemoteSubsetWireValueError(path, describe(value))
  }
  return value
}

function requireObject(value: unknown, path: string): object {
  if (value === null || typeof value !== `object`) {
    throw new RemoteSubsetWireValueError(path, describe(value))
  }
  return value
}

function requirePlainRecord(
  value: unknown,
  path: string,
): Record<string, unknown> {
  const object = requireObject(value, path)
  assertExactPrototype(object, Object.prototype, path)
  return object as Record<string, unknown>
}

function ownKeys(value: object, path: string): Array<string | symbol> {
  try {
    return Reflect.ownKeys(value)
  } catch {
    throw new RemoteSubsetWireValueError(path, `unreadable properties`)
  }
}

function propertyPath(path: string, key: string | symbol): string {
  if (typeof key === `symbol`) return `${path}[${String(key)}]`
  return identifierPattern.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`
}

function describe(value: unknown): string {
  if (value === null) return `null`
  if (typeof value !== `object`) return typeof value
  return `object`
}
