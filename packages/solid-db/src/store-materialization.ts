import { $PROXY, untrack } from 'solid-js'
import { $RAW, createStore, produce, unwrap } from 'solid-js/store'

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
// Native setters and data nodes own updates. The read view preserves accessor
// results and prototype methods when a user field shadows hasOwnProperty.
export function createStoreReadView<T extends object>(store: T): T {
  const views = new WeakMap<object, object>()
  function exposed<V>(value: V): V {
    if (!container(value) || !($PROXY in value)) return value
    const target = unwrap(value)
    if (views.has(target)) return views.get(target) as V
    const native = Reflect.get(target, $PROXY) as RecordValue
    const view = new Proxy(native, {
      get(current, key, receiver) {
        // Native bookkeeping has fixed identities and must remain transparent.
        if (key === $RAW || key === $PROXY) return Reflect.get(current, key)
        const descriptor = Object.getOwnPropertyDescriptor(target, key)
        let result: unknown
        if (descriptor?.get)
          result = Reflect.apply(descriptor.get, receiver, [])
        else if (!descriptor && key in target) {
          // The own-field admission shim notifies native membership nodes.
          // __proto__ bypasses native membership tracking, so read its data node.
          if (key === `__proto__`) Reflect.get(current, key)
          else Reflect.has(current, key)
          result = Reflect.get(target, key, receiver)
        } else result = Reflect.get(current, key, receiver)
        return exposed(result)
      },
    })
    views.set(target, view)
    return view as V
  }
  return exposed(store)
}
export function createRowStore<T extends object>(source: T) {
  // Every nested node is immutable after admission. Native stores supply reads
  // and getter tracking, while one per-row memo preserves source identities.
  const copies = new WeakMap<object, object>()
  function detached<V>(value: V, root = false): V {
    if (!container(value)) return value
    const native = $PROXY in value
    const original = (
      native ? unwrap(Reflect.get(value, $PROXY)) : value
    ) as RecordValue
    if (!root && copies.has(original)) return copies.get(original) as V
    const target: RecordValue = Array.isArray(original)
      ? Object.setPrototypeOf(
          new Array(original.length),
          Object.getPrototypeOf(original),
        )
      : Object.create(Object.getPrototypeOf(original))
    const [view, setView] = createStore(target)
    if (!root) copies.set(original, view)
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
    // Native reads skip node creation for callables behind a shadowed
    // hasOwnProperty and for __proto__. Seed those nodes before observation.
    // An absent __proto__ keeps a node while retaining its inherited fallback.
    for (const key of new Set([...keys(target), `__proto__`])) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key)
      if (descriptor && !(`value` in descriptor)) continue
      const initialValue: unknown = descriptor?.value
      if (typeof initialValue !== `function` && key !== `__proto__`) continue
      if (!descriptor)
        Object.defineProperty(target, key, {
          value: undefined,
          enumerable: true,
          writable: true,
          configurable: true,
        })
      setView(
        produce((draft) => {
          draft[key] = initialValue === null ? undefined : null
          draft[key] = initialValue
        }),
      )
      if (descriptor) Object.defineProperty(target, key, descriptor)
      else delete target[key]
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
                    if (visibility && current[key] === unwrap(value))
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
