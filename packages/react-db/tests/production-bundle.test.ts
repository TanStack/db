// @vitest-environment node
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

// Development warnings must cost nothing in production. An app's bundler
// replaces `process.env.NODE_ENV` with `"production"` and drops code behind a
// condition that is then always false. A gate that only a runtime call
// decides keeps the warning code in every production bundle, even though it
// never runs. This bundles the adapter as an app's production build would and
// checks that no warning text survives.
describe(`react-db production bundle`, () => {
  it(`contains no development warning code`, async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL(`../src/index.ts`, import.meta.url))],
      bundle: true,
      minify: true,
      write: false,
      format: `esm`,
      platform: `browser`,
      packages: `external`,
      // The repo's tsconfig paths would inline workspace packages.
      tsconfigRaw: `{}`,
      logLevel: `error`,
      define: { 'process.env.NODE_ENV': `"production"` },
    })
    const code = result.outputFiles[0]!.text
    // The gate's own call stays, so its environment variable names may
    // remain; the warnings' bodies and messages may not.
    for (const text of [
      `Deriving live query identity from structured`,
      `This query cannot derive a stable identity`,
      `Passing a collection with syncMode`,
    ]) {
      expect(code.includes(text), text).toBe(false)
    }
  })
})
