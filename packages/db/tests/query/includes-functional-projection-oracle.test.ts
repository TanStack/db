import { describe, expect, it } from 'vitest'
import { declareOracle } from '../oracle-declaration.js'
import {
  createLiveQueryCollection,
  eq,
  include,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { createControlledCollection } from './includes-oracle-helpers.js'
import {
  Projection,
  cells,
  cleanupAfterOracle,
  collectionInputError,
  noPrimaryFailure,
  operatorCells,
  orderedPairCells,
  publicRows,
  readChildren,
  rejectsCollectionInput,
  renamedCells,
  selectedRows,
  valueCells,
} from './includes-functional-projection-support.js'
import type {
  Child,
  ChildView,
  Input,
  Phase,
} from './includes-functional-projection-support.js'

/**
 * # What may cross a functional projection boundary?
 *
 * Expression projections stay inside the query graph. Functional projections
 * run user JavaScript. Inline arrays and materialized values can enter that
 * callback as snapshots. A Collection-valued include is a live handle, so the
 * callback cannot turn reads from it into query dependencies. The builder
 * rejects that ambiguous input instead of returning a stale derived scalar.
 *
 * This oracle states five laws:
 *
 * 1. Query references, recursive references, and unions preserve each supported
 *    include form and its public row shape.
 * 2. Functional callbacks receive complete values from the current graph step.
 * 3. Published Collection facades stay live, but reads from them do not become
 *    hidden scalar dependencies.
 * 4. A failed projection publishes no partial facade state or events.
 * 5. Cleanup fences the old graph from a later preload and its publications.
 *
 * The model is a set of small truth Maps and direct JavaScript projections.
 * Declared products cross boundary, form, output, initial state, consumer,
 * operator, and rename choices. Negative cells prove that unsupported
 * Collection inputs fail before user code runs. Callback-time captures prevent
 * a later live reference from making an incomplete callback look correct.
 *
 * This suite owns functional projection compatibility. The route-context suite
 * owns hidden metadata transport. The Collection suite owns facade lifecycle.
 * The authority is the functional-projection contract in
 * `packages/db/src/query/live/ARCHITECTURE.md`. These finite cells use
 * controlled source Collections and do not claim arbitrary callback bodies,
 * provider timing, or every recursive query shape.
 */

declareOracle({
  model: [expectedGroupChildren, expectedOperatorRows],
  grammar: [cells, orderedPairCells, valueCells, renamedCells, operatorCells],
})

// The public rows of the children that a route group owns, predicted from the
// source truth. A route move changes which group a parent reads, so the
// prediction follows the group that the caller passes.
function expectedGroupChildren(
  truth: ReadonlyMap<number, Child>,
  group: number,
): Array<Child> {
  return publicRows(
    [...truth.values()].filter((child) => child.parentGroup === group),
  )
}

// The projected rows that an operator must publish for these parent scores.
// The operator decides the output: distinct keeps one row per score, and
// selected-order keeps the highest score.
function expectedOperatorRows(
  expectedScores: ReadonlyMap<number, number>,
  operator: (typeof operatorCells)[number][`operator`],
): Array<{ id: number; score: number }> {
  let expected = [...expectedScores].map(([id, score]) => ({ id, score }))
  if (operator === `distinct`)
    expected = [...new Set(expected.map((row) => row.score))].map((score) => ({
      id: 0,
      score,
    }))
  if (operator === `selected-order`)
    expected = expected
      .sort((left, right) => right.score - left.score || left.id - right.id)
      .slice(0, 1)
  return expected
}

describe(`functional projection output compatibility`, () => {
  it(`covers the declared output and renamed-field products`, () => {
    expect(valueCells).toHaveLength(48)
    expect(renamedCells).toHaveLength(24)
    expect(operatorCells).toHaveLength(18)
    expect(new Set(valueCells.map((cell) => JSON.stringify(cell))).size).toBe(
      48,
    )
    expect(new Set(renamedCells.map((cell) => JSON.stringify(cell))).size).toBe(
      24,
    )
    expect(
      new Set(operatorCells.map((cell) => JSON.stringify(cell))).size,
    ).toBe(18)
  })

  it.each(operatorCells)(
    `$form / $operator / reads-include=$readsInclude consumes the projected value`,
    async ({ form, operator, readsInclude }) => {
      const parents = createControlledCollection(`operator-parent`, [
        { id: 1, group: 1, base: 3 },
        { id: 2, group: 2, base: 5 },
      ])
      const children = createControlledCollection(`operator-child`, [
        { id: 10, parentGroup: 1, value: 3 },
        { id: 20, parentGroup: 2, value: 5 },
      ])
      // This model stores the scalar computed on a parent projection. A live
      // Collection handle does not make its scalar reads child dependencies.
      const expectedScores = new Map([
        [1, 3],
        [2, 5],
      ])
      const observed: Array<ChildView> = []
      const buildQuery = () =>
        createLiveQueryCollection({
          query: (q) => {
            const source = q
              .from({ parent: parents.collection })
              .select(({ parent }) => {
                const childRows = q
                  .from({ child: children.collection })
                  .where(({ child }) => eq(child.parentGroup, parent.group))
                return {
                  id: parent.id,
                  base: parent.base,
                  children:
                    form === `collection`
                      ? include(childRows)
                      : form === `array`
                        ? toArray(childRows)
                        : materialize(childRows),
                }
              })
            const projected = q.from({ row: source }).fn.select(({ row }) => {
              const view = readsInclude
                ? readChildren(row.children, form)
                : undefined
              if (view)
                observed.push({ ...view, rows: selectedRows(view.rows) })
              return {
                id: operator === `distinct` ? 0 : row.id,
                score: view
                  ? view.rows.reduce((sum, child) => sum + child.value, 0)
                  : row.base,
              }
            })
            if (operator === `distinct`) return projected.distinct()
            if (operator === `selected-order`)
              return projected
                .orderBy(({ $selected }) => $selected.score, `desc`)
                .orderBy(({ $selected }) => $selected.id)
                .limit(1)
            return projected
          },
          getKey:
            operator === `custom-key` ? (row) => `result:${row.id}` : undefined,
        })
      if (rejectsCollectionInput(form, true)) {
        let primaryFailure: unknown = noPrimaryFailure
        try {
          expect(buildQuery).toThrow(collectionInputError)
          expect(observed).toEqual([])
        } catch (error) {
          primaryFailure = error
          throw error
        } finally {
          await cleanupAfterOracle(primaryFailure, [
            () => parents.collection.cleanup(),
            () => children.collection.cleanup(),
          ])
        }
        return
      }
      const live = buildQuery()
      const check = () => {
        const expected = expectedOperatorRows(expectedScores, operator)
        const sort = (rows: Array<{ id: number; score: number }>) =>
          rows.sort(
            (left, right) => left.id - right.id || left.score - right.score,
          )
        expect
          .soft(sort(live.toArray.map(({ id, score }) => ({ id, score }))))
          .toEqual(sort(expected))
        if (operator === `custom-key`)
          expect
            .soft([...live.keys()].sort())
            .toEqual(expected.map((row) => `result:${row.id}`).sort())
        for (const view of observed) {
          expect.soft(view.valid, `operator callback input form`).toBe(true)
          if (form === `collection`)
            expect
              .soft(view.ready, `operator callback input readiness`)
              .toBe(true)
        }
        observed.length = 0
      }
      let primaryFailure: unknown = noPrimaryFailure
      try {
        await live.preload()
        check()
        if (readsInclude && form !== `collection`) expectedScores.set(1, 7)
        children.write(`update`, { id: 10, parentGroup: 1, value: 7 })
        check()
        expectedScores.set(1, 5)
        parents.write(`update`, { id: 1, group: 2, base: 5 })
        check()
        expectedScores.delete(1)
        parents.write(`delete`, { id: 1, group: 2, base: 5 })
        check()
      } catch (error) {
        primaryFailure = error
        throw error
      } finally {
        await cleanupAfterOracle(primaryFailure, [
          () => live.cleanup(),
          () => parents.collection.cleanup(),
          () => children.collection.cleanup(),
        ])
      }
    },
  )

  it.each(renamedCells)(
    `$form / $projection / $consumer / sibling=$withSibling materializes inputs before renaming them`,
    async ({ form, consumer, projection, withSibling }) => {
      const parents = createControlledCollection(`renamed-parent`, [
        { id: 1, group: 1, siblingGroup: 2 },
      ])
      const initial: Array<Child> = [
        { id: 10, parentGroup: 1, value: 3 },
        { id: 20, parentGroup: 2, value: 5 },
      ]
      const children = createControlledCollection(`renamed-child`, initial)
      const truth = new Map(initial.map((row) => [row.id, row]))
      let group = 1
      let phase: Phase = `initial`
      const calls: Array<{
        phase: Phase
        stage: `projection` | `consumer`
        primary: ChildView
        sibling?: ChildView
      }> = []
      const inspect = (
        stage: `projection` | `consumer`,
        primary: unknown,
        sibling: unknown,
      ) => {
        const view = readChildren(primary, form)
        const second = withSibling ? readChildren(sibling, form) : undefined
        calls.push({
          phase,
          stage,
          primary: { ...view, rows: selectedRows(view.rows) },
          sibling: second && { ...second, rows: selectedRows(second.rows) },
        })
        return (
          view.rows.reduce((sum, row) => sum + row.value, 0) +
          (second?.rows.reduce((sum, row) => sum + row.value, 0) ?? 0)
        )
      }
      const buildQuery = () =>
        createLiveQueryCollection((q) => {
          const source = q
            .from({ parent: parents.collection })
            .select(({ parent }) => {
              const primary = q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group))
              const sibling = q
                .from({ other: children.collection })
                .where(({ other }) =>
                  eq(other.parentGroup, parent.siblingGroup),
                )
              return {
                id: parent.id,
                children:
                  form === `collection`
                    ? include(primary)
                    : form === `array`
                      ? toArray(primary)
                      : materialize(primary),
                ...(withSibling
                  ? {
                      sibling:
                        form === `collection`
                          ? include(sibling)
                          : form === `array`
                            ? toArray(sibling)
                            : materialize(sibling),
                    }
                  : {}),
              }
            })
          const input = q.from({ row: source })
          const projected =
            projection === `expression`
              ? input.select(({ row }) => ({
                  id: row.id,
                  renamed: { primary: row.children, sibling: row.sibling },
                  total: 0,
                }))
              : input.fn.select(({ row }) => ({
                  id: row.id,
                  renamed: { primary: row.children, sibling: row.sibling },
                  total: inspect(`projection`, row.children, row.sibling),
                }))
          const outer = q.from({ result: projected })
          return consumer === `expression`
            ? outer.select(({ result }) => ({ value: result }))
            : outer.fn.select(({ result }) => ({
                value: {
                  id: result.id,
                  renamed: result.renamed,
                  total: inspect(
                    `consumer`,
                    result.renamed.primary,
                    result.renamed.sibling,
                  ),
                },
              }))
        })
      if (
        rejectsCollectionInput(
          form,
          projection === `functional`,
          consumer === `functional`,
        )
      ) {
        let primaryFailure: unknown = noPrimaryFailure
        try {
          expect(buildQuery).toThrow(collectionInputError)
          expect(calls).toEqual([])
        } catch (error) {
          primaryFailure = error
          throw error
        } finally {
          await cleanupAfterOracle(primaryFailure, [
            () => parents.collection.cleanup(),
            () => children.collection.cleanup(),
          ])
        }
        return
      }
      const live = buildQuery()
      const check = () => {
        const row = live.toArray[0]?.value
        expect.soft(live.toArray, `${phase}: row count`).toHaveLength(1)
        expect.soft(row?.id, `${phase}: public id`).toBe(1)
        const expectedPrimary = expectedGroupChildren(truth, group)
        const expectedSibling = withSibling
          ? expectedGroupChildren(truth, 2)
          : []
        for (const [value, expected] of [
          [row?.renamed.primary, expectedPrimary],
          ...(withSibling
            ? [[row?.renamed.sibling, expectedSibling] as const]
            : []),
        ] as const) {
          const view = readChildren(value, form)
          expect.soft(view.valid, `${phase}: renamed public form`).toBe(true)
          expect
            .soft(publicRows(view.rows), `${phase}: renamed public rows`)
            .toEqual(expected)
          if (form === `collection`)
            expect
              .soft(view.ready, `${phase}: renamed public readiness`)
              .toBe(true)
        }
        if (row)
          expect
            .soft(
              `children` in row || `row` in row,
              `${phase}: input paths do not leak`,
            )
            .toBe(false)
        if (
          form !== `collection` ||
          phase === `initial` ||
          phase === `route-move`
        ) {
          if (projection === `functional` || consumer === `functional`)
            expect
              .soft(row?.total, `${phase}: derived total`)
              .toBe(
                [...expectedPrimary, ...expectedSibling].reduce(
                  (sum, child) => sum + child.value,
                  0,
                ),
              )
          for (const stage of [
            ...(projection === `functional` ? [`projection` as const] : []),
            ...(consumer === `functional` ? [`consumer` as const] : []),
          ]) {
            expect
              .soft(
                calls.filter(
                  (call) => call.phase === phase && call.stage === stage,
                ).length,
                `${phase}: ${stage} callback reach`,
              )
              .toBeGreaterThan(0)
          }
        }
        for (const call of calls.filter((item) => item.phase === phase)) {
          for (const view of [
            call.primary,
            ...(call.sibling ? [call.sibling] : []),
          ]) {
            expect.soft(view.valid, `${phase}: callback input form`).toBe(true)
            if (form === `collection`)
              expect
                .soft(view.ready, `${phase}: callback input readiness`)
                .toBe(true)
          }
        }
      }
      let primaryFailure: unknown = noPrimaryFailure
      try {
        await live.preload()
        check()
        phase = `child-update`
        const changed = { id: 10, parentGroup: 1, value: 7 }
        truth.set(10, changed)
        children.write(`update`, changed)
        check()
        if (withSibling) {
          phase = `sibling-update`
          const sibling = { id: 20, parentGroup: 2, value: 11 }
          truth.set(20, sibling)
          children.write(`update`, sibling)
          check()
        }
        phase = `route-move`
        group = 2
        parents.write(`update`, { id: 1, group, siblingGroup: 2 })
        check()
      } catch (error) {
        primaryFailure = error
        throw error
      } finally {
        await cleanupAfterOracle(primaryFailure, [
          () => live.cleanup(),
          () => parents.collection.cleanup(),
          () => children.collection.cleanup(),
        ])
      }
    },
  )
})

describe(`functional include projection boundary grammar`, () => {
  it(`covers every declared boundary product without duplicate cells`, () => {
    expect(cells).toHaveLength(54)
    expect(new Set(cells.map((cell) => JSON.stringify(cell))).size).toBe(54)
    expect(orderedPairCells).toHaveLength(27)
    expect(
      new Set(
        [...cells, ...orderedPairCells].map((cell) => JSON.stringify(cell)),
      ).size,
    ).toBe(81)
  })

  it.each([...cells, ...orderedPairCells])(
    `$boundary / $form / $output / $initial`,
    async ({ boundary, form, output, initial }) => {
      const parents = createControlledCollection(`projection-parents`, [
        { id: 1, group: 1 },
      ])
      const absent = createControlledCollection(`projection-absent`, [
        { id: 2 },
      ])
      const initialChildren: Array<Child> = [
        ...(initial !== `empty` ? [{ id: 10, parentGroup: 1, value: 3 }] : []),
        { id: 20, parentGroup: 2, value: 5 },
        ...(initial === `ordered-pair`
          ? [
              { id: 5, parentGroup: 1, value: 9 },
              { id: 15, parentGroup: 2, value: 11 },
            ]
          : []),
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
          view: { ...view, rows: selectedRows(view.rows) },
        })
        const total = view.rows.reduce((sum, item) => sum + item.value, 0)
        return output === `opaque-root`
          ? new Projection(row.id, row.kind, child, total)
          : { id: row.id, kind: row.kind, children: child, total }
      }
      const buildQuery = () =>
        createLiveQueryCollection((q) => {
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
                    ? include(childRows)
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
      if (rejectsCollectionInput(form, output !== `expression`)) {
        let primaryFailure: unknown = noPrimaryFailure
        try {
          expect(buildQuery).toThrow(collectionInputError)
          expect(calls).toEqual([])
        } catch (error) {
          primaryFailure = error
          throw error
        } finally {
          await cleanupAfterOracle(primaryFailure, [
            () => parents.collection.cleanup(),
            () => children.collection.cleanup(),
            () => absent.collection.cleanup(),
          ])
        }
        return
      }
      const live = buildQuery()
      let facade: unknown
      const check = () => {
        expect
          .soft(
            live.toArray
              .map(({ id, kind }) => ({ id, kind }))
              .sort((left, right) => left.id - right.id),
            `${phase}: complete public roots`,
          )
          .toEqual([
            { id: 1, kind: `included` },
            ...(boundary === `union` ? [{ id: 2, kind: `absent` }] : []),
          ])
        const row: (Input & { total: number }) | undefined = live.toArray.find(
          (item) => item.kind === `included`,
        )
        expect.soft(row, `${phase}: included public row`).toBeDefined()
        if (!row) return
        const expected = expectedGroupChildren(truth, group)
        const view = readChildren(row.children, form)
        expect.soft(view.valid, `${phase}: public include form`).toBe(true)
        expect
          .soft(selectedRows(view.rows), `${phase}: public children`)
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
          const other: (Input & { total?: number }) | undefined =
            live.toArray.find((item) => item.kind === `absent`)
          expect.soft(other, `${phase}: absent branch survives`).toBeDefined()
          expect
            .soft(other?.children, `${phase}: absent branch value`)
            .toBeUndefined()
          expect.soft(other?.total, `${phase}: absent branch total`).toBe(0)
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
        const absentCalls = calls.filter(
          (item) => item.phase === phase && item.kind === `absent`,
        )
        if (
          boundary === `union` &&
          output !== `expression` &&
          phase === `initial`
        )
          expect
            .soft(absentCalls.length, `initial: absent callback reach`)
            .toBeGreaterThan(0)
        for (const call of absentCalls) {
          expect
            .soft(call.child, `${phase}: valid callback absence`)
            .toBeUndefined()
        }
      }
      let primaryFailure: unknown = noPrimaryFailure
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
      } catch (error) {
        primaryFailure = error
        throw error
      } finally {
        await cleanupAfterOracle(primaryFailure, [
          () => live.cleanup(),
          () => parents.collection.cleanup(),
          () => children.collection.cleanup(),
          () => absent.collection.cleanup(),
        ])
      }
    },
  )
})
