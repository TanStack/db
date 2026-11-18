import { expect } from 'vitest'
import {
  publicFieldCells,
  publicFieldGrammar,
  publicFieldOverlapCells,
  publicFieldOverlapFunctionalCells,
} from '../conformance/public-field-oracle.js'
import type {
  PublicFieldCell,
  PublicFieldOverlapCell,
} from '../conformance/public-field-oracle.js'

// The route-context grammar, the materialized-input grammar and model, and the
// outer-join key model and check of the route-context transport oracle, moved
// here unchanged from includes-context-transport-oracle.test.ts. The oracle
// drives production through them; the ordinary grammar-size checks and checker
// calibrations in includes-context-transport.test.ts import them without
// registering the oracle's tests again. This module registers no tests.

export const checkpoints = [`initial`, `parent-update`, `child-update`] as const

// These axes name semantic boundaries, not implementation functions. Adding a
// compiler feature means adding its boundary here or stating why it cannot
// carry correlated context. Each declared tuple gets one named test below;
// the path-specific witnesses in `includes-context-transport.test.ts`
// reconstruct the separate dotted-path cases.
//
// Removing a family loses a distinct question: field versus whole-parent
// projection; unmatched versus null correlation; immediate versus ancestor
// scope; grouping versus aggregate placement; recursive boundary versus
// evaluation phase; join-key side versus correlation attachment; union form;
// derived-result boundary versus selection and nullability; user-name location
// versus boundary and spelling; or public-surface shape. Within a family, the
// asserted parent and child changes distinguish route reuse from recomputation.
// The fixtures bound the range to small finite source Collections, three public
// forms, and the listed updates. New numeric values with the same relations
// change parameters, while arbitrary path segments or deeper recursive shapes
// require new grammar rules. Ancestor alias shadowing and compiled
// Collection-valued functional inputs are invalid query forms and excluded.
export const routeContextGrammar = {
  parentProjection: {
    shapes: [`field`, `whole-row`] as const,
  },
  correlationDomain: {
    states: [`unmatched`, `null`] as const,
  },
  lexicalScope: {
    scopes: [`immediate-parent`, `lexical-ancestor`] as const,
  },
  aggregation: {
    groupings: [`implicit`, `explicit`] as const,
    placements: [`inside-aggregate`, `wrapped-aggregate`] as const,
  },
  recursiveSource: {
    boundaries: [`from-query-ref`, `joined-query-ref`, `union-branch`] as const,
    phases: [
      `filter`,
      `projection`,
      `aggregate`,
      `having`,
      `order-window`,
    ] as const,
  },
  join: {
    keySides: [`main`, `joined`] as const,
    correlationAttachments: [`main`, `joined`] as const,
  },
  unionIdentity: {
    forms: [`union-from`, `union-all`] as const,
  },
  derivedResult: {
    boundaries: [`from-query-ref`, `joined-query-ref`, `union-all`] as const,
    selections: [`expression`, `functional`] as const,
    domains: [`non-null`, `nullable`] as const,
  },
  namespaceCollision: {
    locations: [`parent-alias`, `selected-field`] as const,
    boundaries: [`direct`, `query-ref`, `join`, `group`] as const,
    names: [
      `__parentContextIdentity`,
      `__parentContext`,
      `__correlationKey`,
      `value`,
      `identity`,
    ] as const,
  },
  publicField: publicFieldGrammar,
  publicSurface: {
    shapes: [
      `object-query-ref-scalar`,
      `nested-functional-spread`,
      `opaque-wrapper`,
      `functional-having-input`,
      `nested-reference`,
      `adversarial-key`,
      `user-symbol`,
      `implicit-join`,
    ] as const,
  },
} as const

export type ParentProjectionCell = {
  family: `parent-projection`
  shape: (typeof routeContextGrammar.parentProjection.shapes)[number]
}

export type CorrelationDomainCell = {
  family: `correlation-domain`
  state: (typeof routeContextGrammar.correlationDomain.states)[number]
}

export type LexicalScopeCell = {
  family: `lexical-scope`
  scope: (typeof routeContextGrammar.lexicalScope.scopes)[number]
}

export type AggregationCell = {
  family: `aggregation`
  grouping: (typeof routeContextGrammar.aggregation.groupings)[number]
  placement: (typeof routeContextGrammar.aggregation.placements)[number]
}

export type RecursiveSourceCell = {
  family: `recursive-source`
  boundary: (typeof routeContextGrammar.recursiveSource.boundaries)[number]
  phase: (typeof routeContextGrammar.recursiveSource.phases)[number]
}

export type JoinCell = {
  family: `join`
  keySide: (typeof routeContextGrammar.join.keySides)[number]
  correlationAttachment: (typeof routeContextGrammar.join.correlationAttachments)[number]
}

export type UnionIdentityCell = {
  family: `union-identity`
  form: (typeof routeContextGrammar.unionIdentity.forms)[number]
}

export type DerivedResultCell = {
  family: `derived-result`
  boundary: (typeof routeContextGrammar.derivedResult.boundaries)[number]
  selection: (typeof routeContextGrammar.derivedResult.selections)[number]
  domain: (typeof routeContextGrammar.derivedResult.domains)[number]
}

export type NamespaceCollisionCell = {
  family: `namespace-collision`
  location: (typeof routeContextGrammar.namespaceCollision.locations)[number]
  boundary: (typeof routeContextGrammar.namespaceCollision.boundaries)[number]
  name: (typeof routeContextGrammar.namespaceCollision.names)[number]
}

export type PublicSurfaceCell = {
  family: `public-surface`
  shape: (typeof routeContextGrammar.publicSurface.shapes)[number]
}

export type GrammarCell =
  | ParentProjectionCell
  | CorrelationDomainCell
  | LexicalScopeCell
  | AggregationCell
  | RecursiveSourceCell
  | JoinCell
  | UnionIdentityCell
  | DerivedResultCell
  | NamespaceCollisionCell
  | PublicSurfaceCell
  | PublicFieldCell
  | PublicFieldOverlapCell

// Expand every declared product once. The calibration test below rejects both
// missing cells and duplicate cells.
export const grammarCells: Array<GrammarCell> = [
  ...routeContextGrammar.parentProjection.shapes.map(
    (shape): ParentProjectionCell => ({
      family: `parent-projection`,
      shape,
    }),
  ),
  ...routeContextGrammar.correlationDomain.states.map(
    (state): CorrelationDomainCell => ({
      family: `correlation-domain`,
      state,
    }),
  ),
  ...routeContextGrammar.lexicalScope.scopes.map((scope): LexicalScopeCell => ({
    family: `lexical-scope`,
    scope,
  })),
  ...routeContextGrammar.aggregation.groupings.flatMap((grouping) =>
    routeContextGrammar.aggregation.placements.map(
      (placement): AggregationCell => ({
        family: `aggregation`,
        grouping,
        placement,
      }),
    ),
  ),
  ...routeContextGrammar.recursiveSource.boundaries.flatMap((boundary) =>
    routeContextGrammar.recursiveSource.phases.map(
      (phase): RecursiveSourceCell => ({
        family: `recursive-source`,
        boundary,
        phase,
      }),
    ),
  ),
  ...routeContextGrammar.join.keySides.flatMap((keySide) =>
    routeContextGrammar.join.correlationAttachments.map(
      (correlationAttachment): JoinCell => ({
        family: `join`,
        keySide,
        correlationAttachment,
      }),
    ),
  ),
  ...routeContextGrammar.unionIdentity.forms.map((form): UnionIdentityCell => ({
    family: `union-identity`,
    form,
  })),
  ...routeContextGrammar.derivedResult.boundaries.flatMap((boundary) =>
    routeContextGrammar.derivedResult.selections.flatMap((selection) =>
      routeContextGrammar.derivedResult.domains.map(
        (domain): DerivedResultCell => ({
          family: `derived-result`,
          boundary,
          selection,
          domain,
        }),
      ),
    ),
  ),
  ...routeContextGrammar.namespaceCollision.locations.flatMap((location) =>
    routeContextGrammar.namespaceCollision.boundaries.flatMap((boundary) =>
      routeContextGrammar.namespaceCollision.names.map(
        (name): NamespaceCollisionCell => ({
          family: `namespace-collision`,
          location,
          boundary,
          name,
        }),
      ),
    ),
  ),
  ...publicFieldCells,
  ...publicFieldOverlapCells,
  ...publicFieldOverlapFunctionalCells,
  ...routeContextGrammar.publicSurface.shapes.map(
    (shape): PublicSurfaceCell => ({ family: `public-surface`, shape }),
  ),
]

export function grammarCellName(cell: GrammarCell): string {
  switch (cell.family) {
    case `parent-projection`:
      return `${cell.family} / ${cell.shape}`
    case `correlation-domain`:
      return `${cell.family} / ${cell.state}`
    case `lexical-scope`:
      return `${cell.family} / ${cell.scope}`
    case `aggregation`:
      return `${cell.family} / ${cell.grouping} / ${cell.placement}`
    case `recursive-source`:
      return `${cell.family} / ${cell.boundary} / ${cell.phase}`
    case `join`:
      return `${cell.family} / ${cell.keySide}-side key / ${cell.correlationAttachment}-side correlation`
    case `union-identity`:
      return `${cell.family} / ${cell.form}`
    case `derived-result`:
      return `${cell.family} / ${cell.boundary} / ${cell.selection} / ${cell.domain}`
    case `namespace-collision`:
      return `${cell.family} / ${cell.location} / ${cell.boundary} / ${cell.name}`
    case `public-field`:
      return `${cell.family} / ${String(cell.key)} / ${cell.location} / ${cell.selection} / ${cell.destination}`
    case `public-field-overlap`:
      return `${cell.family} / ${cell.destination} / ${cell.operation} / ${cell.descriptor}`
    case `public-surface`:
      return `${cell.family} / ${cell.shape}`
  }
}

export const materializedInputGrammar = {
  boundaries: [`from-query-ref`, `joined-query-ref`] as const,
  selections: [`expression`, `functional`] as const,
  inputs: [`array`, `materialized`] as const,
  checkpoints: [
    `initial`,
    `parent-move`,
    `child-move`,
    `grandchild-update`,
    `grandchild-empty`,
    `grandchild-reactivation`,
  ] as const,
}

export type MaterializedInputCell = {
  boundary: (typeof materializedInputGrammar.boundaries)[number]
  selection: (typeof materializedInputGrammar.selections)[number]
  input: (typeof materializedInputGrammar.inputs)[number]
}
export type MaterializedInputChild = { id: number; parentGroup: number }
export type MaterializedInputGrandchild = {
  id: number
  childId: number
  label: string
}
export type MaterializedInputRow = MaterializedInputChild & {
  grandchildren: Array<{ id: number; label: string }>
}

export const materializedInputCells =
  materializedInputGrammar.boundaries.flatMap((boundary) =>
    materializedInputGrammar.selections.flatMap((selection) =>
      materializedInputGrammar.inputs.map((input) => ({
        boundary,
        selection,
        input,
      })),
    ),
  )

// The model enumerates the current source rows from independently retained
// facts. A child's membership depends only on its parent's group. Its nested
// array contains exactly the grandchildren naming that child, even when empty.
export function expectedMaterializedInputRows(
  parent: { group: number },
  children: ReadonlyArray<MaterializedInputChild>,
  grandchildren: ReadonlyArray<MaterializedInputGrandchild>,
): Array<MaterializedInputRow> {
  return children
    .filter((child) => child.parentGroup === parent.group)
    .map((child) => ({
      ...child,
      grandchildren: grandchildren
        .filter((grandchild) => grandchild.childId === child.id)
        .map(({ id, label }) => ({ id, label }))
        .sort((left, right) => left.id - right.id),
    }))
    .sort((left, right) => left.id - right.id)
}

export function checkMaterializedInputRows(
  actual: unknown,
  expected: ReadonlyArray<MaterializedInputRow>,
  checkpoint: string,
): void {
  expect(actual, checkpoint).toEqual(expected)
}

export const outerJoinKeyGrammar = (
  [`inner`, `left`, `right`, `full`] as const
).flatMap((join) =>
  [false, true].flatMap((mainRef) =>
    [false, true].flatMap((joinedRef) =>
      ([`numbers`, `strings`, `mixed`] as const).map((keys) => ({
        join,
        mainRef,
        joinedRef,
        keys,
      })),
    ),
  ),
)
export type OuterKeyRow = { id: number; link: number; parentGroup: number }
export function expectedOuterJoinKeyRows(
  mains: ReadonlyArray<OuterKeyRow>,
  children: ReadonlyArray<OuterKeyRow>,
  group: number,
  join: (typeof outerJoinKeyGrammar)[number][`join`],
) {
  return children
    .filter((child) => child.parentGroup === group)
    .flatMap((child) => {
      const matched = mains.filter((main) => main.link === child.link)
      return (
        matched.length
          ? matched
          : join === `right` || join === `full`
            ? [undefined]
            : []
      ).map((main) => ({
        id: child.id,
        mainId: main?.id,
      }))
    })
    .sort((a, b) => a.id - b.id)
}
export function checkOuterJoinKeyRows(
  observed: Iterable<{ id: unknown; mainId: unknown }>,
  expected: ReturnType<typeof expectedOuterJoinKeyRows>,
) {
  expect(
    [...observed]
      .map(({ id, mainId }) => ({ id, mainId }))
      .sort((a, b) => Number(a.id) - Number(b.id)),
  ).toEqual(expected)
}
