import { execFile } from 'node:child_process'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { withTestCleanup } from '../tests/helpers'
import { startLocalBackend } from './local-backend'
import type { TestProject } from 'vitest/node'

const run = promisify(execFile)
const revision = `2fac21e360bfcceae6065096f1b81480bd8c6fd5`
const repository = `https://github.com/get-convex/convex-demos.git`

declare module 'vitest' {
  interface ProvidedContext {
    publicPaginationUrl: string
  }
}

/**
 * Run the actual pinned public demo, without redistributing its unlicensed
 * source. git archive reads the pinned tree, so local edits and untracked
 * files cannot alter the deployed messages/schema functions. The app shell is
 * independently supplied test configuration using this package's Convex SDK.
 */
export default async function setup(project: Pick<TestProject, `provide`>) {
  const directory = await mkdtemp(join(tmpdir(), `convex-public-pagination-`))
  let stop: (() => Promise<void>) | undefined
  try {
    let source = process.env.CONVEX_PUBLIC_DEMOS_SOURCE
    if (source) {
      const head = (
        await run(`git`, [`-C`, source, `rev-parse`, `HEAD`])
      ).stdout.trim()
      if (head !== revision)
        throw new Error(
          `Public pagination source must be pinned to ${revision}`,
        )
    } else {
      source = join(directory, `repository`)
      await run(`git`, [`init`, source])
      await run(`git`, [
        `-C`,
        source,
        `fetch`,
        `--depth=1`,
        repository,
        revision,
      ])
      await run(`git`, [`-C`, source, `checkout`, `--detach`, `FETCH_HEAD`])
    }
    const archive = join(directory, `source.tar`)
    await run(`git`, [
      `-C`,
      source,
      `archive`,
      `--format=tar`,
      `--output=${archive}`,
      revision,
      `pagination/convex`,
    ])
    await run(`tar`, [`-xf`, archive, `-C`, directory])
    const app = join(directory, `pagination`)
    await writeFile(
      join(app, `package.json`),
      JSON.stringify({
        name: `convex-public-pagination-integration`,
        private: true,
        type: `module`,
        dependencies: { convex: `1.47.0` },
      }),
    )
    await symlink(
      fileURLToPath(new URL(`../node_modules`, import.meta.url)),
      join(app, `node_modules`),
      `dir`,
    )
    const backend = await startLocalBackend(pathToFileURL(`${app}/`))
    stop = backend.stop
    project.provide(`publicPaginationUrl`, backend.url)
  } catch (error) {
    await withTestCleanup(
      () => {
        throw error
      },
      async () => {
        await stop?.()
      },
      () => rm(directory, { recursive: true, force: true }),
    )
    throw error
  }
  return () =>
    withTestCleanup(
      () => {},
      async () => {
        await stop()
      },
      () => rm(directory, { recursive: true, force: true }),
    )
}
