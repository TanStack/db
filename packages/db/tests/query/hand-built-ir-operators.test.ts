import { describe, expect, it } from 'vitest'
import {
  Query,
  count,
  createCollection,
  groupingCompiler,
  include,
  includesRuntime,
} from '../../src/index.js'
import { mockSyncCollectionOptions } from '../utils.js'

// Code that builds query IR by hand passes operator code to `IR.Aggregate`
// and `IR.IncludesSubquery`. The public entry exports that code, and it must
// be the same value the operator functions carry, so hand-built and
// builder-built IR compile the same way.
describe(`operator code for hand-built IR`, () => {
  it(`exports the grouping compiler that aggregates carry`, () => {
    expect(groupingCompiler).toBe(count(1).grouping)
  })

  it(`exports the include runtime that include() carries`, () => {
    const issues = createCollection(
      mockSyncCollectionOptions<{ id: number }>({
        id: `hand-built-ir-issues`,
        getKey: (issue) => issue.id,
        initialData: [],
      }),
    )
    expect(includesRuntime).toBe(
      include(new Query().from({ i: issues })).runtime,
    )
  })
})
