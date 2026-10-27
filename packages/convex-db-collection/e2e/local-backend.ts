import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { withTestCleanup } from '../tests/helpers'

/** Own a dedicated local backend for the test run. Never select a cloud project. */
export async function startLocalBackend(directory: URL, port?: number) {
  const {
    CONVEX_DEPLOY_KEY: _deployKey,
    CONVEX_SELF_HOSTED_URL: _selfHostedUrl,
    CONVEX_SELF_HOSTED_ADMIN_KEY: _adminKey,
    CONVEX_DEPLOYMENT: _deployment,
    ...environment
  } = process.env
  const backend = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL(`../node_modules/convex/bin/main.js`, import.meta.url),
      ),
      `dev`,
      ...(process.env.CONVEX_TEST_BACKEND_VERSION
        ? [`--local-backend-version`, process.env.CONVEX_TEST_BACKEND_VERSION]
        : []),
      `--typecheck`,
      `disable`,
      `--tail-logs`,
      `disable`,
      ...(port === undefined
        ? []
        : [
            `--local-cloud-port`,
            String(port),
            `--local-site-port`,
            String(port + 1),
          ]),
    ],
    {
      cwd: fileURLToPath(directory),
      env: { ...environment, CONVEX_AGENT_MODE: `anonymous`, FORCE_COLOR: `0` },
      stdio: [`ignore`, `pipe`, `pipe`],
    },
  )
  let output = ``
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Local Convex startup timed out:\n${output}`)),
        120000,
      )
      const receive = (chunk: Buffer) => {
        output = (output + String(chunk)).slice(-8000)
        if (output.includes(`Convex functions ready!`)) {
          clearTimeout(timeout)
          resolve()
        }
      }
      backend.stdout.on(`data`, receive)
      backend.stderr.on(`data`, receive)
      backend.once(`error`, (cause) => {
        clearTimeout(timeout)
        reject(cause)
      })
      backend.once(`exit`, (code) => {
        clearTimeout(timeout)
        reject(new Error(`Local Convex exited (${code}):\n${output}`))
      })
    })
    const env = await readFile(new URL(`.env.local`, directory), `utf8`)
    const url = /^CONVEX_URL=(.+)$/m.exec(env)?.[1]
    if (
      !url ||
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(url) ||
      (port !== undefined && url !== `http://127.0.0.1:${port}`)
    )
      throw new Error(`Expected an isolated loopback Convex backend`)
    return { url, stop }
  } catch (cause) {
    await withTestCleanup(() => {
      throw cause
    }, stop)
    throw cause
  }
  async function stop() {
    if (backend.exitCode !== null || backend.signalCode !== null) return
    const exited = new Promise<void>((resolve) =>
      backend.once(`exit`, () => resolve()),
    )
    backend.kill(`SIGINT`)
    await exited
  }
}
