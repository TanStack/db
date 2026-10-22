import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  interface ProvidedContext {
    convexUrl: string
  }
}

/** Own a dedicated local backend for the test run. Never select a cloud project. */
export default async function setup(project: TestProject) {
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
      `--typecheck`,
      `disable`,
      `--tail-logs`,
      `disable`,
      `--local-cloud-port`,
      process.env.CONVEX_TEST_PORT ?? `43310`,
      `--local-site-port`,
      String(Number(process.env.CONVEX_TEST_PORT ?? `43310`) + 1),
    ],
    {
      cwd: fileURLToPath(new URL(`./backend`, import.meta.url)),
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
    const env = await readFile(
      new URL(`./backend/.env.local`, import.meta.url),
      `utf8`,
    )
    const url = /^CONVEX_URL=(.+)$/m.exec(env)?.[1]
    if (!url?.startsWith(`http://127.0.0.1:`))
      throw new Error(`Expected an isolated loopback Convex backend`)
    project.provide(`convexUrl`, url)
  } catch (cause) {
    backend.kill(`SIGINT`)
    throw cause
  }
  return async () => {
    const exited = new Promise<void>((resolve) =>
      backend.once(`exit`, () => resolve()),
    )
    backend.kill(`SIGINT`)
    await exited
  }
}
