import { IR } from '@tanstack/db'
import type { LoadSubsetOptions } from '@tanstack/db'

export type RemoteSubsetWirePrimitive =
  undefined | null | boolean | string | number | bigint

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
  | { type: `ref`; path: Array<string>; sourceAlias?: string }
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
  validateOnly: boolean
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
  return visitLoadSubsetOptions(options, false)
}

/** Checks wire admission without constructing a detached request snapshot. */
export function validateRemoteSubsetOptions(options: LoadSubsetOptions): void {
  visitLoadSubsetOptions(options, true)
}

// Both modes run the same admission checks. Validation retains input nodes only
// as cycle markers; it never writes to them or returns them to a caller.
function visitLoadSubsetOptions(
  options: LoadSubsetOptions,
  validateOnly: boolean,
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
    validateOnly,
    expressions: new WeakMap(),
    expressionArrays: new WeakMap(),
    stringArrays: new WeakMap(),
    orderByArrays: new WeakMap(),
    orderByClauses: new WeakMap(),
    compareOptions: new WeakMap(),
    cursors: new WeakMap(),
    wireValues: new WeakMap(),
  }
  const projected: TransportedLoadSubsetOptions = validateOnly
    ? (options as TransportedLoadSubsetOptions)
    : {}
  const where = readDataProperty(options, `where`, `options.where`)
  const orderBy = readDataProperty(options, `orderBy`, `options.orderBy`)
  const limit = readDataProperty(options, `limit`, `options.limit`)
  const cursor = readDataProperty(options, `cursor`, `options.cursor`)
  const offset = readDataProperty(options, `offset`, `options.offset`)

  if (where.present && where.value !== undefined) {
    const result = projectExpression(where.value, `options.where`, state)
    if (!state.validateOnly) projected.where = result
  }
  if (orderBy.present && orderBy.value !== undefined) {
    const result = projectOrderBy(orderBy.value, `options.orderBy`, state)
    if (!state.validateOnly) projected.orderBy = result
  }
  if (limit.present && limit.value !== undefined) {
    const result = projectNumber(limit.value, `options.limit`)
    if (!state.validateOnly) projected.limit = result
  }
  if (cursor.present && cursor.value !== undefined) {
    const result = projectCursor(cursor.value, `options.cursor`, state)
    if (!state.validateOnly) projected.cursor = result
  }
  if (offset.present && offset.value !== undefined) {
    const result = projectNumber(offset.value, `options.offset`)
    if (!state.validateOnly) projected.offset = result
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
      assertAllowedProperties(object, path, [`type`, `path`, `sourceAlias`])
      const projected: Extract<RemoteSubsetWireExpression, { type: `ref` }> =
        state.validateOnly
          ? (object as Extract<RemoteSubsetWireExpression, { type: `ref` }>)
          : { type: `ref`, path: [] }
      state.expressions.set(object, projected)
      const sourcePath = readRequiredDataProperty(
        object,
        `path`,
        `${path}.path`,
      )
      const result = projectStringArray(sourcePath, `${path}.path`, state)
      if (!state.validateOnly) projected.path = result
      const sourceAlias = readDataProperty(
        object,
        `sourceAlias`,
        `${path}.sourceAlias`,
      )
      if (sourceAlias.present) {
        if (
          typeof sourceAlias.value !== `string` ||
          result[0] !== sourceAlias.value
        ) {
          throw new RemoteSubsetWireValueError(
            `${path}.sourceAlias`,
            `source alias must match the first path segment`,
          )
        }
        if (!state.validateOnly) projected.sourceAlias = sourceAlias.value
      }
      return projected
    }
    case `val`: {
      assertExpressionPrototype(object, path, IR.Value.prototype)
      assertAllowedProperties(object, path, [`type`, `value`])
      const projected: Extract<RemoteSubsetWireExpression, { type: `val` }> =
        state.validateOnly
          ? (object as Extract<RemoteSubsetWireExpression, { type: `val` }>)
          : { type: `val`, value: undefined }
      state.expressions.set(object, projected)
      const sourceValue = readRequiredDataProperty(
        object,
        `value`,
        `${path}.value`,
      )
      const result = projectWireValue(sourceValue, `${path}.value`, state)
      if (!state.validateOnly) projected.value = result
      return projected
    }
    case `func`: {
      assertExpressionPrototype(object, path, IR.Func.prototype)
      assertAllowedProperties(object, path, [`type`, `name`, `args`])
      const projected: Extract<RemoteSubsetWireExpression, { type: `func` }> =
        state.validateOnly
          ? (object as Extract<RemoteSubsetWireExpression, { type: `func` }>)
          : { type: `func`, name: ``, args: [] }
      state.expressions.set(object, projected)
      const name = readRequiredDataProperty(object, `name`, `${path}.name`)
      if (typeof name !== `string`) {
        throw new RemoteSubsetWireValueError(`${path}.name`, describe(name))
      }
      if (!state.validateOnly) projected.name = name
      const args = readRequiredDataProperty(object, `args`, `${path}.args`)
      const result = projectExpressionArray(args, `${path}.args`, state)
      if (!state.validateOnly) projected.args = result
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
  const projected = state.validateOnly
    ? (array as Array<RemoteSubsetWireExpression>)
    : new Array<RemoteSubsetWireExpression>(array.length)
  state.expressionArrays.set(array, projected)
  for (let index = 0; index < array.length; index++) {
    if (!(index in array)) {
      throw new RemoteSubsetWireValueError(
        `${path}[${index}]`,
        `missing expression`,
      )
    }
    const result = projectExpression(array[index], `${path}[${index}]`, state)
    if (!state.validateOnly) projected[index] = result
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
  const projected = state.validateOnly
    ? (array as Array<string>)
    : new Array<string>(array.length)
  state.stringArrays.set(array, projected)
  for (let index = 0; index < array.length; index++) {
    const entry = array[index]
    if (!(index in array) || typeof entry !== `string`) {
      throw new RemoteSubsetWireValueError(`${path}[${index}]`, describe(entry))
    }
    if (!state.validateOnly) projected[index] = entry
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
  const projected = state.validateOnly
    ? (array as Array<RemoteSubsetWireOrderByClause>)
    : new Array<RemoteSubsetWireOrderByClause>(array.length)
  state.orderByArrays.set(array, projected)

  for (let index = 0; index < array.length; index++) {
    const clausePath = `${path}[${index}]`
    const clause = requirePlainRecord(array[index], clausePath)
    const existingClause = state.orderByClauses.get(clause)
    if (existingClause) {
      if (!state.validateOnly) projected[index] = existingClause
      continue
    }
    assertAllowedProperties(clause, clausePath, [
      `expression`,
      `compareOptions`,
    ])
    const projectedClause = state.validateOnly
      ? (clause as RemoteSubsetWireOrderByClause)
      : {
          expression: undefined as unknown as RemoteSubsetWireExpression,
          compareOptions:
            undefined as unknown as RemoteSubsetWireCompareOptions,
        }
    if (!state.validateOnly) projected[index] = projectedClause
    state.orderByClauses.set(clause, projectedClause)
    const expression = projectExpression(
      readRequiredDataProperty(
        clause,
        `expression`,
        `${clausePath}.expression`,
      ),
      `${clausePath}.expression`,
      state,
    )
    const compareOptions = projectCompareOptions(
      readRequiredDataProperty(
        clause,
        `compareOptions`,
        `${clausePath}.compareOptions`,
      ),
      `${clausePath}.compareOptions`,
      state,
    )
    if (!state.validateOnly) {
      projectedClause.expression = expression
      projectedClause.compareOptions = compareOptions
    }
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
  } = state.validateOnly ? source : {}

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
  if (!state.validateOnly) projected.direction = direction

  const nulls = readRequiredDataProperty(source, `nulls`, `${path}.nulls`)
  if (nulls !== `first` && nulls !== `last`) {
    throw new RemoteSubsetWireValueError(`${path}.nulls`, describe(nulls))
  }
  if (!state.validateOnly) projected.nulls = nulls

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
    if (!state.validateOnly) projected.stringSort = stringSort.value
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
      if (!state.validateOnly) projected.locale = locale.value
    }
    const localeOptions = readDataProperty(
      source,
      `localeOptions`,
      `${path}.localeOptions`,
    )
    if (localeOptions.present && localeOptions.value !== undefined) {
      const result = projectWireRecord(
        localeOptions.value,
        `${path}.localeOptions`,
        state,
      )
      if (!state.validateOnly) projected.localeOptions = result
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
  const projected: RemoteSubsetWireCursor = state.validateOnly
    ? (source as RemoteSubsetWireCursor)
    : {
        whereFrom: undefined as unknown as RemoteSubsetWireExpression,
        whereCurrent: undefined as unknown as RemoteSubsetWireExpression,
      }
  state.cursors.set(source, projected)
  const whereFrom = projectExpression(
    readRequiredDataProperty(source, `whereFrom`, `${path}.whereFrom`),
    `${path}.whereFrom`,
    state,
  )
  const whereCurrent = projectExpression(
    readRequiredDataProperty(source, `whereCurrent`, `${path}.whereCurrent`),
    `${path}.whereCurrent`,
    state,
  )
  if (!state.validateOnly) {
    projected.whereFrom = whereFrom
    projected.whereCurrent = whereCurrent
  }
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
    if (!state.validateOnly) projected.lastKey = lastKey.value
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
    const time = value.getTime()
    const projected = state.validateOnly ? value : new NativeDate(time)
    state.wireValues.set(value, projected)
    return projected
  }
  if (value instanceof RegExp) {
    assertExactPrototype(value, RegExp.prototype, path)
    assertRegExpShape(value, path)
    const { source, flags } = value
    const projected = state.validateOnly ? value : new RegExp(source, flags)
    state.wireValues.set(value, projected)
    return projected
  }
  if (value instanceof ArrayBuffer) {
    assertExactPrototype(value, ArrayBuffer.prototype, path)
    assertNoOwnProperties(value, path)
    assertFixedArrayBuffer(value, path)
    let projected: ArrayBuffer
    try {
      if (state.validateOnly) {
        // A zero-length view checks detachment without copying the backing bytes.
        new Uint8Array(value, 0, 0)
        projected = value
      } else {
        projected = value.slice(0)
      }
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
    const projected = state.validateOnly
      ? value
      : new DataView(projectedBuffer, byteOffset, byteLength)
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
      projected = state.validateOnly
        ? typedArray
        : new typedArrayConstructor(projectedBuffer, byteOffset, length)
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
  const projected = state.validateOnly
    ? (value as Array<RemoteSubsetWireValue>)
    : new Array<RemoteSubsetWireValue>(value.length)
  state.wireValues.set(value, projected)
  for (let index = 0; index < value.length; index++) {
    if (index in value) {
      const result = projectWireValue(value[index], `${path}[${index}]`, state)
      if (!state.validateOnly) projected[index] = result
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
  const projected = state.validateOnly
    ? (value as Map<RemoteSubsetWireValue, RemoteSubsetWireValue>)
    : new Map<RemoteSubsetWireValue, RemoteSubsetWireValue>()
  state.wireValues.set(value, projected)
  let index = 0
  for (const [key, entry] of value) {
    const projectedKey = projectWireValue(
      key,
      `${path}.entries[${index}].key`,
      state,
    )
    const projectedValue = projectWireValue(
      entry,
      `${path}.entries[${index}].value`,
      state,
    )
    if (!state.validateOnly) projected.set(projectedKey, projectedValue)
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
  const projected = state.validateOnly
    ? (value as Set<RemoteSubsetWireValue>)
    : new Set<RemoteSubsetWireValue>()
  state.wireValues.set(value, projected)
  let index = 0
  for (const entry of value) {
    const result = projectWireValue(entry, `${path}.values[${index}]`, state)
    if (!state.validateOnly) projected.add(result)
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
  const projected: RemoteSubsetWireRecord = state.validateOnly
    ? (source as RemoteSubsetWireRecord)
    : {}
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
    const result = projectWireValue(descriptor.value, childPath, state)
    if (!state.validateOnly) {
      Object.defineProperty(projected, key, {
        value: result,
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
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
