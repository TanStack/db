#!/usr/bin/env node
// Gap report: which production behaviour do the oracles that own it leave
// unexercised or unjudged?
//
// The report does not locate bugs or judge laws. It lists gaps: evidence that
// the owning oracles cannot see some difference in production. The author
// states the law each gap reveals and re-plans the oracle (report.mjs). For
// the source files given, it:
//
// 1. Compiles every operator mutant into one instrumented copy of each file
//    (schemata.mjs) and serves that copy to Vitest through a plugin. Nothing
//    is written to the source file. State-probe code is marked and left out.
// 2. Finds every test file the package's Vitest config includes. A test file
//    that calls `declareOracle({ owns })` is an oracle file; owning an entry
//    function owns its static call tree (owners.mjs). A declaration that
//    names nothing or is not a literal list refuses the run, because it would
//    hide gaps.
// 3. Runs every test file twice with no mutant active. Each test reports the
//    mutation sites it reached, the outcomes each `if` took, the values it
//    asserted on and observed, its registered route, and its law verdicts
//    (capture-setup.mjs). A test whose values differ between the runs is
//    nondeterministic and judges nothing. An oracle file that fails here
//    refuses the run; an ordinary file is left out and listed.
// 4. Runs each mutant against the owner files whose tests reached it, in a
//    warm Vitest process, and classifies it (see `outcomeOf`): `killed` only
//    by a law verdict on a reproducible route; otherwise a gap. A mutant in a
//    function no oracle owns is `unowned`, a warning. Survivors are sorted
//    into `comparison-gap`, `generator-gap`, `no-observed-difference`, and
//    `indeterminate`.
// 5. Runs a survivor against the ordinary tests that reach it, for
//    information only: an ordinary test never closes a gap.
//
// The pipeline lives in check.mjs, as a session that keeps Vitest warm. A
// cold run opens one session for one check. With --daemon, the CLI sends the
// check to a daemon for the package (daemon.mjs), starting it if needed; the
// daemon keeps its session and an evidence store on disk, reuses every unit
// of evidence whose inputs are unchanged, and reports what a cold run would.
//
// The rules come from the maintainer's decisions in the gap-check design
// (runs v11, v14, and v19 under ~/.cache/oracle-grammar; not yet in the
// repository's decision register). The CLI's own oracle is
// gap-report-oracle.property.test.mjs.
//
// --seed sets TANSTACK_DB_ORACLE_SEED in every test run, so random campaigns
// run the same histories every time and captured values stay comparable.
//
// Usage:
//   node scripts/oracle-gaps/index.mjs --package <dir> --source <src/x.ts,...>
//     [--daemon]              (check through the package's daemon)
//     [--seed <n>] [--mutants <dir>] [--out <dir>] [--only <id,id>]
//     [--diff-base <rev>]
//     [--test-timeout <ms>]   (default 15000; also bounds hooks and teardown.
//                              Each mutant run also has a wall-clock limit of
//                              10 s plus three times its file's unmutated time.)
//     [--sample <n>]          (a fixed-seed sample of n mutants per source;
//                              the report marks the run as partial)
//     [--contexts <n>]        (warm contexts, one worker each; default
//                              the machine's parallelism minus 2, at most 8)
//   node scripts/oracle-gaps/index.mjs --stop-daemon --package <dir>
import { realpathSync } from 'node:fs'
import { parseArgs } from './args.mjs'
import { openSession } from './check.mjs'
import { requestDaemon, stopDaemon } from './daemon.mjs'
import { memoryStore } from './evidence.mjs'

if (import.meta.url === `file://${realpathSync(process.argv[1])}`) {
  let exitCode = 0
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.stop) await stopDaemon(options.pkg)
    else if (options.daemon) {
      const reply = await requestDaemon(options.pkg, process.argv.slice(2))
      if (reply.stderr) process.stderr.write(reply.stderr)
      if (reply.stdout) process.stdout.write(reply.stdout)
      exitCode = reply.exitCode
    } else {
      const session = await openSession(options.pkg)
      try {
        console.log(await session.check(options, memoryStore()))
      } finally {
        await session.close()
      }
    }
  } catch (error) {
    console.error(error)
    exitCode = 1
  }
  process.exit(exitCode)
}
