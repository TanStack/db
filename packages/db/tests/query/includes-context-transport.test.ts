/**
 * Fixed-scenario and harness tests for correlated include route-context
 * transport. Each test checks literal values or the harness's own failure
 * reporting, so it is supplemental coverage. The grammar cells, their models,
 * and the compound join matrix are the oracle in
 * `includes-context-transport-oracle.test.ts`, which owns the transport law
 * from ARCHITECTURE.md.
 */

import { describe, expect, test } from 'vitest'
import {
  caseWhen,
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import {
  attachRouteMetadata,
  transformPublicContainers,
} from '../../src/query/compiler/route-metadata.js'
import {
  fieldStages,
  overlapStages,
  publicFieldCells,
  publicFieldOverlapCells,
  publicFieldOverlapFunctionalCells,
} from '../conformance/public-field-oracle.js'
import {
  createGrammarCollection,
  expectEveryForm,
  expectNoPrivateSymbolsDeep,
  includeInEveryForm,
  materializationForms,
  runWithCleanup,
} from './includes-context-transport-helpers.js'
import {
  checkMaterializedInputRows,
  checkOuterJoinKeyRows,
  checkpoints,
  expectedMaterializedInputRows,
  expectedOuterJoinKeyRows,
  grammarCellName,
  grammarCells,
  materializedInputCells,
  materializedInputGrammar,
  routeContextGrammar,
} from './includes-context-transport-model-oracle.js'
import type {
  Cleanable,
  MaterializedForms,
} from './includes-context-transport-helpers.js'

test('carries dotted and nested parent fields through one include', async () => {
  const parents = createGrammarCollection('path-parent', [
    { id: 1, 'a.b': 11, a: { b: 22 } },
  ])
  const children = createGrammarCollection('path-child', [
    { id: 10, parentId: 1 },
  ])
  const live = createLiveQueryCollection((q) =>
    q.from({ parent: parents.collection }).select(({ parent }) => ({
      id: parent.id,
      children: toArray(
        q
          .from({ child: children.collection })
          .where(({ child }) => eq(child.parentId, parent.id))
          .select(({ child }) => ({
            id: child.id,
            flat: parent['a.b'],
            nested: parent.a.b,
          })),
      ),
    })),
  )
  await runWithCleanup(live, [parents, children], async () => {
    await live.preload()
    expect(live.get(1)?.children).toEqual([{ id: 10, flat: 11, nested: 22 }])

    parents.write(`update`, { id: 1, 'a.b': 33, a: { b: 44 } })
    expect(live.get(1)?.children).toEqual([{ id: 10, flat: 33, nested: 44 }])
  })
})

test('carries both parent paths through nested includes', async () => {
  const parents = createGrammarCollection('nested-path-parent', [
    { id: 1, 'a.b': 11, a: { b: 22 } },
  ])
  const children = createGrammarCollection('nested-path-child', [
    { id: 10, parentId: 1 },
  ])
  const grandchildren = createGrammarCollection('nested-path-grandchild', [
    { id: 100, childId: 10 },
  ])
  const live = createLiveQueryCollection((q) =>
    q.from({ parent: parents.collection }).select(({ parent }) => ({
      id: parent.id,
      children: toArray(
        q
          .from({ child: children.collection })
          .where(({ child }) => eq(child.parentId, parent.id))
          .select(({ child }) => ({
            id: child.id,
            grandchildren: toArray(
              q
                .from({ grandchild: grandchildren.collection })
                .where(({ grandchild }) => eq(grandchild.childId, child.id))
                .select(({ grandchild }) => ({
                  id: grandchild.id,
                  flat: parent['a.b'],
                  nested: parent.a.b,
                })),
            ),
          })),
      ),
    })),
  )
  await runWithCleanup(live, [parents, children, grandchildren], async () => {
    await live.preload()
    expect(live.toArray).toHaveLength(1)
    expect(live.toArray[0]?.children).toEqual([
      { id: 10, grandchildren: [{ id: 100, flat: 11, nested: 22 }] },
    ])
  })
})

test('keeps dotted ancestor aliases distinct in nested includes', async () => {
  const dotted = createGrammarCollection('dotted-alias-parent', [
    { id: 1, x: 11 },
  ])
  const nested = createGrammarCollection('nested-alias-parent', [
    { id: 1, q: { x: 22 } },
  ])
  const children = createGrammarCollection('alias-path-child', [
    { id: 10, parentId: 1 },
  ])
  const grandchildren = createGrammarCollection('alias-path-grandchild', [
    { id: 100, childId: 10 },
  ])
  const live = createLiveQueryCollection((q) =>
    q
      .from({ 'p.q': dotted.collection })
      .innerJoin({ p: nested.collection }, ({ 'p.q': left, p }) =>
        eq(left.id, p.id),
      )
      .select(({ 'p.q': left, p }) => ({
        id: left.id,
        children: toArray(
          q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentId, left.id))
            .select(({ child }) => ({
              id: child.id,
              grandchildren: toArray(
                q
                  .from({ grandchild: grandchildren.collection })
                  .where(({ grandchild }) => eq(grandchild.childId, child.id))
                  .select(({ grandchild }) => ({
                    id: grandchild.id,
                    flat: left.x,
                    nested: p.q.x,
                  })),
              ),
            })),
        ),
      })),
  )
  await runWithCleanup(
    live,
    [dotted, nested, children, grandchildren],
    async () => {
      await live.preload()
      expect(live.toArray).toHaveLength(1)
      expect(live.toArray[0]?.children).toEqual([
        { id: 10, grandchildren: [{ id: 100, flat: 11, nested: 22 }] },
      ])
    },
  )
})

test('routes dotted and nested include result paths independently', async () => {
  const parents = createGrammarCollection('route-path-parent', [
    { id: 1, flatKey: 1, nestedKey: 2 },
  ])
  const flatChildren = createGrammarCollection('route-path-flat', [
    { id: 10, parentId: 1 },
  ])
  const nestedChildren = createGrammarCollection('route-path-nested', [
    { id: 20, parentId: 2 },
  ])
  const live = createLiveQueryCollection((q) =>
    q.from({ parent: parents.collection }).select(({ parent }) => ({
      id: parent.id,
      'a.b': toArray(
        q
          .from({ child: flatChildren.collection })
          .where(({ child }) => eq(child.parentId, parent.flatKey))
          .select(({ child }) => ({ id: child.id })),
      ),
      a: caseWhen(
        eq(parent.id, 1),
        {
          b: toArray(
            q
              .from({ child: nestedChildren.collection })
              .where(({ child }) => eq(child.parentId, parent.nestedKey))
              .select(({ child }) => ({ id: child.id })),
          ),
        },
        { b: [] as Array<{ id: number }> },
      ),
    })),
  )
  await runWithCleanup(
    live,
    [parents, flatChildren, nestedChildren],
    async () => {
      await live.preload()
      expect(live.toArray).toHaveLength(1)
      expect(live.toArray[0]?.['a.b']).toEqual([{ id: 10 }])
      expect(live.toArray[0]?.a.b).toEqual([{ id: 20 }])

      parents.write(`update`, { id: 1, flatKey: 2, nestedKey: 1 })
      expect(live.toArray[0]?.['a.b']).toEqual([])
      expect(live.toArray[0]?.a.b).toEqual([])

      flatChildren.write(`insert`, { id: 11, parentId: 2 })
      nestedChildren.write(`insert`, { id: 21, parentId: 1 })
      expect(live.toArray[0]?.['a.b']).toEqual([{ id: 11 }])
      expect(live.toArray[0]?.a.b).toEqual([{ id: 21 }])
    },
  )
})

const queryRefMetadataGrammar = {
  routeModes: [`plain`, `routed`] as const,
} as const

type QueryRefMetadataMode = (typeof queryRefMetadataGrammar.routeModes)[number]

function expectNoRouteMetadata(row: object): void {
  expect(Object.hasOwn(row, `__correlationKey`)).toBe(false)
  expect(Object.hasOwn(row, `__parentContext`)).toBe(false)
}

// Public VirtualRowProps names these five keys, not arbitrary $-prefixed data.
const publicMetadataKeys = new Set([
  `$hasPendingWrites`,
  `$origin`,
  `$key`,
  `$collectionId`,
])

function expectSelectedOwnKeys(
  row: object,
  selected: ReadonlyArray<string>,
): void {
  expect(
    new Set(
      Reflect.ownKeys(row).filter(
        (key) => typeof key !== `string` || !publicMetadataKeys.has(key),
      ),
    ),
  ).toEqual(new Set(selected))
}

function captureMetadataRows(
  rows: Iterable<{ id: number; label: string }>,
): Array<{ id: number; label: string }> {
  if (Array.isArray(rows)) {
    expect(new Set(Reflect.ownKeys(rows))).toEqual(
      new Set([
        `length`,
        ...Array.from({ length: rows.length }, (_, index) => String(index)),
      ]),
    )
  }
  return [...rows].map((row) => {
    expectNoRouteMetadata(row)
    expectSelectedOwnKeys(row, [`id`, `label`])
    return { id: row.id, label: row.label }
  })
}

async function runQueryRefMetadataCell(
  routeMode: QueryRefMetadataMode,
): Promise<void> {
  const anchors = createGrammarCollection(`metadata-${routeMode}-anchors`, [
    { id: 1, candidateId: 10, parentGroup: 1 },
  ])
  const candidates = createGrammarCollection(
    `metadata-${routeMode}-candidates`,
    [{ id: 10, label: `ten` }],
  )

  if (routeMode === `plain`) {
    const live = createLiveQueryCollection((q) => {
      const projectedCandidates = q
        .from({ candidate: candidates.collection })
        .select(({ candidate }) => ({
          id: candidate.id,
          label: candidate.label,
        }))
      return q
        .from({ anchor: anchors.collection })
        .innerJoin(
          { candidateResult: projectedCandidates },
          ({ anchor, candidateResult }) =>
            eq(anchor.candidateId, candidateResult.id),
        )
        .select(({ candidateResult }) => candidateResult)
    })

    await runWithCleanup(live, [anchors, candidates], async () => {
      await live.preload()
      expect(captureMetadataRows(live.toArray)).toEqual([
        { id: 10, label: `ten` },
      ])

      candidates.write(`update`, { id: 10, label: `updated` })
      expect(captureMetadataRows(live.toArray)).toEqual([
        { id: 10, label: `updated` },
      ])
    })
    return
  }

  const parents = createGrammarCollection(`metadata-routed-parents`, [
    { id: 1, group: 1 },
  ])
  const live = createLiveQueryCollection((q) =>
    q.from({ parent: parents.collection }).select(({ parent }) => {
      const projectedCandidates = q
        .from({ candidate: candidates.collection })
        .select(({ candidate }) => ({
          id: candidate.id,
          label: candidate.label,
        }))
      const rows = q
        .from({ anchor: anchors.collection })
        .innerJoin(
          { candidateResult: projectedCandidates },
          ({ anchor, candidateResult }) =>
            eq(anchor.candidateId, candidateResult.id),
        )
        .where(({ anchor }) => eq(anchor.parentGroup, parent.group))
        .select(({ candidateResult }) => candidateResult)
      return { id: parent.id, ...includeInEveryForm(rows) }
    }),
  )
  const assertClean = (expected: Array<{ id: number; label: string }>) => {
    expect(live.toArray.map(({ id }) => id)).toEqual([1])
    const forms = live.get(1)!
    expectSelectedOwnKeys(forms, [`id`, `collection`, `array`, `materialized`])
    for (const rows of [
      forms.collection.values(),
      forms.array,
      forms.materialized,
    ]) {
      expect(captureMetadataRows(rows)).toEqual(expected)
    }
  }

  await runWithCleanup(live, [parents, anchors, candidates], async () => {
    await live.preload()
    assertClean([{ id: 10, label: `ten` }])

    parents.write(`update`, { id: 1, group: 2 })
    assertClean([])

    anchors.write(`update`, { id: 1, candidateId: 10, parentGroup: 2 })
    assertClean([{ id: 10, label: `ten` }])
  })
}

describe(`correlated include route-context transport grammar`, () => {
  test(`public result comparison rejects wrong routes, omissions, and duplicates`, () => {
    const expected = [{ id: 10, value: `one` }]
    const forms: MaterializedForms<{ id: number; value: string }> = {
      collection: { values: () => expected },
      array: expected,
      materialized: expected,
    }
    const project = (rows: Iterable<{ id: number; value: string }>) => [...rows]

    expectEveryForm(forms, project, expected)
    expect(() =>
      expectEveryForm(
        { ...forms, array: [{ id: 20, value: `two` }] },
        project,
        expected,
      ),
    ).toThrow()
    expect(() =>
      expectEveryForm(
        { ...forms, collection: { values: () => [] } },
        project,
        expected,
      ),
    ).toThrow()
    expect(() =>
      expectEveryForm(
        { ...forms, materialized: [...expected, ...expected] },
        project,
        expected,
      ),
    ).toThrow()
  })

  test(`cleanup retains the primary failure and releases every source`, async () => {
    const primary = new Error(`route mismatch`)
    const liveCleanupFailure = new Error(`live cleanup failed`)
    const sourceCleanupFailure = new Error(`source cleanup failed`)
    const released: Array<string> = []
    const live: Cleanable = {
      cleanup: async () => {
        released.push(`live`)
        throw liveCleanupFailure
      },
    }
    const sources = [
      {
        collection: {
          cleanup: async () => {
            released.push(`first source`)
            throw sourceCleanupFailure
          },
        },
      },
      {
        collection: {
          cleanup: async () => {
            released.push(`second source`)
          },
        },
      },
    ]

    let caught: unknown
    try {
      await runWithCleanup(live, sources, async () => {
        throw primary
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AggregateError)
    const failure = caught as AggregateError
    expect(failure.cause).toBe(primary)
    expect(failure.errors).toHaveLength(2)
    expect((failure.errors[0] as Error).cause).toBe(liveCleanupFailure)
    expect((failure.errors[1] as Error).cause).toBe(sourceCleanupFailure)
    expect(released).toEqual([`live`, `first source`, `second source`])
  })

  test(`metadata observations reject vacuity, extra rows, and unknown own keys`, () => {
    const expected = [{ id: 10, label: `ten` }]
    const valid = { id: 10, label: `ten` }
    for (const key of publicMetadataKeys) {
      Object.defineProperty(valid, key, { value: undefined })
    }
    expect(captureMetadataRows([valid])).toEqual(expected)
    expect(captureMetadataRows([])).toEqual([])
    const check = (rows: Array<{ id: number; label: string }>) =>
      expect(captureMetadataRows(rows)).toEqual(expected)
    for (const rows of [
      [],
      [...expected, ...expected],
      [{ id: 10, label: `wrong` }],
    ])
      expect(() => check(rows)).toThrow()
    for (const key of [`extra`, `$unknown`, Symbol(`private`)] as const) {
      const row = { id: 10, label: `ten` }
      Object.defineProperty(row, key, { value: undefined })
      expect(() => check([row])).toThrow()
    }
    const rows = [...expected]
    Object.defineProperty(rows, Symbol(`private array carrier`), {
      value: undefined,
    })
    expect(() => check(rows)).toThrow()
  })

  test(`preserves cycles while removing nested route metadata`, () => {
    const routed = attachRouteMetadata({ id: 1 }, 1, null)
    const value: Record<string, unknown> = { routed }
    value.self = value

    const cleaned = transformPublicContainers(
      value,
      (leaf) => leaf,
      new Set(Object.getOwnPropertySymbols(routed)),
    ) as typeof value

    expect(cleaned).not.toBe(value)
    expect(cleaned.self).toBe(cleaned)
    expectNoPrivateSymbolsDeep(cleaned, new Set())
  })

  test(`does not evaluate unused accessors while cleaning routed callback rows`, async () => {
    let reads = 0
    const payload = {}
    Object.defineProperty(payload, `unused`, {
      get() {
        reads++
        throw new Error(`unused getter evaluated`)
      },
      enumerable: true,
    })
    const parents = createGrammarCollection(`getter-parents`, [
      { id: 1, group: 1 },
    ])
    const children = createGrammarCollection(`getter-children`, [
      { id: 10, parentGroup: 1, payload },
    ])
    const live = createLiveQueryCollection((q) =>
      q.from({ parent: parents.collection }).select(({ parent }) => ({
        id: parent.id,
        children: toArray(
          q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .fn.where(() => true)
            .fn.select(({ child }) => ({ id: child.id })),
        ),
      })),
    )

    await runWithCleanup(live, [parents, children], async () => {
      await live.preload()
      expect(live.get(1)?.children).toEqual([{ id: 10 }])
      expect(reads).toBe(0)
    })
  })

  for (const routeMode of queryRefMetadataGrammar.routeModes) {
    test(`query-ref metadata / ${routeMode}`, () =>
      runQueryRefMetadataCell(routeMode))
  }
})

// Grammar-size checks and checker calibrations for the route-context
// transport oracle. They run no production: the size checks count the grammar
// tables, and each calibration feeds a wrong row set to the oracle's check.
describe(`route-context transport grammar and checks`, () => {
  test(`expands every declared product without duplicate cells`, () => {
    const expectedCellCount =
      routeContextGrammar.parentProjection.shapes.length +
      routeContextGrammar.correlationDomain.states.length +
      routeContextGrammar.lexicalScope.scopes.length +
      routeContextGrammar.aggregation.groupings.length *
        routeContextGrammar.aggregation.placements.length +
      routeContextGrammar.recursiveSource.boundaries.length *
        routeContextGrammar.recursiveSource.phases.length +
      routeContextGrammar.join.keySides.length *
        routeContextGrammar.join.correlationAttachments.length +
      routeContextGrammar.unionIdentity.forms.length +
      routeContextGrammar.derivedResult.boundaries.length *
        routeContextGrammar.derivedResult.selections.length *
        routeContextGrammar.derivedResult.domains.length +
      routeContextGrammar.namespaceCollision.locations.length *
        routeContextGrammar.namespaceCollision.boundaries.length *
        routeContextGrammar.namespaceCollision.names.length +
      routeContextGrammar.publicSurface.shapes.length +
      publicFieldCells.length +
      publicFieldOverlapCells.length +
      publicFieldOverlapFunctionalCells.length
    const names = grammarCells.map(grammarCellName)

    expect(grammarCells).toHaveLength(expectedCellCount)
    expect(new Set(names)).toHaveLength(expectedCellCount)
    expect(
      grammarCells.filter(
        (cell) =>
          cell.family !== `public-field` &&
          cell.family !== `public-field-overlap`,
      ).length *
        materializationForms.length *
        checkpoints.length,
    ).toBe(819)
    expect(
      grammarCells.filter((cell) => cell.family === `public-field`).length *
        fieldStages.length *
        4,
    ).toBe(1200)
    expect(
      (publicFieldOverlapCells.length +
        publicFieldOverlapFunctionalCells.length) *
        overlapStages.length *
        4,
    ).toBe(432)
  })

  test(`expands every declared input boundary without duplicates`, () => {
    const expected =
      materializedInputGrammar.boundaries.length *
      materializedInputGrammar.selections.length *
      materializedInputGrammar.inputs.length
    expect(materializedInputCells).toHaveLength(expected)
    expect(
      new Set(
        materializedInputCells.map(
          ({ boundary, selection, input }) =>
            `${boundary}/${selection}/${input}`,
        ),
      ),
    ).toHaveLength(expected)
  })

  test(`rejects lost children and cross-parent reuse at the public checkpoint`, () => {
    const children = [
      { id: 10, parentGroup: 1 },
      { id: 20, parentGroup: 2 },
    ]
    const grandchildren = [{ id: 100, childId: 10, label: `ten` }]
    const expected = expectedMaterializedInputRows(
      { group: 1 },
      children,
      grandchildren,
    )
    const wrongRoute = expectedMaterializedInputRows(
      { group: 2 },
      children,
      grandchildren,
    )
    checkMaterializedInputRows(expected, expected, `allowed`)
    for (const wrong of [[], wrongRoute]) {
      expect(() =>
        checkMaterializedInputRows(wrong, expected, `calibration`),
      ).toThrow()
    }
  })

  test(`rejects missing and duplicated joined contributions`, () => {
    const mains = [{ id: 10, link: 10, parentGroup: 1 }]
    const children = [
      { id: 20, link: 10, parentGroup: 1 },
      { id: 21, link: 10, parentGroup: 1 },
      { id: 10, link: 30, parentGroup: 1 },
    ]
    for (const join of [`inner`, `left`, `right`, `full`] as const) {
      const expected = expectedOuterJoinKeyRows(mains, children, 1, join)
      checkOuterJoinKeyRows(expected, expected)
      for (const wrong of [expected.slice(1), [...expected, expected[0]!]])
        expect(() => checkOuterJoinKeyRows(wrong, expected)).toThrow()
    }
  })
})
