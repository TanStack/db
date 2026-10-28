/**
 * Client-only query bindings must not ship SSR admission or snapshot capture.
 * Authority: the maintainer's 2026-10-26 decision that SSR fixes have no code
 * cost for applications that do not use SSR. The reference judgment depends
 * only on whether the application imports DbClient, never on observer internals.
 *
 * These finite consumer programs cross ordinary, Suspense and infinite React
 * hooks. esbuild consumes built ESM and minifies the consumer with production
 * defines. Every aliased package must be rebuilt after its source changes.
 * At the final bundle checkpoint, SSR transport operations must be absent from
 * plain programs and present in DbClient controls. The controls prevent an
 * empty bundle or a misspelled operation from giving a false green. This checks
 * code inclusion, not SSR correctness, byte budgets, or every consumer bundler.
 * DbClient is the current opt-in boundary. A browser app using DbClient only
 * for collection descriptors still retains transport; this check does not claim
 * to isolate that case without a separate SSR API.
 * Existing framework hydration oracles continue to own runtime behavior.
 */
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { assertPackageDistFresh } from '../packages/db/scripts/assert-dist-fresh.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packages = ['db', 'db-ivm', 'react-db']
const ssrOperations = ['_captureServerQuery', '_hasSsrCollectionSnapshot']
const calibrate = process.argv.includes('--calibrate')
await Promise.all(packages.map((pkg) => assertPackageDistFresh(root, pkg)))

// Importing a hook creates no SSR capability. Explicitly importing DbClient
// retains its transport implementation; the positive control needs every
// operation to remain visible after the same minifier and public-name rules.
for (const hook of [
  'useLiveQuery',
  'useLiveSuspenseQuery',
  'useLiveInfiniteQuery',
]) {
  for (const transport of [false, true]) {
    const result = await build({
      stdin: {
        contents: `export { ${hook} } from '@tanstack/react-db';\n${transport || calibrate ? `export { DbClient } from '@tanstack/db';` : ''}`,
        resolveDir: root,
      },
      alias: Object.fromEntries(
        packages.map((pkg) => [
          `@tanstack/${pkg}`,
          join(root, 'packages', pkg, 'dist/esm/index.js'),
        ]),
      ),
      bundle: true,
      minify: true,
      write: false,
      metafile: true,
      platform: 'browser',
      format: 'esm',
      external: ['react', 'react-dom'],
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'error',
    })
    const code = result.outputFiles[0].text
    assert.ok(
      code.length > 1000,
      `${hook}: the consumer entry reached production`,
    )
    for (const operation of ssrOperations) {
      assert.equal(
        code.includes(operation),
        transport,
        `${hook} ${transport ? 'DbClient control must retain' : 'client-only bundle must exclude'} ${operation}`,
      )
    }
    // bytesInOutput distinguishes code that ships from inputs the bundler
    // traversed and then discarded. Merely checking the input graph is weaker.
    const transportBytes = Object.values(result.metafile.outputs).reduce(
      (total, output) =>
        total +
        Object.entries(output.inputs).reduce(
          (bytes, [file, input]) =>
            bytes +
            (file.endsWith('/live-query-observer-client.js')
              ? input.bytesInOutput
              : 0),
          0,
        ),
      0,
    )
    assert.equal(
      transportBytes > 0,
      transport,
      `${hook}: observer transport implementation inclusion`,
    )
    console.log(
      `${hook}: ${transport ? 'transport retained' : 'SSR policy excluded'}`,
    )
  }
}
