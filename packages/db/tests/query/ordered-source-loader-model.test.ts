// Grammar check for ordered-source-loader-oracle.test.ts. It runs no
// production: it checks that the boundary-by-demand grammar names each cell
// once. The grammar is in ordered-source-loader-model-oracle.ts.
import { describe, expect, it } from 'vitest'
import { stagedWindowCases } from './ordered-source-loader-model-oracle.js'

describe(`OrderedSourceLoader`, () => {
  it(`enumerates every staged-boundary explicit-window cell exactly once`, () => {
    const keys = stagedWindowCases.map(
      ({ boundary, demand }) => `${boundary}:${demand}`,
    )

    expect(stagedWindowCases).toHaveLength(4)
    expect(new Set(keys).size).toBe(4)
  })
})
