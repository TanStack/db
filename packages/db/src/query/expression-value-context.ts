export type ExpressionValueContext =
  | `exact-output`
  | `equality-operand`
  | `membership-candidates`
  | `ordering-operand`
  | `structural-operand`

/** Describe how each function argument contributes to its observable result. */
export function getExpressionArgumentValueContext(
  name: string,
  index: number,
  argumentCount: number,
  resultContext: ExpressionValueContext,
): ExpressionValueContext {
  if (name === `eq`) return `equality-operand`
  if (name === `in`) {
    return index === 0 ? `equality-operand` : `membership-candidates`
  }
  if (isOrderingFunction(name)) return `ordering-operand`

  if (
    name === `concat` ||
    name === `length` ||
    name === `add` ||
    name === `subtract` ||
    name === `multiply` ||
    name === `divide` ||
    name === `date` ||
    name === `datetime` ||
    name === `strftime`
  ) {
    return `structural-operand`
  }

  if (name === `coalesce` || name === `upper` || name === `lower`) {
    return resultContext
  }

  if (name === `caseWhen`) {
    const isDefault = argumentCount % 2 === 1 && index === argumentCount - 1
    return isDefault || index % 2 === 1 ? resultContext : `exact-output`
  }

  return `exact-output`
}

/** Reject values whose observable scalar behavior cannot be cloned exactly. */
export function assertSnapshotCapableStructuralValue(
  value: unknown,
  path = `value`,
): void {
  visitStructuralValue(value, path, new WeakSet(), new WeakSet())
}

/**
 * Read an IN candidate array without invoking caller-defined iteration or
 * accessors. The plain result gives later identity and adapter paths one stable
 * observation of the request.
 */
export function snapshotMembershipCandidateValues(
  value: unknown,
  path = `value`,
): Array<unknown> | undefined {
  if (!Array.isArray(value)) return undefined
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throwUnsupportedMembership(path, `array subclasses are unsupported`)
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, `length`)
  const length = lengthDescriptor?.value
  if (typeof length !== `number` || !Number.isInteger(length) || length < 0) {
    throwUnsupportedMembership(path, `invalid array length`)
  }

  const snapshot = new Array<unknown>(length)
  for (let index = 0; index < length; index++) snapshot[index] = undefined

  for (const key of Reflect.ownKeys(value)) {
    if (key === `length`) continue
    if (typeof key !== `string` || !isArrayIndex(key)) {
      throwUnsupportedMembership(path, `custom properties are unsupported`)
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (!descriptor.enumerable || !(`value` in descriptor)) {
      throwUnsupportedMembership(
        `${path}.${key}`,
        `non-enumerable indexed properties and accessors are unsupported`,
      )
    }
    snapshot[Number(key)] = descriptor.value
  }

  return snapshot
}

function visitStructuralValue(
  value: unknown,
  path: string,
  active: WeakSet<object>,
  complete: WeakSet<object>,
): void {
  if (typeof value === `function`) {
    throwUnsupported(path, `functions may expose mutable coercion hooks`)
  }
  if (typeof value !== `object` || value === null) return
  if (complete.has(value)) return
  if (active.has(value)) throwUnsupported(path, `cyclic values are unsupported`)
  active.add(value)

  if (value instanceof Date) {
    assertPrototype(value, Date.prototype, path)
    assertNoOwnProperties(value, path)
  } else if (value instanceof ArrayBuffer) {
    assertPrototype(value, ArrayBuffer.prototype, path)
    assertNoOwnProperties(value, path)
  } else if (ArrayBuffer.isView(value)) {
    assertSupportedArrayBufferViewPrototype(value, path)
    assertOnlyIndexedProperties(value, path, false)
  } else if (Array.isArray(value)) {
    assertPrototype(value, Array.prototype, path)
    assertOnlyIndexedProperties(value, path, true)
    value.forEach((entry, index) =>
      visitStructuralValue(entry, `${path}[${index}]`, active, complete),
    )
  } else if (value instanceof Map) {
    assertPrototype(value, Map.prototype, path)
    assertNoOwnProperties(value, path)
    let index = 0
    for (const [key, entryValue] of value) {
      visitStructuralValue(key, `${path}.key[${index}]`, active, complete)
      visitStructuralValue(
        entryValue,
        `${path}.value[${index}]`,
        active,
        complete,
      )
      index++
    }
  } else if (value instanceof Set) {
    assertPrototype(value, Set.prototype, path)
    assertNoOwnProperties(value, path)
    let index = 0
    for (const entry of value) {
      visitStructuralValue(entry, `${path}[${index}]`, active, complete)
      index++
    }
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throwUnsupported(path, `opaque object prototypes are unsupported`)
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== `string`) {
        throwUnsupported(path, `symbol properties are unsupported`)
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (!descriptor.enumerable || !(`value` in descriptor)) {
        throwUnsupported(
          `${path}.${key}`,
          `non-enumerable properties and accessors are unsupported`,
        )
      }
      visitStructuralValue(descriptor.value, `${path}.${key}`, active, complete)
    }
  }

  active.delete(value)
  complete.add(value)
}

function assertPrototype(value: object, expected: object, path: string): void {
  if (Object.getPrototypeOf(value) !== expected) {
    throwUnsupported(path, `built-in subclasses are unsupported`)
  }
}

function assertSupportedArrayBufferViewPrototype(
  value: ArrayBufferView,
  path: string,
): void {
  const prototype = Object.getPrototypeOf(value)
  const supported = [
    DataView.prototype,
    Int8Array.prototype,
    Uint8Array.prototype,
    Uint8ClampedArray.prototype,
    Int16Array.prototype,
    Uint16Array.prototype,
    Int32Array.prototype,
    Uint32Array.prototype,
    Float32Array.prototype,
    Float64Array.prototype,
    BigInt64Array.prototype,
    BigUint64Array.prototype,
    ...(typeof Buffer === `undefined` ? [] : [Buffer.prototype]),
  ]
  if (!supported.includes(prototype)) {
    throwUnsupported(path, `built-in subclasses are unsupported`)
  }
}

function assertNoOwnProperties(value: object, path: string): void {
  if (Reflect.ownKeys(value).length > 0) {
    throwUnsupported(path, `custom properties are unsupported`)
  }
}

function assertOnlyIndexedProperties(
  value: object,
  path: string,
  allowLength: boolean,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== `string`) {
      throwUnsupported(path, `custom properties are unsupported`)
    }

    const isLength = allowLength && key === `length`
    if (!isLength && !isArrayIndex(key)) {
      throwUnsupported(path, `custom properties are unsupported`)
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (!(`value` in descriptor) || (!isLength && !descriptor.enumerable)) {
      throwUnsupported(
        `${path}.${key}`,
        `non-enumerable indexed properties and accessors are unsupported`,
      )
    }
  }
}

function isArrayIndex(key: string): boolean {
  const index = Number(key)
  return Number.isInteger(index) && index >= 0 && String(index) === key
}

function throwUnsupported(path: string, reason: string): never {
  throw new TypeError(
    `Cannot snapshot structural expression value at ${path}: ${reason}`,
  )
}

function throwUnsupportedMembership(path: string, reason: string): never {
  throw new TypeError(
    `Cannot snapshot membership candidates at ${path}: ${reason}`,
  )
}

function isOrderingFunction(name: string): boolean {
  return name === `gt` || name === `gte` || name === `lt` || name === `lte`
}
