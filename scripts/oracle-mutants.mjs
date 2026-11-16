// Runs a list of production mutants against their owner oracles.
//
// Each mutant replaces one exact piece of production code with a plausible
// wrong design. The runner applies it in memory through the package's
// `vitest.mutants.config.ts`, runs the owner oracles, and expects every mutant
// to fail a named test unless the mutant is marked `equivalent` with the reason
// no observation can tell it apart. A mutant whose target no longer matches,
// or that never reached a transformed module, is an error: the list has
// drifted from the code. A kill prints the first failing test and the law that
// its oracle reported.
//
// A mutant list calls `runMutants` and takes `--only=ID,ID` and `--list`.
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, `..`)

function run({ packageDir, oracles, timeoutMs }, mutant) {
  const mark = join(mkdtempSync(join(tmpdir(), `db-mutant-`)), `applied`)
  return new Promise((done) => {
    execFile(
      `npx`,
      [
        `vitest`,
        `run`,
        `--config`,
        `vitest.mutants.config.ts`,
        `--bail`,
        `1`,
        ...oracles,
      ],
      {
        cwd: join(ROOT, packageDir),
        timeout: timeoutMs,
        killSignal: `SIGKILL`,
        maxBuffer: 256 * 1024 * 1024,
        env: {
          ...process.env,
          CI: `1`,
          TANSTACK_DB_MUTANT: JSON.stringify(mutant),
          TANSTACK_DB_MUTANT_MARK: mark,
        },
      },
      (error, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`.replace(/\x1b\[[0-9;]*m/g, ``)
        const failed = output.match(/^\s*×\s.*$/m)?.[0].trim()
        const law = output.match(
          /violated at checkpoint "[^"]*" \(law: ([^)]*)\)/,
        )?.[1]
        const applied =
          existsSync(mark) && readFileSync(mark, `utf8`).trim() !== ``
        if (!applied)
          done({ outcome: `not applied`, detail: output.slice(-2000) })
        else if (error?.killed) done({ outcome: `timeout` })
        else if (!error) done({ outcome: `survived` })
        else if (failed)
          done({
            outcome: `killed`,
            detail: law ? `${failed} (law: ${law})` : failed,
          })
        else done({ outcome: `error`, detail: output.slice(-2000) })
      },
    )
  })
}

/**
 * Runs `mutants` (`{ id, file, find, replace, rationale, equivalent? }`, with
 * `file` relative to the repository) against the `oracles` of the package in
 * `packageDir`, and exits nonzero when a mutant that is not equivalent
 * survives, or any mutant does not apply.
 */
export async function runMutants({ packageDir, oracles, mutants, timeoutMs }) {
  const only = process.argv
    .find((arg) => arg.startsWith(`--only=`))
    ?.slice(`--only=`.length)
    .split(`,`)
  const selected = mutants.filter((mutant) => !only || only.includes(mutant.id))
  if (process.argv.includes(`--list`)) {
    for (const m of selected)
      console.log(
        `${m.id} ${m.equivalent ? `(equivalent) ` : ``}${m.rationale}`,
      )
    return
  }

  // Validate every target before running anything.
  const drifted = selected.filter(
    (m) => readFileSync(join(ROOT, m.file), `utf8`).split(m.find).length !== 2,
  )
  if (drifted.length > 0) {
    console.error(
      `mutant targets no longer match: ${drifted.map((m) => m.id).join(`, `)}`,
    )
    process.exit(1)
  }

  const failures = []
  for (const mutant of selected) {
    const started = Date.now()
    const { outcome, detail } = await run(
      { packageDir, oracles, timeoutMs },
      mutant,
    )
    const expected = mutant.equivalent ? `survived` : `killed`
    const ok =
      outcome === expected || (mutant.equivalent && outcome === `killed`)
    const seconds = Math.round((Date.now() - started) / 1000)
    console.log(
      `${ok ? `ok ` : `BAD`} ${mutant.id} ${outcome} (${seconds}s) ${mutant.rationale}${detail && outcome === `killed` ? ` | ${detail}` : ``}`,
    )
    if (!ok) failures.push({ mutant, outcome, detail })
  }
  for (const { mutant, outcome, detail } of failures) {
    console.error(
      `\n${mutant.id} ${outcome}: ${mutant.rationale}\n${detail ?? ``}`,
    )
  }
  if (failures.length > 0) process.exit(1)
}
