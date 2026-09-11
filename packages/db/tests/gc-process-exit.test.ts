// @vitest-environment node
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it(`allows Node to exit with unused eagerly synced collections`, async () => {
  const packageRoot = fileURLToPath(new URL(`..`, import.meta.url))
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      `--import`,
      `tsx`,
      `--input-type=module`,
      `-e`,
      `import { createCollection } from './src/collection/index.ts';
       createCollection({
         getKey: row => row.id,
         startSync: true,
         sync: { sync: ({ markReady }) => markReady() },
       });
       console.log('finished');`,
    ],
    {
      cwd: packageRoot,
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: `${packageRoot}/tsconfig.json`,
      },
      timeout: 3000,
    },
  )
  expect(stdout.trim()).toBe(`finished`)
})
