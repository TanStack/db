// The sync metadata session's named witnesses, moved unchanged out of
// sync-metadata-session-oracle.property.test.ts so that its model-only witness
// check in sync-metadata-session.test.ts can import them without importing the
// oracle file. The oracle file replays each witness through production. It
// registers no tests.
import {
  flatGrammar,
  nestedGrammar,
  nestedSeedGrammar,
  seedFullGrammar,
  seedGrammar,
} from './sync-metadata-session-oracle.js'
import type {
  SessionAction,
  SessionGrammar,
} from './sync-metadata-session-oracle.js'

// ---------------------------------------------------------------------------
// Named witnesses
// ---------------------------------------------------------------------------

const a = (
  type: SessionAction[`type`],
  key?: number | string,
  metadata?: boolean,
) =>
  ({
    type,
    ...(key === undefined ? {} : { key }),
    ...(metadata === undefined ? {} : { metadata }),
  }) as SessionAction

/**
 * Each witness reaches one law's premise. The model expectations below are
 * derived by hand from the laws, so they also check the model against the
 * wrong answers that production gives on `30175be48`.
 */
export const witnesses = {
  // A later seed beneath an open re-insert does not change its kind, but a
  // source update that merges over that seed and commits ahead does: the
  // re-insert then lands on a different row (decision 10).
  lateSeedUnderMergedUpdate: {
    grammar: nestedSeedGrammar,
    history: [
      a(`seed`, 1),
      a(`begin`),
      a(`upsert`, 1, true),
      a(`reinsert`, 1, false),
      a(`begin`),
      { type: `seed`, key: 1, bare: true },
      a(`upsert`, 1, false),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // The same under a hold: the inner commit stays accepted but unapplied, so
  // the seed still marks the row.
  heldLateSeedUnderMergedUpdate: {
    grammar: nestedSeedGrammar,
    history: [
      a(`hold`),
      a(`seed`, 1),
      a(`begin`),
      a(`upsert`, 1, true),
      a(`reinsert`, 1, false),
      a(`begin`),
      { type: `seed`, key: 1, bare: true },
      a(`upsert`, 1, false),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // Issue #2220: a held earlier write must stay visible after a later commit.
  heldCursor: {
    grammar: flatGrammar,
    history: [
      a(`hold`),
      a(`begin`),
      { type: `collectionSet`, key: `cursor` },
      a(`commit`),
      a(`begin`),
      a(`upsert`, 1, false),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // The open transaction overlays every held one, not only the newest.
  openOverHeld: {
    grammar: flatGrammar,
    history: [
      a(`hold`),
      a(`begin`),
      a(`rowSet`, 1),
      { type: `collectionSet`, key: `gc:a` },
      a(`commit`),
      a(`begin`),
    ] as Array<SessionAction>,
  },
  // Independent transactions: an outer abort keeps an inner commit.
  outerAbortKeepsInnerCommit: {
    grammar: nestedGrammar,
    history: [
      a(`begin`),
      a(`begin`),
      a(`upsert`, 1, true),
      a(`commit`),
      a(`cancel`),
    ] as Array<SessionAction>,
  },
  // Commit order: the outer transaction commits after the inner one, so its
  // earlier write wins, and a hold does not change that order.
  commitOrderDuringHold: {
    grammar: nestedGrammar,
    history: [
      a(`hold`),
      a(`begin`),
      a(`rowSet`, 1),
      a(`begin`),
      a(`rowSet`, 1),
      a(`commit`),
      a(`commit`),
      a(`release`),
    ] as Array<SessionAction>,
  },
  // During a hold, the outer transaction can still write and commit after an
  // inner one commits.
  outerContinuesAfterInnerDuringHold: {
    grammar: nestedGrammar,
    history: [
      a(`hold`),
      a(`begin`),
      a(`begin`),
      a(`rowSet`, 1),
      a(`commit`),
      a(`rowSet`, 2),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // An inner truncate applies at its own commit, at once despite a hold.
  innerTruncateAppliesAtItsCommit: {
    grammar: nestedGrammar,
    history: [
      a(`begin`),
      a(`upsert`, 1, true),
      a(`commit`),
      a(`hold`),
      a(`begin`),
      a(`begin`),
      a(`truncate`),
      a(`commit`),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // A seed that arrives under an open update changes the update's merge base,
  // but never makes the source's equal re-insert a duplicate, and the
  // re-insert still replaces the row: the late seed's extra field goes.
  seedUnderOpenReinsert: {
    grammar: seedGrammar,
    history: [
      a(`begin`),
      { type: `seed`, key: 1, narrow: true, bare: true },
      a(`upsert`, 1, false),
      a(`reinsert`, 1, false),
      { type: `seed`, key: 1, bare: true },
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // A seed never supersedes a source metadata write on a row the source did not write.
  seedUnderMetadataOnlyWrite: {
    grammar: seedGrammar,
    history: [
      a(`begin`),
      a(`rowSet`, 1),
      a(`commit`),
      a(`seed`, 1),
    ] as Array<SessionAction>,
  },
  // A seed arriving under the source's open insert sits beneath it: the
  // insert replaces the seeded row and clears its metadata. Consumers see the
  // seed until the insert's transaction applies.
  seedUnderOpenInsert: {
    grammar: seedGrammar,
    history: [
      a(`begin`),
      a(`upsert`, 1, false),
      a(`seed`, 1),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // The same history with the insert committed before the seed arrives: the
  // outcome does not depend on arrival order.
  seedAfterCommittedInsert: {
    grammar: seedGrammar,
    history: [
      a(`begin`),
      a(`upsert`, 1, false),
      a(`commit`),
      a(`seed`, 1),
    ] as Array<SessionAction>,
  },
  // A source insert equal to a seeded row is still an insert: the source never
  // wrote the row, so the insert names its metadata and clears the seed's.
  equalInsertOverSeed: {
    grammar: seedGrammar,
    history: [
      a(`seed`, 1),
      a(`begin`),
      a(`reinsert`, 1, false),
    ] as Array<SessionAction>,
  },
  // The latest seed of a row no source write has written wins whole, so a
  // narrow seed drops the earlier seed's other field.
  laterSeedReplacesSeed: {
    grammar: seedGrammar,
    history: [
      a(`seed`, 1),
      { type: `seed`, key: 1, narrow: true },
    ] as Array<SessionAction>,
  },
  // Once the source has updated a seeded row, a later seed is ignored for the
  // row's data; the update wrote no metadata, so the late seed supplies it.
  partialUpdateThenLateSeed: {
    grammar: seedGrammar,
    history: [
      a(`seed`, 1),
      a(`begin`),
      a(`upsert`, 1, false),
      a(`commit`),
      { type: `seed`, key: 1, narrow: true },
    ] as Array<SessionAction>,
  },
  // The latest seed wins whole: a later seed without metadata leaves none.
  bareLaterSeedClearsMetadata: {
    grammar: seedGrammar,
    history: [
      a(`seed`, 1),
      { type: `seed`, key: 1, bare: true },
    ] as Array<SessionAction>,
  },
  // A fresh source insert over a row only a seed supplied replaces the row
  // and, naming no metadata, clears the seed's.
  insertOverSeedReplaces: {
    grammar: seedGrammar,
    history: [
      a(`seed`, 1),
      a(`begin`),
      a(`insertOverSeed`, 1, false),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // A source update merges over a seeded row under partial row updates, so the
  // seed's other field and its metadata stay.
  updateOverSeed: {
    grammar: seedGrammar,
    history: [
      a(`seed`, 1),
      a(`begin`),
      a(`upsert`, 1, false),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // Under full row updates the update replaces the seeded row; its metadata
  // stays, because the update names none.
  updateOverSeedFullRows: {
    grammar: seedFullGrammar,
    history: [
      a(`seed`, 1),
      a(`begin`),
      a(`upsert`, 1, false),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // An open truncate hides a held row write: a row read stops at the truncate.
  openTruncateHidesHeldRow: {
    grammar: flatGrammar,
    history: [
      a(`hold`),
      a(`begin`),
      a(`rowSet`, 1),
      a(`commit`),
      a(`begin`),
      a(`truncate`),
    ] as Array<SessionAction>,
  },
  // An open delete hides a held collection entry from `list()`.
  openDeleteHidesHeldListEntry: {
    grammar: flatGrammar,
    history: [
      a(`hold`),
      a(`begin`),
      a(`collectionSet`, `gc:a`),
      a(`commit`),
      a(`begin`),
      a(`collectionDelete`, `gc:a`),
    ] as Array<SessionAction>,
  },
  // `list('gc:')` includes the key equal to the prefix and excludes `gc`.
  prefixBoundary: {
    grammar: flatGrammar,
    history: [
      a(`begin`),
      a(`collectionSet`, `gc`),
      a(`collectionSet`, `gc:`),
    ] as Array<SessionAction>,
  },
  // Under full row updates a held update replaces the row, so a later insert
  // of the updated row is an equal re-insert, not a duplicate. A classifier
  // that merged the held update would keep the inserted row's field `m`.
  fullUpdateThenEqualInsertDuringHold: {
    grammar: seedFullGrammar,
    history: [
      a(`begin`),
      a(`upsert`, 1, true),
      a(`commit`),
      a(`hold`),
      a(`begin`),
      a(`upsert`, 1, false),
      a(`commit`),
      a(`begin`),
      a(`reinsert`, 1, false),
    ] as Array<SessionAction>,
  },
} satisfies Record<
  string,
  { grammar: SessionGrammar; history: Array<SessionAction> }
>
