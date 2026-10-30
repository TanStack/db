import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { withChangeTracking } from '../src/proxy.js'
import { declareOracle } from './oracle-declaration.js'
import { expectMembers, protocols, visit } from './proxy-iteration-fixture.js'
import type { Item, Protocol } from './proxy-iteration-fixture.js'

/**
 * # Do draft Map and Set iterators preserve native live semantics?
 *
 * Iterators and `forEach` see membership changes made before an entry is
 * consumed. They visit each entry once, use the draft collection as the
 * callback receiver, and report no change for reads alone. New caller-owned
 * members remain shared during the callback, then detach in the returned
 * change set.
 * Existing members reuse one draft identity across values, entries, iterator,
 * and `forEach` paths.
 *
 * Each operation also runs against a native Map or Set where possible. The
 * oracle compares membership, key order, callback arguments, nested writes,
 * aliases, cycles, rollback after throw, and the final detached result. Whole-
 * object detachment rules live in the companion contract, not this model.
 *
 * Array iterators follow the same live rule: an edit made while an iterator
 * is open (a push, a removal, an index write, a length cut) changes what it
 * visits next, as on a native array, and an object element is a draft.
 */

/**
 * The native Map, Set, or Array run is the model. A draft run must visit the
 * same members in the same order, and report the same detached changes.
 */
function expectNativeVisits(actual: unknown, expected: unknown): void {
  expect(actual).toEqual(expected)
}

/**
 * The native Map or Set after `visit` writes `x = 2` through every member.
 * A draft write under the same protocol must match these values before and
 * after the update persists. This is the native model of that write.
 */
function nativeWrittenValues<T extends Map<unknown, Item> | Set<Item>>(
  values: T,
  protocol: Protocol,
): T {
  visit(values, protocol, (value) => {
    value.x = 2
  })
  return values
}

declareOracle({
  check: [expectNativeVisits],
  model: [nativeWrittenValues],
})

describe(`Array draft iteration`, () => {
  type Element = { x: number } | number
  const iterations: Array<
    [string, (array: Array<Element>) => Iterable<unknown>]
  > = [
    [`for...of`, (array) => array],
    [`values()`, (array) => array.values()],
    [`entries()`, (array) => array.entries()],
  ]
  // Each edit runs while the iterator holds its first element.
  const edits: Array<
    [string, (array: Array<Element>, first: unknown) => void]
  > = [
    [`push`, (array) => array.push({ x: 9 }, 8)],
    [`pop`, (array) => array.pop()],
    [`shift`, (array) => array.shift()],
    [`index write`, (array) => (array[1] = 7)],
    [`length cut`, (array) => (array.length = 1)],
    [
      `write through the element`,
      (_array, first) => {
        const element = (Array.isArray(first) ? first[1] : first) as {
          x: number
        }
        element.x = 10
      },
    ],
  ]
  const run = (
    array: Array<Element>,
    iterate: (array: Array<Element>) => Iterable<unknown>,
    edit: (array: Array<Element>, first: unknown) => void,
  ) => {
    const visited: Array<unknown> = []
    for (const value of iterate(array)) {
      if (visited.length === 0) edit(array, value)
      visited.push(JSON.parse(JSON.stringify(value)))
    }
    return visited
  }
  const make = (): { items: Array<Element> } => ({
    items: [{ x: 1 }, 2, { x: 3 }],
  })

  describe.each(iterations)(`%s`, (_name, iterate) => {
    it.each(edits)(
      `matches native visits and detached changes after %s`,
      (_edit, edit) => {
        const native = make()
        const expectedVisits = run(native.items, iterate, edit)
        let visits: Array<unknown> = []
        const changes = withChangeTracking(make(), (draft) => {
          visits = run(draft.items, iterate, edit)
        })
        expectNativeVisits(visits, expectedVisits)
        expectNativeVisits(changes, { items: native.items })
      },
    )
  })
})

describe.each([`Map`, `Set`] as const)(
  `%s caller-owned insertion values`,
  (kind) => {
    it.each([`mutate`, `delete-readd`, `second-entry`] as const)(
      `matches native raw-object mutation after insertion: %s`,
      (operation) => {
        const run = (values: Map<string, Item> | Set<Item>) => {
          const item = { x: 1 }
          if (values instanceof Map) values.set(`a`, item)
          else values.add(item)
          if (operation === `delete-readd`) {
            if (values instanceof Map) values.delete(`a`)
            else values.delete(item)
          }
          item.x = 2
          if (operation !== `mutate`) {
            if (values instanceof Map)
              values.set(operation === `second-entry` ? `b` : `a`, item)
            else values.add(item)
          }
        }
        const make = () =>
          kind === `Map` ? new Map<string, Item>() : new Set<Item>()
        const expected = make()
        run(expected)
        const changes = withChangeTracking({ values: make() }, (draft) =>
          run(draft.values),
        )
        expectNativeVisits(
          [...(changes.values as ReturnType<typeof make>).values()],
          [...expected.values()],
        )
      },
    )
  },
)

describe.each([`Map`, `Set`] as const)(`%s nested iteration laws`, (kind) => {
  it.each(protocols)(
    `%s matches native membership changes during iteration`,
    (protocol) => {
      const run = (values: Map<unknown, Item> | Set<Item>) => {
        const seen: Array<number> = []
        visit(values, protocol, (value) => {
          if (seen.length > 5) throw new Error(`Iteration did not terminate`)
          seen.push(value.x)
          value.x += 10
          if (seen.length === 1) {
            if (values instanceof Map) {
              values.delete(2)
              values.set(3, { x: 3 })
            } else {
              values.delete([...values][1]!)
              values.add({ x: 3 })
            }
          }
        })
        return { seen, values: [...values.values()] }
      }
      const make = () =>
        kind === `Map`
          ? new Map([
              [1, { x: 1 }],
              [2, { x: 2 }],
            ])
          : new Set([{ x: 1 }, { x: 2 }])
      const expected = run(make())
      const changes = withChangeTracking({ values: make() }, (draft) => {
        expectNativeVisits(run(draft.values), expected)
      })
      expect([
        ...(changes.values as Map<unknown, Item> | Set<Item>).values(),
      ]).toEqual(expected.values)
    },
  )
})

it.each(protocols)(
  `Set %s observes clear and re-add after an edit just like a native iterator`,
  (protocol) => {
    const run = (values: Set<Item>) => {
      const seen: Array<number> = []
      visit(values, protocol, (value) => {
        if (seen.length > 2) throw new Error(`Iteration did not terminate`)
        seen.push(value.x)
        if (seen.length === 1) {
          value.x = 3
          values.clear()
          values.add(value)
        }
      })
      return seen
    }
    const expected = run(new Set([{ x: 1 }, { x: 2 }]))
    const changes = withChangeTracking(
      { values: new Set([{ x: 1 }, { x: 2 }]) },
      (draft) => {
        expectNativeVisits(run(draft.values), expected)
      },
    )
    expect(changes.values).toEqual(new Set([{ x: 3 }]))
  },
)

it.each(
  ([`Map`, `Set`] as const).flatMap((kind) =>
    protocols.map((protocol) => ({ kind, protocol })),
  ),
)(
  `$kind $protocol writes match native values before and after persistence`,
  async ({ kind, protocol }) => {
    const make = () =>
      kind === `Map` ? new Map([[`a`, { x: 1 }]]) : new Set([{ x: 1 }])
    const expected = nativeWrittenValues(make(), protocol)
    let confirm: (value: {
      id: number
      values: ReturnType<typeof make>
    }) => void = () => {}
    const collection = createCollection<{
      id: number
      values: ReturnType<typeof make>
    }>({
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({
            type: `insert`,
            value: { id: 1, values: make() },
          })
          commit()
          markReady()
          confirm = (value) => {
            begin()
            write({ type: `update`, value })
            commit()
          }
        },
      },
      // The handler confirms the update, so the stored row is its result.
      onUpdate: ({ transaction }) => {
        confirm(transaction.mutations[0].modified)
        return Promise.resolve()
      },
    })
    try {
      const tx = collection.update(1, (draft) => {
        visit(draft.values, protocol, (value) => {
          value.x = 2
        })
      })
      expectMembers(
        tx.mutations[0]!.changes.values as ReturnType<typeof make>,
        expected,
      )
      expectMembers(collection.get(1)!.values, expected)
      await tx.when(`settled`)
      expectMembers(collection.get(1)!.values, expected)
    } finally {
      await collection.cleanup()
    }
  },
)
