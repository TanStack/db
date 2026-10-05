// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { transformSync } from 'esbuild'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shouldWarnInDevelopment } from '../src/development'

const source = readFileSync(
  new URL(`../src/development.ts`, import.meta.url),
  `utf8`,
)

// Evaluates the module as a browser bundle would: `NODE_ENV` inlined by the
// bundler, or left alone, and no `process` global.
function inBrowser(
  nodeEnv: string | undefined,
  // Globals of the page, such as a `process` shim from another library.
  globals: Record<string, unknown> = {},
): (name: string) => boolean {
  const { code } = transformSync(source, {
    loader: `ts`,
    format: `cjs`,
    define:
      nodeEnv === undefined
        ? {}
        : { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) },
  })
  const bundle = { exports: {} as Record<string, unknown> }
  runInContext(
    code,
    createContext({ ...globals, module: bundle, exports: bundle.exports }),
  )
  return bundle.exports.shouldWarnInDevelopment as (name: string) => boolean
}

describe(`development warnings`, () => {
  afterEach(() => vi.unstubAllEnvs())

  it(`warn in a browser development bundle without a process global`, () => {
    expect(inBrowser(`development`)(`DISABLE`)).toBe(true)
  })

  it(`stay on when a page's process shim has no env`, () => {
    expect(inBrowser(`development`, { process: {} })(`DISABLE`)).toBe(true)
  })

  it(`stay off in a browser production bundle or without a bundler`, () => {
    expect(inBrowser(`production`)(`DISABLE`)).toBe(false)
    expect(inBrowser(undefined)(`DISABLE`)).toBe(false)
  })

  it(`honor the disable variable and production under Node`, () => {
    vi.stubEnv(`NODE_ENV`, `development`)
    expect(shouldWarnInDevelopment(`DISABLE`)).toBe(true)
    vi.stubEnv(`DISABLE`, `1`)
    expect(shouldWarnInDevelopment(`DISABLE`)).toBe(false)
    vi.unstubAllEnvs()
    vi.stubEnv(`NODE_ENV`, `production`)
    expect(shouldWarnInDevelopment(`DISABLE`)).toBe(false)
  })
})
