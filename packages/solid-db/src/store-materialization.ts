import { createSignal, createStore, markRaw } from 'solid-js'
import type { Signal } from 'solid-js'

type Fields = Record<PropertyKey, unknown>
type Descriptors = Map<PropertyKey, PropertyDescriptor>

// Solid's store leaves this name to the prototype: it is never an own field of
// a store, and reading it yields undefined. A row store keeps the user's own
// field of that name beside the store and serves it through a read facade.
const RESERVED = `__proto__`

function isContainer(value: unknown): value is Fields {
  if (value === null || typeof value !== `object`) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return (
    Array.isArray(value) || prototype === Object.prototype || prototype === null
  )
}

// An array's length follows its indices, so it is not a field of its own.
function descriptors(fields: Fields): Descriptors {
  const keys = Reflect.ownKeys(fields).filter(
    (key) => !Array.isArray(fields) || key !== `length`,
  )
  return new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(fields, key)!]),
  )
}

/** The own reserved field's data, or undefined when the row has none. */
type Reserved = { value: unknown; enumerable: boolean }
function reservedOf(fields: Fields): Reserved | undefined {
  const own = Object.getOwnPropertyDescriptor(fields, RESERVED)
  return own && `value` in own
    ? { value: own.value, enumerable: own.enumerable === true }
    : undefined
}
function sameReserved(a: Reserved | undefined, b: Reserved | undefined) {
  return (
    a === b ||
    (a !== undefined &&
      b !== undefined &&
      Object.is(a.value, b.value) &&
      a.enumerable === b.enumerable)
  )
}

/**
 * A row store for one result row: what `query()` hands the component.
 *
 * The adapter must not write into a Collection's borrowed row, so each admitted
 * container is a copy the store owns. A copy keeps its descriptors: an accessor
 * stays an accessor, so a getter read in a consumer's scope keeps tracking the
 * signals it reads, and a function or a reserved name stays ordinary user data.
 * A nested container is admitted once per source object and is then immutable,
 * so an unchanged one keeps its identity and its readers stay quiet.
 *
 * The public value is a facade over the native store. It serves the store's
 * fine-grained reads and adds the one field the store cannot hold.
 */
export function createRowStore<T extends object>(source: T) {
  // One view per admitted source object, shared across the row's updates.
  const views = new WeakMap<object, Fields>()
  const apply = new WeakMap<Fields, (next: Fields) => void>()

  /** A detached copy: own data and accessors, with nested containers admitted. */
  function copy(original: Fields): Fields {
    // A real array of the same length and prototype, so array methods and
    // Array.isArray keep working; any other container keeps its prototype.
    const detached = (
      Array.isArray(original)
        ? Object.setPrototypeOf(
            new Array(original.length),
            Object.getPrototypeOf(original),
          )
        : Object.create(Object.getPrototypeOf(original))
    ) as Fields
    for (const key of Reflect.ownKeys(original)) {
      if (key === RESERVED || (Array.isArray(original) && key === `length`))
        continue
      const own = Object.getOwnPropertyDescriptor(original, key)!
      Object.defineProperty(
        detached,
        key,
        `value` in own
          ? {
              value: isContainer(own.value) ? view(own.value) : own.value,
              enumerable: own.enumerable,
              writable: true,
              configurable: true,
            }
          : {
              ...own,
              // The getter keeps reading its source, so it stays live.
              get: () => {
                const value: unknown = Reflect.get(original, key)
                return isContainer(value) ? view(value) : value
              },
              configurable: true,
            },
      )
    }
    return detached
  }

  function view(original: Fields): Fields {
    const existing = views.get(original)
    if (existing) return existing

    // What the store was last told, by descriptor. Compared with the next
    // copy, this keeps an unchanged field's readers asleep.
    let admitted = descriptors(original)
    const [store, setStore] = createStore(copy(original))
    const [reserved, setReserved] = createSignal<Reserved | undefined>(
      reservedOf(original),
    )
    // A store node compares the two zeros as equal, so it cannot hold -0 over
    // +0. The admitted sign is kept beside the store, one signal per key that
    // holds a zero, so a reader of that key follows a flip and no other.
    const negativeZero = new Map<PropertyKey, Signal<boolean>>()
    for (const [key, own] of admitted)
      if (`value` in own && own.value === 0)
        negativeZero.set(key, createSignal(Object.is(own.value, -0)))

    const facade = new Proxy(store, {
      get(target, key) {
        if (key === RESERVED) {
          const own = reserved()
          // Without an own field the read is the ordinary inherited one.
          return own ? own.value : Object.getPrototypeOf(target)
        }
        // The store is the receiver, so its own getters see the store.
        const value: unknown = Reflect.get(target, key, target)
        const sign = negativeZero.get(key)
        return value === 0 && sign?.[0]() ? -0 : value
      },
      getOwnPropertyDescriptor(target, key) {
        const own = reserved()
        if (key !== RESERVED)
          return Reflect.getOwnPropertyDescriptor(target, key)
        return own && { ...own, writable: true, configurable: true }
      },
      has(target, key) {
        if (key !== RESERVED) return Reflect.has(target, key)
        const prototype = Object.getPrototypeOf(target)
        return !!reserved() || (prototype !== null && key in prototype)
      },
      ownKeys(target) {
        const keys = Reflect.ownKeys(target)
        return reserved() ? [...keys, RESERVED] : keys
      },
    })
    // A parent store serves the facade as is instead of wrapping it again:
    // a wrapped array would no longer read as an array.
    views.set(original, markRaw(facade))

    apply.set(facade, (next) => {
      const detached = copy(next)
      const nextDescriptors = descriptors(detached)
      const reservedNext = reservedOf(next)
      // A visibility change moves no membership, so a single transaction
      // would collapse it: delete first, then define.
      const settled: Array<[PropertyKey, PropertyDescriptor]> = []
      setStore((draft) => {
        const target = draft
        // Own keys only: an inherited name such as toString stays `in` the
        // copy after the source drops its own field of that name.
        for (const key of admitted.keys())
          if (!nextDescriptors.has(key)) delete target[key]
        // An equal length notifies nobody.
        if (Array.isArray(detached)) target.length = detached.length
        for (const [key, own] of nextDescriptors) {
          const previous = admitted.get(key)
          if (!(`value` in own)) {
            // An accessor is defined, never evaluated. An absent key is
            // written first so its membership is observable.
            if (!previous) target[key] = undefined
            Object.defineProperty(target, key, own)
          } else if (!previous || !(`value` in previous)) {
            Object.defineProperty(target, key, own)
          } else if (!Object.is(previous.value, own.value)) {
            if (previous.value !== own.value) target[key] = own.value
            // Otherwise a signed-zero flip: the store keeps its zero and the
            // facade serves the sign.
          } else if (previous.enumerable !== own.enumerable) {
            delete target[key]
            settled.push([key, own])
          }
        }
      })
      if (settled.length)
        setStore((draft) => {
          for (const [key, own] of settled)
            Object.defineProperty(draft, key, own)
        })
      admitted = nextDescriptors
      setReserved((previous) =>
        sameReserved(previous, reservedNext) ? previous : reservedNext,
      )
      for (const [key, own] of nextDescriptors) {
        if (!(`value` in own) || own.value !== 0) continue
        const negative = Object.is(own.value, -0)
        const sign = negativeZero.get(key)
        if (sign) sign[1](negative)
        else negativeZero.set(key, createSignal(negative))
      }
    })
    return facade
  }

  const value = view(source as Fields) as T
  let current = source
  return {
    value,
    update(next: T) {
      if (next === current) return
      current = next
      apply.get(value as unknown as Fields)!(next as Fields)
    },
  }
}
