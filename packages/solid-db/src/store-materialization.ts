import { $PROXY, untrack } from 'solid-js'
import { createStore, produce, unwrap } from 'solid-js/store'

type RecordValue = Record<PropertyKey, unknown>
function container(value: unknown): value is RecordValue {
  if (value === null || typeof value !== `object`) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return Array.isArray(value) || proto === Object.prototype || proto === null
}
function keys(value: object) {
  return Reflect.ownKeys(value).filter(
    (key) =>
      (typeof key !== `symbol` ||
        Object.prototype.propertyIsEnumerable.call(value, key)) &&
      !(Array.isArray(value) && key === `length`),
  )
}
export function createRowStore<T extends object>(source: T) {
  // Every nested node is immutable after admission. Native stores supply reads
  // and getter tracking, while one per-row memo preserves source identities.
  const copies = new WeakMap<object, object>()
  function detached<V>(value: V, root = false): V {
    if (!container(value)) return value
    if (!root && copies.has(value)) return copies.get(value) as V
    const native = $PROXY in value
    const original = (
      native ? unwrap(Reflect.get(value, $PROXY)) : value
    ) as RecordValue
    const target: RecordValue = Array.isArray(original)
      ? Object.setPrototypeOf(
          new Array(original.length),
          Object.getPrototypeOf(original),
        )
      : Object.create(Object.getPrototypeOf(original))
    const view = createStore(target)[0]
    if (!root) copies.set(value, view)
    for (const key of Reflect.ownKeys(original)) {
      if (Array.isArray(original) && key === `length`) continue
      const desc = Object.getOwnPropertyDescriptor(original, key)!
      if (native && typeof key === `symbol` && !desc.enumerable) continue
      Object.defineProperty(
        target,
        key,
        `value` in desc
          ? {
              value: detached(desc.value),
              enumerable: desc.enumerable,
              writable: true,
              configurable: true,
            }
          : desc.enumerable && desc.get
            ? {
                get: () => detached(Reflect.get(original, key)),
                enumerable: true,
                configurable: true,
              }
            : { ...desc, configurable: true },
      )
    }
    return view as V
  }
  return untrack(() => {
    let [row, setRow] = createStore(unwrap(detached(source, true)))
    const entry = {
      value: row,
      update(nextSource: T) {
        if (nextSource === source) return
        untrack(() => {
          const next = detached(nextSource, true)
          const target = unwrap(next) as RecordValue
          const current = unwrap(row) as RecordValue
          // Native setters do not replace accessor definitions. A root-accessor
          // row is a separate boundary; nested accessors remain immutable views.
          const rootAccessor = [...keys(current), ...keys(target)].some(
            (key) =>
              Object.getOwnPropertyDescriptor(current, key)?.get ||
              Object.getOwnPropertyDescriptor(target, key)?.get,
          )
          if (rootAccessor) {
            ;[row, setRow] = createStore(target as T)
            entry.value = row
          } else
            setRow(
              produce((draft: RecordValue) => {
                for (const key of keys(current))
                  if (!Object.hasOwn(target, key)) {
                    if (draft[key] === undefined) draft[key] = null
                    delete draft[key]
                  }
                for (const key of keys(target)) {
                  const desc = Object.getOwnPropertyDescriptor(target, key)!
                  const value: unknown = Reflect.get(next, key)
                  const existed = Object.hasOwn(current, key)
                  const visibility =
                    existed &&
                    Object.prototype.propertyIsEnumerable.call(current, key) !==
                      desc.enumerable
                  // Shadow inherited names before native setters compare them.
                  if (!existed)
                    Object.defineProperty(current, key, {
                      value: undefined,
                      enumerable: desc.enumerable,
                      writable: true,
                      configurable: true,
                    })
                  if (value === undefined) {
                    if (!existed || current[key] !== undefined || visibility) {
                      draft[key] = null
                      draft[key] = undefined
                      Object.defineProperty(current, key, {
                        value: undefined,
                        enumerable: desc.enumerable,
                        writable: true,
                        configurable: true,
                      })
                    }
                  } else {
                    if (visibility && current[key] === value)
                      draft[key] = value === null ? undefined : null
                    if (current[key] !== unwrap(value)) draft[key] = value
                    if (!existed || visibility)
                      Object.defineProperty(current, key, {
                        enumerable: desc.enumerable,
                      })
                  }
                }
                if (Array.isArray(target)) draft.length = target.length
              }) as (previous: T) => T,
            )
          source = nextSource
        })
      },
    }
    return entry
  })
}
