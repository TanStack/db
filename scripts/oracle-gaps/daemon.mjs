// The gap report's daemon: one process per package that keeps a check
// session warm (check.mjs) and its evidence store on disk (evidence.mjs), so
// an author who checks hundreds of times pays Vitest's startup once and reruns
// only the units whose inputs changed. A check through the daemon reports
// what a cold run reports (the CLI oracle's law 9).
//
// The CLI talks to it over a Unix socket named by the package's path. Each
// request is one line of JSON, the CLI's arguments; the reply is one line of
// JSON with the exit code and the output a cold run would have printed. One
// check runs at a time. The daemon exits when asked, or after 30 idle
// minutes.
//
// Usage (the CLI starts it): node scripts/oracle-gaps/daemon.mjs --package <dir>
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, openSync, realpathSync, rmSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const idleMs = 30 * 60_000

/** The socket of a package's daemon. A socket path must stay short. */
export const socketOf = (pkg) =>
  join(
    tmpdir(),
    `oracle-gaps-${createHash(`sha1`).update(pkg).digest(`hex`).slice(0, 12)}.sock`,
  )
/** Where a package's daemon keeps its evidence and its log. */
export const stateDirOf = (pkg) => join(pkg, `.oracle-gaps`)

function send(pkg, message) {
  return new Promise((resolvePromise, reject) => {
    const socket = connect(socketOf(pkg))
    let reply = ``
    socket.on(`connect`, () => socket.write(`${JSON.stringify(message)}\n`))
    socket.on(`data`, (chunk) => {
      reply += chunk
    })
    socket.on(`end`, () => {
      try {
        resolvePromise(JSON.parse(reply))
      } catch (error) {
        reject(error)
      }
    })
    socket.on(`error`, reject)
  })
}

/** Sends a check to the package's daemon, starting the daemon if needed. */
export async function requestDaemon(pkg, argv) {
  try {
    return await send(pkg, { argv, cwd: process.cwd() })
  } catch (error) {
    if (![`ENOENT`, `ECONNREFUSED`].includes(error.code)) throw error
  }
  mkdirSync(stateDirOf(pkg), { recursive: true })
  const log = openSync(join(stateDirOf(pkg), `daemon.log`), `a`)
  spawn(process.execPath, [join(here, `daemon.mjs`), `--package`, pkg], {
    detached: true,
    stdio: [`ignore`, log, log],
  }).unref()
  for (let waited = 0; ; waited += 100) {
    await new Promise((r) => setTimeout(r, 100))
    try {
      return await send(pkg, { argv, cwd: process.cwd() })
    } catch (error) {
      if (![`ENOENT`, `ECONNREFUSED`].includes(error.code) || waited > 60_000)
        throw error
    }
  }
}

/** Stops the package's daemon, if one runs, after its current check. */
export async function stopDaemon(pkg) {
  try {
    await send(pkg, { stop: true })
  } catch (error) {
    if (![`ENOENT`, `ECONNREFUSED`].includes(error.code)) throw error
  }
}

async function serve(pkg) {
  const { openSession } = await import(`./check.mjs`)
  const { diskStore } = await import(`./evidence.mjs`)
  const { parseArgs } = await import(`./args.mjs`)
  const store = await diskStore(stateDirOf(pkg))
  const session = await openSession(pkg)
  const socket = socketOf(pkg)
  rmSync(socket, { force: true })
  let queue = Promise.resolve()
  let idle
  const server = createServer((connection) => {
    let request = ``
    connection.on(`data`, (chunk) => {
      request += chunk
      if (!request.includes(`\n`)) return
      const message = JSON.parse(request)
      queue = queue.then(async () => {
        clearTimeout(idle)
        // The reply waits until the daemon has closed, so a daemon started
        // next finds the evidence on disk and no warm context in its way.
        if (message.stop) await shutdown(connection)
        const stderr = []
        let stdout = ``
        let exitCode = 0
        try {
          // Paths are the caller's, so they resolve against its directory.
          const options = parseArgs(message.argv, message.cwd)
          if (options.pkg !== pkg)
            throw new Error(`this daemon serves ${pkg}, not ${options.pkg}`)
          stdout = `${await session.check(options, store, (line) => stderr.push(`${line}\n`))}\n`
        } catch (error) {
          stderr.push(`${error?.stack ?? error}\n`)
          exitCode = 1
        }
        connection.end(
          `${JSON.stringify({ exitCode, stdout, stderr: stderr.join(``) })}\n`,
        )
        idle = setTimeout(() => {
          queue = queue.then(() => shutdown())
        }, idleMs)
      })
    })
  })
  async function shutdown(connection) {
    server.close()
    rmSync(socket, { force: true })
    await session.close()
    await store.close()
    if (connection)
      await new Promise((r) =>
        connection.end(`${JSON.stringify({ exitCode: 0 })}\n`, r),
      )
    process.exit(0)
  }
  server.listen(socket)
  idle = setTimeout(() => {
    queue = queue.then(() => shutdown())
  }, idleMs)
}

if (import.meta.url === `file://${realpathSync(process.argv[1])}`) {
  const at = process.argv.indexOf(`--package`)
  await serve(realpathSync(resolve(process.argv[at + 1])))
}
