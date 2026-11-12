// Exact index identity membership is determined by live source descriptors.
import { expect } from 'vitest'
import { oracleAssertion } from './oracle-assertion-adapter'
import type { BaseIndex } from '../src/indexes/base-index.js'

type GroupRow<T> = Readonly<{ key: string; value: T; groupId: number }>

// groupId is a model-only label for values equal under the comparator. The
// production index receives value objects and a comparator, not this label.
// Handles preserve exact identity; expected memberships come only from live
// descriptors. Keep retired handles so a stale bucket cannot leave the query set.
export function expectExactIdentities<T>(
  index: Pick<BaseIndex<string>, `equalityLookup`>,
  rows: ReadonlyArray<GroupRow<T>>,
  identities: ReadonlyArray<T>,
): void {
  for (const value of identities) {
    oracleAssertion('expectExactIdentities', () =>
      expect(index.equalityLookup(value)).toEqual(
        new Set(
          rows.filter((row) => row.value === value).map((row) => row.key),
        ),
      ),
    )
  }
}
