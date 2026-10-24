import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { startLocalBackend } from '../local-backend'
import { withTestCleanup } from '../../tests/helpers'
import { prepareAuthApp } from './prepare'
import { authEnvironment } from './configure'
import type { TestProject } from 'vitest/node'

const run = promisify(execFile)
const upstream = `https://github.com/get-convex/convex-auth-with-role-based-permissions.git`
const revision = `45f08008e1257758560948db4280cc4e7d64e84a`

/** The provider issues genuine JWTs, no client is given deployment admin auth. */
export default async function setup(project: TestProject) {
  const checkout = await mkdtemp(join(tmpdir(), `convex-auth-upstream-`))
  let stop: (() => Promise<void>) | undefined
  const runtime = fileURLToPath(new URL(`./runtime/`, import.meta.url))
  try {
    await run(`git`, [`init`, checkout])
    await run(`git`, [`-C`, checkout, `remote`, `add`, `origin`, upstream])
    await run(`git`, [`-C`, checkout, `fetch`, `--depth=1`, `origin`, revision])
    await run(`git`, [`-C`, checkout, `checkout`, `--detach`, `FETCH_HEAD`])
    const { stdout } = await run(`git`, [`-C`, checkout, `rev-parse`, `HEAD`])
    if (stdout.trim() !== revision)
      throw new Error(`Wrong upstream auth revision`)
    await prepareAuthApp(checkout)
    const backend = await startLocalBackend(pathToFileURL(`${runtime}/`), 43330)
    stop = backend.stop
    if (!backend.url.startsWith(`http://127.0.0.1:`))
      throw new Error(`Authentication setup requires an isolated local backend`)
    const {
      CONVEX_DEPLOY_KEY: _key,
      CONVEX_SELF_HOSTED_URL: _url,
      CONVEX_SELF_HOSTED_ADMIN_KEY: _admin,
      CONVEX_DEPLOYMENT: _deployment,
      ...environment
    } = process.env
    const cli = fileURLToPath(
      new URL(`./node_modules/convex/bin/main.js`, import.meta.url),
    )
    for (const [name, value] of Object.entries(await authEnvironment())) {
      try {
        await run(process.execPath, [cli, `env`, `set`, name, `--`, value], {
          cwd: runtime,
          env: environment,
        })
      } catch {
        // execFile errors contain argv, which contains the ephemeral private key.
        throw new Error(
          `Failed to configure local authentication variable ${name}`,
        )
      }
    }
    project.provide(`authAppUrl`, backend.url)
  } catch (cause) {
    await withTestCleanup(
      () => {
        throw cause
      },
      () => stop?.(),
      () => rm(checkout, { recursive: true, force: true }),
      () => rm(runtime, { recursive: true, force: true }),
    )
  }
  return async () =>
    withTestCleanup(
      () => {},
      () => stop?.(),
      () => rm(checkout, { recursive: true, force: true }),
      () => rm(runtime, { recursive: true, force: true }),
    )
}
