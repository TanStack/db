import { describe, expect, it } from 'vitest'
import {
  createLiveQueryCollection,
  eq,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { createControlledCollection } from './includes-oracle-helpers.js'

const boundaries = [`query-ref`, `recursive-query-ref`, `union`] as const
const forms = [`collection`, `array`, `materialized`] as const
const outputs = [`expression`, `record`, `opaque-root`] as const
const initialStates = [`empty`, `populated`] as const
const cells = boundaries.flatMap((boundary) =>
  forms.flatMap((form) =>
    outputs.flatMap((output) =>
      initialStates.map((initial) => ({ boundary, form, output, initial })),
    ),
  ),
)

type Child = { id: number; parentGroup: number; value: number }
type Input = { id: number; kind: string; children?: unknown }
type Phase = `initial` | `child-update` | `route-move`
type ChildView = {
  valid: boolean
  ready: boolean | undefined
  rows: Array<Child>
}

function readChildren(value: unknown, form: (typeof forms)[number]): ChildView {
  if (form !== `collection`) {
    return {
      valid: Array.isArray(value),
      ready: undefined,
      rows: Array.isArray(value) ? value : [],
    }
  }
  if (
    typeof value !== `object` ||
    value === null ||
    !(`toArray` in value) ||
    !(`isReady` in value) ||
    typeof value.isReady !== `function`
  ) {
    return { valid: false, ready: undefined, rows: [] }
  }
  return {
    valid: Array.isArray(value.toArray),
    ready: value.isReady(),
    rows: Array.isArray(value.toArray) ? value.toArray : [],
  }
}

// Keep only the selected public fields in row comparisons. Callback-time shape
// and facade readiness have their own assertions rather than being normalized away.
function publicRows(rows: ReadonlyArray<Child>) {
  return rows
    .map(({ id, parentGroup, value }) => ({ id, parentGroup, value }))
    .sort((left, right) => left.id - right.id)
}

class Projection {
  constructor(
    readonly id: number,
    readonly kind: string,
    readonly children: unknown,
    readonly total: number,
  ) {}
}

describe(`functional include projection boundary grammar`, () => {
  it(`preserves opaque-root fields without include materialization`, async () => {
    const parents = createControlledCollection(`opaque-root-control`, [
      { id: 1 },
    ])
    const live = createLiveQueryCollection((q) =>
      q
        .from({ parent: parents.collection })
        .fn.select(
          ({ parent }) => new Projection(parent.id, `plain`, undefined, 0),
        ),
    )
    try {
      await live.preload()
      const row = live.toArray[0]
      expect(row?.id).toBe(1)
      expect(row?.kind).toBe(`plain`)
      expect(row?.total).toBe(0)
      // Collection root records already flatten prototypes without includes.
      // This matrix checks their fields, not a new prototype-preservation API.
    } finally {
      await live.cleanup()
      await parents.collection.cleanup()
    }
  })

  it(`covers every declared boundary product without duplicate cells`, () => {
    expect(cells).toHaveLength(54)
    expect(new Set(cells.map((cell) => JSON.stringify(cell))).size).toBe(54)
  })

  it.each(cells)(
    `$boundary / $form / $output / $initial`,
    async ({ boundary, form, output, initial }) => {
      const parents = createControlledCollection(`projection-parents`, [
        { id: 1, group: 1 },
      ])
      const absent = createControlledCollection(`projection-absent`, [
        { id: 2 },
      ])
      const initialChildren: Array<Child> = [
        ...(initial === `populated`
          ? [{ id: 10, parentGroup: 1, value: 3 }]
          : []),
        { id: 20, parentGroup: 2, value: 5 },
      ]
      const children = createControlledCollection(
        `projection-children`,
        initialChildren,
      )
      const truth = new Map(initialChildren.map((row) => [row.id, row]))
      let group = 1
      let phase: Phase = `initial`
      const calls: Array<{
        phase: Phase
        kind: string
        child: unknown
        view: ChildView
      }> = []
      const project = (row: Input) => {
        const child = row.children
        const view = readChildren(child, form)
        // Capture readiness and contents NOW, not through a reference read after preload.
        calls.push({
          phase,
          kind: row.kind,
          child,
          view: { ...view, rows: publicRows(view.rows) },
        })
        const total = view.rows.reduce((sum, item) => sum + item.value, 0)
        return output === `opaque-root`
          ? new Projection(row.id, row.kind, child, total)
          : { id: row.id, kind: row.kind, children: child, total }
      }
      const live = createLiveQueryCollection((q) => {
        const included = q
          .from({ parent: parents.collection })
          .select(({ parent }) => {
            const childRows = q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .orderBy(({ child }) => child.id)
              .select(({ child }) => ({
                id: child.id,
                parentGroup: child.parentGroup,
                value: child.value,
              }))
            return {
              id: parent.id,
              kind: `included`,
              total: 0,
              children:
                form === `collection`
                  ? childRows
                  : form === `array`
                    ? toArray(childRows)
                    : materialize(childRows),
            }
          })
        if (boundary === `union`) {
          const withoutInclude = q
            .from({ other: absent.collection })
            .select(({ other }) => ({
              id: other.id,
              kind: `absent`,
              total: 0,
            }))
          const union = q.unionAll(included, withoutInclude)
          return output === `expression` ? union : union.fn.select(project)
        }
        if (boundary === `recursive-query-ref`) {
          const intermediate = q
            .from({ inner: included })
            .select(({ inner }) => inner)
          const outer = q.from({ row: intermediate })
          return output === `expression`
            ? outer.select(({ row }) => row)
            : outer.fn.select(({ row }) => project(row))
        }
        const outer = q.from({ row: included })
        return output === `expression`
          ? outer.select(({ row }) => row)
          : outer.fn.select(({ row }) => project(row))
      })
      let facade: unknown
      const check = () => {
        const row: (Input & { total: number }) | undefined = live.toArray.find(
          (item) => item.kind === `included`,
        )
        expect.soft(row, `${phase}: included public row`).toBeDefined()
        if (!row) return
        const expected = publicRows(
          [...truth.values()].filter((item) => item.parentGroup === group),
        )
        const view = readChildren(row.children, form)
        expect.soft(view.valid, `${phase}: public include form`).toBe(true)
        expect
          .soft(publicRows(view.rows), `${phase}: public children`)
          .toEqual(expected)
        if (form === `collection`) {
          expect.soft(view.ready, `${phase}: public facade ready`).toBe(true)
          if (phase === `initial`) facade = row.children
          else if (phase === `child-update`)
            expect.soft(row.children, `child-only facade identity`).toBe(facade)
          else
            expect
              .soft(row.children, `route move replaces facade`)
              .not.toBe(facade)
        }
        // A Collection is a live handle, not a dependency-tracked scalar read.
        // Assert derived scalars when the parent projection runs, not on child-only
        // changes to a retained facade. Inline values do drive parent recomputation.
        if (
          output !== `expression` &&
          (form !== `collection` || phase !== `child-update`)
        ) {
          expect
            .soft(row.total, `${phase}: derived scalar`)
            .toBe(expected.reduce((sum, item) => sum + item.value, 0))
        }
        if (boundary === `union`) {
          const other: Input | undefined = live.toArray.find(
            (item) => item.kind === `absent`,
          )
          expect.soft(other, `${phase}: absent branch survives`).toBeDefined()
          expect
            .soft(other?.children, `${phase}: absent branch value`)
            .toBeUndefined()
        }
        const current = calls.filter(
          (call) => call.phase === phase && call.kind === `included`,
        )
        if (
          output !== `expression` &&
          (form !== `collection` || phase !== `child-update`)
        )
          expect
            .soft(current.length, `${phase}: callback reach`)
            .toBeGreaterThan(0)
        for (const call of current) {
          expect
            .soft(call.view.valid, `${phase}: callback include form`)
            .toBe(true)
          if (form === `collection`)
            expect
              .soft(call.view.ready, `${phase}: callback facade ready`)
              .toBe(true)
        }
        for (const call of calls.filter(
          (item) => item.phase === phase && item.kind === `absent`,
        )) {
          expect
            .soft(call.child, `${phase}: valid callback absence`)
            .toBeUndefined()
        }
      }
      try {
        await live.preload()
        check()
        phase = `child-update`
        const changed = { id: 10, parentGroup: 1, value: 7 }
        truth.set(10, changed)
        children.write(initial === `empty` ? `insert` : `update`, changed)
        check()
        phase = `route-move`
        group = 2
        parents.write(`update`, { id: 1, group })
        check()
      } finally {
        await live.cleanup()
        await Promise.all([
          parents.collection.cleanup(),
          children.collection.cleanup(),
          absent.collection.cleanup(),
        ])
      }
    },
  )
})
