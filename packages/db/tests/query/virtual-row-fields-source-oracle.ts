import { declareOracle } from '../oracle-declaration.js'

/**
 * Source metadata is a source fact, separate from output-row attribution.
 * VirtualRowProps supplies the authored key and Collection ID. An optimistic
 * snapshot is pending and local; otherwise the applied source row supplies its
 * origin. VirtualOrigin and optimistic-history-oracle own how settlement sets
 * that applied origin. This small judgment does not choose an output owner,
 * reconstruct a sync queue, or assign metadata to an Effect result object.
 */
export function expectedSourceMetadata(
  key: string | number,
  collectionId: string,
  pending: boolean,
  appliedOrigin: `local` | `remote` = `remote`,
) {
  return {
    $key: key,
    $collectionId: collectionId,
    $hasPendingWrites: pending,
    $origin: pending ? (`local` as const) : appliedOrigin,
  }
}

declareOracle({ model: [expectedSourceMetadata] })
