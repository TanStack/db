import { createServer } from 'node:http'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn } from 'node:child_process'

type TauriE2ERunResult =
  | {
      kind: `result`
      status: `passed`
      payload: unknown
    }
  | {
      kind: `result`
      status: `failed`
      payload: unknown
    }

function isTauriE2ERunResult(
  value:
    | TauriE2ERunResult
    | { kind: `status`; phase: string; details?: unknown }
    | null,
): value is TauriE2ERunResult {
  return value?.kind === `result`
}

function createOutputCollector() {
  let output = ``

  return {
    append(chunk: string | Buffer) {
      output += chunk.toString()
      if (output.length > 20_000) {
        output = output.slice(-20_000)
      }
    },
    getOutput() {
      return output
    },
  }
}

export async function runTauriPersistedCollectionE2E(options?: {
  timeoutMs?: number
}): Promise<TauriE2ERunResult> {
  const timeoutMs = options?.timeoutMs ?? 180_000
  const runId = Date.now().toString(36)
  const appDirectory = join(process.cwd(), `e2e`, `app`)
  let latestMessage:
    | TauriE2ERunResult
    | {
        kind: `status`
        phase: string
        details?: unknown
      }
    | null = null

  const reportServer = createServer((request, response) => {
    response.setHeader(`Access-Control-Allow-Origin`, `*`)
    response.setHeader(`Access-Control-Allow-Methods`, `POST, OPTIONS`)
    response.setHeader(`Access-Control-Allow-Headers`, `content-type`)

    if (request.method === `OPTIONS`) {
      response.statusCode = 204
      response.end()
      return
    }

    if (request.method !== `POST`) {
      response.statusCode = 404
      response.end()
      return
    }

    const chunks: Array<Buffer> = []
    request.on(`data`, (chunk) => {
      chunks.push(Buffer.from(chunk))
    })
    request.on(`end`, () => {
      try {
        latestMessage = JSON.parse(Buffer.concat(chunks).toString(`utf8`)) as
          | TauriE2ERunResult
          | {
              kind: `status`
              phase: string
              details?: unknown
            }
        response.statusCode = 204
        response.end()
      } catch {
        response.statusCode = 400
        response.end()
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    reportServer.listen(0, `127.0.0.1`, () => resolve())
    reportServer.once(`error`, reject)
  })

  const reportPort = (
    reportServer.address() as {
      port: number
    }
  ).port
  const reportUrl = `http://127.0.0.1:${String(reportPort)}`

  const stdoutCollector = createOutputCollector()
  const stderrCollector = createOutputCollector()

  const child = spawn(`pnpm`, [`exec`, `tauri`, `dev`, `--no-watch`], {
    cwd: appDirectory,
    env: {
      ...process.env,
      VITE_TANSTACK_DB_TAURI_E2E_RUN_ID: runId,
      VITE_TANSTACK_DB_TAURI_E2E_REPORT_URL: reportUrl,
    },
    stdio: [`ignore`, `pipe`, `pipe`],
    detached: true,
  })

  child.stdout.on(`data`, (chunk) => {
    stdoutCollector.append(chunk)
  })
  child.stderr.on(`data`, (chunk) => {
    stderrCollector.append(chunk)
  })

  const startedAt = Date.now()

  try {
    while (Date.now() - startedAt < timeoutMs) {
      if (child.exitCode !== null) {
        throw new Error(
          `Tauri e2e process exited before producing results.\nLatest message: ${JSON.stringify(latestMessage)}\nSTDOUT:\n${stdoutCollector.getOutput()}\nSTDERR:\n${stderrCollector.getOutput()}`,
        )
      }

      if (isTauriE2ERunResult(latestMessage)) {
        return latestMessage
      }

      await delay(1_000)
    }

    throw new Error(
      `Timed out waiting for Tauri e2e results.\nLatest message: ${JSON.stringify(latestMessage)}\nSTDOUT:\n${stdoutCollector.getOutput()}\nSTDERR:\n${stderrCollector.getOutput()}`,
    )
  } finally {
    try {
      if (typeof child.pid === `number`) {
        process.kill(-child.pid, `SIGTERM`)
      }
    } catch {
      try {
        child.kill(`SIGTERM`)
      } catch {}
    }

    await delay(1_000).catch(() => {})
    await new Promise<void>((resolve) => {
      reportServer.close(() => resolve())
    })
  }
}
