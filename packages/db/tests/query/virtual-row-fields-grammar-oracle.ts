/**
 * Shared authoring dimensions for the runtime and public type metadata owners.
 * A projection description names user syntax, never a production classifier.
 * Composition changes where that same syntax is consumed. Each receiver owns
 * its model and legal boundary-specific extensions.
 */
import { declareOracle } from '../oracle-declaration.js'

export const metadataProjectionShapes = [
  `structured-projection`,
  `structured-spread`,
  `functional-projection`,
  `functional-spread`,
  `functional-direct`,
] as const
export const metadataCompositions = [
  `direct`,
  `query-ref`,
  `nested-query-ref`,
  `joined-query-ref`,
  `functional-query-ref`,
  `union`,
  `union-last`,
  `union-query-ref`,
] as const

// Authored collisions are input syntax, not a classification of production
// output. Both booleans distinguish a genuine source flag from an authored one.
export const metadataCollisionCases = [
  `none`,
  `$key`,
  `$hasPendingWrites`,
  `$origin`,
  `$collectionId`,
  `all`,
].flatMap((collision) =>
  (collision === `$hasPendingWrites` || collision === `all`
    ? [false, true]
    : [false]
  ).map((authoredPending) => ({ collision, authoredPending })),
)

declareOracle({
  grammar: [
    metadataProjectionShapes,
    metadataCompositions,
    metadataCollisionCases,
  ],
})
