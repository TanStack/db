// The oracleProperty ids that the declareOracle removal adds for the
// "db-query-includes" conversion group, and their replay owners. Only that group's branch
// edits this file, so parallel groups do not conflict in oracle-config.ts
// or oracle-replay-manifest.ts. Integration folds both lists into those
// files and deletes this directory.
import type { ConvertedOwnerGroup } from './index.js'

export const properties: ReadonlyArray<string> = [
  `includes-space.reachable-facades`,
  `includes-outer-join-route-work.main-correlation`,
  `evaluators.in-original-calibration`,
  `includes-functional-projection.operator`,
  `includes-functional-projection.renamed`,
  `includes-functional-projection.boundary`,
  `includes-optimistic.held-repair`,
  `includes-optimistic.sibling-delivery`,
  `includes-optimistic.failed-cleanup`,
  `includes-optimistic.apply-checkpoint`,
  `includes-optimistic.immediate-route`,
  `includes-cross-formulation.grouped-equality`,
  `includes-cross-formulation.equivalence-fixed`,
  `includes-cross-formulation.ordered-window-cases`,
  `includes-publication.plain-write-checkpoints`,
  `includes-publication.transient-tear`,
  `includes-publication.callback-only-tear`,
  `includes-publication.confirmation-sides`,
  `includes-publication.missing-callbacks`,
  `includes-publication.held-repair`,
  `includes-temporal.readiness-fixed`,
  `includes-temporal.demand-scheduling-orders`,
  `includes-temporal.release-reentry-fixed`,
  `includes-temporal.lagging-source`,
  `includes-query-shape.multiplicity-fixed`,
  `includes-query-shape.correlation-fixed`,
  `includes-query-shape.nullable-fixed`,
]

export const owners: ReadonlyArray<ConvertedOwnerGroup> = [
  [
    `db/tests/query/includes-space-oracle.test.ts`,
    `includes-space`,
    `reachable-facades`,
  ],
  [
    `db/tests/query/includes-outer-join-route-work-oracle.test.ts`,
    `includes-outer-join-route-work`,
    `main-correlation`,
  ],
  [
    `db/tests/query/compiler/in-evaluator-oracle.property.test.ts`,
    `evaluators`,
    `in-original-calibration`,
  ],
  [
    `db/tests/query/includes-functional-projection-oracle.test.ts`,
    `includes-functional-projection`,
    `operator renamed boundary`,
  ],
  [
    `db/tests/query/includes-optimistic-oracle.property.test.ts`,
    `includes-optimistic`,
    `held-repair sibling-delivery failed-cleanup apply-checkpoint immediate-route`,
  ],
  [
    `db/tests/query/includes-cross-formulation-oracle.property.test.ts`,
    `includes-cross-formulation`,
    `grouped-equality equivalence-fixed ordered-window-cases`,
  ],
  [
    `db/tests/query/includes-publication-oracle.test.ts`,
    `includes-publication`,
    `plain-write-checkpoints transient-tear callback-only-tear confirmation-sides missing-callbacks held-repair`,
  ],
  [
    `db/tests/query/includes-temporal-oracle.test.ts`,
    `includes-temporal`,
    `readiness-fixed demand-scheduling-orders release-reentry-fixed lagging-source`,
  ],
  [
    `db/tests/query/includes-query-shape-oracle.test.ts`,
    `includes-query-shape`,
    `multiplicity-fixed correlation-fixed nullable-fixed`,
  ],
]
