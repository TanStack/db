import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createHeapDiagnostic,
  createPostEnqueueMonitor,
  postEnqueueWindowMs,
  selectSupervisorReason,
} from '../../../scripts/h02-progress/receiving-monitor.mjs'
import {
  checkReceiptFault,
  checkReceiptWriter,
  createReceiptReader,
} from '../../../scripts/h02-progress/receipt-transport.mjs'
import type {
  ProgressHistory,
  ProgressOutcome,
  ProgressReceipt,
} from './queued-answer-progress-oracle.js'

/**
 * A separate process group runs the synchronous production graph. This parent
 * can observe its durable queued receipt even when that graph never returns.
 * The 20s/1GiB limits contain the instrument; they are not product deadlines.
 * Callback/value judgments remain in the oracle, outside this recorder.
 */
export function resolveProgressRoot(
  frozenRoot: string,
  moduleUrl = import.meta.url,
): string {
  // Vitest normalizes the literal new-URL asset pattern to self.location in
  // jsdom. Read the actual file module URL without that browser asset pattern.
  // fileURLToPath rejects non-file input; neither cwd nor the freeze can
  // substitute for an outside or unexpectedly placed supervisor module.
  const file = fileURLToPath(moduleUrl)
  const root = resolve(dirname(file), `../../../`)
  if (
    file !==
    resolve(
      root,
      `packages/query-db-collection/tests/queued-answer-progress-supervisor.ts`,
    )
  )
    throw new Error(`unexpected progress supervisor location: ${file}`)
  if (root !== frozenRoot)
    throw new Error(
      `progress supervisor root differs from frozen root: ${root}`,
    )
  return root
}

export async function receiveProgressHistory(
  history: ProgressHistory,
  observe: (receipt: ProgressReceipt) => void,
): Promise<ProgressOutcome> {
  const sourceFreeze = process.env.H02_PROGRESS_SOURCE_FREEZE
  if (!sourceFreeze)
    throw new Error(
      `H02_PROGRESS_SOURCE_FREEZE is required before receiving execution`,
    )
  const freeze: { worktree: string } = JSON.parse(
    readFileSync(sourceFreeze, `utf8`),
  )
  const root = resolveProgressRoot(freeze.worktree)
  const directory = resolve(
    tmpdir(),
    `h02-progress-${process.pid}-${randomUUID()}`,
  )
  mkdirSync(directory, { mode: 0o700 })
  const historyPath = resolve(directory, `history.json`)
  const logPath = resolve(directory, `receipts.jsonl`)
  const stdoutPath = resolve(directory, `worker.stdout.log`)
  const stderrPath = resolve(directory, `worker.stderr.log`)
  writeFileSync(historyPath, JSON.stringify(history, null, 2))
  const args = [
    `--max-old-space-size=384`,
    realpathSync(resolve(root, `node_modules/vitest/vitest.mjs`)),
    `run`,
    `--config`,
    `scripts/h02-progress/vitest.config.ts`,
    `packages/query-db-collection/tests/queued-answer-progress.receiving.test.ts`,
  ]
  const command = {
    executable: process.execPath,
    args,
    cwd: root,
    historyPath,
    directory,
    receiptTransport: {
      path: logPath,
      flags: `wx`,
      mode: 0o600,
      stdoutPath,
      stderrPath,
    },
    limits: {
      wallMs: 20_000,
      groupRssBytes: 1024 ** 3,
      nodeHeapMiB: 384,
      postEnqueueWindowMs,
    },
  }
  writeFileSync(
    resolve(directory, `prepared.json`),
    JSON.stringify(command, null, 2),
  )
  const stdoutFd = openSync(stdoutPath, `wx`, 0o600)
  let stderrFd: number
  try {
    stderrFd = openSync(stderrPath, `wx`, 0o600)
  } catch (error) {
    try {
      closeSync(stdoutFd)
    } catch {
      // Preserve the primary diagnostic setup failure.
    }
    throw error
  }
  const child = spawn(process.execPath, args, {
    cwd: root,
    detached: true,
    stdio: [`ignore`, `pipe`, `pipe`],
    env: {
      ...process.env,
      H02_PROGRESS_WORKER_HISTORY: historyPath,
      H02_PROGRESS_BINDING_DIR: directory,
      H02_PROGRESS_RECEIPTS: logPath,
      H02_PROGRESS_SELECTED_ROOT: root.replace(/\/$/, ``),
    },
  })
  const outcome: ProgressOutcome = {
    reason: `exited`,
    exitCode: null,
    signal: null,
    receipts: [],
    keyCallbacks: 0,
    prefixViolations: 0,
    warnings: 0,
    cleanupErrors: [],
    logPath,
  }
  const start = Date.now()
  let maxSampledGroupRssBytes = 0
  let latestGroupRows: Array<string> = []
  const heapDiagnostic = createHeapDiagnostic()
  const postEnqueue = createPostEnqueueMonitor()
  let watchdogTrigger: string | undefined
  let killAttempted = false
  let receivingExited = false
  const save = (phase: string) =>
    writeFileSync(
      resolve(directory, `supervisor.json`),
      JSON.stringify(
        {
          ...command,
          phase,
          pid: child.pid,
          elapsedMs: Date.now() - start,
          maxSampledGroupRssBytes,
          latestGroupRows,
          killAttempted,
          watchdogTrigger,
          heapDiagnosticDetected: heapDiagnostic.detected(),
          postEnqueue: postEnqueue.snapshot(),
          outcome,
        },
        null,
        2,
      ),
    )
  save(`spawned`)
  const groupRows = () => {
    const output = execFileSync(`/bin/ps`, [`-axo`, `pid=,pgid=,rss=,args=`], {
      encoding: `utf8`,
      maxBuffer: 4 * 1024 ** 2,
    })
    return output
      .split(`\n`)
      .filter((line) => Number(line.trim().split(/\s+/)[1]) === child.pid)
  }
  const kill = (
    reason: ProgressOutcome[`reason`],
    trigger: string = reason,
  ) => {
    outcome.reason = selectSupervisorReason(
      outcome.reason,
      reason,
      heapDiagnostic.detected(),
    )
    if (killAttempted || child.pid === undefined) return
    watchdogTrigger = trigger
    killAttempted = true
    save(`before-kill`)
    try {
      process.kill(-child.pid, `SIGKILL`)
    } catch (error) {
      if (!(
        error instanceof Error &&
        `code` in error &&
        error.code === `ESRCH`
      ))
        outcome.cleanupErrors.push(String(error))
    }
  }
  const reader = createReceiptReader(logPath, (receipt) => {
    try {
      postEnqueue.observe(receipt, performance.now())
      if (receipt.phase === `query-key-callback`) outcome.keyCallbacks++
      if (receipt.phase === `actual-key-prefix` && receipt.valid !== true)
        outcome.prefixViolations++
      if (receipt.phase === `warning`) outcome.warnings++
      // Keep the raw complete callback/key/lease trace on disk. These few
      // semantic receipts suffice for the independent parent judgment.
      if (
        [
          `worker-start`,
          `conflicting-cache-premise`,
          `answer-queued`,
          `answer-executed`,
          `reload-start`,
          `public-change`,
          `cleanup-start`,
          `retained-publication`,
          `initial-publication`,
          `immediate-publication`,
          `final-publication`,
          `source-stack`,
          `worker-error`,
          `worker-cleaned`,
          `source-establishing-receipt`,
        ].includes(receipt.phase)
      ) {
        outcome.receipts.push(receipt)
      }
      observe(receipt)
    } catch (error) {
      outcome.primaryObservationError ??=
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      if (!receivingExited) kill(`observation`)
    }
  })
  const instrumentFailure = (where: string, error: unknown) => {
    const message = `instrument receipt transport ${where}: ${String(error)}`
    if (outcome.primaryObservationError) outcome.cleanupErrors.push(message)
    else outcome.primaryObservationError = message
    if (!receivingExited) kill(`observation`)
  }
  const diagnostic = (fd: number, data: Buffer) => {
    try {
      let offset = 0
      while (offset < data.length) {
        const count = writeSync(fd, data, offset, data.length - offset)
        if (count <= 0)
          throw new Error(`diagnostic file write made no progress`)
        offset += count
      }
    } catch (error) {
      instrumentFailure(`diagnostic write`, error)
    }
  }
  child.stdout.on(`data`, (data: Buffer) => diagnostic(stdoutFd, data))
  child.stderr.on(`data`, (data: Buffer) => {
    diagnostic(stderrFd, data)
    if (heapDiagnostic.feed(data.toString(`utf8`))) outcome.reason = `heap`
  })
  const interval = setInterval(() => {
    // A large captured receipt prefix must not postpone an already armed cut.
    // Final drain still observes any execution receipt written before the kill.
    if (!receivingExited && postEnqueue.expired(performance.now()))
      kill(`wall`, `post-enqueue-window`)
    try {
      reader.drain()
      checkReceiptFault(logPath)
    } catch (error) {
      instrumentFailure(`live read`, error)
    }
    try {
      latestGroupRows = groupRows()
      const rss = latestGroupRows.reduce(
        (sum, line) => sum + Number(line.trim().split(/\s+/)[2]) * 1024,
        0,
      )
      maxSampledGroupRssBytes = Math.max(maxSampledGroupRssBytes, rss)
      if (rss > command.limits.groupRssBytes) kill(`rss`)
      else if (postEnqueue.expired(performance.now()))
        kill(`wall`, `post-enqueue-window`)
      else if (Date.now() - start > command.limits.wallMs) kill(`wall`)
      save(`monitoring`)
    } catch (error) {
      outcome.cleanupErrors.push(`monitor: ${String(error)}`)
      kill(`observation`)
    }
  }, 100)
  try {
    await new Promise<void>((done) => {
      child.once(`error`, (error) => {
        receivingExited = true
        outcome.cleanupErrors.push(`spawn: ${String(error)}`)
        done()
      })
      child.once(`close`, (code, signal) => {
        receivingExited = true
        outcome.exitCode = code
        outcome.signal = signal
        done()
      })
    })
  } finally {
    clearInterval(interval)
    try {
      latestGroupRows = groupRows()
      if (latestGroupRows.length > 0) {
        // kill() itself records one attempt and ignores later calls. Only a
        // positively observed remaining live group enters this cleanup path.
        kill(`observation`)
        await new Promise<void>((done) => setTimeout(done, 100))
        latestGroupRows = groupRows()
        if (latestGroupRows.length > 0)
          outcome.cleanupErrors.push(
            `remaining process-group rows: ${latestGroupRows.join(` | `)}`,
          )
      }
    } catch (error) {
      outcome.cleanupErrors.push(`final group check: ${String(error)}`)
    }
    try {
      reader.drain(true)
      checkReceiptWriter(logPath)
    } catch (error) {
      instrumentFailure(`final read/setup`, error)
    }
    try {
      reader.close()
    } catch (error) {
      instrumentFailure(`reader close`, error)
    }
    for (const fd of [stdoutFd, stderrFd]) {
      try {
        closeSync(fd)
      } catch (error) {
        instrumentFailure(`diagnostic close`, error)
      }
    }
    if (
      outcome.reason === `exited` &&
      outcome.exitCode !== 0 &&
      !outcome.receipts.some(({ phase }) => phase === `worker-error`)
    ) {
      instrumentFailure(
        `worker exit`,
        `nonzero exit without a worker-error receipt; inspect separate diagnostics`,
      )
    }
    save(`final`)
  }
  try {
    execFileSync(
      process.execPath,
      [
        `--max-old-space-size=384`,
        resolve(root, `scripts/h02-progress/verify-bindings.mjs`),
        directory,
        sourceFreeze,
      ],
      {
        cwd: root,
        encoding: `utf8`,
        timeout: 20_000,
        maxBuffer: 4 * 1024 ** 2,
      },
    )
    const verification: unknown = JSON.parse(
      readFileSync(resolve(directory, `binding-verification.json`), `utf8`),
    )
    if (
      typeof verification !== `object` ||
      verification === null ||
      !(`status` in verification) ||
      verification.status !== `bound`
    )
      throw new Error(`source binding did not establish bound status`)
    outcome.bindingStatus = `bound`
  } catch (error) {
    outcome.bindingStatus = `unresolved`
    outcome.bindingError = String(error)
  }
  save(`final-with-binding`)
  return outcome
}
