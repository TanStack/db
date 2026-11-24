/**
 * Supplemental examples for the row view's own boundary. The laws that own
 * row materialization live in `row-materialization-oracle.test.tsx`; these
 * pin what no law reaches:
 *
 * - how a row view answers `in` for the reserved name, and that a row keeps
 *   its null prototype;
 * - that a getter is served live by a read outside a tracking scope, and
 *   that an own accessor of the row is refused where a signal would hold
 *   its value;
 * - that an Array row follows a change, a shrink and a regrow;
 * - that a field which arrives non-enumerable stays out of `Object.keys`
 *   while its readers follow it, until it turns visible or leaves;
 * - that a field which arrives with the value `undefined` is still own;
 * - that the row is the Collection's: the view cannot be written, frozen or
 *   reprototype'd, and a publication is served at once, before any flush.
 *
 * An accessor of the reserved name in a nested container is a nested getter
 * like any other and is served live; it is outside every law of the owner.
 *
 * A reader's re-run lands on the next flush, so each example that watches a
 * memo across a publication flushes; a plain read does not need one.
 */
import { describe, expect, it } from 'vitest'
import { createMemo, createRoot, flush } from 'solid-js'
import { createRowView } from '../src/row-view'

const settled = () => flush()

describe(`row view reserved name`, () => {
  it(`answers \`in\` like an ordinary object: inherited, own, and absent on a null prototype`, () => {
    // The reserved name as an ordinary own data field.
    type Reserved = { id?: string; __proto__?: unknown }
    const own: Reserved = {}
    Object.defineProperty(own, `__proto__`, {
      value: 7,
      enumerable: true,
      writable: true,
      configurable: true,
    })
    const nullPrototype = (fields: object): Reserved =>
      Object.assign(Object.create(null), fields)

    // An ordinary object inherits the name from Object.prototype.
    const ordinary = createRowView<Reserved>({ id: `a` })
    expect(`__proto__` in ordinary.value).toBe(true)
    expect(ordinary.value.__proto__).toBe(Object.prototype)
    expect(Object.hasOwn(ordinary.value, `__proto__`)).toBe(false)

    // An own data field of that name is served and reported as own.
    const reserved = createRowView(own)
    expect(`__proto__` in reserved.value).toBe(true)
    expect(Object.hasOwn(reserved.value, `__proto__`)).toBe(true)
    expect(reserved.value.__proto__).toBe(7)

    // A null-prototype row has nothing of that name until it does. It also
    // keeps its null prototype.
    const bare = createRowView(nullPrototype({ id: `b` }))
    expect(Object.getPrototypeOf(bare.value)).toBe(null)
    expect(`__proto__` in bare.value).toBe(false)

    bare.update(nullPrototype(own))
    expect(`__proto__` in bare.value).toBe(true)
    expect(Object.hasOwn(bare.value, `__proto__`)).toBe(true)
    expect(bare.value.__proto__).toBe(7)

    // A field that leaves is no longer own. With no prototype there is no
    // inherited accessor either: the read is what the row's own would be.
    bare.update(nullPrototype({ id: `b` }))
    expect(`__proto__` in bare.value).toBe(false)
    expect(Object.hasOwn(bare.value, `__proto__`)).toBe(false)
    expect(bare.value.__proto__).toBeUndefined()
    expect(nullPrototype({ id: `b` }).__proto__).toBeUndefined()

    // The sources are never written into.
    expect(Object.getPrototypeOf(own)).toBe(Object.prototype)
    expect(Object.keys(own)).toEqual([`__proto__`])
  })
})

describe(`row view accessor boundary`, () => {
  it(`serves a getter live to a read outside a tracking scope, and refuses the row's own accessor where a signal would hold its value`, () => {
    const version = { n: 1 }
    const nested = {
      get label() {
        return `n${version.n}`
      },
    }
    type Config = { id?: string; label?: string }
    type Row = { id: string; config: Config; title?: string }
    // Core evaluates a row's own accessors before it admits the row, so a
    // root accessor can only be a contract breach. That is the case here.
    const titled = {
      id: `a`,
      config: nested,
      get title() {
        return `t${version.n}`
      },
    } as unknown as Row
    const row = createRowView<Row>(titled)

    // Live: nothing holds the getter's value, so each read evaluates it.
    expect(row.value.config.label).toBe(`n1`)
    expect(row.value.title).toBe(`t1`)
    version.n = 2
    expect(row.value.config.label).toBe(`n2`)
    expect(row.value.title).toBe(`t2`)

    // A signal would hold one reading of it, stale from then on: refused at
    // the first read in a tracking scope.
    const trackTitle = () => {
      const scope = createRoot((dispose) => ({
        title: createMemo(() => row.value.title),
        dispose,
      }))
      try {
        return scope.title()
      } finally {
        scope.dispose()
      }
    }
    expect(trackTitle).toThrowError(/arrived with an accessor/)

    const tracked = createRoot((dispose) => ({
      id: createMemo(() => row.value.id),
      dispose,
    }))
    try {
      expect(tracked.id()).toBe(`a`)

      // On a publication, for a field a scope tracks. A refused row leaves
      // the view on the row it served.
      const breached = {
        config: nested,
        get id() {
          return `never`
        },
      } as unknown as Row
      expect(() => row.update(breached)).toThrowError(
        /arrived with an accessor/,
      )
      expect(row.value.id).toBe(`a`)
      expect(tracked.id()).toBe(`a`)

      // A field no scope tracks is served live, as a nested getter is,
      // until a scope tracks it.
      const live = {
        id: `a`,
        config: nested,
        get title() {
          return `t${version.n}`
        },
      } as unknown as Row
      row.update(live)
      expect(row.value.title).toBe(`t2`)
      version.n = 3
      expect(row.value.title).toBe(`t3`)
      expect(trackTitle).toThrowError(/arrived with an accessor/)

      // An inherited accessor is not a field of the row's: it is served.
      const inherited: Row = Object.create({
        get title() {
          return `inherited`
        },
      })
      inherited.id = `a`
      row.update(inherited)
      expect(row.value.title).toBe(`inherited`)
      expect(tracked.id()).toBe(`a`)
    } finally {
      tracked.dispose()
    }
  })
})

describe(`row view Array row`, () => {
  it(`follows a change, a shrink and a regrow, for its slots and its length`, async () => {
    const row = createRowView([`a`, `b`, `c`])
    const value = row.value
    expect(Array.isArray(value)).toBe(true)
    expect([...value]).toEqual([`a`, `b`, `c`])
    expect(Object.keys(value)).toEqual([`0`, `1`, `2`])
    expect(Object.getOwnPropertyDescriptor(value, `length`)).toMatchObject({
      value: 3,
      enumerable: false,
    })

    const view = createRoot((dispose) => ({
      second: createMemo(() => value[1]),
      length: createMemo(() => value.length),
      dispose,
    }))
    try {
      expect(view.second()).toBe(`b`)
      expect(view.length()).toBe(3)

      row.update([`a`, `B`, `c`])
      await settled()
      expect(view.second()).toBe(`B`)
      expect(view.length()).toBe(3)
      expect([...value]).toEqual([`a`, `B`, `c`])

      row.update([`a`])
      await settled()
      expect(view.length()).toBe(1)
      expect(view.second()).toBeUndefined()
      expect([...value]).toEqual([`a`])

      row.update([`x`, `y`, `z`, `w`])
      await settled()
      expect(view.length()).toBe(4)
      expect(value[3]).toBe(`w`)
      expect([...value]).toEqual([`x`, `y`, `z`, `w`])
      // The array methods see the row as it is now.
      expect(value.join(``)).toBe(`xyzw`)
      expect(value.filter((slot) => slot !== `y`)).toEqual([`x`, `z`, `w`])

      // One row, one view: an update never replaces what consumers hold.
      expect(row.value).toBe(value)
    } finally {
      view.dispose()
    }
  })
})

describe(`row view hidden field`, () => {
  type Row = { id: string; secret?: number }
  const hidden = (secret: number): Row =>
    Object.defineProperty({ id: `a` }, `secret`, {
      value: secret,
      enumerable: false,
      writable: true,
      configurable: true,
    })
  const watch = (row: ReturnType<typeof createRowView<Row>>) =>
    createRoot((dispose) => ({
      keys: createMemo(() => Object.keys(row.value)),
      names: createMemo(() => Object.getOwnPropertyNames(row.value)),
      secret: createMemo(() => row.value.secret),
      own: createMemo(() => Object.hasOwn(row.value, `secret`)),
      dispose,
    }))

  it(`keeps a field that arrives non-enumerable out of keys while its readers follow it, until it turns visible or leaves`, async () => {
    const row = createRowView<Row>({ id: `a` })
    const view = watch(row)
    try {
      expect(view.keys()).toEqual([`id`])
      expect(view.names()).toEqual([`id`])
      expect(view.own()).toBe(false)
      expect(view.secret()).toBeUndefined()

      row.update(hidden(1))
      await settled()
      expect(view.own()).toBe(true)
      expect(row.value.secret).toBe(1)
      expect(view.keys()).toEqual([`id`])
      // Hidden is not absent: the name is among the row's own keys.
      expect(view.names()).toEqual([`id`, `secret`])
      expect(view.secret()).toBe(1)

      row.update(hidden(2))
      await settled()
      expect(view.secret()).toBe(2)
      expect(view.keys()).toEqual([`id`])

      // A field that arrived hidden can still turn visible.
      row.update({ id: `a`, secret: 3 })
      await settled()
      expect(view.keys()).toEqual([`id`, `secret`])
      expect(view.secret()).toBe(3)

      // And one that arrived hidden can still leave.
      row.update({ id: `a` })
      await settled()
      expect(view.own()).toBe(false)
      expect(view.names()).toEqual([`id`])
      expect(view.keys()).toEqual([`id`])
      expect(view.secret()).toBeUndefined()
    } finally {
      view.dispose()
    }
  })

  it(`does the same for a field that is hidden from the start`, async () => {
    const row = createRowView<Row>(hidden(1))
    const view = watch(row)
    try {
      expect(view.own()).toBe(true)
      expect(view.keys()).toEqual([`id`])
      expect(view.secret()).toBe(1)

      row.update(hidden(2))
      await settled()
      expect(view.secret()).toBe(2)
      expect(view.keys()).toEqual([`id`])

      row.update({ id: `a`, secret: 3 })
      await settled()
      expect(view.keys()).toEqual([`id`, `secret`])
      expect(view.secret()).toBe(3)

      row.update({ id: `a` })
      await settled()
      expect(view.own()).toBe(false)
      expect(view.keys()).toEqual([`id`])
      expect(view.secret()).toBeUndefined()
    } finally {
      view.dispose()
    }
  })
})

describe(`row view undefined field`, () => {
  it(`makes a field that arrives with the value undefined own`, async () => {
    type Row = { id: string; later?: string }
    const row = createRowView<Row>({ id: `a` })
    const view = createRoot((dispose) => ({
      keys: createMemo(() => Object.keys(row.value)),
      member: createMemo(() => `later` in row.value),
      later: createMemo(() => row.value.later),
      dispose,
    }))
    try {
      expect(view.member()).toBe(false)
      expect(view.keys()).toEqual([`id`])

      // Absent and own-undefined are different states for a field.
      row.update({ id: `a`, later: undefined })
      await settled()
      expect(Object.hasOwn(row.value, `later`)).toBe(true)
      expect(view.member()).toBe(true)
      expect(view.keys()).toEqual([`id`, `later`])
      expect(view.later()).toBeUndefined()

      row.update({ id: `a`, later: `here` })
      await settled()
      expect(view.later()).toBe(`here`)

      row.update({ id: `a` })
      await settled()
      expect(view.member()).toBe(false)
      expect(view.keys()).toEqual([`id`])
    } finally {
      view.dispose()
    }
  })
})

describe(`row view update re-entrancy`, () => {
  it(`keeps each row's new values to itself when a read updates another row`, async () => {
    type First = { id: string; x: number; w?: number }
    type Second = { id: string; z: number }
    const first = createRowView<First>({ id: `a`, x: 1, w: 2 })
    const second = createRowView<Second>({ id: `b`, z: 0 })
    const readers = createRoot((dispose) => ({
      x: createMemo(() => first.value.x),
      w: createMemo(() => first.value.w),
      z: createMemo(() => second.value.z),
      dispose,
    }))
    try {
      expect([readers.x(), readers.w(), readers.z()]).toEqual([1, 2, 0])
      // The next row of the first inherits `w` from a getter that publishes
      // to the second while the first is being read.
      const next: First = Object.create({
        get w() {
          second.update({ id: `b`, z: 999 })
          return 5
        },
      })
      next.id = `a`
      next.x = 42
      first.update(next)
      await settled()
      expect([readers.x(), readers.w(), readers.z()]).toEqual([42, 5, 999])
    } finally {
      readers.dispose()
    }
  })
})

describe(`row view is the Collection's row`, () => {
  type Row = { id: string; title: string; nested: { count: number } }
  const source = (title: string): Row => ({
    id: `a`,
    title,
    nested: { count: 0 },
  })

  it(`refuses a write, a deletion, a redefinition, a freeze and a new prototype, and stays whole`, () => {
    const row = createRowView(source(`one`))
    const view = row.value
    const attempts: Array<() => unknown> = [
      () => {
        view.title = `two`
      },
      // A field the row never had.
      () => {
        ;(view as { later?: string }).later = `field`
      },
      () => delete (view as { title?: string }).title,
      () => Object.defineProperty(view, `title`, { value: `two` }),
      () => Object.freeze(view),
      () => Object.seal(view),
      () => Object.preventExtensions(view),
      () => Object.setPrototypeOf(view, null),
      () => Object.assign(view, { title: `two` }),
    ]
    for (const attempt of attempts) expect(attempt).toThrowError(TypeError)
    // The reflecting form answers instead of throwing.
    expect(Reflect.set(view, `title`, `two`)).toBe(false)
    expect(Reflect.defineProperty(view, `title`, { value: `two` })).toBe(false)
    expect(Reflect.deleteProperty(view, `title`)).toBe(false)
    expect(Reflect.preventExtensions(view)).toBe(false)

    // Not one of them took: the row is as the Collection lent it.
    expect(Object.keys(view)).toEqual([`id`, `title`, `nested`])
    expect({ ...view }).toEqual(source(`one`))
    expect(view.title).toBe(`one`)
    expect(`title` in view).toBe(true)
    expect(Object.hasOwn(view, `title`)).toBe(true)
    expect(Object.isFrozen(view)).toBe(false)
    expect(Object.isExtensible(view)).toBe(true)
    expect(Object.getPrototypeOf(view)).toBe(Object.prototype)
    expect(view.nested).toEqual({ count: 0 })
  })

  it(`reports a fixed field as configurable: the field is the row's, and the view does not hold it`, () => {
    const fixed: { id: string; title: string; fixed?: number } = {
      id: `a`,
      title: `one`,
    }
    Object.defineProperty(fixed, `fixed`, {
      value: 7,
      enumerable: true,
      writable: false,
      configurable: false,
    })
    const row = createRowView(fixed)
    expect(Object.keys(row.value)).toEqual([`id`, `title`, `fixed`])
    expect(row.value.fixed).toBe(7)
    // A proxy may report a field it does not hold only as configurable.
    const reported = Object.getOwnPropertyDescriptor(row.value, `fixed`)!
    expect(reported).toMatchObject({ value: 7, enumerable: true })
    expect(reported.configurable).toBe(true)
    // The row itself is as it was.
    expect(Object.getOwnPropertyDescriptor(fixed, `fixed`)!.configurable).toBe(
      false,
    )
  })

  it(`serves a publication to a plain read at once, and to a reader's re-run on the next flush`, async () => {
    const row = createRowView(source(`one`))
    const reader = createRoot((dispose) => {
      const runs = { title: 0, keys: 0 }
      return {
        runs,
        title: createMemo(() => {
          runs.title++
          return row.value.title
        }),
        keys: createMemo(() => {
          runs.keys++
          return Object.keys(row.value)
        }),
        dispose,
      }
    })
    try {
      expect(reader.title()).toBe(`one`)
      expect(reader.keys()).toEqual([`id`, `title`, `nested`])
      expect(reader.runs).toEqual({ title: 1, keys: 1 })

      const next = { ...source(`two`), nested: row.value.nested }
      row.update(next)
      // At once: nothing waits for a flush to show the row.
      expect(row.value.title).toBe(`two`)
      expect(row.value.nested).toBe(next.nested)
      // A reader re-runs on the next flush.
      await settled()
      expect(reader.title()).toBe(`two`)
      expect(reader.runs.title).toBe(2)
      // A reader of the keys is not woken by a change in values.
      expect(reader.runs.keys).toBe(1)

      // The row it already serves is nothing to apply.
      row.update(next)
      await settled()
      expect(reader.runs.title).toBe(2)

      // A reader of one field is not woken by a change to another.
      const nested = createRoot((dispose) => {
        let run = 0
        return {
          count: () => run,
          value: createMemo(() => {
            run++
            return row.value.nested.count
          }),
          dispose,
        }
      })
      try {
        expect(nested.value()).toBe(0)
        // Another field changes; the field this reader reads is the same object.
        row.update({ ...source(`three`), nested: row.value.nested })
        await settled()
        expect(reader.runs.title).toBe(3)
        expect(nested.count()).toBe(1)
        row.update({ ...source(`three`), nested: { count: 1 } })
        await settled()
        expect(nested.count()).toBe(2)
        expect(nested.value()).toBe(1)
        expect(reader.runs.title).toBe(3)
      } finally {
        nested.dispose()
      }
    } finally {
      reader.dispose()
    }
  })
})
