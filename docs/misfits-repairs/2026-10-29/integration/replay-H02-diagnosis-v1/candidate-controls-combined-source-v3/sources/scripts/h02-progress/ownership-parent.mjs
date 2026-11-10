import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHeapDiagnostic } from './receiving-monitor.mjs'

export const ownershipLimits = Object.freeze({
  wallMs: 60_000,
  nodeHeapMiB: 384,
  groupRssBytes: 1024 ** 3,
  samplingMs: 100,
})

/**
 * This parent contains one finite invocation of the existing ownership owner.
 * It computes no product expectation. Timeout, resource, source-identity and
 * recording failures are operational failures, never product RED evidence.
 * The child and its workers keep the original detached process group. Raw
 * stdout/stderr use inherited file descriptors and survive leader exit.
 */

/** @param {string} file */
export function hashOwnershipFile(file) {
  const digest = createHash(`sha256`)
  const fd = openSync(file, `r`)
  try {
    if (!fstatSync(fd).isFile()) throw new Error(`identity input is not a file`)
    const bytes = Buffer.alloc(64 * 1024)
    for (;;) {
      const count = readSync(fd, bytes, 0, bytes.length, null)
      if (count === 0) break
      digest.update(bytes.subarray(0, count))
    }
    return digest.digest(`hex`)
  } finally {
    closeSync(fd)
  }
}

/** @param {string} text @param {number} pgid */
export function ownershipGroupRows(text, pgid) {
  if (!Number.isSafeInteger(pgid) || pgid <= 0)
    throw new Error(`invalid original process group`)
  return text.split(`\n`).flatMap((line) => {
    const fields = line.trim().split(/\s+/)
    if (Number(fields[1]) !== pgid) return []
    const pid = Number(fields[0])
    const rssKiB = Number(fields[2])
    if (
      !Number.isSafeInteger(pid) ||
      pid <= 0 ||
      !Number.isSafeInteger(rssKiB) ||
      rssKiB < 0
    )
      throw new Error(`invalid process group row: ${line}`)
    return [{ pid, pgid, rssBytes: rssKiB * 1024, raw: line }]
  })
}

/** @param {number} elapsedMs @param {number} rssBytes @param {boolean} heap */
export function ownershipCut(elapsedMs, rssBytes, heap) {
  if (heap) return `heap`
  if (rssBytes > ownershipLimits.groupRssBytes) return `rss`
  if (elapsedMs >= ownershipLimits.wallMs) return `wall`
  return undefined
}

/**
 * @param {{ trigger?: string, heap: boolean, observationError?: string,
 * identityMatched: boolean, remainingGroup: number, cleanupErrors: number,
 * exitCode: number | null, signal: string | null }} facts
 */
export function classifyOwnershipCommand(facts) {
  if (
    facts.trigger ||
    facts.heap ||
    facts.observationError ||
    !facts.identityMatched ||
    facts.remainingGroup ||
    facts.cleanupErrors ||
    facts.signal ||
    facts.exitCode === null
  )
    return `operational failure; no product verdict`
  return facts.exitCode === 0
    ? `finite test command passed; inspect assertions and reach evidence`
    : `finite test command failed; inspect original assertion diagnostics`
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function object(value) {
  if (typeof value !== `object` || value === null || Array.isArray(value))
    throw new Error(`expected identity record`)
  return /** @type {Record<string, unknown>} */ (value)
}

/** @param {unknown} value @returns {string} */
function string(value) {
  if (typeof value !== `string` || !value)
    throw new Error(`expected identity string`)
  return value
}

/** @param {unknown} value @returns {Array<string>} */
function strings(value) {
  if (!Array.isArray(value) || !value.every((part) => typeof part === `string`))
    throw new Error(`expected command arguments`)
  return value
}

/** @param {unknown} input @param {unknown} sourceFreeze */
export function validateOwnershipRecipe(input, sourceFreeze) {
  const recipe = object(input)
  const freeze = object(sourceFreeze)
  const worktree = string(freeze.worktree)
  const node = object(freeze.node)
  const packages = object(freeze.packages)
  const vitest = object(packages.vitest)
  const executable = string(node.executable)
  const expectedArgs = [
    `--max-old-space-size=384`,
    resolve(string(vitest.resolved), `vitest.mjs`),
    `run`,
    `--config`,
    `scripts/h02-progress/ownership-neighbor.config.ts`,
    `packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts`,
    `-t`,
    `keeps a reacquired lease's result`,
  ]
  if (
    recipe.kind !== `h02-ownership-neighbor` ||
    recipe.worktree !== worktree ||
    recipe.executable !== executable ||
    JSON.stringify(strings(recipe.args)) !== JSON.stringify(expectedArgs) ||
    JSON.stringify(object(recipe.limits)) !== JSON.stringify(ownershipLimits)
  )
    throw new Error(`ownership recipe differs from the finite frozen command`)
  return {
    worktree,
    executable,
    args: expectedArgs,
    outputDirectory: string(recipe.outputDirectory),
  }
}

/** @param {Record<string, unknown>} freeze */
export function verifyOwnershipIdentity(freeze) {
  const worktree = string(freeze.worktree)
  let inputs = 0
  for (const key of [
    `productionFiles`,
    `instrumentFiles`,
    `sharedInstrumentFiles`,
  ]) {
    for (const [relative, digest] of Object.entries(object(freeze[key]))) {
      const file = resolve(worktree, relative)
      if (!file.startsWith(worktree + `/`))
        throw new Error(`outside frozen source`)
      if (hashOwnershipFile(file) !== digest)
        throw new Error(`source identity differs: ${relative}`)
      inputs++
    }
  }
  const node = object(freeze.node)
  if (hashOwnershipFile(string(node.executable)) !== node.sha256)
    throw new Error(`selected Node identity differs`)
  const locks = object(freeze.lockfiles)
  if (
    hashOwnershipFile(resolve(worktree, `pnpm-lock.yaml`)) !==
      locks.repoPnpmLock ||
    hashOwnershipFile(resolve(worktree, `node_modules/.pnpm/lock.yaml`)) !==
      locks.installedPnpmLock
  )
    throw new Error(`lockfile identity differs`)
  for (const [relative, value] of Object.entries(
    object(freeze.dependencyReuseLinks),
  )) {
    const link = object(value)
    const file = resolve(worktree, relative)
    if (
      lstatSync(file).isSymbolicLink() !== link.isSymlink ||
      realpathSync(file) !== link.resolved
    )
      throw new Error(`dependency reuse identity differs: ${relative}`)
  }
  let payloadFiles = 0
  for (const value of Object.values(object(freeze.packages))) {
    const pkg = object(value)
    for (const [relative, digest] of Object.entries(
      object(pkg.regularPayloadFilesMap),
    )) {
      if (hashOwnershipFile(resolve(string(pkg.resolved), relative)) !== digest)
        throw new Error(`dependency payload differs: ${relative}`)
      payloadFiles++
    }
  }
  return {
    diskSourcesMatched: inputs,
    payloadFilesMatched: payloadFiles,
    nodeAndLocksAndLinksMatched: true,
  }
}

/** @param {string} recipePath */
export async function runOwnershipRecipe(recipePath) {
  const recipe = object(JSON.parse(readFileSync(recipePath, `utf8`)))
  const freezePath = string(recipe.sourceFreeze)
  if (hashOwnershipFile(freezePath) !== recipe.sourceFreezeSha256)
    throw new Error(`source freeze file differs from accepted recipe`)
  const freeze = object(JSON.parse(readFileSync(freezePath, `utf8`)))
  const command = validateOwnershipRecipe(recipe, freeze)
  if (
    fileURLToPath(import.meta.url) !==
    resolve(command.worktree, `scripts/h02-progress/ownership-parent.mjs`)
  )
    throw new Error(`ownership parent is outside the selected source root`)
  // Never reuse an output directory. A failed setup cannot overwrite evidence.
  const directory = resolve(command.outputDirectory)
  mkdirSync(directory, { mode: 0o700 })
  /** @param {string} name @param {unknown} value */
  const save = (name, value) =>
    writeFileSync(resolve(directory, name), JSON.stringify(value, null, 2), {
      flag: `wx`,
      mode: 0o600,
    })
  save(`invocation.json`, {
    recipePath,
    recipeSha256: hashOwnershipFile(recipePath),
    command,
    limits: ownershipLimits,
    parentPid: process.pid,
    proofBoundary: `on-disk identity only; no V8 loaded-source binding claimed`,
  })
  save(`identity-before.json`, verifyOwnershipIdentity(freeze))
  writeFileSync(
    resolve(directory, `source-freeze.json`),
    readFileSync(freezePath),
    { flag: `wx`, mode: 0o600 },
  )
  const stdoutFile = resolve(directory, `worker.stdout.log`)
  const stderrFile = resolve(directory, `worker.stderr.log`)
  /** @type {Array<number>} */
  const descriptors = []
  /** @type {number | undefined} */
  let pgid
  /** @type {string | undefined} */
  let trigger
  /** @type {string | undefined} */
  let observationError
  /** @type {number | null} */
  let exitCode = null
  /** @type {string | null} */
  let signal = null
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let timer
  let stderrOffset = 0
  let maxSampledGroupRssBytes = 0
  /** @type {ReturnType<typeof ownershipGroupRows>} */
  let lastRows = []
  /** @type {Array<string>} */
  const cleanupErrors = []
  const heap = createHeapDiagnostic()
  let started = performance.now()
  /** @returns {ReturnType<typeof ownershipGroupRows>} */
  const group = () => {
    if (pgid === undefined) return []
    return ownershipGroupRows(
      execFileSync(`/bin/ps`, [`-axo`, `pid=,pgid=,rss=,args=`], {
        encoding: `utf8`,
        timeout: 2000,
        maxBuffer: 4 * 1024 ** 2,
      }),
      pgid,
    )
  }
  const killGroup = () => {
    if (pgid === undefined) return
    try {
      process.kill(-pgid, `SIGKILL`)
    } catch (error) {
      if (!(
        error instanceof Error &&
        `code` in error &&
        error.code === `ESRCH`
      ))
        cleanupErrors.push(String(error))
    }
  }
  /** @param {string} reason */
  const kill = (reason) => {
    if (trigger || pgid === undefined) return
    trigger = reason
    try {
      save(`before-kill.json`, {
        trigger,
        elapsedMonotonicMs: performance.now() - started,
        originalPgid: pgid,
        rows: lastRows,
        heapDetected: heap.detected(),
        maxSampledGroupRssBytes,
      })
    } catch (error) {
      observationError ??= String(error)
    } finally {
      // Recording failure cannot prevent process containment.
      killGroup()
    }
  }
  /** @type {number | undefined} */
  let stderrRead
  /** @param {number | undefined} finalEnd */
  const readDiagnostics = (finalEnd = undefined) => {
    if (stderrRead === undefined) return
    const end = finalEnd ?? fstatSync(stderrRead).size
    const bytes = Buffer.alloc(64 * 1024)
    // A live pass reads a finite prefix; the final pass has a captured end.
    const stop = finalEnd ?? Math.min(end, stderrOffset + 1024 ** 2)
    while (stderrOffset < stop) {
      const count = readSync(
        stderrRead,
        bytes,
        0,
        Math.min(bytes.length, stop - stderrOffset),
        stderrOffset,
      )
      if (count <= 0) throw new Error(`stderr read made no progress`)
      stderrOffset += count
      heap.feed(bytes.subarray(0, count).toString(`utf8`))
    }
  }
  const sample = () => {
    try {
      const before = ownershipCut(
        performance.now() - started,
        0,
        heap.detected(),
      )
      if (before) kill(before)
      readDiagnostics()
      lastRows = group()
      const rss = lastRows.reduce((sum, row) => sum + row.rssBytes, 0)
      maxSampledGroupRssBytes = Math.max(maxSampledGroupRssBytes, rss)
      const cut = ownershipCut(
        performance.now() - started,
        rss,
        heap.detected(),
      )
      if (cut) kill(cut)
    } catch (error) {
      observationError ??= String(error)
      kill(`observation`)
    }
  }
  try {
    const stdoutFd = openSync(stdoutFile, `wx`, 0o600)
    descriptors.push(stdoutFd)
    const stderrFd = openSync(stderrFile, `wx`, 0o600)
    descriptors.push(stderrFd)
    stderrRead = openSync(stderrFile, `r`)
    descriptors.push(stderrRead)
    const environment = { ...process.env }
    for (const name of [
      `NODE_OPTIONS`,
      `NODE_PATH`,
      `TANSTACK_DB_ORACLE_SEED`,
      `TANSTACK_DB_ORACLE_PATH`,
      `TANSTACK_DB_ORACLE_PROPERTY`,
      `TANSTACK_DB_ORACLE_CALIBRATION`,
      `H02_PROGRESS_SOURCE_FREEZE`,
      `H02_PROGRESS_WORKER_HISTORY`,
      `H02_PROGRESS_BINDING_DIR`,
      `H02_PROGRESS_SELECTED_ROOT`,
      `H02_PROGRESS_RECEIPTS`,
    ])
      delete environment[name]
    started = performance.now()
    const child = spawn(command.executable, command.args, {
      cwd: command.worktree,
      detached: true,
      stdio: [`ignore`, stdoutFd, stderrFd],
      env: environment,
    })
    pgid = child.pid
    // Install listeners before fallible post-spawn recording.
    const completion = new Promise((done) => {
      child.once(`error`, (error) => {
        observationError ??= String(error)
        done(undefined)
      })
      child.once(`close`, (code, childSignal) => {
        exitCode = code
        signal = childSignal
        done(undefined)
      })
    })
    timer = setInterval(sample, ownershipLimits.samplingMs)
    save(`child-process.json`, {
      pid: child.pid,
      originalPgid: pgid,
      detached: true,
    })
    await completion
  } catch (error) {
    observationError ??= String(error)
    kill(`observation`)
  } finally {
    if (timer !== undefined) clearInterval(timer)
    try {
      lastRows = group()
      if (lastRows.length) {
        cleanupErrors.push(`leader ended while original process group remained`)
        kill(`leader-exit-with-live-group`)
      }
    } catch (error) {
      observationError ??= String(error)
      kill(`observation`)
    }
    try {
      save(`final-group-before-cleanup.json`, {
        originalPgid: pgid,
        rows: lastRows,
      })
    } catch (error) {
      observationError ??= String(error)
    }
    // Always attempt cleanup even if sampling or recording failed.
    killGroup()
    try {
      const cleanupStarted = performance.now()
      do {
        lastRows = group()
        if (!lastRows.length) break
        await new Promise((done) => setTimeout(done, 100))
      } while (performance.now() - cleanupStarted < 2000)
      if (lastRows.length)
        cleanupErrors.push(`original process group remains live`)
      save(`final-group.json`, { originalPgid: pgid, rows: lastRows })
    } catch (error) {
      observationError ??= String(error)
    }
    try {
      if (stderrRead !== undefined) readDiagnostics(fstatSync(stderrRead).size)
    } catch (error) {
      observationError ??= String(error)
    }
    for (const fd of descriptors) {
      try {
        closeSync(fd)
      } catch (error) {
        cleanupErrors.push(String(error))
      }
    }
  }
  let identityMatched = false
  try {
    save(`identity-after.json`, verifyOwnershipIdentity(freeze))
    identityMatched = true
  } catch (error) {
    observationError ??= String(error)
  }
  const facts = {
    trigger,
    heap: heap.detected(),
    observationError,
    identityMatched,
    remainingGroup: lastRows.length,
    cleanupErrors: cleanupErrors.length,
    exitCode,
    signal,
  }
  const result = {
    classification: classifyOwnershipCommand(facts),
    ...facts,
    cleanupDiagnostics: cleanupErrors,
    elapsedMonotonicMs: performance.now() - started,
    maxSampledGroupRssBytes,
    originalPgid: pgid,
    stdoutSha256: existsSync(stdoutFile)
      ? hashOwnershipFile(stdoutFile)
      : undefined,
    stderrSha256: existsSync(stderrFile)
      ? hashOwnershipFile(stderrFile)
      : undefined,
    limits: `Finite ownership assertions and reaches require review. Operational failures never supply product RED. Only the original process group is captured; no escaped-group claim.`,
  }
  save(`outcome.json`, result)
  return result
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const recipe = process.argv[2]
  if (!recipe) throw new Error(`exact ownership recipe path is required`)
  const result = await runOwnershipRecipe(recipe)
  console.info(JSON.stringify(result))
  process.exitCode = result.classification.startsWith(
    `finite test command passed`,
  )
    ? 0
    : 1
}
