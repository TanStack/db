import { createSignal, getObserver, runWithOwner } from 'solid-js'
import type { Signal } from 'solid-js'

/**
 * `equals` of a field's signal. The default comparison holds the two zeros
 * equal, so a reader would not see a field flip from `0` to `-0`. The setter
 * applies the same comparison: an equal value notifies nobody.
 */
const VALUE = { equals: Object.is }

/** A row's own keys, in order. `Reflect.ownKeys` types a key as possibly a number; one never is. */
type OwnKeys = Array<string | symbol>
function ownKeysOf(row: object): OwnKeys {
  return Reflect.ownKeys(row) as OwnKeys
}
function enumerableKeysOf(row: object): OwnKeys {
  return ownKeysOf(row).filter(
    (key) => Reflect.getOwnPropertyDescriptor(row, key)!.enumerable,
  )
}

function sameKeys(a: OwnKeys, b: OwnKeys) {
  return a.length === b.length && a.every((key, index) => key === b[index])
}
/** `equals` of a key list's signal: a publication that keeps the keys and their order notifies nobody. */
const KEYS = { equals: sameKeys }

/**
 * The row's own data value of `key`, or the inherited read when the row has
 * no field of that name.
 *
 * An own accessor is refused. Core evaluates a row's own accessors before it
 * admits the row, so one can only be a contract breach; and a getter read
 * into a signal would be one reading of it, stale from then on.
 */
function dataField(row: object, key: PropertyKey): unknown {
  const own = Object.getOwnPropertyDescriptor(row, key)
  if (own !== undefined) {
    if (!(`value` in own))
      throw new Error(`TanStack DB: a live query row arrived with an accessor`)
    return own.value
  }
  return Reflect.get(row, key)
}

/**
 * One row's state: the proxy's target, whose prototype is the row's own. No
 * trap exposes the target's fields, so it carries the prototype and the
 * state alike, and every row shares one handler.
 */
type State = {
  /** The Collection's row as last published. */
  current: object
  /** One signal per name a tracking scope has read. */
  fields: Map<PropertyKey, Signal<unknown>> | undefined
  /** The row's own keys, and its enumerable ones: created by the first tracked membership read or enumeration. */
  ownKeys: Signal<OwnKeys> | undefined
  enumerableKeys: Signal<OwnKeys> | undefined
}

/**
 * Sets a field's signal to a value.
 *
 * A function is a field like any other, and Solid's setter takes a function
 * as an updater: the value is returned by one.
 */
function writeField(field: Signal<unknown>, value: unknown) {
  if (typeof value === `function`) field[1](() => value)
  else field[1](value)
}

/**
 * A field's signal, created by the first read a tracking scope makes of the
 * field.
 *
 * `createSignal` takes a function as its computation, so a function is not
 * made a signal's first value. A write does not do either: it is staged until
 * a flush commits it, and a write is refused inside the scope that reads. A
 * function is a field like any other, so it takes the function form of
 * `createSignal`, a read-only signal that a setter may still write: its first
 * value is the row's, and the row it reads is the one the view serves.
 */
function fieldOf(state: State, key: PropertyKey): Signal<unknown> {
  const value = dataField(state.current, key)
  return typeof value === `function`
    ? runWithOwner(null, () =>
        createSignal<unknown>(() => dataField(state.current, key), VALUE),
      )
    : createSignal(value, VALUE)
}

function trackOwnKeys(state: State): OwnKeys {
  return (state.ownKeys ??= createSignal(ownKeysOf(state.current), KEYS))[0]()
}
function trackEnumerableKeys(state: State): OwnKeys {
  return (state.enumerableKeys ??= createSignal(
    enumerableKeysOf(state.current),
    KEYS,
  ))[0]()
}

/**
 * The `get` trap of every row view.
 *
 * A read outside a tracking scope, as in an event handler, is served from the
 * row and creates nothing. A read in one gets the field's signal, which the
 * first such read makes.
 */
function readField(target: State, key: PropertyKey): unknown {
  const current = target.current
  if (getObserver() === null) return Reflect.get(current, key)
  let fields = target.fields
  let field = fields?.get(key)
  if (field === undefined) {
    field = fieldOf(target, key)
    ;(fields ??= target.fields = new Map()).set(key, field)
  }
  return field[0]()
}

/** The `has` trap: membership follows the row's own keys. */
function hasMember(target: State, key: PropertyKey): boolean {
  if (getObserver() !== null) trackOwnKeys(target)
  return Reflect.has(target.current, key)
}

/** The `ownKeys` trap. */
function listOwnKeys(target: State): OwnKeys {
  return getObserver() === null
    ? ownKeysOf(target.current)
    : trackOwnKeys(target)
}

/**
 * The `getOwnPropertyDescriptor` trap. An own-key change moves a field and a
 * visibility change moves none, so an enumeration reads both key lists.
 *
 * The target holds the row's state, not its fields, and a field the target
 * does not hold can only be reported configurable. An array's `length` is an
 * array target's own fixed property: it keeps the target's shape and takes
 * the row's length.
 */
function describeField(
  target: State,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  const current = target.current
  if (getObserver() !== null) {
    trackOwnKeys(target)
    trackEnumerableKeys(target)
  }
  if (Array.isArray(target) && key === `length`)
    return {
      value: (current as { length: number }).length,
      writable: true,
      enumerable: false,
      configurable: false,
    }
  const own = Reflect.getOwnPropertyDescriptor(current, key)
  return own && (own.configurable ? own : { ...own, configurable: true })
}

/**
 * The trap of every write and of every change to the view's shape. The row is
 * the Collection's, and the view is read, never written. It also keeps the
 * prototype and the extensibility the row gave it: once frozen, a proxy whose
 * target is not its row could no longer be enumerated. A trap that returns
 * false is a TypeError in strict mode and ignored otherwise, as it is for a
 * frozen object.
 */
function refuse(): false {
  return false
}

// One handler serves every row: each row's state is its own proxy's target.
const handler: ProxyHandler<State> = {
  get: readField,
  has: hasMember,
  ownKeys: listOwnKeys,
  getOwnPropertyDescriptor: describeField,
  set: refuse,
  defineProperty: refuse,
  deleteProperty: refuse,
  preventExtensions: refuse,
  setPrototypeOf: refuse,
}

/** One result row as the component reads it, and how a publication reaches it. */
export type RowView<T extends object> = {
  value: T
  /** Makes the view serve `next`. The row it already serves is nothing to apply. */
  update: (next: T) => void
}

/**
 * A row view for one result row: what `query()` hands the component.
 *
 * The Collection lends the row and takes it back; nothing here copies it. The
 * view is one stable object per result row and a read is served from the row
 * the Collection holds now, so a consumer sees exactly what was admitted: a
 * nested getter stays live because the consumer's own scope evaluates it, a
 * function stays a function, a signed zero keeps its sign, an array keeps its
 * methods, and an own `__proto__` field is an ordinary field.
 *
 * Reads are fine-grained, and paid for as they are made. A name read in a
 * tracking scope gets a signal of its own, the first time it is read that
 * way, so a reader of one field is not woken by a change to another.
 * Enumeration (`Object.keys`, a spread) and membership (`in`,
 * `Object.hasOwn`) follow the row's own keys the same way. A publication
 * writes the signals of the changed row only: an unchanged row costs one
 * identity comparison, and a row no scope reads never has a signal.
 *
 * Two limits follow from the view's shape. Neither is reachable through the
 * hook, where Core admits every root row as a plain object. The view keeps
 * the prototype of the row it was made from. Membership follows the row's
 * own names: a name a later row inherits is read as it is, but a reader of
 * it in a tracking scope is not woken while the own names stay the same.
 *
 * An own accessor is served live by a read outside a tracking scope and is
 * refused where a signal would hold its value.
 */
/** The state of one row: the proxy's target, carrying the row's prototype. */
function stateOf(source: object): State {
  const state = {
    current: source,
    fields: undefined,
    ownKeys: undefined,
    enumerableKeys: undefined,
  }
  // An array row gets an array target, so the view reads as an array.
  const target = Array.isArray(source) ? Object.assign([], state) : state
  return Object.setPrototypeOf(target, Object.getPrototypeOf(source))
}

export function createRowView<T extends object>(source: T): RowView<T> {
  const state = stateOf(source)
  const value = new Proxy(state, handler) as unknown as T
  return {
    value,
    update(next) {
      if (next === state.current) return
      const tracked = state.fields
      if (tracked === undefined) state.current = next
      else {
        // Read every tracked field before any is released: a row refused
        // for an accessor leaves the view on the row it served. The values
        // are this update's own: a read can run the code of an inherited
        // getter, and that can update another row.
        const values = new Array<unknown>(tracked.size)
        let index = 0
        for (const key of tracked.keys()) values[index++] = dataField(next, key)
        state.current = next
        // Each signal's own comparison keeps an equal value from notifying
        // anybody. It is not read here first: a publication runs in the
        // adapter's effect, where a read of a reactive value is untracked.
        index = 0
        for (const field of tracked.values()) writeField(field, values[index++])
      }
      if (state.ownKeys !== undefined) state.ownKeys[1](ownKeysOf(next))
      if (state.enumerableKeys !== undefined)
        state.enumerableKeys[1](enumerableKeysOf(next))
    },
  }
}
