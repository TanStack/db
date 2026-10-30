import { $PROXY, createSignal, untrack } from 'solid-js'
import { createStore, produce, unwrap } from 'solid-js/store'

type RecordValue = Record<PropertyKey, unknown>
type Getter = { read: () => unknown; update: (read: () => unknown) => void }
const getters = new WeakMap<object, Map<PropertyKey, Getter>>()

function isContainer(value: unknown): value is RecordValue {
  if (value === null || typeof value !== `object`) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return (
    Array.isArray(value) || prototype === Object.prototype || prototype === null
  )
}

// One copy per source container keeps shared graphs linear. Unchanged source
// objects reuse their owned copies, including elements that move in an array.
// Reconciliation below separates an owned alias before its paths diverge.
function copyForStore<T>(
  value: T,
  previousSource?: unknown,
  previousCopy?: unknown,
  copies = new WeakMap<object, object>(),
): T {
  if (!isContainer(value)) return value
  const cached = copies.get(value)
  if (cached) return cached as T
  if (value === previousSource && isContainer(previousCopy)) {
    copies.set(value, previousCopy)
    return previousCopy as T
  }
  // Reading a native store's backing data avoids copying wrapper accessors or
  // bookkeeping. Never unwrap an ordinary source tree: unwrap can edit it.
  const store = $PROXY in value
  const source = (
    store ? unwrap<unknown>(Reflect.get(value, $PROXY)) : value
  ) as RecordValue
  const array = Array.isArray(source)
  const copy: RecordValue = array
    ? Object.setPrototypeOf(
        new Array(source.length),
        Object.getPrototypeOf(source),
      )
    : Object.create(Object.getPrototypeOf(source))
  copies.set(value, copy)
  const previousItems = new Map<unknown, Array<unknown>>()
  if (array && Array.isArray(previousSource) && Array.isArray(previousCopy))
    for (let index = previousSource.length - 1; index >= 0; index--) {
      const item: unknown = previousSource[index]
      const items = previousItems.get(item) ?? []
      items.push(previousCopy[index])
      previousItems.set(item, items)
    }
  for (const key of Reflect.ownKeys(source)) {
    if (array && key === `length`) continue
    const descriptor = Object.getOwnPropertyDescriptor(source, key)!
    if (store && typeof key === `symbol` && !descriptor.enumerable) continue
    if (descriptor.get && descriptor.enumerable) {
      const [read, setRead] = createSignal(() => Reflect.get(source, key))
      const getter: Getter = {
        read: () => read()(),
        update: (next) => setRead(() => next),
      }
      const fields = getters.get(copy) ?? new Map<PropertyKey, Getter>()
      fields.set(key, getter)
      getters.set(copy, fields)
      // Getter results can alias ordinary fields. Their view must stay private
      // when those ordinary fields reconcile to a different source object.
      const getterCopies = new WeakMap<object, object>()
      Object.defineProperty(copy, key, {
        enumerable: true,
        configurable: true,
        get() {
          return copyForStore(getter.read(), undefined, undefined, getterCopies)
        },
      })
    } else if (`value` in descriptor) {
      const child: unknown = Reflect.get(source, key)
      const priorSource: unknown = isContainer(previousSource)
        ? Reflect.get(previousSource, key)
        : undefined
      const priorCopy: unknown =
        array && typeof key === `string` && /^\d+$/.test(key)
          ? previousItems.get(child)?.pop()
          : isContainer(previousCopy)
            ? Reflect.get(previousCopy, key)
            : undefined
      Object.defineProperty(copy, key, {
        value: copyForStore(
          child,
          array &&
            typeof key === `string` &&
            /^\d+$/.test(key) &&
            priorCopy !== undefined
            ? child
            : priorSource,
          priorCopy,
          copies,
        ),
        enumerable: descriptor.enumerable,
        writable: true,
        configurable: true,
      })
    } else
      Object.defineProperty(copy, key, { ...descriptor, configurable: true })
  }
  return copy as T
}

// Hidden strings are user fields. Only hidden symbols belong outside the
// selected-value boundary; array length is handled after its indexed fields.
function valueKeys(value: RecordValue): Array<PropertyKey> {
  return Reflect.ownKeys(value).filter(
    (key) =>
      (typeof key !== `symbol` ||
        Object.prototype.propertyIsEnumerable.call(value, key)) &&
      !(Array.isArray(value) && key === `length`),
  )
}

function visitGraph(
  value: unknown,
  visit: (value: RecordValue) => void,
  seen = new WeakSet<object>(),
): void {
  if (!isContainer(value) || seen.has(value)) return
  seen.add(value)
  visit(value)
  for (const key of valueKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (`value` in descriptor) visitGraph(descriptor.value, visit, seen)
  }
}

// A setter unwraps raw input recursively. Give every replacement a native
// store wrapper once, so later assignments unwrap its backing node directly.
function prepareStores(value: unknown, seen = new WeakSet<object>()): void {
  const raw = unwrap(value)
  if (!isContainer(raw) || seen.has(raw)) return
  seen.add(raw)
  for (const key of valueKeys(raw)) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key)!
    if (`value` in descriptor && isContainer(descriptor.value))
      prepareStores(Reflect.get(value as object, key), seen)
  }
}

// Protect every old node reused by the next graph. Then each old node has one
// candidate target: a second target makes it a replacement, without exploring
// the product of the old and new graphs' sharing patterns.
function conflictingCopies(current: unknown, next: unknown): WeakSet<object> {
  const previousNodes = new WeakSet<object>()
  visitGraph(current, (node) => previousNodes.add(node))
  const conflicts = new WeakSet<object>()
  visitGraph(next, (node) => {
    if (previousNodes.has(node)) conflicts.add(node)
  })
  const targets = new WeakMap<object, object>()
  function visit(previous: unknown, target: unknown): void {
    if (
      previous === target ||
      !isContainer(previous) ||
      !isContainer(target) ||
      conflicts.has(previous)
    )
      return
    const first = targets.get(previous)
    if (first) {
      if (first !== target) conflicts.add(previous)
      return
    }
    targets.set(previous, target)
    if (Array.isArray(target)) return
    for (const key of valueKeys(target)) {
      if (getters.get(target)?.has(key) || getters.get(previous)?.has(key))
        continue
      const descriptor = Object.getOwnPropertyDescriptor(target, key)!
      if (`value` in descriptor)
        visit(
          Object.hasOwn(previous, key) ? previous[key] : undefined,
          descriptor.value,
        )
    }
  }
  visit(current, next)
  return conflicts
}

function canReconcile(
  current: unknown,
  next: unknown,
  conflicts: WeakSet<object>,
): boolean {
  return (
    isContainer(current) &&
    isContainer(next) &&
    Array.isArray(current) === Array.isArray(next) &&
    !conflicts.has(current) &&
    !(
      Array.isArray(next) &&
      Object.getPrototypeOf(next) !== Array.prototype &&
      Object.getPrototypeOf(next) !== Object.getPrototypeOf(current)
    ) &&
    [...(getters.get(next)?.keys() ?? [])].every((key) =>
      getters.get(current)?.has(key),
    )
  )
}

// Solid setters still own notifications. Reconcile each graph pair once;
// recursing through Solid's tree reconciler would expand a shared DAG again.
function reconcileForStore(
  current: unknown,
  next: unknown,
  conflicts: WeakSet<object>,
  visited = new WeakSet<object>(),
): unknown {
  if (current === next || !canReconcile(current, next, conflicts)) return next
  const previous = current as RecordValue
  const target = next as RecordValue
  if (visited.has(previous)) return previous
  visited.add(previous)
  return produce((draft: RecordValue) => {
    const fields = getters.get(previous)
    for (const key of valueKeys(previous))
      if (!Object.hasOwn(target, key)) {
        fields?.get(key)?.update(() => undefined)
        fields?.delete(key)
        const descriptor = Object.getOwnPropertyDescriptor(previous, key)!
        if (descriptor.get)
          Object.defineProperty(previous, key, {
            value: undefined,
            enumerable: descriptor.enumerable,
            writable: true,
            configurable: true,
          })
        if (draft[key] === undefined) draft[key] = null
        delete draft[key]
      }
    for (const key of valueKeys(target)) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key)!
      const getter = fields?.get(key)
      if (getter) {
        getter.update(
          getters.get(target)?.get(key)?.read ?? (() => target[key]),
        )
        Object.defineProperty(previous, key, {
          enumerable: descriptor.enumerable,
        })
        continue
      }
      if (descriptor.get) {
        Object.defineProperty(previous, key, {
          ...descriptor,
          configurable: true,
        })
        continue
      }
      const existed = Object.hasOwn(previous, key)
      const visibilityChanged =
        existed &&
        Object.prototype.propertyIsEnumerable.call(previous, key) !==
          descriptor.enumerable
      const value = Array.isArray(target)
        ? target[key]
        : reconcileForStore(
            existed ? unwrap(draft[key]) : undefined,
            target[key],
            conflicts,
            visited,
          )
      // Let Solid admit new fields first. Defining an array index here would
      // grow its backing length before the setter can notify length readers.
      if (value === undefined) {
        if (!existed || previous[key] !== undefined || visibilityChanged) {
          draft[key] = null
          draft[key] = undefined
          Object.defineProperty(previous, key, {
            value: undefined,
            enumerable: descriptor.enumerable,
            writable: true,
            configurable: true,
          })
        }
      } else {
        if (visibilityChanged && previous[key] === value)
          draft[key] = value === null ? undefined : null
        if (previous[key] !== value)
          draft[key] =
            value !== null && typeof value === `object`
              ? (Reflect.get(value, $PROXY) ?? value)
              : value
        if (!existed || visibilityChanged)
          Object.defineProperty(previous, key, {
            enumerable: descriptor.enumerable,
          })
      }
    }
    if (Array.isArray(target)) draft.length = target.length
  })(previous)
}

export function createRowStore<T extends object>(source: T) {
  return untrack(() => {
    let [row, setRow] = createStore(copyForStore(source))
    const entry = {
      value: row,
      update(nextSource: T) {
        if (source === nextSource) return
        untrack(() => {
          const current = unwrap(row)
          const next = copyForStore(nextSource, source, current)
          const nextStore = createStore(next)
          prepareStores(nextStore[0])
          const conflicts = conflictingCopies(current, next)
          if (canReconcile(current, next, conflicts))
            setRow(
              (previous) => reconcileForStore(previous, next, conflicts) as T,
            )
          else {
            ;[row, setRow] = nextStore
            entry.value = row
          }
          source = nextSource
        })
      },
    }
    return entry
  })
}
