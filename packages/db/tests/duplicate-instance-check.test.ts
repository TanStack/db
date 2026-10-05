// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { transformSync } from 'esbuild'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL(`../src/duplicate-instance-check.ts`, import.meta.url),
  `utf8`,
)

class DuplicateDbInstanceError extends Error {}

// Loads the check twice in one browser top window, as two bundled copies of
// the package would: `define` is what the bundler inlines, and the window
// has no `process` global.
function loadTwice(define: Record<string, string>): unknown {
  const { code } = transformSync(source, {
    loader: `ts`,
    format: `cjs`,
    define,
  })
  const window: Record<string, unknown> = { document: {} }
  window.top = window
  const context = createContext({ window })
  // Each copy runs in its own module scope, sharing the window's globals.
  const load = runInContext(
    `(function (module, exports, require) {\n${code}\n})`,
    context,
  ) as (
    module: { exports: object },
    exports: object,
    require: () => object,
  ) => void
  try {
    for (let copy = 0; copy < 2; copy++) {
      const bundle = { exports: {} }
      load(bundle, bundle.exports, () => ({ DuplicateDbInstanceError }))
    }
  } catch (error) {
    return error
  }
  return undefined
}

describe(`duplicate @tanstack/db instance check`, () => {
  it(`rejects a second copy in a browser development bundle`, () => {
    expect(
      loadTwice({ 'process.env.NODE_ENV': `"development"` }),
    ).toBeInstanceOf(DuplicateDbInstanceError)
  })

  it(`stays off in production, when disabled, and without a bundler`, () => {
    expect(
      loadTwice({ 'process.env.NODE_ENV': `"production"` }),
    ).toBeUndefined()
    expect(
      loadTwice({
        'process.env.NODE_ENV': `"development"`,
        'process.env.TANSTACK_DB_DISABLE_DUP_CHECK': `"1"`,
      }),
    ).toBeUndefined()
    expect(loadTwice({})).toBeUndefined()
  })
})
