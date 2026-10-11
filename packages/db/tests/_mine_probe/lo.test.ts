import { it } from 'vitest'
import { createCollection } from '../../src/index'
import { localOnlyCollectionOptions } from '../../src/local-only'

const make = (id: string, handlers = {}) =>
  createCollection(
    localOnlyCollectionOptions<{ id: number; v: number }, number>({
      id,
      getKey: (r) => r.id,
      ...handlers,
    }),
  )
const run = (label: string, f: () => unknown) => {
  try {
    f()
    return `${label}: ok`
  } catch (e) {
    return `${label}: threw ${String(e)}`
  }
}

it(`same-key subscriber writes and same-collection nesting`, () => {
  for (const kind of [`update`, `delete`] as const) {
    const c = make(`lo-${kind}`)
    let done = false
    c.subscribeChanges((changes) => {
      if (done || !changes.some((ch) => ch.key === 1 && ch.type === `insert`))
        return
      done = true
      if (kind === `update`)
        c.update(1, (d) => {
          d.v = 2
        })
      else c.delete(1)
    })
    console.log(
      run(`subscriber ${kind}s same key`, () => c.insert({ id: 1, v: 1 })),
      `rows:`,
      JSON.stringify(c.toArray.map((r) => [r.id, r.v])),
    )
  }
  for (const handler of [false, true]) {
    const c = make(
      `lo-nest-${handler}`,
      handler ? { onInsert: async () => {} } : {},
    )
    let inner = `not run`
    c.subscribeChanges((changes) => {
      if (!changes.some((ch) => ch.key === 1)) return
      try {
        c.insert({ id: 2, v: 0 })
        inner = `ok`
      } catch (e) {
        inner = `threw ${String(e)}`
      }
    })
    c.subscribeChanges((changes) => {
      if (changes.some((ch) => ch.key === 2)) throw new Error(`boom2`)
    })
    console.log(
      `handler=${handler}`,
      run(`outer`, () => c.insert({ id: 1, v: 0 })),
      `inner:`,
      inner,
    )
  }
})
